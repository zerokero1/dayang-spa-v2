-- ============================================================
-- LOG AKTIVITAS OFFICE — cantatat tiap login akun office.op@dayang.com
-- ke tabel audit_logs (action = 'login'), supaya ada jejak siapa &
-- kapan office masuk ke sistem.
--
-- Aksi office lainnya (koreksi 'edit', hapus treatment 'cancel',
-- diskon) SUDAH dicatat otomatis oleh edit_booking_correction &
-- hapus_booking_office via log_audit.
--
-- JALANKAN file ini SEKALI di Supabase SQL Editor.
-- ============================================================

create or replace function log_office_login()
returns void
language plpgsql
security definer
as $fn$
declare
  v_email text;
  v_name text;
begin
  select email into v_email from auth.users where id = auth.uid();

  -- Hanya dicatat bila yang login memang akun office
  if lower(coalesce(v_email, '')) <> 'office.op@dayang.com' then
    return;
  end if;

  select name into v_name from users where id = auth.uid();

  insert into audit_logs (actor, actor_name, action, table_name, record_id, outlet_id, detail)
  values (auth.uid(), coalesce(v_name, 'office'), 'login', 'session', null, null, '{}'::jsonb);
end;
$fn$;

grant execute on function public.log_office_login() to authenticated;