-- ============================================================
-- PEMAKAIAN FULL BODY MASSAGE — HOLE SHEET / SINGLE SHEET / FACE CRADLE
--
-- Tujuan: bisa menghitung estimasi pengeluaran (jumlah & rupiah) untuk
-- treatment full body massage per outlet.
--
-- Aturan default: 1 treatment full body massage memakai
--   1 Hole Sheet + 1 Single Sheet + 1 Face Cradle
--
-- Full body massage = kategori 'Massage' dengan durasi 60 atau 90 menit,
-- dikecualikan Foot Massage, Head Massage, dan Back, Neck & Shoulder.
--
-- Jalankan file ini di Supabase SQL Editor (production).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Harga satuan per barang (dipakai untuk hitung estimasi rupiah)
-- ------------------------------------------------------------
alter table inventory add column if not exists unit_cost numeric not null default 0;

-- Cegah barang kembar di outlet yang sama (mis. "hole sheet" vs "Hole Sheet").
create unique index if not exists inventory_outlet_name_uniq
  on inventory (outlet_id, lower(name));

-- ------------------------------------------------------------
-- 2) Pemakaian per treatment (bisa diubah nanti per treatment)
-- ------------------------------------------------------------
create table if not exists treatment_consumables (
  treatment_id uuid not null references treatments(id) on delete cascade,
  item_name text not null,
  qty numeric not null default 1,
  created_at timestamptz not null default now(),
  primary key (treatment_id, item_name)
);

alter table treatment_consumables enable row level security;
drop policy if exists "authenticated all" on treatment_consumables;
create policy "authenticated all" on treatment_consumables
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 3) Isi aturan: 1 paket = 1 Hole Sheet + 1 Single Sheet + 1 Face Cradle
-- ------------------------------------------------------------
insert into treatment_consumables (treatment_id, item_name, qty)
select t.id, c.item_name, c.qty
  from treatments t
  cross join (values ('Hole Sheet', 1), ('Single Sheet', 1), ('Face Cradle', 1)) as c(item_name, qty)
 where t.category = 'Massage'
   and t.duration_minutes in (60, 90)
   and t.name not like 'Foot Massage%'
   and t.name not like 'Head Massage%'
   and t.name not like 'Back, Neck & Shoulder%'
on conflict (treatment_id, item_name) do update set qty = excluded.qty;

-- ------------------------------------------------------------
-- 4) Pastikan barang tersedia di semua outlet (stok & harga diisi manual)
-- ------------------------------------------------------------
insert into inventory (outlet_id, name, unit, stock, unit_cost)
select o.id, c.item_name, c.unit, 0, 0
  from outlets o
  cross join (values ('Hole Sheet', 'lembar'),
                     ('Single Sheet', 'lembar'),
                     ('Face Cradle', 'pcs')) as c(item_name, unit)
 where not exists (
   select 1 from inventory i
    where i.outlet_id = o.id and lower(i.name) = lower(c.item_name)
 );

-- ------------------------------------------------------------
-- 5) Realtime (supaya harga satuan ikut ter-update di halaman lain)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'treatment_consumables'
    ) then
      alter publication supabase_realtime add table treatment_consumables;
    end if;
  end if;
end $$;