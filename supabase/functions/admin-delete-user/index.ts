import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in as an admin first." }, 401);

  try {
    const { userId } = await request.json();
    if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return json({ error: "A valid user ID is required." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase function configuration.");

    const accessToken = authorization.slice("Bearer ".length);
    const caller = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await caller.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);
    if (authData.user.id === userId) return json({ error: "You cannot delete the currently signed-in admin account." }, 400);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) throw new Error("Could not verify admin permissions: " + profileError.message);
    if (!profile || !["admin", "officer"].includes(profile.role)) {
      return json({ error: "Only admins and officers can delete users." }, 403);
    }

    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError) throw new Error("Could not load the selected account: " + targetError.message);
    if (!target.user) return json({ error: "That user account was not found." }, 404);

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error("Supabase Auth could not delete the account: " + deleteError.message);

    // Belt and braces: if a foreign key ever stops cascading, still free the student number.
    const { error: profileDeleteError } = await admin.from("profiles").delete().eq("id", userId);
    if (profileDeleteError) console.error("Auth user deleted but profile cleanup failed:", profileDeleteError.message);

    const { error: avatarError } = await admin.storage.from("avatars").remove([userId + "/profile"]);
    if (avatarError && !/not found|does not exist|no rows/i.test(avatarError.message)) {
      console.error("Deleted user but could not remove profile avatar:", avatarError.message);
      return json({ deleted: true, warning: "The account was deleted, but its profile picture could not be removed." });
    }

    return json({ deleted: true });
  } catch (error) {
    console.error("Admin user deletion failed:", error);
    return json({
      error: error instanceof Error ? error.message : "Unable to delete the user. Check the Supabase Edge Function logs.",
    }, 500);
  }
});
