import { createClient } from '@supabase/supabase-js';

// GANTI dengan kredensial proyek Supabase kamu (Settings -> API):
//   SUPABASE_URL   = Project URL, contoh: https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY = anon public (bukan service_role!)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://lombokdayangspa.tech';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheWFuZyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzkwNTI4Mjg5LCJleHAiOjIxMDU4ODgyODl9.f_ITyQOiRlYXCvENa-qSdYSRZPN7uMrC2LzKIDa0s4g';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
