-- ============================================================================
-- LAPISAN PENGAWASAN: AGENT + SUPERVISOR
--
-- Aplikasi ini punya beberapa pekerjaan yang berjalan sendiri di server
-- (absensi otomatis, pemeriksaan bug, pemicu otomatis). Semuanya itu adalah
-- "agent": program yang bekerja tanpa disentuh manusia.
--
-- Masalahnya sebelumnya: tidak ada yang mengawasi apakah mereka benar-benar
-- jalan, apakah hasil kerjanya masuk akal, dan apakah ada yang keluar jalur.
-- Kalau salah satu diam-diam macet atau mulai merusak data, tidak ada yang
-- sadari sampai uangnya hilang.
--
-- File ini membangun lapisan pengawasan di atasnya:
--
--   agent_keamanan        memeriksa pintu dan kunci database
--   agent_kesalahan       memeriksa angka yang salah (dari cek_kesehatan.sql)
--   agent_arsip           menyimpan salinan data dan memangkas yang lamakan
--   agent_pemeriksa_rekan memanggil keempatnya, lalu menilai hasil kerjanya
--
-- Yang penting dipahami: ini program dengan aturan, bukan AI yang berpikir.
-- Mereka tidak mengarang. Semua temuan bisa ditelusuri ke query yang dipakai.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- DAFTAR AGENT
-- ---------------------------------------------------------------------------
create table if not exists tabel_agent (
  kode        text primary key,
  nama        text not null,
  tugas       text not null,
  jadwal      text,
  frekuensi   text not null default 'harian',  -- 'harian' | 'setiap_jam'
  aktif       boolean not null default true,
  dibuat_pada timestamptz default now()
);


-- ---------------------------------------------------------------------------
-- CATATAN KERJA SETIAP AGENT
--
-- Setiap kali agent selesai, dia menulis di sini. Supervisor membaca tabel
-- ini untuk menilai: sudah jalan? entrenched? hasilnya wajar?
-- ---------------------------------------------------------------------------
create table if not exists catatan_agent (
  id          bigserial primary key,
  agent       text not null references tabel_agent(kode) on delete cascade,
  mulai       timestamptz not null default now(),
  selesai     timestamptz,
  durasi_ms   integer,
  status      text not null default 'jalan',   -- 'jalan' | 'selesai' | 'gagal'
  pesan       text,
  temuan      integer not null default 0,
  rincian     jsonb,
  dicatat_pada timestamptz default now()
);

create index if not exists idx_catatan_agent_waktu
  on catatan_agent (agent, dicatat_pada desc);


