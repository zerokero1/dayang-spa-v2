import { createClient } from '@supabase/supabase-js';

// GANTI dengan kredensial proyek Supabase kamu (Settings -> API):
//   SUPABASE_URL   = Project URL, contoh: https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY = anon public (bukan service_role!)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'TU-ISIKAN-SUPABASE-URL';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'TU-ISIKAN-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
