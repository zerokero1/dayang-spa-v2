import { supabase } from './supabase';

export const OFFICE_EMAIL = 'office.op@dayang.com';

/** Catat login akun office ke audit_logs (fire-and-forget; tak mengganggu alur login). */
export function logOfficeLogin() {
  supabase.rpc('log_office_login').then(({ error }) => {
    if (error) console.warn('[logOffice] gagal mencatat login:', error.message);
  });
}

/** Ambil riwayat aktivitas akun office (aksi koreksi/hapus + login). */
export async function getOfficeActivity(userId, limit = 300) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, actor, actor_name, action, table_name, record_id, outlet_id, detail, created_at')
    .eq('actor', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}