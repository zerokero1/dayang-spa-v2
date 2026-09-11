import { useEffect, useState } from 'react';
import { supabase } from './supabase';

function todayBoundsMs() {
  const now = new Date(Date.now() + 7 * 3600000);
  const start = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00+07:00');
  return { start, end: start + 24 * 3600000 };
}

/**
 * Pantau jumlah transaksi hari ini yang BELUM BAYAR.
 * Return: { count, overdue }
 *   - count   : total transaksi belum bayar (semua status berjalan/selesai)
 *   - overdue : yang jam selesai treatment-nya sudah lewat tapi belum dibayar
 * Cetak ulang tiap 30 detik (sama seperti halaman-halaman lain).
 * outletId = null artinya hitung semua outlet (untuk admin pusat / office).
 */
export function useUnpaid(outletId, enabled) {
  const [summary, setSummary] = useState({ count: 0, overdue: 0 });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    function load() {
      const { start, end } = todayBoundsMs();
      let q = supabase
        .from('bookings')
        .select('id, end_at')
        .eq('paid', false)
        .in('status', ['berjalan', 'selesai'])
        .gte('start_at', start)
        .lte('start_at', end);
      if (outletId) q = q.eq('outlet_id', outletId);
      q.order('start_at', { ascending: false })
        .limit(600)
        .then(({ data, error }) => {
          if (error || !alive) return;
          const rows = data || [];
          const now = Date.now();
          setSummary({
            count: rows.length,
            overdue: rows.filter((b) => b.end_at != null && Number(b.end_at) <= now).length
          });
        });
    }

    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [outletId, enabled]);

  return summary;
}