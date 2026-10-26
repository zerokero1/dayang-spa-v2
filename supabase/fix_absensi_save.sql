-- Tambahan skema yang dibutuhkan AbsensiPage dan attendanceService saat ini.
-- Aman dijalankan ulang; tidak mengubah atau menghapus data absensi.

alter table public.attendance
  add column if not exists check_in_minutes int,
  add column if not exists check_out_minutes int,
  add column if not exists shift_code text,
  add column if not exists late_minutes int not null default 0,
  add column if not exists source text not null default 'lama',
  add column if not exists recorded_by text;

create table if not exists public.attendance_overtime (
  employee_id uuid not null,
  employee_name text,
  outlet_id text references public.outlets(id),
  date text not null,
  minutes int not null default 0,
  verified boolean not null default true,
  source text not null default 'manual',
  note text default '',
  recorded_by text,
  recorded_at timestamptz not null default now(),
  primary key (employee_id, date)
);

create index if not exists attendance_date_idx
  on public.attendance (date);
create index if not exists attendance_outlet_date_idx
  on public.attendance (outlet_id, date);
create index if not exists attendance_overtime_date_idx
  on public.attendance_overtime (date);
create index if not exists attendance_overtime_outlet_date_idx
  on public.attendance_overtime (outlet_id, date);

alter table public.attendance enable row level security;
alter table public.attendance_overtime enable row level security;

drop policy if exists "authenticated all" on public.attendance;
create policy "authenticated all" on public.attendance
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all" on public.attendance_overtime;
create policy "authenticated all" on public.attendance_overtime
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.attendance to authenticated;
grant select, insert, update, delete on public.attendance_overtime to authenticated;