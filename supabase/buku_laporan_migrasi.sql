-- =====================================================================
-- MIGRASI: Buku Laporan (Inventory / Absensi / Komisi / Revenue)
-- Tanggal: 2026-10-02
--
-- Mengaktifkan 3 hal yang belum ada di database:
--   1. oil_inventory_logs  -> riwayat movements minyak per outlet
--   2. attendance jam masuk/pulang + lembur terpisah
--   3. bookings.wib_date   -> kolom tanggal WIB untuk laporan harian
--
-- AMAN DIJALANKAN ULANG (idempotent).
-- =====================================================================

\pset pager off

-- bookings menyimpan waktu sebagai epoch bigint (ms) dalam UTC.
-- +25200 detik = +7 jam = WIB, dipakai untuk mengubah epoch menjadi
-- tanggal/jam lokal tanpa bergantung pada timezone sesi.
-- 420 menit = 7 jam dalam menit.

-- ---------------------------------------------------------------------
-- 0. Cadangan attendance lama SEBELUM apa pun diubah.
-- ---------------------------------------------------------------------
create table if not exists attendance_legacy_backup_20261002 as
  select * from attendance where false;

-- Cadangan ini memakai skema LAMA. Bila migrasi dijalankan ulang setelah
-- kolom baru ditambahkan, samakan dulu strukturnya supaya INSERT berikut
-- tidak gagal, lalu salin hanya kolom warisan absensi.
alter table attendance_legacy_backup_20261002 add column if not exists check_in_minutes int;
alter table attendance_legacy_backup_20261002 add column if not exists check_out_minutes int;
alter table attendance_legacy_backup_20261002 add column if not exists shift_code text;
alter table attendance_legacy_backup_20261002 add column if not exists late_minutes int not null default 0;
alter table attendance_legacy_backup_20261002 add column if not exists source text not null default 'lama';
alter table attendance_legacy_backup_20261002 add column if not exists recorded_by text;

insert into attendance_legacy_backup_20261002
  (employee_id, employee_name, outlet_id, date, type, overtime_minutes, note, recorded_at)
select a.employee_id, a.employee_name, a.outlet_id, a.date,
       a.type, a.overtime_minutes, a.note, a.recorded_at
  from attendance a
where not exists (
  select 1 from attendance_legacy_backup_20261002 b
  where b.employee_id = a.employee_id and b.date = a.date
);

-- ---------------------------------------------------------------------
-- 1. RIWAYAT MINYAK
--    oil_inventory hanya menyimpan angka absolut sehingga "barang masuk /
--    keluar" minyak mustahil ditelusuri. oil_inventory_logs menutup celah
--    itu. Semua pergerakan dicatat otomatis lewat TRIGGER supaya tidak
--    ada jalur (booking / batal / pindah outlet / adjust manual) yang
--    terlewat.
-- ---------------------------------------------------------------------
create table if not exists oil_inventory_logs (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null references outlets(id),
  oil_type text not null,
  size text not null,
  type text not null check (type in ('in', 'out')),
  qty int not null default 0 check (qty >= 0),
  stock_after int not null default 0,
  note text default '',
  created_at timestamptz not null default now()
);

create index if not exists oil_inventory_logs_outlet_date_idx
  on oil_inventory_logs (outlet_id, created_at desc);
create index if not exists oil_inventory_logs_item_idx
  on oil_inventory_logs (outlet_id, oil_type, size, created_at desc);

alter table oil_inventory_logs enable row level security;
drop policy if exists "authenticated all" on oil_inventory_logs;
create policy "authenticated all" on oil_inventory_logs
  for all to authenticated using (true) with check (true);

-- Baseline: catat saldo saat pencatatan dimulai sebagai 'in' supaya
-- laporan "In Out" punya titik awal yang jelas dan bisa diaudit.
insert into oil_inventory_logs (outlet_id, oil_type, size, type, qty, stock_after, note, created_at)
select o.outlet_id, o.oil_type, o.size, 'in', o.stock, o.stock,
       'Saldo awal pencatatan (riwayat sebelum ini tidak ada)', now()
  from oil_inventory o
 where o.stock > 0
   and not exists (
     select 1 from oil_inventory_logs l
      where l.outlet_id = o.outlet_id
        and l.oil_type = o.oil_type
        and l.size = o.size
   );

