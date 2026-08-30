-- Jalankan di Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> Run)
-- Menambahkan stok "Aloevera Cream" (default 0) untuk semua outlet.
insert into oil_inventory (outlet_id, oil_type, size, stock, unit)
select o.id, oi.oil_type, oi.size, 0, 'botol'
from (values ('DR'),('RR'),('DP'),('D1'),('D2'),('Y')) o(id)
cross join (
  values ('Aloevera Cream','Kecil'),('Aloevera Cream','Besar')
) oi(oil_type, size)
on conflict (outlet_id, oil_type, size) do nothing;
