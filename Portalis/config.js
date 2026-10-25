// Supabase connection (anon key is public by design; RLS protects the data)
const SUPABASE_URL = "https://xrbehmcvywexlpddmcsp.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyYmVobWN2eXdleGxwZGRtY3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4OTA0NTQsImV4cCI6MjEwODQ2NjQ1NH0.75iCBvnfHc6voSQ2P__AdmlYPR9sTGzKEQpgaBFZm5w";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