-- Trigger pencatat. Dipasang SESUDAH baseline supaya baris baseline
-- tidak memicu dirinya sendiri.
create or replace function log_oil_stock_change() returns trigger
language plpgsql as $fn$
declare
  v_delta int;
begin
  -- Pada INSERT, OLD tidak ada; SELURUH stok dianggap pertambahan.
  if tg_op = 'INSERT' then
    v_delta := new.stock;
  else
    v_delta := new.stock - old.stock;
  end if;

  -- Abaikan perubahan yang tidak mengubah stok (mis. ubah label size).
  if coalesce(v_delta, 0) = 0 then return null; end if;

  insert into oil_inventory_logs
    (outlet_id, oil_type, size, type, qty, stock_after, note)
  values
    (new.outlet_id, new.oil_type, new.size,
     case when v_delta > 0 then 'in' else 'out' end,
     abs(v_delta), new.stock,
     case when tg_op = 'INSERT' then 'Penambahan stok'
          else 'Penyesuaian otomatis' end);
  return null;
end;
$fn$;

drop trigger if exists trg_oil_inventory_logs on oil_inventory;
create trigger trg_oil_inventory_logs
  after insert or update of stock on oil_inventory
  for each row execute function log_oil_stock_change();

-- ---------------------------------------------------------------------
-- 2. ABSENSI: jam masuk / jam pulang
--    type tetap 'hadir' sebagai kondisi kerja, sehingga lembur TIDAK lagi
--    menimpa kehadiran pada baris yang sama.
-- ---------------------------------------------------------------------
alter table attendance add column if not exists check_in_minutes int;
alter table attendance add column if not exists check_out_minutes int;
alter table attendance add column if not exists shift_code text;
alter table attendance add column if not exists late_minutes int not null default 0;
alter table attendance add column if not exists source text not null default 'lama';
alter table attendance add column if not exists recorded_by text;

create index if not exists attendance_date_idx on attendance (date);
create index if not exists attendance_outlet_date_idx on attendance (outlet_id, date);

-- ---------------------------------------------------------------------
-- 3. LEMBUR TERPISAH
--    Dulu lembur ditulis sebagai type='lembur' dengan primary key
--    (employee_id, date) -> satu hari hanya bisa HADIR atau LEMBUR,
--    tidak keduanya. Dipisah ke tabel sendiri.
-- ---------------------------------------------------------------------
create table if not exists attendance_overtime (
  employee_id uuid not null,
  employee_name text,
  outlet_id text references outlets(id),
  date text not null,
  minutes int not null default 0,
  verified boolean not null default true,
  source text not null default 'manual',
  note text default '',
  recorded_by text,
  recorded_at timestamptz not null default now(),
  primary key (employee_id, date)
);

create index if not exists attendance_overtime_date_idx
  on attendance_overtime (date);
create index if not exists attendance_overtime_outlet_date_idx
  on attendance_overtime (outlet_id, date);

alter table attendance_overtime enable row level security;
drop policy if exists "authenticated all" on attendance_overtime;
create policy "authenticated all" on attendance_overtime
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 4. PINDAHKAN LEMBUR LAMA
--    Semua baris type='lembur' dipindah ke attendance_overtime.
--    verified = true bila ada booking di hari itu yang selesai melewati
--    jam selesai shift (bukti); verified = false bila tidak ada bukti ->
--    ditandai untuk ditinjau manusia, TIDAK dihapus dan TIDAK dikarang.
--    Jam selesai shift dicerminkan dari SHIFT_END_MINUTES (overtimeService.js).
-- ---------------------------------------------------------------------
create temp table _shift_end (shift text primary key, end_minutes int);
insert into _shift_end values
  ('sp', 1380), ('sp1', 1320), ('sp2', 1380), ('malam', 1380),
  ('AD', 1380), ('11', 1380), ('st', 960);

