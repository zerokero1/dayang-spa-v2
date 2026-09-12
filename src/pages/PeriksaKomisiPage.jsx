import { useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getCommissionAudit } from '../lib/reportService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayStr() {
  const d = new Date(Date.now() + 7 * 3600000);
  return d.toISOString().slice(0, 10);
}

function outletName(id) {
  return OUTLETS.find((o) => o.id === id)?.name || id;
}

export default function PeriksaKomisiPage({ active }) {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    if (!startDate || !endDate || endDate < startDate) {
      setError('Pilih rentang tanggal yang benar (awal <= akhir).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getCommissionAudit(startDate, endDate);
      setRows(data);
      setSearched(true);
    } catch (e) {
      setError(e.message || 'Gagal memuat data komisi.');
      setSearched(false);
    } finally {
      setLoading(false);
    }
  }

  const byTherapist = {};
  rows.forEach((r) => {
    if (!byTherapist[r.therapistName]) {
      byTherapist[r.therapistName] = { therapistName: r.therapistName, count: 0, recorded: 0, expected: 0, mismatch: 0 };
    }
    const t = byTherapist[r.therapistName];
    t.count += 1;
    t.recorded += r.recorded || 0;
    t.expected += r.expected || 0;
    if (r.mismatch) t.mismatch += 1;
  });
  const therapistRows = Object.values(byTherapist).sort((a, b) => b.recorded - a.recorded);
  const mismatches = rows.filter((r) => r.mismatch);
  const totalRecorded = rows.reduce((s, r) => s + (r.recorded || 0), 0);
  const totalExpected = rows.reduce((s, r) => s + (r.expected || 0), 0);

  return (
    <div className="kasir-page">
      <h2>Periksa Komisi Semua Terapis</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Membandingkan komisi tercatat (commission_amount) terhadap persen x harga di tiap booking.
        Selisih &gt; Rp0 dianggap bermasalah.
      </p>

      <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Dari</p>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ margin: 0 }} />
        </div>
        <div>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Sampai</p>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ margin: 0 }} />
        </div>
        <button onClick={run} disabled={loading}>
          {loading ? 'Memeriksa...' : '🔍 Periksa'}
        </button>
      </section>
      {error && <p className="error">{error}</p>}

      {searched && !loading && (
        <>
          <section className="grid-2">
            <div className="oil-card">
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Transaksi (non-batal)</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{rows.length}</div>
            </div>
            <div className="oil-card">
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Komisi tercatat total</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{rp(totalRecorded)}</div>
            </div>
            <div className="oil-card">
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Seharusnya (persen x harga)</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{rp(totalExpected)}</div>
            </div>
            <div className="oil-card" style={mismatches.length ? { border: '1px solid var(--warning)' } : undefined}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Bermasalah</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: mismatches.length ? 'var(--warning)' : 'var(--success)' }}>
                {mismatches.length}
              </div>
            </div>
          </section>

          <section>
            <h3>Per Terapis ({therapistRows.length})</h3>
            {therapistRows.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada transaksi di rentang ini.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: 6 }}>Terapis</th>
                      <th style={{ padding: 6 }}>Transaksi</th>
                      <th style={{ padding: 6 }}>Komisi tercatat</th>
                      <th style={{ padding: 6 }}>Seharusnya</th>
                      <th style={{ padding: 6 }}>Selisih</th>
                      <th style={{ padding: 6 }}>Bermasalah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {therapistRows.map((t) => (
                      <tr key={t.therapistName} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 6, fontWeight: 600 }}>{t.therapistName}</td>
                        <td style={{ padding: 6 }}>{t.count}</td>
                        <td style={{ padding: 6 }}>{rp(t.recorded)}</td>
                        <td style={{ padding: 6 }}>{rp(t.expected)}</td>
                        <td style={{ padding: 6, color: t.recorded - t.expected !== 0 ? 'var(--warning)' : 'var(--success)' }}>
                          {t.recorded - t.expected >= 0 ? '+' : '-'}{rp(Math.abs(t.recorded - t.expected))}
                        </td>
                        <td style={{ padding: 6, color: t.mismatch ? 'var(--warning)' : 'var(--success)' }}>
                          {t.mismatch}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 style={{ color: mismatches.length ? 'var(--warning)' : 'var(--success)' }}>
              Detail Bermasalah ({mismatches.length})
            </h3>
            {mismatches.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Semua komisi cocok. 🎉</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: 6 }}>Tanggal</th>
                      <th style={{ padding: 6 }}>Outlet</th>
                      <th style={{ padding: 6 }}>Terapis</th>
                      <th style={{ padding: 6 }}>Treatment</th>
                      <th style={{ padding: 6 }}>Harga</th>
                      <th style={{ padding: 6 }}>%</th>
                      <th style={{ padding: 6 }}>Tercatat</th>
                      <th style={{ padding: 6 }}>Seharusnya</th>
                      <th style={{ padding: 6 }}>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((r) => (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 6 }}>{r.date}</td>
                        <td style={{ padding: 6 }}>{outletName(r.outletId)}</td>
                        <td style={{ padding: 6 }}>{r.therapistName}</td>
                        <td style={{ padding: 6 }}>{r.treatmentName}</td>
                        <td style={{ padding: 6 }}>{rp(r.treatmentPrice)}</td>
                        <td style={{ padding: 6 }}>{r.commissionPercent}</td>
                        <td style={{ padding: 6 }}>{rp(r.recorded)}</td>
                        <td style={{ padding: 6 }}>{rp(r.expected)}</td>
                        <td style={{ padding: 6, color: 'var(--warning)' }}>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}