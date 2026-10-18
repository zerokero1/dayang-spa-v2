/**
 * Backup database ke disk.
 *
 * Agent Arsip di server menyalin tabel ke dalam database itu sendiri. Itu
 * melindungi dari kesalahan tidak sengaja (salah hapus, salah ubah), tapi
 * tidak melindungi dari server yang ikut rusak atau salah konfigurasi.
 * Untuk itu butuh salinan yang benar-benar ada di tempat lain.
 *
 * Isi backup: seluruh tabel di schema public, ditulis sebagai satu file JSON
 * per tanggal. Password dan isi .env tidak pernah ikut.
 *
 * Cara pakai:
 *   node backup-database.mjs            -> backup hari ini
 *   node backup-database.mjs 2026-10-18 -> backup dengan tanggal tertentu
 *
 * Untuk berjalan otomatis setiap malam, buat penjadwalan Windows:
 *   schtasks /create /tn "Backup Dayang Spa" /tr "node D:\dayang-spa-v2\backup-database.mjs" /sc daily /st 01:30
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const LOKASI = path.join(process.cwd(), 'backup', 'dayang-spa');
const JAGA_HARI = 30;

// Nama tabel yang isinya tidak pernah ikut backup.
const LEWATI = new Set([]);

function bacaEnv(p) {
  const e = {};
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return e;
}

function ukuranUntukOrang(n) {
  if (n == null) return null;
  const angka = Number(n);
  if (!Number.isFinite(angka)) return String(n);
  return angka.toLocaleString('id-ID');
}

async function main() {
  const tanggal = process.argv[2] || new Date().toISOString().slice(0, 10);
  const tujuan = path.join(LOKASI, tanggal);

  if (!fs.existsSync('.env-pg')) {
    console.error('Tidak ada .env-pg. Backup tidak bisa dijalankan.');
    process.exit(1);
  }

  fs.mkdirSync(tujuan, { recursive: true });

  const env = bacaEnv('.env-pg');
  const client = new pg.Client({
    host: env.PGHOST,
    port: 5432,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: 'postgres',
    ssl: false
  });
  await client.connect();

  const { rows: tabel } = await client.query(`
    select table_name
      from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `);

  const ringkasan = [];
  const mulai = Date.now();
  console.log('Backup ' + tanggal + ' -> ' + tujuan);
  console.log('Ada ' + tabel.length + ' tabel\n');

  for (const { table_name: nama } of tabel) {
    if (LEWATI.has(nama)) continue;
    const begun = Date.now();
    try {
      const { rows, rowCount } = await client.query(
        'select * from public.' + pgClientQuote(nama)
      );
      const namaFile = nama + '.json';
      fs.writeFileSync(
        path.join(tujuan, namaFile),
        JSON.stringify(rows, null, 0),
        'utf8'
      );
      const ukuran = fs.statSync(path.join(tujuan, namaFile)).size;
      ringkasan.push({
        tabel: nama,
        baris: rowCount,
        byte: ukuran,
        ms: Date.now() - begun
      });
      console.log(
        '  ' + nama.padEnd(34) +
        String(rowCount).padStart(8) + ' baris  ' +
        (Math.round(ukuran / 1024) + ' KB').padStart(10)
      );
    } catch (e) {
      ringkasan.push({ tabel: nama, galat: e.message });
      console.log('  ' + nama.padEnd(34) + ' GAGAL: ' + e.message.slice(0, 60));
    }
  }

  // Daftar isi file ini, supaya jelas apa saja yang tersimpan tanpa harus
  // membuka satu per satu.
  fs.writeFileSync(
    path.join(tujuan, '_ringkasan.json'),
    JSON.stringify(
      {
        tanggal,
        dibuat: new Date().toISOString(),
        total_tabel: ringkasan.length,
        total_baris: ringkasan.reduce((n, t) => n + (t.baris || 0), 0),
        durasi_detik: Math.round((Date.now() - mulai) / 1000),
        tabel: ringkasan
      },
      null,
      2
    ),
    'utf8'
  );

  // Catat ke server supaya halaman Supervisor bisa tahu backup terakhir.
  try {
    await client.query(
      `insert into catatan_agent (agent, status, pesan, temuan, rincian)
       values ('arsip_disk', 'selesai', $1, 0, $2)`,
      [
        'Backup disk ' + tanggal,
        JSON.stringify({
          folder: tujuan,
          tabel: ringkasan.length,
          baris: ringkasan.reduce((n, t) => n + (t.baris || 0), 0)
        })
      ]
    );
  } catch (e) {
    console.log('\nTidak bisa menulis catatan ke server: ' + e.message.slice(0, 60));
  }

  // Pangkas backup lama.
  const semua = fs
    .readdirSync(LOKASI, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  const lebihDari = semua.slice(0, Math.max(0, semua.length - JAGA_HARI));
  for (const nama of lebihDari) {
    fs.rmSync(path.join(LOKASI, nama), { recursive: true, force: true });
    console.log('  (backup lama dihapus: ' + nama + ')');
  }

  await client.end();

  const totalBaris = ringkasan.reduce((n, t) => n + (t.baris || 0), 0);
  const gagal = ringkasan.filter((t) => t.galat).length;
  console.log(
    '\nSelesai: ' + ringkasan.length + ' tabel, ' +
    ukuranUntukOrang(totalBaris) + ' baris, ' +
    Math.round((Date.now() - mulai) / 1000) + ' detik'
  );
  if (gagal > 0) {
    console.log('Ada ' + gagal + ' tabel yang gagal diambil. Periksa daftar di atas.');
    process.exitCode = 1;
  }
}

// Nama tabel bisa mengandung karakter aneh. Tanpa ini, nama tabel bisa
// disisipkan ke query.
function pgClientQuote(nama) {
  return '"' + String(nama).replace(/"/g, '""') + '"';
}

main().catch((e) => {
  console.error('Backup gagal: ' + e.message);
  process.exit(1);
});
