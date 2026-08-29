-- ============================================================
-- PERBAIKAN DATA TERAPIS v2
-- 1) Hapus terapis yang sudah keluar (Anita)
-- 2) Tambah terapis baru: Afdon, HANUM, mia, sahni, Ali, jepri
-- 3) Set 'libur' (off) untuk terapis yang off hari ini
-- ============================================================

-- 1) Hapus terapis yang sudah keluar
delete from therapists where name = 'Anita';

-- 2) Tambah terapis baru (status free)
insert into therapists (name, role, home_outlet_id, status) values
  ('Afdon', 'terapis', 'DR', 'free'),
  ('HANUM', 'terapis', 'DR', 'free'),
  ('mia',   'terapis', 'DP', 'free'),
  ('sahni', 'terapis', 'DP', 'free'),
  ('Ali',   'terapis', 'D1', 'free'),
  ('jepri', 'terapis', 'D1', 'free')
on conflict do nothing;

-- 3) Tandai 'libur' untuk terapis yang off hari ini
update therapists set status = 'libur'
where name in ('Fenti', 'Ily', 'Ira', 'Laura', 'Pian', 'Ripan', 'Runi', 'Tumin', 'Ayuha', 'Ulan');
