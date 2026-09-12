-- ============================================================
-- ORDER STOK (permintaan pengadaan minyak/produk)
-- Setiap kasir, saat closing, bisa mengirim permintaan stok yang
-- akan habis. Data tersimpan di tabel stock_requests lalu pihak
-- pusat/office bisa menandai status: diajukan -> diproses -> selesai.
--
-- JALANKAN SEKALI di Supabase SQL Editor.
-- ============================================================

create table if not exists public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null,
  item_type text not null default 'oil',      -- 'oil' | 'item'
  name text not null,
  size text not null default '',              -- ukuran botol untuk oil
  unit text not null default '',
  qty integer not null default 1,
  note text not null default '',
  status text not null default 'diajukan',    -- diajukan | diproses | selesai | batal
  created_by text not null default '',
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  done_at timestamptz
);

create index if not exists idx_stock_requests_outlet
  on public.stock_requests (outlet_id, created_at desc);
create index if not exists idx_stock_requests_status
  on public.stock_requests (status);