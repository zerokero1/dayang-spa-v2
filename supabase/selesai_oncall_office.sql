-- ============================================================
-- SELESAIKAN ONCALL SEGERA — KHUSUS AKUN OFFICE
--
-- 1. Fungsi: selesai_oncall_booking_office(booking_id)
--    Mengakhiri transaksi oncall kapan pun:
--      - booking ditandai selesai (tetap LUNAS, komisi tetap dihitung)
--      - terapis dilepas dari blokir oncall itu SEGERA (tidak menunggu
--        jam selesai), selama tidak ada sesi lain (oncall lain / in-house).
--    Hanya akun office.op@dayang.com yang boleh memanggil.
--
-- 2. Perubahan auto_free_expired_therapists (kasus 3):
--    Block masuk HANYA untuk oncall yang masih terikat di terapis
--    (current_group_id / current_booking_ids), sehingga oncall yang
--    sudah diselesaikan office tidak akan memblok ulang terapis.
--
-- JALANKAN SEKALI di Supabase SQL Editor (atau via script).
-- ============================================================

-- ------------------------------------------------------------
-- 1. selesai_oncall_booking_office
-- ------------------------------------------------------------
create or replace function public.selesai_oncall_booking_office(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tid uuid;
  v_other_oncall integer := 0;
  v_in_house integer := 0;
begin
  if not is_office_op() then
    raise exception 'Fitur ini khusus akun office';
  end if;

  if not exists (
    select 1 from bookings
    where id = p_booking_id and booking_source = 'oncall' and status <> 'batal'
  ) then
    raise exception 'Transaksi oncall tidak ditemukan atau sudah dibatalkan';
  end if;

  select therapist_id into v_tid from bookings where id = p_booking_id;

  -- Akhiri booking (tetap lunas, komisi tidak berubah).
  update bookings
     set status = 'selesai',
         paid = true,
         cancelled_at = null
   where id = p_booking_id and booking_source = 'oncall';

  select count(*) into v_other_oncall
    from bookings
   where booking_source = 'oncall'
     and status <> 'batal'
     and id <> p_booking_id
     and therapist_id = v_tid;

  select count(*) into v_in_house
    from bookings
   where status = 'berjalan'
     and therapist_id = v_tid;

  -- Bebaskan bila tidak ada oncall lain maupun sesi berjalan lain.
  if v_other_oncall = 0 and v_in_house = 0 then
    update therapists
       set status = 'free',
           current_outlet_id = null,
           current_booking_id = null,
           current_booking_ids = '[]'::jsonb,
           current_treatment_names = '[]'::jsonb,
           current_treatment_name = null,
           current_paid = false,
           current_payment_method = null,
           current_price = null,
           current_group_id = null,
           start_at = null,
           end_at = null
     where current_group_id = 'oncall:' || p_booking_id::text;
  else
    -- Masih ada sesi lain: lepas saja kaitan oncall ini dari terapis
    -- (biarkan sesi in-house / oncall lain tetap jalan).
    update therapists
       set current_booking_ids = (current_booking_ids - p_booking_id::text::text)
     where current_group_id = 'oncall:' || p_booking_id::text;
  end if;
end;
$function$;

grant execute on function public.selesai_oncall_booking_office(uuid) to authenticated;
grant execute on function public.selesai_oncall_booking_office(uuid) to anon;

-- ------------------------------------------------------------
-- 2. auto_free_expired_therapists — block oncall hanya yang terikat
-- ------------------------------------------------------------
create or replace function auto_free_expired_therapists()
returns int
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_now bigint;
  r record;
  v_done int := 0;
begin
  v_now := (extract(epoch from now()) * 1000)::bigint;

  -- (1) Terapis yang waktu treatment-nya sudah lewat -> langsung free.
  --     Booking TIDAK disentuh (tetap 'berjalan').
  for r in
    select t.id as tid
    from therapists t
    where t.status = 'ambil_tamu'
      and t.end_at is not null
      and t.end_at <= v_now
  loop
    perform clear_therapist_session(r.tid);
    v_done := v_done + 1;
  end loop;

  -- (2) Terapis 'ambil_tamu' yang tidak punya booking 'berjalan' sama sekali
  --     (status nyangkut dari sisa lama) -> paksa bersihkan jadi free.
  for r in
    select t.id as tid
    from therapists t
    where t.status = 'ambil_tamu'
      and not exists (
        select 1 from bookings b
        where b.therapist_id = t.id and b.status = 'berjalan'
      )
      and not exists (
        select 1 from bookings b
        where b.therapist_id = t.id
          and b.booking_source = 'oncall'
          and b.status <> 'batal'
      )
  loop
    perform clear_therapist_session(r.tid);
    v_done := v_done + 1;
  end loop;

  -- (3) BLOKIR ONCALL MASUK: terapis yang masih FREE tapi punya jadwal oncall
  --     diblock mulai (jam mulai - 20 menit) sampai jam selesai oncall.
  --     DIUBAH: hanya oncall yang MASIH TERIKAT di terapis
  --     (current_group_id / current_booking_ids) yang memblok. Oncall yang
  --     sudah diselesaikan office tidak akan memblok ulang.
  --     PENTING: therapists.current_booking_ids bertipe jsonb, JADI pakai
  --     operator '@>' (jsonb array contains). Dulu pakai '??' yang tidak
  --     eksis untuk jsonb -> fungsi ini selalu error dan tidak pernah
  --     membebaskan terapis sama sekali.
  for r in
    select b.therapist_id as tid,
           b.outlet_id,
           b.id as booking_id,
           b.treatment_name,
           b.treatment_price,
           b.payment_method,
           b.start_at,
           b.end_at
    from bookings b
    where b.booking_source = 'oncall'
      and b.status <> 'batal'
      and b.start_at is not null
      and b.end_at is not null
      and b.start_at <= v_now + 1200000
      and b.end_at > v_now
      and exists (
        select 1 from therapists t
        where t.id = b.therapist_id
          and (
            t.current_group_id = 'oncall:' || b.id::text
            or coalesce(t.current_booking_ids, '[]'::jsonb) @> jsonb_build_array(b.id::text)
          )
      )
  loop
    if not exists (
      select 1 from therapists t where t.id = r.tid and t.status = 'ambil_tamu'
    ) then
      update therapists set
        status = 'ambil_tamu',
        current_outlet_id = r.outlet_id,
        current_group_id = 'oncall:' || r.booking_id::text,
        current_booking_id = r.booking_id::text,
        current_booking_ids = coalesce(current_booking_ids, '[]'::jsonb) || jsonb_build_array(r.booking_id::text),
        current_treatment_names = coalesce(current_treatment_names, '[]'::jsonb) || jsonb_build_array(r.treatment_name),
        current_treatment_name = r.treatment_name,
        current_paid = true,
        current_payment_method = r.payment_method,
        current_price = r.treatment_price,
        start_at = r.start_at,
        end_at = r.end_at
      where id = r.tid;
      v_done := v_done + 1;
    end if;
  end loop;

  return v_done;
end;
$fn$;

grant execute on function public.auto_free_expired_therapists() to authenticated;
grant execute on function public.auto_free_expired_therapists() to anon;