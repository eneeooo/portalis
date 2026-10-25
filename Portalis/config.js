// Supabase connection (anon key is public by design; RLS protects the data)
const SUPABASE_URL = "https://wtvdcmlwaihcllpghikd.supabase.co";
// Paste your PUBLISHABLE key here (Supabase -> Project Settings -> API Keys -> "Publishable key",
// it starts with sb_publishable_). Edge Functions now reject the old anon key.
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_-hBfMNgQjQvYcUy4-zJ0Kw_dxoVUbbT";

// Legacy anon key, only used while the publishable key above is empty.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0dmRjbWx3YWloY2xscGdoaWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MTcwNzEsImV4cCI6MjEwODQ5MzA3MX0.bAsTFR7xfUz_n7XWhs684rMPcN0qX5CKx0kQXr14gXw";
const sb = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY,
);
