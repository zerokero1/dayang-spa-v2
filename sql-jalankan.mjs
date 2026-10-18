// Menjalankan satu file SQL ke database Dayang Spa lewat port PostgreSQL.
//
// Cara pakai: node sql-jalankan <nama-file.sql>
//
// Kredensial dibaca dari file .env-pg di folder project ini. File itu TIDAK
// ikut ter-push ke GitHub (sudah masuk .gitignore), jadi aman disimpan di
// komputer Anda sendiri. Kalau belum ada, buat manual dengan isi seperti
// contoh di bawah.
//
// Contoh isi .env-pg:
//   PGHOST=lombokdayangspa.tech
//   PGUSER=postgres
//   PGPASSWORD=password-postgres-anda
//   PGDATABASE=postgres
//   PGSSLMODE=require

import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Cara pakai: node sql-jalankan <nama-file.sql>');
  process.exit(1);
}
if (!existsSync(file)) {
  console.error('File tidak ditemukan: ' + file);
  process.exit(1);
}

function envPathFor(rel) {
  const u = new URL('./' + rel, import.meta.url);
  return decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, '$1');
}

const envFile = envPathFor('.env-pg');
if (!existsSync(envFile)) {
  console.error('File .env-pg belum ada di folder project.');
  console.error('Buat dulu (isi 5 baris di bawah), lalu jalankan ulang:');
  console.error('');
  console.error('  PGHOST=lombokdayangspa.tech');
  console.error('  PGUSER=postgres');
  console.error('  PGPASSWORD=password-postgres-anda');
  console.error('  PGDATABASE=postgres');
  console.error('  PGSSLMODE=require');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const client = new pg.Client({
  host: env.PGHOST,
  port: Number(env.PGPORT || 5432),
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE || 'postgres',
  ssl: (env.PGSSLMODE || 'require') === 'disable' ? false : { rejectUnauthorized: false }
});

const sql = readFileSync(file, 'utf8');

console.log('File  : ' + file + '  (' + sql.length + ' karakter)');
console.log('Host  : ' + env.PGHOST + ':' + (env.PGPORT || 5432));
console.log('DB    : ' + (env.PGDATABASE || 'postgres'));
console.log('User  : ' + env.PGUSER);
console.log('');

try {
  await client.connect();
  console.log('Terhubung. Menjalankan SQL...');
  const result = await client.query(sql);
  const rows = Array.isArray(result) ? result[result.length - 1]?.rows : result?.rows;
  if (rows && rows.length) {
    console.log('');
    console.table(rows);
  } else if (result && result.rowCount != null) {
    console.log('Baris terpengaruh: ' + result.rowCount);
  }
  console.log('');
  console.log('SELESAI.');
} catch (e) {
  console.error('');
  console.error('GAGAL: ' + e.message);
  if (e.position) console.error('Posisi karakter: ' + e.position);
  if (e.detail) console.error('Detail: ' + e.detail);
  if (e.hint) console.error('Petunjuk: ' + e.hint);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}