-- Ringkasan booking per terapis per hari WIB + jam selesai (menit).
create temp table _ot_booking as
select b.therapist_id,
       (to_timestamp(b.end_at / 1000 + 25200) at time zone 'Asia/Jakarta')::date as d,
       (extract(hour   from to_timestamp(b.end_at / 1000 + 25200) at time zone 'Asia/Jakarta') * 60
      + extract(minute from to_timestamp(b.end_at / 1000 + 25200) at time zone 'Asia/Jakarta'))::int as end_min
  from bookings b
  join therapists t on t.id = b.therapist_id
 where b.status <> 'batal' and b.end_at is not null;
create index on _ot_booking (therapist_id, d);

insert into attendance_overtime
  (employee_id, employee_name, outlet_id, date, minutes, verified, source, note)
select a.employee_id, a.employee_name, a.outlet_id, a.date,
       greatest(a.overtime_minutes, 0),
       exists (select 1
                 from _ot_booking ob
                 join therapists t on t.id = a.employee_id
                 join _shift_end se on se.shift = t.shift
                where ob.therapist_id = a.employee_id
                  and ob.d = a.date::date
                  and ob.end_min > se.end_minutes) as verified,
       'lama',
       case when exists (select 1
                           from _ot_booking ob
                           join therapists t on t.id = a.employee_id
                           join _shift_end se on se.shift = t.shift
                          where ob.therapist_id = a.employee_id
                            and ob.d = a.date::date
                            and ob.end_min > se.end_minutes)
            then 'Lembur lama, didukung booking'
            else 'Lembur lama, TANPA booking pendukung - perlu ditinjau' end
  from attendance a
 where a.type = 'lembur'
   and not exists (
     select 1 from attendance_overtime o
      where o.employee_id = a.employee_id and o.date = a.date
   );

-- Baris lembur lama kembali menjadi 'hadir' supaya hari itu tidak hilang
-- dari laporan kehadiran.
update attendance set type = 'hadir'
 where type = 'lembur'
   and exists (select 1 from attendance_overtime o
                where o.employee_id = attendance.employee_id
                  and o.date = attendance.date);

drop table _ot_booking;
drop table _shift_end;

-- ---------------------------------------------------------------------
-- 5. bookings.wib_date -> tanggal lokal, untuk laporan revenue harian.
--    Generated column diturunkan dari start_at (epoch UTC) + 7 jam.
-- ---------------------------------------------------------------------
alter table bookings drop column if exists wib_date;
alter table bookings add column wib_date date
  generated always as ((to_timestamp(start_at / 1000 + 25200) at time zone 'Asia/Jakarta')::date) stored;
create index if not exists bookings_wib_date_idx on bookings (wib_date);
create index if not exists bookings_revenue_idx on bookings (wib_date, outlet_id, paid);

-- ---------------------------------------------------------------------
-- 6. Ringkasan hasil migrasi
-- ---------------------------------------------------------------------
\echo ''
\echo '=== oil_inventory_logs ==='
select type, count(*) as baris, sum(qty) as total_qty from oil_inventory_logs group by 1 order by 1;

\echo ''
\echo '=== lembur lama dimindahkan ==='
select verified, count(*) as baris, sum(minutes) as total_menit
  from attendance_overtime where source = 'lama' group by 1 order by 1;

\echo ''
\echo '=== 8 lembur tanpa bukti (butuh ditinjau) ==='
select employee_name, outlet_id, date, minutes
  from attendance_overtime where source = 'lama' and not verified order by date;

\echo ''
\echo '=== attendance: type sekarang ==='
select type, count(*) from attendance group by 1 order by 1;

\echo ''
\echo '=== trigger oil aktif? ==='
select tgname, tgenabled from pg_trigger
 where tgrelid = 'oil_inventory'::regclass and not tgisinternal;

\echo ''
\echo '=== kolom baru attendance ==='
select column_name, data_type from information_schema.columns
 where table_name = 'attendance' and column_name in
   ('check_in_minutes','check_out_minutes','shift_code','late_minutes','source','recorded_by')
 order by column_name;

\echo ''
\echo '=== revenue harian (cek wib_date) ==='
select wib_date, count(*) as transaksi, round(sum(treatment_price)) as omzet
  from bookings where paid and wib_date >= current_date - 3
 group by 1 order by 1;
