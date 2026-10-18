-- ============================================================================
-- PEMERIKSAAN KESEHATAN SISTEM
--
-- Menjalankan sejumlah aturan pemeriksaan atas data yang selama ini hanya bisa
-- dicek kalau ada yang melihat manual. Setiap temuan disimpan di tabel
-- pemeriksaan_sistem supaya riwayat masalah bisa dilihat, bukan cuma kondisi
-- hari ini.
--
-- Semua aturan dibuat dari kesalahan yang benar-benar pernah terjadi:
--   - payment_method berisi JSON objek terapis, bukan metode bayar
--   - grup yang dipakai lebih dari satu outlet
--   - booking ganda terkirim karena tombol ditekan dua kali
--   - komisi yang tidak sesuai rumus
--   - stok yang keluar padahal sudah nol
--   - transaksi yang sudah lewat jam tapi masih berstatus berjalan
--   - absensi ada tapi tidak ada treatment (indikasi absen fiktif)
--   - treatment ada tapi absensinya kosong
--
-- Tidak ada yang diubah oleh pemeriksaan ini: hanya membaca dan mencatat.
-- ============================================================================

create table if not exists pemeriksaan_sistem (
  id          bigserial primary key,
  tanggal     text not null,
  kode        text not null,
  kategori    text not null,
  berat       text not null,             -- 'tinggi' | 'sedang' | 'rendah'
  judul       text not null,
  keterangan  text,
  total       integer not null,
  contoh      text,
  dicek_pada  timestamptz default now()
);

-- Nama agent yang menulis temuan ini. Tanpa kolom ini, tiap agent menghapus
-- temuan agent sebelumnya dan halaman hanya menampilkan agent terakhir.
alter table pemeriksaan_sistem
  add column if not exists agent text not null default 'kesalahan';

create index if not exists idx_pemeriksaan_tanggal
  on pemeriksaan_sistem (tanggal);
create index if not exists idx_pemeriksaan_kode
  on pemeriksaan_sistem (kode, tanggal desc);
create index if not exists idx_pemeriksaan_agent
  on pemeriksaan_sistem (agent, tanggal desc);


-- Hapus hasil pemeriksaan sebelumnya untuk satu tanggal, tapi HANYA milik
-- agent yang sedang jalan. Kalau penghapusan dilakukan untuk seluruh tabel,
-- agent yang jalan belakangan menghapus temuan agent yang jalan lebih dulu.
create or replace function bersihkan_pemeriksaan_oleh(p_agent text)
returns void
language sql
as $$
  delete from pemeriksaan_sistem
   where tanggal = to_char(now() at time zone 'Asia/Makassar', 'YYYY-MM-DD')
     and agent = p_agent;
$$;

-- Dipakai oleh pemeriksaan bug (agent 'kesalahan').
create or replace function bersihkan_pemeriksaan_sebelumnya()
returns void
language sql
as $$
  select bersihkan_pemeriksaan_oleh('kesalahan');
$$;


-- Jalankan seluruh aturan dan simpan temuannya.
create or replace function jalankan_pemeriksaan_sistem()
returns integer
language plpgsql
as $$
declare
  v_tanggal text := to_char(now() at time zone 'Asia/Makassar', 'YYYY-MM-DD');
  v_total   integer := 0;
  v_n       integer;
  v_contoh  text;
  v_sejak   text := to_char(now() at time zone 'Asia/Makassar' - interval '14 days', 'YYYY-MM-DD');
