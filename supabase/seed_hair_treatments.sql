-- ============================================================
-- SEED TREATMENT HAIR TREATMENT (daftar ASLI dari outlet)
-- Menghapus item hair default sebelumnya, lalu insert daftar sebenarnya.
-- ============================================================

-- Hapus item hair yang dibuat sebelumnya (default), agar tidak dobel
delete from treatments where category = 'Hair Treatment' and
  name in ('Hair Spa Treatment (30 Min)','Hair Spa Treatment (45 Min)','Creambath (45 Min)',
           'Hair Mask (30 Min)','Scalp Treatment (30 Min)','Haircut (Potong Rambut)',
           'Cuci + Blow Dry','Hair Coloring (30 Min)','Hair Coloring (45 Min)',
           'Hair Smoothing','Hair Keratin','Hair Rebonding');

-- Insert daftar hair treatment asli
insert into treatments (name, price, category, duration_minutes, commission_percent, uses_oil) values
  -- Perawatan Rambut & Kulit Kepala
  ('Japanese Head Spa By Natural/Product (Scalp Treatment, Massage, Face Mask)', 300000, 'Hair Treatment', 60, 10, false),
  ('Japanese Creambath', 200000, 'Hair Treatment', 45, 10, false),
  ('Japanese Hair Mask', 200000, 'Hair Treatment', 45, 10, false),
  ('Japanese Hair Spa', 200000, 'Hair Treatment', 45, 10, false),
  ('Japanese Scalp Treatment', 200000, 'Hair Treatment', 45, 10, false),
  ('Japanese Facial By Natural/Product', 150000, 'Hair Treatment', 45, 10, false),
  ('Japanese Head Massage', 150000, 'Hair Treatment', 30, 10, false),
  -- Potong & Gaya
  ('Cut & Style (Female)', 300000, 'Hair Treatment', 60, 10, false),
  ('Cut & Style (Kids)', 150000, 'Hair Treatment', 45, 10, false),
  ('Man Cut', 100000, 'Hair Treatment', 30, 10, false),
  ('Bang', 100000, 'Hair Treatment', 20, 10, false),
  ('Trim', 125000, 'Hair Treatment', 30, 10, false),
  ('Wash & Blow Dry', 150000, 'Hair Treatment', 30, 10, false),
  ('Wash & Blow Variation', 200000, 'Hair Treatment', 30, 10, false),
  ('Blow', 100000, 'Hair Treatment', 20, 10, false),
  ('Style', 100000, 'Hair Treatment', 30, 10, false),
  -- Warna & Perawatan Khusus
  ('Highlights, Lowlights & Balayage (Start From)', 800000, 'Hair Treatment', 240, 10, false),
  ('Keratin Short Hair', 800000, 'Hair Treatment', 180, 10, false),
  ('Keratin Medium Hair', 1000000, 'Hair Treatment', 210, 10, false),
  ('Keratin Long Hair', 1200000, 'Hair Treatment', 240, 10, false),
  ('Keratin Extra Long Hair', 1400000, 'Hair Treatment', 270, 10, false),
  ('Lashlift & Tint', 250000, 'Hair Treatment', 45, 10, false),
  ('Eyebrow Laminating & Tint', 300000, 'Hair Treatment', 45, 10, false),
  -- Ekstensi Bulu Mata
  ('Eyelash Extension Natural', 250000, 'Hair Treatment', 60, 10, false),
  ('Eyelash Extension Volume', 350000, 'Hair Treatment', 60, 10, false),
  ('Eyelash Extension Mega Volume', 400000, 'Hair Treatment', 60, 10, false),
  ('Hair Breading', 0, 'Hair Treatment', 240, 10, false)
on conflict do nothing;
