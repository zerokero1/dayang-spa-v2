-- Backup nilai SEBELUM perbaikan Happy Hour 4 Oktober 2026.
-- Dibuat 4 Okt 2026, sebelum DB produksi diubah.
--
-- Alasan perbaikan:
--   1) 14 baris punya discount_reason 'Harga Spesial 11:00 - 14:59' padahal
--      treatment-nya 30/60 menit, bukan 90 menit. Happy Hour hanya berlaku untuk
--      7 menu Massage 90 menit, jadi diskon itu tidak boleh ada.
--   2) 2 baris 'tamu special' diskon 8.33% -> harga 275.010 karena kasir mengetik
--      persen, bukan rupiah. Treatment-nya Stress Relieving Massage (90 Min)
--      yang memang ikut Happy Hour, jadi harga seharusnya 250.000.
--
-- Cara mengembalikan (PENTING: booking sudah ada, jadi jangan INSERT).
-- Jalankan UPDATE dengan nilai lama di bawah:

-- ======================= 14 BARIS: HH LAMA -> HARGA PENUH =======================
update public.bookings set treatment_price=180000, original_price=200000, commission_amount=18000, discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='07a972a4-699e-4637-b878-005ba25ff193';
update public.bookings set treatment_price=180000, original_price=200000, commission_amount=18000, discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='08dfb619-2f44-408c-832f-6f3cd22d6d6d';
update public.bookings set treatment_price=180000, original_price=200000, commission_amount=18000, discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='39f85433-d0be-4fb2-a750-7831fec856e8';
update public.bookings set treatment_price=180000, original_price=200000, commission_amount=18000, discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='3add1be6-10ae-4aec-b3dc-2f94f6d4fd85';
update public.bookings set treatment_price=200000, original_price=200000, commission_amount=20000, discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='3df4a069-beb9-44e2-9351-a9c8afe6f693';
update public.bookings set treatment_price=75000,  original_price=100000, commission_amount=7500,  discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='49202f3b-a74e-4e57-af2b-3868aa5aedd3';
update public.bookings set treatment_price=90000,  original_price=100000, commission_amount=9000,  discount_pct=10.0, discount_reason='Harga Spesial 11:00 - 14:59' where id='930d1e62-b858-476f-9a7e-bebc3a1107f7';
update public.bookings set treatment_price=90000,  original_price=100000, commission_amount=9000,  discount_pct=10.0, discount_reason='Harga Spesial 11:00 - 14:59' where id='95a841d8-42d7-4c6e-9b97-b8982e1a59f7';
update public.bookings set treatment_price=75000,  original_price=100000, commission_amount=7500,  discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='984095ef-4fb3-414a-b00a-75966ffe40a3';
update public.bookings set treatment_price=90000,  original_price=100000, commission_amount=9000,  discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='dc519612-c4c7-4484-af1b-622d4f1bf69f';
update public.bookings set treatment_price=90000,  original_price=100000, commission_amount=9000,  discount_pct=10.0, discount_reason='Harga Spesial 11:00 - 14:59' where id='e8d4b63a-cd1a-4e94-a368-d32baafb5e64';
update public.bookings set treatment_price=72000,  original_price=80000,  commission_amount=7200,  discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='ea5c42f4-d8d1-4f60-b776-937f567157c6';
update public.bookings set treatment_price=180000, original_price=200000, commission_amount=18000, discount_pct=0,   discount_reason='Harga Spesial 11:00 - 14:59' where id='edc2e7cf-793c-4600-be1f-092c21fd01d4';
update public.bookings set treatment_price=72000,  original_price=80000,  commission_amount=7200,  discount_pct=10.0, discount_reason='Harga Spesial 11:00 - 14:59' where id='f79cfe93-9494-45fe-aeee-6d9156c0af3d';

-- ================ 2 BARIS: 'TAMU SPECIAL' -> HAPPY HOUR 250.000 ================
update public.bookings set treatment_price=275010, original_price=300000, commission_amount=27501, discount_pct=8.33, discount_reason='tamu special' where id='38124bd2-950c-492f-8a1e-4162be1319da';
update public.bookings set treatment_price=275010, original_price=300000, commission_amount=27501, discount_pct=8.33, discount_reason='tamu special' where id='b7955330-dbe2-4eaa-b72c-809cca7fdf66';

-- Yang SENGAJA TIDAK disentuh pada 4 Okt 2026:
--   * 6 baris Happy Hour 90 menit yang sudah benar (harga 250.000, komisi 25.000).
--   * 3 booking hotel 30 Sep 2026 yang nilainya masuk ribuan (harga 400/350).
--     Owner memutuskan untuk belum disentuh, lihat catatan di atas.