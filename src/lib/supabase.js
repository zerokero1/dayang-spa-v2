import { createClient } from '@supabase/supabase-js';

// GANTI dengan kredensial proyek Supabase kamu (Settings -> API):
//   SUPABASE_URL   = Project URL, contoh: https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY = anon public (bukan service_role!)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ifvkussvmgmprhmxbevj.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmdmt1c3N2bWdtcHJobXhiZXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5OTgyOTQsImV4cCI6MjEwMzU3NDI5NH0.MeiDCsNpScioNVlnHBq2cMZABznUaVFtWw0KEQ13A_8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
