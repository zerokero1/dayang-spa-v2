/**
 * Cek semua halaman: render tiap file di src/pages tanpa browser.
 *
 * Dipakai karena `npm run build` TIDAK menangkap salah ketik nama variabel.
 * Build tetap lolos, tapi halamannya jadi putih kosong saat dibuka karena
 * React melempar ReferenceError dan tidak ada yang menangkapnya.
 *
 * Jalankan:  npm run cek:halaman
 */
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const dir = process.cwd();
const sementara = path.join(dir, '.cek-halaman-tmp.cjs');

// Booking ke Supabase tidak dijalankan saat render pertama, jadi kunci
// environment hanya perlu nilai placeholder.
const define = {
  'import.meta.env': JSON.stringify({
    VITE_SUPABASE_URL: 'https://cek.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'cek'
  })
};

async function cek(entry) {
  const nama = path.basename(entry).replace('.jsx', '');
  const hasil = await esbuild.build({
    entryPoints: [path.join(dir, entry)],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'exceljs', '@supabase/supabase-js'],
    define,
    logLevel: 'silent'
  });

  fs.writeFileSync(sementara, hasil.outputFiles[0].text, 'utf8');
  try {
    const modul = await import('file:///' + sementara.replace(/\\/g, '/'));
    renderToStaticMarkup(createElement(modul.default.default, {}));
    return { nama, ok: true };
  } catch (e) {
    const jejak = (e.stack || '').split('\n')[1] || '';
    return { nama, ok: false, pesan: e.message, jejak: jejak.trim().slice(0, 100) };
  } finally {
    try { fs.unlinkSync(sementara); } catch {}
  }
}

const folder = path.join(dir, 'src', 'pages');
const daftar = fs
  .readdirSync(folder)
  .filter((f) => f.endsWith('.jsx'))
  .sort();

const laporan = [];
for (const f of daftar) laporan.push(await cek(path.join('src', 'pages', f)));

const rusak = laporan.filter((h) => !h.ok);
laporan.filter((h) => h.ok).forEach((h) => console.log('  OK    ' + h.nama));
rusak.forEach((h) => {
  console.log('  GAGAL ' + h.nama + '  -> ' + h.pesan);
  if (h.jejak) console.log('         ' + h.jejak);
});

console.log('');
console.log('ringkasan: ' + (laporan.length - rusak.length) + ' ok, ' + rusak.length + ' rusak');
process.exit(rusak.length ? 1 : 0);