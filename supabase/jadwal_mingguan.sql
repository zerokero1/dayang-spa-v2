-- Jadwal Mingguan Terapis — tabel baru
--
-- Sebelumnya aplikasi hanya menyimpan SATU shift per terapis di
-- therapists.shift, dan shift itu berlaku sama untuk setiap hari. Tidak ada
-- tempat untuk menyimpan pola mingguan (Senin shift apa, Selasa off, dst).
--
-- Tabel ini menyimpan satu baris per terapis per hari-dalam-minggu.
-- day_of_week: 0=Minggu, 1=Senin, 2=Selasa, 3=Rabu, 4=Kamis, 5=Jumat, 6=Sabtu
--
-- shift_code NULL atau 'off' berarti hari itu tidak bekerja. Kalau shift_code
-- NULL, baris bisa dihapus saja supaya tabel tidak menumpuk.
--
-- Aman dijalankan berulang kali (IF NOT EXISTS).

create table if not exists public.therapist_weekly_schedules (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid        not null references public.therapists(id) on delete cascade,
  day_of_week  smallint    not null check (day_of_week between 0 and 6),
  shift_code   text        not null default 'off',
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (therapist_id, day_of_week)
);

create index if not exists idx_tws_day_of_week
  on public.therapist_weekly_schedules (day_of_week);

-- Supaya updated_at selalu terisi tanpa harus frontend mengirim nilainya.
create or replace function public.touch_therapist_weekly_schedule()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_tws_updated_at on public.therapist_weekly_schedules;
create trigger trg_tws_updated_at
  before update on public.therapist_weekly_schedules
  for each row execute function public.touch_therapist_weekly_schedule();

-- RLS: pola yang sama seperti tabel therapists & attendance.
alter table public.therapist_weekly_schedules enable row level security;

drop policy if exists "authenticated all" on public.therapist_weekly_schedules;
create policy "authenticated all"
  on public.therapist_weekly_schedules
  for all to authenticated
  using (true) with check (true);

-- Verifikasi: harus mengembalikan 1 baris kalau tabel sudah ada.
-- select count(*) from public.therapist_weekly_schedules;
