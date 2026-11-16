/**
 * Helper pengambilan data berhalaman (paginated) dari Supabase/PostgREST.
 *
 * MASALAH YANG DISELESAIKAN
 * PostgREST membatasi jumlah baris per respons lewat `db-max-rows`
 * (default 1000; server produksi memang membatasi 1000). Akibatnya
 * `.limit(20000)` TIDAK membuat server mengirim 20.000 baris — server tetap
 * hanya mengirim 1.000 baris pertama, tanpa error. Kalau query rentang tanggal
 * tidak punya urutan yang tetap, 1.000 baris yang lolos bahkan bisa berbeda
 * tiap request. Itu sebabnya laporan Excel dengan rentang tanggal bisa
 * kehilangan sebagian transaksi dan totalnya tidak balance, sementara laporan
 * per tanggal (yang tiap harinya di bawah 1.000 baris) selalu benar.
 *
 * CARA PAKAI
 *   const rows = await fetchAllRows(() =>
 *     supabase
 *       .from('bookings')
 *       .select('...')
 *       .gte('created_at', start)
 *       .lte('created_at', end)
 *       .order('created_at', { ascending: true })
 *       .order('id', { ascending: true })
 *   );
 *
 * SYARAT
 * - `buildQuery` harus MENGEMBALIKAN QUERY BARU setiap dipanggil, karena query
 *   builder Supabase sekali pakai.
 * - Query WAJIB punya urutan deterministik, dan kolom terakhirnya harus unik
 *   (mis. `id`, atau pasangan primary key). Tanpa itu, halaman bisa tumpang
 *   tindih atau melewatkan baris saat banyak baris punya nilai urut yang sama.
 */

/** Ukuran halaman = batas `db-max-rows` PostgREST (default 1000). */
export const PAGE_SIZE = 1000;

/** Batas pengaman supaya browser tidak kehabisan memori kalau rentangnya kelewat panjang. */
export const MAX_ROWS = 200000;

export async function fetchAllRows(
  buildQuery,
  { pageSize = PAGE_SIZE, maxRows = MAX_ROWS, label = 'query' } = {}
) {
  const all = [];

  for (let from = 0; ; ) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) break;

    all.push(...rows);
    from += rows.length;

    if (all.length >= maxRows) {
      console.warn(
        `${label}: berhenti di ${all.length} baris (batas pengaman ${maxRows}). ` +
        'Angka laporan bisa kurang — persempit rentang tanggalnya.'
      );
      break;
    }
  }

  return all;
}
