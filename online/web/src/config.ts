// Προεπιλογές demo project — overridable με VITE_ env vars στο Cloudflare Pages.
// Το anon key είναι ΔΗΜΟΣΙΟ by design (χρησιμοποιείται στον browser).
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jyxcqenkguokveyfsvvs.supabase.co";

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5eGNxZW5rZ3Vva3ZleWZzdnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0Nzk0MjcsImV4cCI6MjA5NjA1NTQyN30.McYDzilz2h0FuOAb-xV8g-vvBTuHe5CFnsYggVLS3is";
