import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { OUTLETS } from '../lib/constants';
import { getCombinedDailyReport } from '../lib/reportService';
import { getTherapistBoardSummary } from '../lib/therapistBoardService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function MiniStat({ label, value, bg }) {
  return (
    <div style={{ background: bg, color: '#fff', borderRadius: 10, padding: '6px 10px', textAlign: 'center', minWidth: 66 }}>
      <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.95 }}>{label}</div>
    </div>
  );
}

function todayId() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

export default function DashboardPage({ active, onOpen }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState(null);

  async function refresh() {
    const date = todayId();
    try {
      const data = await getCombinedDailyReport(date);
      setReport(data);
    } catch (e) {
      console.error('Dashboard refresh error:', e);
    }
  }

  async function refreshBoard() {
    const s = await getTherapistBoardSummary();
    if (s) setBoard(s);
  }

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
    refreshBoard();

    // Realtime: muat ulang otomatis saat ada booking berubah di outlet mana pun.
    const channel = supabase
      .channel(`dash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { refresh(); refreshBoard(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'therapists' }, () => refreshBoard())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [active]);

  // Safety net: polling tiap 90 detik kalau realtime terputus.
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(refresh, 90000);
    const iv2 = setInterval(refreshBoard, 60000);
    return () => { clearInterval(iv); clearInterval(iv2); };
  }, [active]);

  const grand = report || { grandTotalRevenue: 0, grandTotalCommission: 0, grandTotalTreatment: 0, grandTotalDiscount: 0, grandOncallRevenue: 0, grandOncallCount: 0 };
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

      {/* Ringkasan Dashboard Terapis + pintasan ke halamannya. */}
      <div
        className="oil-card"
        style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Dashboard Terapis — hari ini</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
            {board
              ? [
                  `${board.busy} ambil tamu`,
                  board.break ? `${board.break} break` : null,
                  (board.overtimeToday ?? board.overtime) ? `${board.overtimeToday ?? board.overtime} lembur` : null,
                  `${board.free} free`
                ].filter(Boolean).join(' · ')
              : 'Memuat…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {board && (
            <>
              <MiniStat label="Ambil Tamu" value={board.busy} bg="var(--busy)" />
              <MiniStat label="Break" value={board.break} bg="var(--warning, #f59e0b)" />
              <MiniStat label="Lembur" value={board.overtimeToday ?? board.overtime} bg="#7c3aed" />
            </>
          )}
        </div>
        {onOpen && (
          <button
            style={{ width: 'auto', padding: '10px 14px', fontSize: 13 }}
            onClick={() => onOpen('dashboardTerapis')}
          >
            Buka Dashboard Terapis →
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Omzet Outlet</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary-dark)', marginTop: 4 }}>{rp(grand.grandTotalRevenue)}</div>
        </div>
        <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Omzet Oncall</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>{rp(grand.grandOncallRevenue)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{grand.grandOncallCount || 0} transaksi</div>
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
                  <th style={{ padding: 8 }}>Oncall</th>
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
                      <td style={{ padding: 8, color: 'var(--primary)' }}>{rp(s.oncallRevenue)}</td>
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

          {Object.keys(report.therapistCommissions || {}).length > 0 && (
            <div className="oil-card" style={{ padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Komisi per Terapis</div>
              {Object.entries(report.therapistCommissions)
                .sort((a, b) => b[1].commissionTotal - a[1].commissionTotal)
                .map(([tid, t]) => (
                  <div key={tid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{t.therapistName} <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>({t.treatmentCount} trx)</span></span>
                    <span>{rp(Math.round(t.commissionTotal))}</span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {!report && !loading && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Belum ada data hari ini.</p>
      )}
    </div>
  );
}
