-- ============================================================================
-- ABSENSI OTOMATIS DARI DATA TREATMENT
--
-- Pembagian tanggung jawab:
--   SISTEM yang mengisi : 'hadir'   -- hanya kalau ada treatment hari itu
--   KASIR yang mengisi  : 'telat', 'alpha', 'sakit', 'izin'
--                         dan lembur (tabel attendance_overtime)
--
-- Prinsip: sistem TIDAK PERNAH menulis 'alpha'. Absen tanpa keterangan itu
-- keputusan manusia. Kalau seseorang hadir tapi tidak ada treatment (menyapu,
-- terima barang, training), absensinya dikosongkan — bukan dianggap alpa,
-- karena itu akan merugikan orangnya.
--
-- Zona waktu: tanggal absensi memakai jam lokal Lombok (WITA, UTC+8), bukan
-- WIB. Server memakai UTC, jadi jadwal 23:00 WITA = 15:00 UTC.
-- ============================================================================

-- Riwayat perubahan absensi otomatis, supaya koreksi kasir tidak hilang
-- jejaknya. 127 baris absensi lama sama sekali tidak mencatat siapa yang
-- mengisi; tabel ini menutup celah itu ke depan.
create table if not exists attendance_auto_log (
  id            bigserial primary key,
  employee_id   uuid,
  employee_name text,
  date          text,
  outlet_id     text,
  tipe_sebelum  text,
  tipe_sesudah  text,
  source_sebelum text,
  action        text not null,          -- 'auto-insert' | 'kasir-ubah'
  oleh          text,                   -- 'sistem' atau email kasir
  treatment_saat_ini integer default 0,
  dicatat_pada  timestamptz default now()
);

create index if not exists idx_attendance_auto_log_date
  on attendance_auto_log (date);
create index if not exists idx_attendance_auto_log_employee
  on attendance_auto_log (employee_id, date);

-- Jumlah treatment tiap terapis per hari (WITA), hanya yang tidak batal.
create or replace function treatment_harian(p_tanggal text)
returns table (
  therapist_id   uuid,
  therapist_name text,
  outlet_id      text,
  jumlah         bigint
)
language sql
stable
as $$
  select b.therapist_id,
         max(b.therapist_name),
         max(b.outlet_id),
         count(*)
    from bookings b
   where b.status <> 'batal'
     and b.therapist_id is not null
     and (b.created_at at time zone 'Asia/Makassar')::date::text = p_tanggal
   group by b.therapist_id;
$$;


-- Isi absensi 'hadir' untuk satu tanggal dari data treatment.
--
-- Aman dipanggil berulang: tidak menimpa baris yang sudah ada, sehingga
-- absensi yang sudah diisi kasir (telat/izin/sakit) aman.
create or replace function isi_absensi_otomatis(p_tanggal text default null)
returns table (
  diproses      integer,
  dibuat        integer,
  dilewati      integer,
  sudah_ada     integer
)
language plpgsql
as $$
declare
  v_tanggal   text;
  v_diproses  integer := 0;
  v_dibuat    integer := 0;
  v_dilewati  integer := 0;
  v_sudah_ada integer := 0;
  r           record;
begin
  -- Default = hari ini WITA, bukan tanggal server.
  v_tanggal := coalesce(
    p_tanggal,
    (now() at time zone 'Asia/Makassar')::date::text
  );

  for r in
    select t.therapist_id, t.therapist_name, t.outlet_id, t.jumlah,
           (a.employee_id is not null) as sudah_ada
      from treatment_harian(v_tanggal) t
      left join attendance a
        on a.employee_id = t.therapist_id
       and a.date = v_tanggal
  loop
    v_diproses := v_diproses + 1;

    if r.sudah_ada then
      v_sudah_ada := v_sudah_ada + 1;
      continue;                      -- sudah ada isinya, jangan ditimpa
    end if;

    insert into attendance (
      employee_id, employee_name, outlet_id, date, type,
      late_minutes, overtime_minutes, shift_code,
      source, recorded_by, note
    ) values (
      r.therapist_id, r.therapist_name, r.outlet_id, v_tanggal, 'hadir',
      0, 0, null,
      'auto', 'sistem',
      'Otomatis dari ' || r.jumlah::text || ' treatment'
    )
    on conflict (employee_id, date) do nothing;

    if found then
      v_dibuat := v_dibuat + 1;
      insert into attendance_auto_log
        (employee_id, employee_name, date, outlet_id, tipe_sebelum, tipe_sesudah,
         source_sebelum, action, oleh, treatment_saat_ini)
      values
        (r.therapist_id, r.therapist_name, v_tanggal, r.outlet_id, null, 'hadir',
         null, 'auto-insert', 'sistem', r.jumlah::integer);
    else
      v_dilewati := v_dilewati + 1;
    end if;
  end loop;

  return query select v_diproses, v_dibuat, v_dilewati, v_sudah_ada;
end;
$$;

-- Catat setiap perubahan kasir terhadap absensi yang dibuat otomatis.
-- Dipanggil dari trigger di bawah, bukan dipanggil aplikasi.
create or replace function catat_perubahan_absensi()
returns trigger
language plpgsql
as $$
declare
  v_otomatis boolean;
begin
  select (old.source = 'auto') into v_otomatis;
  if not coalesce(v_otomatis, false) then
    return null;                     -- perubahan biasa, tidak perlu dicatat
  end if;

  insert into attendance_auto_log
    (employee_id, employee_name, date, outlet_id, tipe_sebelum, tipe_sesudah,
     source_sebelum, action, oleh, treatment_saat_ini)
  values (
    old.employee_id, old.employee_name, old.date, old.outlet_id,
    old.type::text, new.type::text, old.source,
    'kasir-ubah', new.recorded_by, null
  );
  return null;
end;
$$;

drop trigger if exists trg_absensi_auto_log on attendance;
create trigger trg_absensi_auto_log
  after update of type, check_in_minutes, check_out_minutes, late_minutes,
                 shift_code, note on attendance
  for each row
  when (old.source = 'auto')
  execute function catat_perubahan_absensi();