-- Catat hasil kerja agent. Dipanggil dari dalam tiap fungsi agent, supaya
--Supervisor tidak perlu menebak apakah agent itu jalan atau tidak.
create or replace function catat_agent_hasil(
  p_agent   text,
  p_status  text,
  p_pesan   text default null,
  p_temuan  integer default 0,
  p_rincian jsonb default null,
  p_mulai   timestamptz default null
)
returns void
language plpgsql
as $$
begin
  insert into catatan_agent
    (agent, mulai, selesai, durasi_ms, status, pesan, temuan, rincian)
  values (
    p_agent,
    coalesce(p_mulai, now()),
    now(),
    case when p_mulai is null then null
         else greatest(0, (extract(epoch from (now() - p_mulai)) * 1000)::integer) end,
    p_status, p_pesan, coalesce(p_temuan, 0), p_rincian
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- PENUTUP PINTU YANG BOCOR
--
-- TEMUAN PENTING: beberapa tabel backup tidak punya RLS sama sekali, dan
-- peran `anon` (pengunjung tanpa login) diberi hak SELECT di tabelnya.
-- Artinya siapa pun di internet yang tahu alamat server bisa membuka data
-- itu tanpa password:
--
--   bookings_backup_20261014        1.485 baris  (nama tamu, harga)
--   therapists_backup_20261014        43 baris  (data pribadi terapis)
--   attendance_backup_20261017       665 baris
--   payment_method_rusak_20261016     217 baris
--
-- Tabel utama aman karena punya RLS, tapi tabel backup justru yang paling
-- penting justru yang tidak terkunci.
--
-- Perbaikannya sengaja dibuat umum, bukan hanya untuk nama yang mengandung
-- "backup". Kalau hanya nama backup yang ditutup, tabel berikutnya
-- yang dibuat tanpa RLS akan bocor lagi tanpa ada yang tahu. Jadi
-- SEMUA tabel tanpa RLS dinyalakan, lalu diberi policy hanya bila memang
-- perlu dibaca aplikasi.
--
-- Aturan politiknya:
--   - tabel kerja yang dibaca aplikasi  : authenticated boleh SELECT, tidak
--                                          boleh INSERT/UPDATE/DELETE
--   - tabel backup dan arsip           : tidak ada policy sama sekali, jadi
--                                          ditolak semua orang. Pemiliknya
--                                          sendiri (postgres) tetap bisa.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabel text;
begin
  -- Nyalakan RLS untuk semua tabel yang belum punya.
  for v_tabel in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', v_tabel);
  end loop;

  -- Tabel laporan yang dibaca halaman Pemeriksaan Sistem dan Supervisor.
  -- Hanya boleh dibaca, tidak boleh diubah dari sisi browser.
  foreach v_tabel in array array[
    'pemeriksaan_sistem', 'tabel_agent', 'catatan_agent', 'attendance_auto_log'
  ] loop
    execute format('revoke all on table public.%I from anon', v_tabel);
    execute format('drop policy if exists "authenticated read" on public.%I', v_tabel);
    execute format(
      'create policy "authenticated read" on public.%I for select to authenticated using (true)',
      v_tabel);
  end loop;

  -- Tabel backup dan arsip: cabut semua hak dari anon dan authenticated.
  -- postgres sebagai pemilik tetap bisa membukanya.
  for v_tabel in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and (c.relname ilike '%backup%'
            or c.relname ilike 'bk_%'
            or c.relname ilike '%legacy%'
            or c.relname ilike 'arsip_%'
            or c.relname ilike 'oncall_paksa%'
            or c.relname ilike 'payment_method_rusak%')
  loop
    execute format('revoke all on table public.%I from anon, authenticated', v_tabel);
  end loop;
end;
$$;


-- Jejak audit hanya boleh ditambah dan dibaca, tidak boleh diubah atau
-- dihapus oleh akun biasa. RLS sudah menahan TAMU, tapi akun yang sudah
-- login masih bisa DELETE. Kalau jejaknya bisa dihapus, log aktivitas tidak
-- lagi berguna untuk investigating.
revoke update, delete, truncate, references, trigger
  on table audit_logs from anon, authenticated;


-- Fungsi SECURITY DEFINER wajib mengunci search_path. Kalau tidak, nama objek
-- di dalam fungsi bisa dialihkan ke objek buatan penyerang yang namanya sama.
-- Ditambahkan untuk semua fungsi yang belum mengunci, bukan hanya yang
-- sekarang bermasalah, supaya fungsi baru ikut aman.
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and (p.proconfig is null
            or not exists (
                 select 1 from unnest(p.proconfig) cfg
                  where cfg like 'search\_path=%'))
  loop
    execute format('alter function %s set search_path = public', v_fn.signature);
  end loop;
end;
$$;


-- Halaman daftar outlet dan permintaan stok punya RLS tapi tanpa policy.
-- Akibatnya tidak ada yang bisa membacanya, termasuk aplikasi sendiri.
-- Dua-duanya hanya dipakai sebagai daftar acuan, jadi dibuka untuk
-- authenticated saja.
alter table public.outlets enable row level security;
drop policy if exists "authenticated read outlets" on public.outlets;
create policy "authenticated read outlets" on public.outlets
  for select to authenticated using (true);

alter table public.stock_requests enable row level security;
drop policy if exists "authenticated read stock_requests" on public.stock_requests;
create policy "authenticated read stock_requests" on public.stock_requests
  for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- AGENT KEAMANAN
-- ---------------------------------------------------------------------------
create or replace function agent_keamanan()
returns integer
language plpgsql
as $$
declare
  v_mulai timestamptz := now();
  v_total integer := 0;
  v_n     integer;
  v_contoh text;
  -- Dipisah per pemeriksaan supaya catatan kerja agent jujur. Kalau cuma satu
  -- variabel, isinya akan menimpa dan catatan menyebut hal yang salah.
  v_jumlah_tanpa_rls    integer := 0;
  v_jumlah_search_path  integer := 0;
  v_jumlah_audit        integer := 0;
begin
  perform bersihkan_pemeriksaan_oleh('keamanan');

  -- 1. Tabel tanpa RLS sama sekali. Karena peran anon dan authenticated
  --    punya hak default dari PostgREST, tabel seperti ini terbuka.
  select count(*), left(string_agg(c.relname, ', '), 200)
    into v_n, v_contoh
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
    values
      (to_char(v_mulai at time zone 'Asia/Makassar','YYYY-MM-DD'),
       'tabel_tanpa_rls', 'keamanan', 'tinggi',
       'Tabel tanpa pengunci baris (RLS)',
       'Peran anon punya hak baca bawaan dari PostgREST. Tabel tanpa RLS bisa dibuka siapa pun tanpa login.',
       v_n, v_contoh, 'keamanan');
    v_jumlah_tanpa_rls := v_n;
    v_total := v_total + v_n;
  end if;

  -- 2. Fungsi SECURITY DEFINER tanpa search_path. Kalau ada yang bisa
  --    membuat objek dengan nama sama di schema terdahulu, dia bisa
  --    membuat fungsi itu menjalankan miliknya sendiri. Ini celah
--    escalation yang dikenal di PostgreSQL.
  select count(*), left(string_agg(p.proname, ', '), 200)
    into v_n, v_contoh
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.proconfig is null;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
    values
      (to_char(v_mulai at time zone 'Asia/Makassar','YYYY-MM-DD'),
       'definer_tanpa_search_path', 'keamanan', 'sedang',
       'Fungsi dengan hak akses tanpa search_path',
       'Fungsi SECURITY DEFINER harus mengunci search_path. Tanpa itu, nama objek bisa dialihkan ke objek milik penyerang.',
       v_n, v_contoh, 'keamanan');
    v_jumlah_search_path := v_n;
    v_total := v_total + v_n;
  end if;

  -- 3. Jejak audit boleh dihapus. Kalau audit_logs bisa di-DROP atau
  --    di-DELETE oleh bukan pemilik, jejaknya bisa dihapus orang yang
  --    seharusnya diawasi.
  select count(*), left(string_agg(grantee || ':' || privilege_type, ', '), 200)
    into v_n, v_contoh
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'audit_logs'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('DELETE', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
    values
      (to_char(v_mulai at time zone 'Asia/Makassar','YYYY-MM-DD'),
       'audit_bisa_dihapus', 'keamanan', 'tinggi',
       'Jejak audit boleh diubah atau dihapus',
       'Log aktivitas bisa dihapus oleh akun biasa. Kalau ada yang tidak sengaja menghapus jejaknya, tidak ada bukti.',
       v_n, v_contoh, 'keamanan');
    v_jumlah_audit := v_n;
    v_total := v_total + v_n;
  end if;

  -- 4. Tabel backup menumpuk. Bukan bahaya, tapi database jadi berat dan
  --    sulitRIER searched.
  select count(*)::int, left(string_agg(tablename, ', '), 200)
    into v_n, v_contoh
    from pg_tables
   where schemaname = 'public'
     and (tablename ilike '%backup%' or tablename ilike 'bk_%');

  if v_n > 12 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
    values
      (to_char(v_mulai at time zone 'Asia/Makassar','YYYY-MM-DD'),
       'backup_menumpuk', 'keamanan', 'rendah',
       'Tabel backup menumpuk',
       'Setiap perbaikan data membuat tabel backup baru. Kalau dibiarkan, database makin berat dan sulit dicari. Tabel lama yang tidak diperlukan sebaiknya dihapus.',
       v_n, v_contoh, 'keamanan');
    v_total := v_total + v_n;
  end if;

  perform catat_agent_hasil(
    'keamanan', 'selesai',
    'Pemeriksaan keamanan selesai', v_total,
    jsonb_build_object(
      'tabel_tanpa_rls', v_jumlah_tanpa_rls,
      'fungsi_tanpa_search_path', v_jumlah_search_path,
      'audit_bisa_dihapus', v_jumlah_audit,
      'contoh_tabel_backup', v_contoh),
    v_mulai
  );

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------------
-- AGENT KESALAHAN
--
-- Aturan pemeriksaannya sudah ada dan lebih lengkap di cek_kesehatan.sql
-- (fungsi jalankan_pemeriksaan_sistem). Agent ini hanyalah pembungkus yang
-- memberi hasil kerja itu kepada catatan_agent, supaya supervisor bisa
-- menilai hasilnya seperti agent yang lain.
-- ---------------------------------------------------------------------------
create or replace function agent_kesalahan()
returns integer
language plpgsql
as $$
declare
  v_mulai timestamptz := now();
  v_total integer;
begin
  v_total := jalankan_pemeriksaan_sistem();

  perform catat_agent_hasil(
    'kesalahan', 'selesai',
    'Pemeriksaan angka dan data selesai', v_total,
    jsonb_build_object(
      'catatan', 'aturan lengkap ada di cek_kesehatan.sql'),
    v_mulai
  );

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------------
-- AGENT ARSIP
--
-- Catatan penting soal ruang lingkup: menyalin ke database yang sama hanya
-- melindungi dari kesalahan tidak sengaja (mis. ada yang salah hapus), bukan
-- dari server yang bermasalah. Untuk perlindungan terhadap server, backup ke
-- disk dikerjakan oleh skrip terpisah (backup-database.mjs).
--
-- Fungsi ini membuat salinan harian tabel-tabel kecil yang paling sulit
-- direkonstruksi kalau tidak sengaja terhapus: daftar terapis, stok, dan
-- setelan oil. Salinan lama dipangkas otomatis.
--
-- Booking dan log aktivitas tidak disalin utuh karena keduanya besar dan
-- tumbuh setiap hari. Untuk keduanya, backup penuh dikerjakan oleh skrip
-- terpisah yang menulis ke disk (lihat backup-database.mjs), karena
-- menyimpan salinan di database yang sama tidak berguna kalau servernya
-- yang bermasalah.
-- ---------------------------------------------------------------------------
create or replace function agent_arsip()
returns integer
language plpgsql
as $$
declare
  v_mulai timestamptz := now();
  v_total integer := 0;
  v_n     integer;
  v_tabel text;
  v_contoh text;
  v_label text := to_char(v_mulai at time zone 'Asia/Makassar', 'YYYYMMDD');
begin
  for v_tabel in
    select unnest(array['therapists', 'inventory', 'oil_inventory',
                        'attendance_overtime', 'overtime_adjustments'])
  loop
    execute format(
      'create table if not exists arsip_%I_%s as select * from public.%I',
      v_tabel, v_label, v_tabel);

    -- Tabel arsip adalah salinan data kerja. Kalau tidak dikunci, salinan itu
    -- justru jadi kebocoran baru: tabelnya baru dibuat, RLS belum otomatis.
    execute format('alter table public.arsip_%I_%s enable row level security', v_tabel, v_label);
    execute format(
      'revoke all on table public.arsip_%I_%s from anon, authenticated', v_tabel, v_label);

    v_total := v_total + 1;
  end loop;

  -- Pangkas arsip yang lebih tua dari 7 hari.
  select count(*)::int, left(string_agg(tablename, ', '), 200)
    into v_n, v_contoh
    from pg_tables
   where schemaname = 'public'
     and tablename ~ '^arsip_(therapists|inventory|oil_inventory|attendance_overtime|overtime_adjustments)_\d{8}$';

  if v_n > 0 then
    for v_tabel in
      select tablename from pg_tables
       where schemaname = 'public'
         and tablename ~ '^arsip_(therapists|inventory|oil_inventory|attendance_overtime|overtime_adjustments)_\d{8}$'
         and substring(tablename from '(\d{8})$') < to_char((now() at time zone 'Asia/Makassar') - interval '7 days', 'YYYYMMDD')
    loop
      execute format('drop table if exists public.%I', v_tabel);
      v_total := v_total + 1;
    end loop;
  end if;

  perform catat_agent_hasil(
    'arsip', 'selesai',
    'Salinan harian dibuat dan arsip lama dipangkas', v_total,
    jsonb_build_object('arsip_dipangkas', v_n),
    v_mulai
  );

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------------
-- AGENT PEMERIKSA REKAN
--
-- Memanggil agent lain lalu menilai hasil kerjanya. Inilah yang membedakan
-- "ada program yang jalan" dari "ada yang mengawasi".
--
-- Yang dinilai:
--   1. Agent yang harusnya jalan hari ini, apakah sudah jalan?
--   2. Agent yang gagal atau macet.
--   3. Hasil yang tidak wajar. Contohnya agent kesalahan yang tiba-tiba
--      melaporkan 0 temuan padahal sehari sebelumnya ada ratusan. Itu lebih
--      mencurigakan daripada sistemnya yang kebetulan bersih.
--   4. Agent yang tercatat di daftar tapi jadwalnya hilang dari pg_cron,
--      sehingga diam-diam tidak akan jalan lagi.
--
-- Batasnya perlu jujur: yang diperiksa adalah catatan kerja tiap agent,
-- bukan isi database. Fungsi-fungsi ini hanya membaca tabel transaksi
-- untuk menilai apakah ada agent yang boleh-boleh mengubahnya. Pemeriksaan
-- seperti itu perlu Trigger yang mencatat setiap perubahan, dan itu belum
-- ada di sistem ini.
-- ---------------------------------------------------------------------------
create or replace function agent_pemeriksa_rekan()
returns integer
language plpgsql
as $$
declare
  v_mulai   timestamptz := now();
  v_hari    text := to_char(v_mulai at time zone 'Asia/Makassar', 'YYYY-MM-DD');
  v_total   integer := 0;
  v_n       integer;
  v_contoh  text;
  v_agent   record;
  v_nol    integer;
begin
  perform bersihkan_pemeriksaan_oleh('pemeriksa_rekan');

  -- 1. Agent aktif yang belum menjalankan tugasnya hari ini.
  --
--  Batas "hari ini" harus midnight Lombok, ditulis sebagai timestamp
  --  (tanpa zona) lalu diubah ke timestamptz dengan 'at time zone'. Kalau
  --  casting langsung ke timestamptz, PostgreSQL menafsirkan teksnya memakai
  --  zona sesi, dan server ini memakai UTC, sehingga batasnya bergeser 8 jam.
  select count(*), left(string_agg(a.kode, ', '), 200)
    into v_n, v_contoh
    from tabel_agent a
   where a.aktif
     and a.kode <> 'arsip_disk'
     and not exists (
       select 1 from catatan_agent c
        where c.agent = a.kode
          and c.dicatat_pada >= (
                (v_hari || ' 00:00')::timestamp at time zone 'Asia/Makassar')
     );

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
    values
      (v_hari, 'agent_belum_jalan', 'supervisor', 'tinggi',
       'Agent aktif belum menjalankan tugas hari ini',
       'Jadwalnya sudah lewat tetapi tidak ada catatan kerja. Bisa jadi cron mati, atau fungsinya error.',
       v_n, v_contoh, 'pemeriksa_rekan');
    v_total := v_total + v_n;
  end if;

  -- 2. Agent yang terakhir gagal.
  select count(*), left(string_agg(distinct c.agent, ', '), 200)
    into v_n, v_contoh
    from catatan_agent c
   where c.status = 'gagal'
     and c.dicatat_pada > now() - interval '2 days';

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
    values
      (v_hari, 'agent_gagal', 'supervisor', 'tinggi',
       'Agent pernah gagal menjalankan tugas',
       'Pesan errornya ada di catatan_agent. Selama belum diperbaiki, tugasnya belum selesai.',
       v_n, v_contoh, 'pemeriksa_rekan');
    v_total := v_total + v_n;
  end if;

  -- 3. Hasil yang mencurigakan: jumlah temuan anjlok dari banyak jadi nol
  --    dalam waktu singkat.
  --
  --    Bedakan dua hal yang kelihatan sama:
  --      - masalahnya benar-benar diperbaiki  -> tidak perlu alarmed
  --      - pemeriksaan itsinya yang berhenti    -> bahaya, karena systemic
  --
  --    Patokannya jarak waktu. Kalau run terakhir yang menemukan masalah
  --    masih dalam 36 jam ke belakang, itu perubahan mendadak dan layak
  --    diperiksa. Kalau sudah beberapa hari nol berturut-turut, berarti
  --    memang sudah bersih, dan kalau tetap berbunyi setiap hari cuma
  --    membuat alarm diabaikan.
  --    Supervisor tidak ikut diperiksa di sini. Kalau iya, ia akan menemukan
  --    temuannya sendiri (temuan "nol mendadak"), temuan itu jadi temuan
  --    baru, lalu run berikutnya ia terbangi sering bermasalah, dan seterusnya.
  --    Supervisor yang mengawasi dirinya sendiri tidak ada gunanya.
  for v_agent in
    select c1.agent,
           count(*)::int as sering_mendapati,
           max(c1.dicatat_pada) as terakhir_mendapati
      from catatan_agent c1
     where c1.temuan > 0
       and c1.agent <> 'pemeriksa_rekan'
       and c1.dicatat_pada > now() - interval '7 days'
     group by c1.agent
  loop
    select count(*)::int into v_nol
      from (
        select c.temuan
          from catatan_agent c
         where c.agent = v_agent.agent
         order by c.dicatat_pada desc
         limit 2
      ) z
     where z.temuan = 0;

    if v_agent.sering_mendapati > 3
       and v_nol >= 2
       and v_agent.terakhir_mendapati > now() - interval '36 hours'
    then
      insert into pemeriksaan_sistem
        (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
      values
        (v_hari, 'temuan_hilang_tiba_tiba', 'supervisor', 'sedang',
         'Jumlah temuan ' || v_agent.agent || ' mendadak jadi nol',
         'Tiga hari terakhir masih sering menemukan masalah, lalu dua run terakhir nol. Perlu dipastikan: masalahnya diperbaiki, atau pemeriksaan itsinya yang berhenti bekerja. Kalau memang sudah bersih,Finding ini akan hilang sendiri dalam sehari.',
         1, v_agent.agent, 'pemeriksa_rekan');
      v_total := v_total + 1;
    end if;
  end loop;

  -- 4. Job cron yang hilang. Jadwal adalah sumber kebenaran; daftar agent
  --    bisa kadaluarsa kalau job-nya dihapus atau salah nama.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select count(*)::int, left(string_agg(a.kode, ', '), 200)
      into v_n, v_contoh
      from tabel_agent a
    where a.aktif
      and a.kode <> 'arsip_disk'
      and not exists (
        select 1 from cron.job j
         where j.jobname = 'agent-' || a.kode
       );

    if v_n > 0 then
      insert into pemeriksaan_sistem
        (tanggal, kode, kategori, berat, judul, keterangan, total, contoh, agent)
      values
        (v_hari, 'cron_agent_hilang', 'supervisor', 'sedang',
         'Job terjadwal untuk agent tidak ada',
         'Agent terdaftar di daftar tapi jadwalnya tidak ada di pg_cron. Agent itu tidak akan jalan sendiri.',
         v_n, v_contoh, 'pemeriksa_rekan');
      v_total := v_total + v_n;
    end if;
  end if;

  perform catat_agent_hasil(
    'pemeriksa_rekan', 'selesai',
    'Rekan kerja diperiksa', v_total,
    jsonb_build_object('agent_aktif',
      (select count(*)::int from tabel_agent where aktif)),
    v_mulai
  );

  return v_total;
end;
$$;


-- Catatan: pemeriksaan_sistem dihapus per tanggal oleh
-- bersihkan_pemeriksaan_sebelumnya(). Supervisor memanggil beberapa agent
-- yang juga menulis ke tabel itu, jadi sebelum agent lain berjalan,
-- tabelnya dikosongkan sekali di sini.
create or replace function bersihkan_pemeriksaan_sebeluruh()
returns void
language sql
as $$
  delete from pemeriksaan_sistem
   where tanggal = to_char(now() at time zone 'Asia/Makassar', 'YYYY-MM-DD');
$$;


-- ---------------------------------------------------------------------------
-- PENDAFTARAN AGENT
-- ---------------------------------------------------------------------------
insert into tabel_agent (kode, nama, tugas, jadwal, frekuensi)
values
  ('keamanan', 'Agent Keamanan',
   'Memeriksa kunci database: tabel tanpa RLS, fungsi yang bisa disalahgunakan, dan jejak audit yang bisa dihapus.',
   '0 7 * * *', 'harian'),
  ('kesalahan', 'Agent Kesalahan',
   'Memeriksa angka yang salah: transaksi menggantung, komisi salah rumus, stok tidak cocok, absensi tidak sesuai treatment.',
   '0 7,10,15 * * *', 'setiap_jam'),
  ('arsip', 'Agent Arsip',
   'Menyimpan salinan harian tabel yang sulit direkonstruksi, dan memangkas arsip lama.',
   '30 6 * * *', 'harian'),
  ('arsip_disk', 'Agent Arsip Disk',
   'Menyalin seluruh database ke komputer sebagai file, supaya ada salinan di luar server. Dijalankan oleh Task Scheduler Windows, bukan oleh cron server.',
   '01:30 setiap malam', 'harian'),
  ('pemeriksa_rekan', 'Agent Pemeriksa Rekan',
   'Memanggil semua agent, lalu menilai apakah mereka jalan, berhasil, dan hasilnya wajar.',
   '0 8 * * *', 'harian')
on conflict (kode) do update
  set nama = excluded.nama,
      tugas = excluded.tugas,
      jadwal = excluded.jadwal,
      frekuensi = excluded.frekuensi;


-- ---------------------------------------------------------------------------
-- PENJADWALAN
--
-- Jam lokal Lombok (WITA, UTC+8). Server memakai UTC, jadi jam di tabel
-- agent dikurangi 8 jam sebelum dipasang ke cron.
-- ---------------------------------------------------------------------------
do $$
declare
  v_agent record;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron tidak tersedia, jadwal agent tidak dipasang.';
    return;
  end if;

  for v_agent in select kode, jadwal from tabel_agent where aktif and kode <> 'arsip_disk'
  loop
    for v_jobid in
      select jobid from cron.job where jobname = 'agent-' || v_agent.kode
    loop
      perform cron.unschedule(v_jobid);
    end loop;

    perform cron.schedule(
      'agent-' || v_agent.kode,
      v_agent.jadwal,
      'select agent_' || v_agent.kode || '()'
    );
  end loop;

  -- Job lama 'cek-kesehatan-sistem' sekarang diduplikasi oleh agent-kesalahan
  -- dengan jadwal yang sama. Kalau dibiarkan, pemeriksaan bug jalan dua kali
  -- setiap periode dan catatan kerjanya jadi ambigu.
  for v_jobid in
    select jobid from cron.job where jobname = 'cek-kesehatan-sistem'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------------
-- UNTUK HALAMAN SUPERVISOR DI APLIKASI
-- ---------------------------------------------------------------------------
create or replace function supervisor_ringkasan()
returns table (
  kode        text,
  nama        text,
  tugas       text,
  jadwal      text,
  frekuensi   text,
  aktif       boolean,
  status      text,
  dijalankan  timestamptz,
  durasi_ms   integer,
  temuan      integer,
  pesan       text,
  rincian     jsonb,
  catatan_terakhir timestamptz
)
language sql
stable
as $$
  select
    a.kode, a.nama, a.tugas, a.jadwal, a.frekuensi, a.aktif,
    case
      when not a.aktif then 'nonaktif'
      when c.id is null then 'belum pernah jalan'
      when c.status = 'gagal' then 'gagal'
      when a.frekuensi = 'setiap_jam'
        and c.dicatat_pada < now() - interval '3 hours' then 'terlambat'
      when a.frekuensi = 'harian'
        and c.dicatat_pada < now() - interval '30 hours' then 'terlambat'
      else 'jalan'
    end as status,
    c.dicatat_pada as dijalankan,
    c.durasi_ms, c.temuan, c.pesan, c.rincian, c.dicatat_pada as catatan_terakhir
  from tabel_agent a
  left join lateral (
    select * from catatan_agent x
     where x.agent = a.kode
     order by x.dicatat_pada desc
     limit 1
  ) c on true
  order by a.kode;
$$;


-- Riwayat kerja agent. Bentuk return berubah karena rincian ditambahkan,
-- jadi fungsi yang lama harus dihapus lebih dulu.
drop function if exists supervisor_riwayat(integer);

create or replace function supervisor_riwayat(jumlah int default 40)
returns table (
  agent     text,
  mulai     timestamptz,
  selesai   timestamptz,
  durasi_ms integer,
  status    text,
  temuan    integer,
  pesan     text,
  rincian   jsonb
)
language sql
stable
as $$
  select c.agent, c.mulai, c.selesai, c.durasi_ms, c.status, c.temuan, c.pesan, c.rincian
    from catatan_agent c
   order by c.dicatat_pada desc
   limit greatest(1, least(coalesce(jumlah, 40), 500));
$$;


-- Riwayat kerja satu agent saja, untuk halaman detail.
create or replace function supervisor_riwayat_agent(
  p_agent text,
  p_jumlah int default 20
)
returns table (
  agent     text,
  mulai     timestamptz,
  selesai   timestamptz,
  durasi_ms integer,
  status    text,
  temuan    integer,
  pesan     text,
  rincian   jsonb
)
language sql
stable
as $$
  select c.agent, c.mulai, c.selesai, c.durasi_ms, c.status, c.temuan, c.pesan, c.rincian
    from catatan_agent c
   where c.agent = p_agent
   order by c.dicatat_pada desc
   limit greatest(1, least(coalesce(p_jumlah, 20), 200));
$$;
