-- ============================================================================
-- MENUTUP TRANSAKSI YANG SUDAH SELESAI
--
-- TEMUAN: ada 389 booking berstatus "berjalan" padahal jam treatment-nya
-- sudah lewat. 281 di antaranya lebih dari sehari lalu, 89 sampai 98 per
-- hari. Ini bukan error, tapi membingungkan dan membuat papan status
-- terlihat salah.
--
-- SEBABNYA: ada otomatis yang membebaskan terapis kalau jamnya habis
-- (auto_free_expired_therapists), tapi TIDAK ADA yang menutup booking-nya.
-- Jadi terapis sudah free, booking masih jalan. 241 baris persis begitu.
--
-- Damanya tidak pada uang. Omzet dihitung dari booking yang tidak batal,
-- bukan dari status berjalan, jadi angka revenue tetap benar. Yang rusak
-- hanya tampilannya.
--
-- Perbaikannya: booking yang jamnya sudah lewat lebih dari dua jam ditutup
-- otomatis. Dua jam ini memberi ruang kalau kasir sedang sibuk dan
-- baru mau menekan Lunas.
-- ============================================================================

create or replace function tutup_booking_berakhir()
returns integer
language plpgsql
as $$
declare
  v_mulai timestamptz := now();
  v_total integer := 0;
  v_per_outlet jsonb := '{}'::jsonb;
begin
  with ditutup as (
    update bookings
       set status = 'selesai'
     where status = 'berjalan'
       and end_at is not null
       and end_at < extract(epoch from (now() - interval '2 hours')) * 1000
    returning outlet_id
  )
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb), coalesce(sum(n), 0)
    into v_per_outlet, v_total
    from (select outlet_id as k, count(*)::int as n from ditutup group by 1) d;

  perform catat_agent_hasil(
    'tutup_booking', 'selesai',
    case when v_total = 0
         then 'Tidak ada transaksi tertinggal'
         else v_total || ' transaksi ditutup otomatis'
    end,
    v_total,
    v_per_outlet,
    v_mulai
  );

  return v_total;
end;
$$;


-- Pembungkus agarNamanya ikut pola agent_<kode>, supaya Supervisor bisa
-- menjalankannya dengan cara yang sama seperti agent yang lain.
create or replace function agent_tutup_booking()
returns integer
language sql
as $$
  select tutup_booking_berakhir();
$$;


-- Daftarkan sebagai agent supaya Supervisor ikut mengawasi.
insert into tabel_agent (kode, nama, tugas, jadwal, frekuensi)
values (
  'tutup_booking', 'Agent Tutup Booking',
  'Menutup transaksi yang jam treatment-nya sudah lewat, supaya papan status tidak menampilkan booking lama sebagai sedang berjalan.',
  '*/10 * * * *', 'setiap_jam'
)
on conflict (kode) do update
  set nama = excluded.nama,
      tugas = excluded.tugas,
      jadwal = excluded.jadwal,
      frekuensi = excluded.frekuensi;


-- Pasang jadwalnya kalau belum ada.
do $$
declare
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  for v_jobid in
    select jobid from cron.job where jobname = 'agent-tutup_booking'
  loop
    perform cron.unschedule(v_jobid);
  end loop;

  perform cron.schedule(
    'agent-tutup_booking', '*/10 * * * *', 'select tutup_booking_berakhir()');
end;
$$;
