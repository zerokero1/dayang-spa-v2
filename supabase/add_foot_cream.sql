-- Jalankan di Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> Run)
-- Menambahkan produk "Foot Cream" (default 0) untuk semua outlet.
insert into oil_inventory (outlet_id, oil_type, size, stock, unit)
select o.id, 'Foot Cream', s.size, 0, 'tube'
from (values ('DR'),('RR'),('DP'),('D1'),('D2'),('Y')) o(id)
cross join (values ('Kecil'),('Besar')) s(size)
on conflict (outlet_id, oil_type, size) do nothing;