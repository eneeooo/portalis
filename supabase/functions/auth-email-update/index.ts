import { createClient } from "npm:@supabase/supabase-js@2";

// Saves the student's REAL (contact) email on their profile.
// The Auth login identity stays <student number>@login.portalis.invalid, so
// student-number login can never break. No confirmation email is sent: the
// Supabase admin API applies changes directly and has no email flow, and the
// built-in mailer cannot reach arbitrary addresses anyway.

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
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in before changing your email." }, 401);

  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const clear = email === "";
    if (!clear && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith(".invalid"))) {
      return json({ error: "Enter a valid email address." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase function configuration.");

    const accessToken = authorization.slice("Bearer ".length);
    const caller = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await caller.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);
    const user = authData.user;

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("student_number").eq("id", user.id).maybeSingle();
    if (profileError) throw new Error("Could not load your profile: " + profileError.message);
    if (!profile) return json({ error: "Profile not found." }, 404);

    // Repair/keep the login identity. An earlier version of this function wrote the
    // real email into Auth, which breaks student-number login.
    if (profile.student_number) {
      const loginEmail = profile.student_number + "@login.portalis.invalid";
      if ((user.email ?? "").toLowerCase() !== loginEmail) {
        const { error: fixError } = await admin.auth.admin.updateUserById(user.id, {
          email: loginEmail,
          email_confirm: true,
        });
        if (fixError) throw new Error("Could not restore the student-number login: " + fixError.message);
      }
    }

    // Done after the Auth update so the email-sync trigger cannot blank it again.
    const { data: saved, error: updateError } = await admin.from("profiles")
      .update({ email: clear ? null : email }).eq("id", user.id).select("email");
    if (updateError) throw new Error("Could not save the email: " + updateError.message);
    if (!saved || saved.length === 0) throw new Error("No profile row was updated for this account.");
    if ((saved[0].email ?? null) !== (clear ? null : email)) {
      throw new Error("The database changed the email while saving it (a trigger overwrote it). Run migration_fix_profile_update.sql.");
    }

    return json({ updated: true, version: "profile-email-v2", email: saved[0].email });
  } catch (error) {
    console.error("Email update failed:", error);
    return json({
      error: error instanceof Error ? error.message : "Unable to update the email address.",
    }, 500);
  }
});
