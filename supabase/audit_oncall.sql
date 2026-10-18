-- ============================================================================
-- AUDIT BOOKING ONCALL
--
-- Booking oncall dibuat lewat fungsi create_oncall_booking dan
-- create_oncall_booking_multi. Dua fungsi itu TIDAK memanggil log_audit,
-- sedangkan booking biasa lewat create_booking / create_booking_batch yang
-- sudah memanggil log_audit.
--
-- Akibatnya booking oncall hilang dari Log Aktivitas: 33 dari 750 booking
-- dalam 7 hari tidak punya satu pun entri 'create'. Padahal oncall justru
-- yang paling perlu diawasi, karena uangnya keluar lewat hotel.
--
-- Perbaikannya dipasang sebagai trigger, bukan dengan menyisipkan log_audit
-- ke dalam masing-masing fungsi. Alasannya:
--   - booking oncall bisa masuk dari beberapa jalur (satu, banyak, form
--     koreksi, impor). Kalau ditambahkan fungsi demi fungsi, pasti ada lagi
--     yang terlewat.
--   - trigger menutup semua jalur sekaligus, termasuk yang akan dibuat
--     di kemudian hari.
--
-- Yang dicatat hanya booking oncall. Booking biasa sudah dicatat oleh
-- log_audit di dalam RPC-nya, jadi trigger ini tidak akan mencatat dua kali.
--
-- created_by juga ikut diisi di sini, karena tadinya kolom itu kosong untuk
-- oncall sehingga tidak ada yang bisa dimintai keterangan.
-- ============================================================================

create or replace function public.audit_booking_oncall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Hanya oncall. Booking biasa sudah punya jejaknya sendiri.
  if coalesce(new.booking_source, '') <> 'oncall' then
    return new;
  end if;

  -- Kalau entri audit untuk baris ini sudah ada (mis. RPC yang memang
  -- memanggil log_audit), jangan tulis dua kali.
  if exists (
    select 1 from audit_logs
     where record_id = new.id and action = 'create'
  ) then
    return new;
  end if;

  -- Isi created_by kalau RPC tidak mengisinya.
  if new.created_by is null then
    update bookings set created_by = auth.uid() where id = new.id;
  end if;

  insert into audit_logs
    (actor, actor_name, action, table_name, record_id, outlet_id, detail)
  values (
    auth.uid(),
    coalesce((select name from users where id = auth.uid()), 'system'),
    'create',
    'bookings',
    new.id,
    new.outlet_id,
    jsonb_build_object(
      'treatment_name', new.treatment_name,
      'treatment_price', new.treatment_price,
      'hotel_commission', new.hotel_commission,
      'commission_amount', new.commission_amount,
      'therapist_name', new.therapist_name,
      'customer_name', new.customer_name,
      'payment_method', new.payment_method,
      'catatan', 'dicatat otomatis oleh trigger oncall'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_audit_booking_oncall on bookings;
create trigger trg_audit_booking_oncall
  after insert on bookings
  for each row
  execute function public.audit_booking_oncall();


-- Booking oncall yang sudah terlanjur dibuat sebelum trigger ini dipasang
-- tetap perlu masuk log, kalau tidak riwayatnya bolong.
--
-- created_at ikut memakai jam booking aslinya. Kalau dibiarkan memakai jam
-- sekarang, semuanya akan menumpuk di hari pemasangan dan Log Aktivitas
-- akan dipenuhi ratusan entri palsu di tanggal hari itu.
-- Hanya 30 hari terakhir, supaya tidak membebani.
insert into audit_logs
  (actor, actor_name, action, table_name, record_id, outlet_id, detail, created_at)
select
  null,
  'sistem',
  'create',
  'bookings',
  b.id,
  b.outlet_id,
  jsonb_build_object(
    'treatment_name', b.treatment_name,
    'treatment_price', b.treatment_price,
    'hotel_commission', b.hotel_commission,
    'commission_amount', b.commission_amount,
    'therapist_name', b.therapist_name,
    'customer_name', b.customer_name,
    'payment_method', b.payment_method,
    'catatan', 'diisi ulang oleh trigger oncall'
  ),
  b.created_at
  from bookings b
 where b.booking_source = 'oncall'
   and b.created_at > now() - interval '30 days'
   and not exists (
     select 1 from audit_logs a where a.record_id = b.id and a.action = 'create'
   );
