import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { OUTLETS } from '../lib/constants';
import { getCombinedDailyReport } from '../lib/reportService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayId() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

export default function DashboardPage({ active }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const date = todayId();
    try {
      const data = await getCombinedDailyReport(date);
      setReport(data);
    } catch (e) {
      console.error('Dashboard refresh error:', e);
    }
  }

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));

    // Realtime: muat ulang otomatis saat ada booking berubah di outlet mana pun.
    const channel = supabase
      .channel(`dash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => refresh())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [active]);

  // Safety net: polling tiap 90 detik kalau realtime terputus.
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(refresh, 90000);
    return () => clearInterval(iv);
  }, [active]);

  const grand = report || { grandTotalRevenue: 0, grandTotalCommission: 0, grandTotalTreatment: 0, grandTotalDiscount: 0 };
  const perOutlet = report?.perOutlet || {};

  return (
    <div className="kasir-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dashboard Pendapatan</h2>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Memuat…</span>}
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        Live — otomatis terbarui saat ada transaksi baru
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Omzet Hari Ini</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary-dark)', marginTop: 4 }}>{rp(grand.grandTotalRevenue)}</div>
        </div>
        <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Komisi Terapis</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--busy)', marginTop: 4 }}>{rp(grand.grandTotalCommission)}</div>
        </div>
        <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Treatment</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{grand.grandTotalTreatment}</div>
        </div>
        <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Diskon</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--busy)', marginTop: 4 }}>{rp(grand.grandTotalDiscount)}</div>
        </div>
      </div>

      {report && (
        <>
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table className="summary-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8 }}>Outlet</th>
                  <th style={{ padding: 8 }}>Treatment</th>
                  <th style={{ padding: 8 }}>Omzet</th>
                  <th style={{ padding: 8 }}>Cash</th>
                  <th style={{ padding: 8 }}>Cardless</th>
                  <th style={{ padding: 8 }}>Belum Bayar</th>
                  <th style={{ padding: 8 }}>Komisi</th>
                </tr>
              </thead>
              <tbody>
                {OUTLETS.map((o) => {
                  const s = perOutlet[o.id];
                  if (!s) return null;
                  return (
                    <tr key={o.id}>
                      <td style={{ textAlign: 'left', padding: 8 }}>{o.name}</td>
                      <td style={{ padding: 8 }}>{s.totalTreatment}</td>
                      <td style={{ padding: 8 }}>{rp(s.totalRevenue)}</td>
                      <td style={{ padding: 8 }}>{rp(s.cashRevenue)}</td>
                      <td style={{ padding: 8 }}>{rp(s.cardlessRevenue)}</td>
                      <td style={{ padding: 8, color: 'var(--busy)' }}>{rp(s.unpaidRevenue)}</td>
                      <td style={{ padding: 8 }}>{rp(s.totalCommission)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!report && !loading && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Belum ada data hari ini.</p>
      )}
    </div>
  );
}