begin
  perform bersihkan_pemeriksaan_sebelumnya();

  ------------------------------------------------------------------
  -- KATEGORI: TRANSAKSI
  ------------------------------------------------------------------

  -- payment_method berisi JSON objek terapis, bukan 'cash'/'cardless'.
  -- Ini pernah terjadi karena confirmDiscount() salah jumlah argumen.
  select count(*), left(string_agg(id::text, ', '), 200)
    into v_n, v_contoh
    from bookings
   where payment_method is not null
     and payment_method::text like '{%'
     and (created_at at time zone 'Asia/Makassar')::date::text >= v_sejak;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'payment_method_rusak', 'transaksi', 'tinggi',
       'payment_method berisi data terapis, bukan metode bayar',
       'Tombol "Lunas" mengirim objek terapis ke kolom payment_method. Laporan cash/cardless jadi salah semua.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- Booking sama persis dikirim lebih dari sekali (tombol ditekan dua kali).
  -- Hanya yang berstatus berjalan atau selesai, karena yang batal memang
  -- sengaja dicatat berkali-kali saat kasir mencoba.
  --
  -- PENGECUALIAN: treatment berlabel "(Per Nail)", "(Per Item)", dan sejenisnya
  -- memang sengaja dibuat satu baris per satuan, jadi treatment yang sama pada
  -- jam sama adalah ITU normal, bukan kirim dobel. Tanpa pengecualian ini,
  -- semua pelanggan nail art akan dilaporkan sebagai bug.
  select count(*), left(string_agg(kunci, ' | '), 200)
    into v_n, v_contoh
    from (
      select outlet_id || ' ' ||
             to_char(to_timestamp(start_at / 1000) at time zone 'Asia/Makassar', 'DD-MM HH24:MI') || ' ' ||
             coalesce(nullif(customer_name, ''), '(tanpa nama)') || ' ' ||
             coalesce(therapist_name, '-') || ' ' ||
             treatment_name || ' ' || treatment_price::text || ' x' || count(*)::text
               as kunci,
             min(id::text) as satu_id
        from bookings
       where status in ('selesai', 'berjalan')
         and treatment_name !~* '\(per\s'
         and (created_at at time zone 'Asia/Makassar')::date::text >= v_sejak
       group by outlet_id, start_at, customer_name, therapist_name, treatment_name, treatment_price
      having count(*) > 1
       order by count(*) desc, treatment_price desc
    ) d;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'booking_kembar', 'transaksi', 'tinggi',
       'Booking terkirim lebih dari sekali',
       'Baris identik出现在 lebih dari satu pada tanggal dan jam sama. Kemungkinan tombol simpan ditekan dua kali.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- group_id yang dipakai di lebih dari satu outlet. Kalau grup tidak unik,
  -- pembatalan satu baris bisa menyeret booking outlet lain.
  select count(*), left(string_agg(group_id || ' di ' || outlet_dipakai, ', '), 200)
    into v_n, v_contoh
    from (
      select group_id, count(distinct outlet_id) as jml, string_agg(distinct outlet_id, ',') as outlet_dipakai
        from bookings
       where group_id is not null
         and (created_at at time zone 'Asia/Makassar')::date::text >= v_sejak
       group by group_id
      having count(distinct outlet_id) > 1
    ) d;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'grup_lintas_outlet', 'transaksi', 'tinggi',
       'Nomor grup dipakai lebih dari satu outlet',
       'Kalau grup ini dibatalkan sebagian, booking di outlet lain ikut terpengaruh.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- Komisi tidak sesuai rumus.
  --   in_house : 10% x harga treatment
  --   oncall   : 10% x (harga - komisi hotel)
  select count(*), left(string_agg(
             coalesce(therapist_name,'-') || ' ' || coalesce(treatment_name,'-') || ' ' ||
             coalesce(outlet_id,'-') || ' komisi ' || commission_amount::text ||
             ' seharusnya ' || round((case when booking_source = 'oncall'
                    then treatment_price - coalesce(hotel_commission, 0)
                    else treatment_price end) * coalesce(commission_percent, 0) / 100.0)::text, ', '), 200)
    into v_n, v_contoh
    from bookings
   where status <> 'batal'
     and commission_percent is not null
     and treatment_price is not null
     and coalesce(commission_amount, 0) <>
         round((case when booking_source = 'oncall'
                     then treatment_price - coalesce(hotel_commission, 0)
                     else treatment_price end) * commission_percent / 100.0)
     and (created_at at time zone 'Asia/Makassar')::date::text >= v_sejak;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'komisi_salah_rumus', 'transaksi', 'tinggi',
       'Komisi tidak sesuai rumus',
       'Reguler: 10% x harga. Oncall: 10% x (harga - komisi hotel). Nilai komisi yang tersimpan berbeda.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- CATATAN: tidak ada pemeriksaan "komisi hotel lebih besar dari komisi
  -- terapis". Semuanya oncall, dan itu memang aturan yang berlaku:
  -- komisi = 10% x (harga - komisi hotel). Kalau dibandINGkan dengan harga
  -- penuh, hasilnya selalu lebih kecil. Dulu pemeriksaan ini ada dan
  -- melaporkan 33 temuan, padahal itu kondisi normal yang sudah seharusnya
  -- dan hanya bikin alarm terasa tidak serius.

  -- Pembayaran yang terkunci dua kali.
  --
  -- mark_booking_paid sudah dipasang kuncinya (anti_pembayaran_ganda.sql),
  -- jadi pembayaran kedua diabaikan dan dicatat di tabel pembayaran_ganda.
  -- Pemeriksaan ini menghitungnya supaya kelihatan kalau tombol masih sering
  -- diklik dua kali. Kalau angkanya tinggi, berarti sisi tampilannya masih
  -- belum nonaktifkan tombolnya.
  select count(*), left(string_agg(
             coalesce(outlet_id,'-') || ' ' || coalesce(metode_lama,'-') || '->' ||
             coalesce(metode_baru,'-') || ' ' || to_char(dicatat_pada at time zone 'Asia/Makassar','DD-MM HH24:MI'), ', '), 200)
    into v_n, v_contoh
    from pembayaran_ganda
   where dicatat_pada > now() - interval '7 days';

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'pembayaran_ganda', 'transaksi', 'rendah',
       'Tombol Lunas ditekan lebih dari sekali',
       'Server sudah mengunci, jadi tidak ada dana yang terhitung dua kali. Tapi kalau sering muncul, tombolnya masih belum terkunci di layar dan kasir perlu menekan berkali-kali.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- Transaksi tanpa terapis yang jelas.
  select count(*), left(string_agg(coalesce(outlet_id,'-') || ' ' ||
             coalesce(treatment_name,'-') || ' ' || treatment_price::text, ', '), 200)
    into v_n, v_contoh
    from bookings
   where status <> 'batal'
     and therapist_id is null
     and (created_at at time zone 'Asia/Makassar')::date::text >= v_sejak;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'tanpa_terapis', 'transaksi', 'sedang',
       'Booking tanpa terapis',
       'Terapis kosong, jadi treatment ini tidak masuk slip gaji siapa pun.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  ------------------------------------------------------------------
  -- KATEGORI: TRANSAKSI TERTAHAN
  ------------------------------------------------------------------

  -- Transaksi yang belum ditutup.
  --
  -- Dihitung hanya yang benar-benar tertinggal: sudah lewat lebih dari dua
  -- jam. Treatment yang sedang berjalan hari ini itu wajar, bukan temuan.
  -- Transaksi juga sudah ditutup otomatis oleh agent_tutup_booking, jadi
  -- kalau angka ini besar berarti mekanisme itu belum jalan.
  select count(*), left(string_agg(
             to_char(now() at time zone 'Asia/Makassar', 'DD-MM') || ' ' ||
             coalesce(outlet_id,'-') || ' ' || coalesce(therapist_name,'-') || ' ' ||
             treatment_name || ' ' || treatment_price::text, ', '), 200)
    into v_n, v_contoh
    from bookings
   where status = 'berjalan'
     and end_at is not null
     and end_at < extract(epoch from (now() - interval '2 hours')) * 1000;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'transaksi_tertahan', 'transaksi', 'sedang',
       'Transaksi lewat jam tapi belum ditutup',
       'Treatment-nya sudah selesai lebih dari dua jam lalu, tapi statusnya masih berjalan. Omzet tetap benar karena yang dihitung hanya booking yang tidak batal, tapi papan status jadi terlihat salah.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  ------------------------------------------------------------------
  -- KATEGORI: STOK
  ------------------------------------------------------------------

  -- Barang keluar padahal stok sudah nol. Fungsi konsumsi mengunci di nol,
  -- jadi angka tidak jadi negatif, tapi log jadi lebih besar dari yang bisa
  -- dikurangi -- artinya ada barang keluar tanpa ada barang masuk.
  select count(*), left(string_agg(
             coalesce(i.outlet_id,'-') || ' ' || i.name || ' stok ' || i.stock::text ||
             ' keluar ' || d.keluar::text, ', '), 200)
    into v_n, v_contoh
    from inventory i
    join (
      select l.item_id, sum(l.qty)::int as keluar
        from inventory_logs l
       where l.type = 'out'
       group by l.item_id
    ) d on d.item_id = i.id
   where i.stock = 0 and d.keluar > 0;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'stok_nol_tetap_keluar', 'stok', 'sedang',
       'Barang stok 0 tapi tetap tercatat keluar',
       'Sistem mengunci stok di nol, jadi tidak jadi minus. Tapi berarti ada barang keluar tanpa pencatatan barang masuk.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- Stok minyak tidak sesuai stock_after di log terakhir.
  select count(*), left(string_agg(
             o.outlet_id || ' ' || o.oil_type || ' ' || coalesce(o.size,'-') ||
             ' stok ' || o.stock::text || ' log ' || t.stock_after::text, ', '), 200)
    into v_n, v_contoh
    from oil_inventory o
    join (
      select distinct on (outlet_id, oil_type, size) outlet_id, oil_type, size, stock_after
        from oil_inventory_logs
       order by outlet_id, oil_type, size, created_at desc
    ) t on t.outlet_id = o.outlet_id and t.oil_type = o.oil_type and t.size = o.size
   where o.stock <> t.stock_after;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'minyak_Logs_tidak_cocok', 'stok', 'rendah',
       'Stok minyak beda dengan catatan log terakhir',
       'Kolom stock dan stock_after di log terakhir tidak sama. Selisihnya biasanya 1 botol.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  ------------------------------------------------------------------
  -- KATEGORI: ABSENSI
  ------------------------------------------------------------------

  -- Tercatat hadir tapi tidak ada satu pun treatment di hari itu.
  --
  -- Dulu pemeriksaan ini melaporkan 48 temuan, hampir semuanya staff kantor
  -- (Uni, Meli, Azi, Mia) yang memang tidak menerima tamu. Itu bukan salah,
  -- cuma hari biasa bagi mereka. Melaporkannya sebagai temuan hanya membuat
  -- alarm terlihat tidak serius.
  --
  -- Jadi sekarang yang diperiksa hanya orang yang SEHARUSNYA punya treatment
  -- tapi tidak punya: yaitu yang tercatat mengambil tamu di hari itu. Kalau
  -- statusnya ambil_tamu tapi tidak ada satu pun treatment, itu baru layak
  -- ditanyakan.
  select count(*), left(string_agg(
             coalesce(t.name,'-') || ' ' || coalesce(t.home_outlet_id,'-'), ', '), 200)
    into v_n, v_contoh
    from therapists t
   where t.status = 'ambil_tamu'
     and not exists (
       select 1 from bookings b
        where b.therapist_id = t.id
          and b.status <> 'batal'
          and b.created_at >= ((now() at time zone 'Asia/Makassar')::date::text)::timestamptz
                            - interval '1 day'
          and b.created_at <  ((now() at time zone 'Asia/Makassar')::date::text)::timestamptz
                            + interval '2 days'
     );


  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'ambil_tamu_tanpa_treatment', 'absensi', 'sedang',
       'Status ambil tamu tapi tidak ada treatment',
       'Papan status bilang orang ini sedang melayani tamu, tapi tidak ada satu pun treatment atas namanya. Bisa saja lupa menekan Selesai, atau tamunya batal tidak dihapus.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- Ada treatment tapi absensinya kosong (hari yang sudah lewat).
  select count(*), left(string_agg(
             coalesce(b.therapist_name,'-') || ' ' ||
             (b.created_at at time zone 'Asia/Makassar')::date::text, ', '), 200)
    into v_n, v_contoh
    from bookings b
   where b.status <> 'batal'
     and b.therapist_id is not null
     and (b.created_at at time zone 'Asia/Makassar')::date::text between v_sejak
         and to_char(now() at time zone 'Asia/Makassar' - interval '1 day', 'YYYY-MM-DD')
     and not exists (
       select 1 from attendance a
        where a.employee_id = b.therapist_id
          and a.date = (b.created_at at time zone 'Asia/Makassar')::date::text
     );

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'treatment_tanpa_absensi', 'absensi', 'sedang',
       'Ada treatment tapi absensinya kosong',
       'Absensi otomatis jam 23:00 seharusnya mengisinya. Kalau masih kosong, berarti hari itu tidak diproses.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  -- Absensi tanpa pencatat. Tidak ada jejak siapa yang mengisi.
  select count(*), left(string_agg(
             coalesce(employee_name,'-') || ' ' || date, ', '), 200)
    into v_n, v_contoh
    from attendance
   where (recorded_by is null or recorded_by = '')
     and source <> 'auto'
     and date >= v_sejak;

  if v_n > 0 then
    insert into pemeriksaan_sistem
      (tanggal, kode, kategori, berat, judul, keterangan, total, contoh)
    values
      (v_tanggal, 'absensi_tanpa_pencatat', 'absensi', 'rendah',
       'Absensi tidak mencatat siapa yang mengisi',
       'Kalau ada sengketa tidak ada yang bisa dimintai keterangan.',
       v_n, v_contoh);
    v_total := v_total + v_n;
  end if;

  return v_total;
