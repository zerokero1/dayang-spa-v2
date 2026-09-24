-- ============================================================
-- BACKFILL ONCALL YANG LUPA DIINPUT (hari ini)
-- LOOP Hotel (komisi hotel 0)  : Uswa 1 jam 400K, Aisyah 2 jam 800K
-- Kura Kura Homestay (50K)     : Sumi 1 jam 400K
--
-- Aturan komisi terapis = 10% x (harga treatment - komisi hotel).
-- Status 'selesai', langsung lunas (paid), booking_source 'oncall'.
-- Tidak memblokir terapis (sesinya sudah lewat).
--
-- SEBELUM DIJALANKAN:
--   1. GANTI v_outlet sesuai outlet kasir yang lupa (contoh 'D1').
--   2. Kolom payment_method 'cash' -> ganti 'cardless' bila perlu.
--   3. jam mulai default = saat query dijalankan (hari ini).
--      Bila mau akurat untuk overtime, set v_start_hour/v_start_minute
--      sesuai jam mulai aslinya.
-- ============================================================

do $$
declare
  v_outlet text := 'D1';  -- <-- GANTI sesuai outlet
  v_method text := 'cash';
  v_start_hour int := null;   -- contoh 19 -> jam 19 WIB
  v_start_minute int := null;
  v_tid uuid;
  v_tname text;
  v_comm numeric;
  v_start bigint;
  v_end bigint;
  r record;
begin
  for r in (
    select * from (values
      ('Uswa',   'Full Body Massage', 60,   400000, 0,      'LOOP Hotel'),
      ('Aisyah', 'Full Body Massage', 120,  800000, 0,      'LOOP Hotel'),
      ('Sumi',   'Full Body Massage', 60,   400000, 50000,  'Kura Kura Homestay')
    ) v(name, tname, dur, price, hotel, cust)
  ) loop
    select id, name into v_tid, v_tname
      from therapists
      where lower(name) = lower(r.name)
      order by (home_outlet_id = v_outlet) desc, id
      limit 1;
    if v_tid is null then
      raise notice 'TERAPIS TIDAK DITEMUKAN: %', r.name;
      continue;
    end if;

    v_comm := round(10.0 / 100 * (r.price - r.hotel));

    if v_start_hour is null then
      v_start := (extract(epoch from now()))::bigint * 1000;
    else
      v_start := (
        (now() at time zone 'Asia/Makassar')::date::timestamp
          + make_interval(hours => v_start_hour, mins => v_start_minute)
      )::timestamp::timestamptz at time zone 'UTC';
      v_start := (extract(epoch from v_start))::bigint * 1000;
    end if;
    v_end := v_start + r.dur * 60000;

    insert into bookings (
      outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
      treatment_price, commission_percent, commission_amount, duration_minutes, uses_oil,
      customer_name, status, paid, payment_method, start_at, end_at, created_at, original_price,
      booking_source, hotel_commission
    ) values (
      v_outlet, v_tid, v_tname, null,
      r.tname, r.price, 10, v_comm, r.dur, true,
      r.cust, 'selesai', true, v_method, v_start, v_end, now(), r.price,
      'oncall', r.hotel
    );
    raise notice 'INSERT OK: % (% jam, %i, komisi %)', r.name, r.dur, r.price, v_comm;
  end loop;
end $$;