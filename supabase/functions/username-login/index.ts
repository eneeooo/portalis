import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });

  try {
    const body = await request.json();
    const studentNumber = typeof body.student_number === "string" ? body.student_number.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^\d{2}-\d{2}-\d{3}$/.test(studentNumber) || !password) {
      return Response.json({ error: "A valid student number and password are required." }, { status: 400, headers: corsHeaders });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase function configuration.");

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id").eq("student_number", studentNumber).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return Response.json({ error: "Invalid student number or password." }, { status: 401, headers: corsHeaders });

    const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.id);
    if (accountError || !account.user?.email) {
      return Response.json({
        error: "This account has no Supabase Auth login. Ask an admin to restore the account before signing in.",
      }, { status: 409, headers: corsHeaders });
    }
    const { data, error } = await auth.auth.signInWithPassword({ email: account.user.email, password });
    if (error || !data.session) {
      return Response.json({ error: "Invalid student number or password." }, { status: 401, headers: corsHeaders });
    }
    return Response.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error("Student-number login failed:", error);
    return Response.json({ error: "Unable to log in right now." }, { status: 500, headers: corsHeaders });
  }
});