end;
$$;


-- Ringkasan temuan terbaru, dikelompokkan per kode.
--
-- PENTING soal cara bacanya: kolom `total` itu JUMLAH KEJADIAN, bukan jumlah
-- masalah. Satu masalah bisa berulang ratusan kali (misal 300 transaksi
-- yang sama-sama belum ditutup), dan itu tetap satu masalah dengan satu
-- penyebab. Menampilkan angka kejadian di depan membuat orang mengira ada
-- ratusan hal yang rusak, padahal hanya beberapa jenis.
--
-- Karena itu halaman aplikasi menampilkan "jenis masalah" sebagai angka
-- utama, dan jumlah kejadian hanya sebagai keterangan.
--
-- Kolom `urutan` ditambahkan, jadi bentuk return berubah dan fungsi lama
-- harus dihapus lebih dulu.
drop function if exists ringkasan_pemeriksaan();

create or replace function ringkasan_pemeriksaan()
returns table (
  kode        text,
  agent       text,
  kategori    text,
  berat       text,
  judul       text,
  total       integer,
  tanggal     text,
  contoh      text,
  urutan      integer
)
language sql
stable
as $$
  with terbaru as (
    select distinct on (agent, kode) kode, agent, kategori, berat, judul,
           total, tanggal, contoh
      from pemeriksaan_sistem
     order by agent, kode, tanggal desc, dicek_pada desc
  )
  select t.kode, t.agent, t.kategori, t.berat, t.judul, t.total, t.tanggal, t.contoh,
         case t.berat when 'tinggi' then 1 when 'sedang' then 2 else 3 end
    from terbaru t
   order by 8, t.total desc;
