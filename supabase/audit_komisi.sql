-- ============================================================
-- AUDIT SUMBER KOMISI — jalankan di Supabase SQL Editor, lihat hasil.
-- Komisi aplikasi diambil seluruhnya dari tabel bookings.commission_amount.
-- Catatan: created_at sudah UTC; WIB = UTC+7.
-- ============================================================

-- 1) Total komisi per sumber & status (lihat berapa dari oncall/kasir/reservasi, dan berapa dari booking berjalan/selesai)
select
  coalesce(booking_source, 'kasir') as sumber,
  status,
  count(*) as baris,
  sum(commission_amount) as total_komisi
from bookings
where status <> 'batal'
group by 1, 2
order by 3 desc;

-- 2) Total komisi per hari & per outlet (30 hari terakhir dari hari ini WIB)
select
  (created_at + interval '7 hours')::date as tanggal,
  outlet_id,
  count(*) as baris,
  sum(commission_amount) as total_komisi
from bookings
where status <> 'batal'
  and created_at >= (now() - interval '30 days')
group by 1, 2
order by 1 desc;

-- 3) 20 terapis dengan komisi terbesar (rentang 30 hari)
select
  therapist_name,
  count(*) as baris,
  sum(commission_amount) as total_komisi
from bookings
where status <> 'batal'
  and created_at >= (now() - interval '30 days')
group by therapist_name
order by 3 desc
limit 20;

-- 4) DETEKSI DUPLIKAT: baris yang ingin dimulai sama, terapis sama, treatment sama
--    (bukan oncall) — kemungkinan dicatat 2 kali.
select b.*
from bookings b
where b.booking_source is distinct from 'oncall'
  and exists (
    select 1 from bookings x
    where x.booking_source is distinct from 'oncall'
      and x.id <> b.id
      and x.therapist_id = b.therapist_id
      and x.start_at = b.start_at
      and x.treatment_name = b.treatment_name
      and x.status <> 'batal'
      and b.status <> 'batal'
  )
order by b.start_at desc;

-- 5) Komisi yang tidak masuk akal: persen nol/kosong tapi ada komisi,
--    atau amount tidak cocok dengan persen x harga (selisih > 1).
select
  id, outlet_id, therapist_name, treatment_name,
  treatment_price, commission_percent, commission_amount,
  round(coalesce(commission_percent,0) / 100.0 * treatment_price) as seharusnya,
  status, booking_source, created_at
from bookings
where status <> 'batal'
  and (
    (coalesce(commission_percent,0) = 0 and coalesce(commission_amount,0) <> 0)
    or abs(coalesce(commission_amount,0) - round(coalesce(commission_percent,0) / 100.0 * treatment_price)) > 1
  )
order by created_at desc;

-- 6) Satu terapis contoh: perincian komisi per booking (ganti nama di bawah)
-- select id, treatment_name, treatment_price, commission_percent, commission_amount, start_at
-- from bookings
-- where status <> 'batal' and therapist_name = 'NAMA_TERAPIS'
-- order by start_at desc;