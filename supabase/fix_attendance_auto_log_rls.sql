-- Perbaiki trigger audit absensi agar dapat menulis log saat RLS aktif.
-- Jalankan pada database VPS; tidak memberi role kasir hak INSERT langsung
-- ke tabel audit attendance_auto_log.
create or replace function public.catat_perubahan_absensi()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_otomatis boolean;
begin
  select (old.source = 'auto') into v_otomatis;
  if not coalesce(v_otomatis, false) then
    return null;
  end if;

  insert into public.attendance_auto_log
    (employee_id, employee_name, date, outlet_id, tipe_sebelum, tipe_sesudah,
     source_sebelum, action, oleh, treatment_saat_ini)
  values (
    old.employee_id, old.employee_name, old.date, old.outlet_id,
    old.type::text, new.type::text, old.source,
    'kasir-ubah', new.recorded_by, null
  );
  return null;
end;
$$;