$$;


-- Angka utama untuk halaman: berapa BANYAK JENIS masalah yang aktif.
create or replace function ringkasan_jumlah()
returns table (
  jenis_berat      integer,
  jenis_sedang     integer,
  jenis_rendah     integer,
  kejadian_berat   bigint,
  kejadian_sedang  bigint,
  kejadian_rendah  bigint
)
language sql
stable
as $$
  with terbaru as (
    select distinct on (agent, kode) agent, kode, berat, total
      from pemeriksaan_sistem
     where tanggal = to_char(now() at time zone 'Asia/Makassar', 'YYYY-MM-DD')
     order by agent, kode, dicek_pada desc
  )
  select
    count(*) filter (where berat = 'tinggi')::int,
    count(*) filter (where berat = 'sedang')::int,
    count(*) filter (where berat = 'rendah')::int,
    coalesce(sum(total) filter (where berat = 'tinggi'), 0),
    coalesce(sum(total) filter (where berat = 'sedang'), 0),
    coalesce(sum(total) filter (where berat = 'rendah'), 0)
    from terbaru;
$$;


-- Riwayat temuan per tanggal, untuk melihat apakah masalah makin banyak
-- atau makin sedikit dari waktu ke waktu.
create or replace function riwayat_pemeriksaan(jumlah_hari integer default 14)
returns table (
  tanggal  text,
  kode     text,
  judul    text,
  berat    text,
  total    integer
)
language sql
stable
as $$
  select tanggal, kode, judul, berat, total
    from pemeriksaan_sistem
   where tanggal >= to_char(
           now() at time zone 'Asia/Makassar' - (jumlah_hari || ' days')::interval,
           'YYYY-MM-DD')
   order by tanggal desc,
            case berat when 'tinggi' then 1 when 'sedang' then 2 else 3 end,
            total desc;
$$;


-- CATATAN: tidak ada lagi jadwal cron di file ini.
--
-- Dulu file ini memasang job 'cek-kesehatan-sistem'. Sekarang pekerjaan itu menjadi salah satu agent (agent_kesalahan) yang
-- dijadwalkan oleh agent_dasar.sql, supaya semua agent punya nama dan
-- tempat yang sama di Supervisor. Kalau dua-duanya dibiarkan, pemeriksaan
-- berjalan dua kali setiap periode dan catatan kerjanya ambigu.
