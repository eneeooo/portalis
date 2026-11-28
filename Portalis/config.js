// Supabase connection (the publishable key is public by design; RLS protects the data)
const SUPABASE_URL = "https://wtvdcmlwaihcllpghikd.supabase.co";
// Publishable key: Supabase -> Project Settings -> API Keys -> "Publishable key" (starts with sb_publishable_).
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_-hBfMNgQjQvYcUy4-zJ0Kw_dxoVUbbT";
if (!SUPABASE_PUBLISHABLE_KEY) throw new Error("SUPABASE_PUBLISHABLE_KEY is missing in config.js.");
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
