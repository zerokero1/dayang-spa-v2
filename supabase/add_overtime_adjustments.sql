-- ============================================================
-- KOREKSI OVERTIME (per terapis per hari)
-- Menyimpan nilai overtime manual yang MENIMPA hasil hitung otomatis
-- (otomatis = max(end_at treatment) - jam selesai shift).
-- Tabel ini di-backup getOvertimeReport sehingga laporan overtime,
-- Laporan Absensi, dan ekspor Excel ikut memakai nilai koreksi.
--
-- JALANKAN SEKALI di Supabase SQL Editor.
-- ============================================================

create table if not exists public.overtime_adjustments (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references therapists(id) on delete cascade,
  work_date date not null,
  adjusted_minutes integer not null default 0,
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (therapist_id, work_date)
);

create index if not exists idx_ot_adjust_date
  on public.overtime_adjustments (work_date desc);