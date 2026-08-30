-- Jalankan di Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> Run)
-- Mengatur "Back, Neck & Shoulder" agar selalu wajib memakai minyak (uses_oil = true),
-- konsisten dengan pengaturan yang ada di code & seed_data.sql.
update treatments
set uses_oil = true
where name like 'Back, Neck & Shoulder%';
