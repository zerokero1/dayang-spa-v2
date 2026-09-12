import { useEffect, useState } from 'react';
import { ONCALL_PACKAGES, DEFAULT_ONCALL_COMMISSION_PCT, PAYMENT_METHOD_LABEL } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { createOncallBooking, getTodayOncall } from '../lib/oncallService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayId() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

function fmtWib(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 7 * 3600000);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export default function OncallPage({ outletId, active }) {
  const [therapists, setTherapists] = useState([]);
  const [selPkg, setSelPkg] = useState(null);
  const [selDur, setSelDur] = useState(null);
  const [therapistId, setTherapistId] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [commissionPct, setCommissionPct] = useState(String(DEFAULT_ONCALL_COMMISSION_PCT));
  const [method, setMethod] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [oncallList, setOncallList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!active) return;
    const unsub = listenAllTherapists(setTherapists);
    return () => unsub();
  }, [active]);

  async function loadList() {
    setLoadingList(true);
    try {
      setOncallList(await getTodayOncall(outletId, todayId()));
    } catch (e) {
      console.warn('oncall list', e);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    loadList();
    const timer = setInterval(loadList, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, outletId]);

  const pkg = ONCALL_PACKAGES.find((p) => p.id === selPkg) || null;
  const dur = pkg ? pkg.durations.find((d) => d.minutes === selDur) || null : null;
  const price = dur ? dur.price : 0;
  const therapistOptions = therapists
    .filter((t) => (t.status || 'free') !== 'ambil_tamu')
    .sort((a, b) => {
      const ao = a.homeOutletId === outletId ? 0 : 1;
      const bo = b.homeOutletId === outletId ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  const commissionVal = Number.isFinite(parseFloat(commissionPct)) ? parseFloat(commissionPct) : null;
  const therapistCommissionRp = commissionVal != null && price ? Math.round((commissionVal / 100) * price) : 0;

  const canSubmit =
    pkg && dur && therapistId && customerName.trim() &&
    method && commissionVal != null && commissionVal >= 0 && commissionVal <= 100;

  function resetForm() {
    setSelPkg(null);
    setSelDur(null);
    setTherapistId(null);
    setCustomerName('');
    setCommissionPct(String(DEFAULT_ONCALL_COMMISSION_PCT));
    setMethod('');
    setError('');
  }

  async function handleSubmit() {
    if (!canSubmit) {
      setError('Lengkapi paket, durasi, terapis, nama tamu/hotel, dan metode pembayaran.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await createOncallBooking({
        outletId,
        therapistId,
        packageName: `${pkg.name} (Full Body ${dur.minutes} mnt)`,
        durationMinutes: dur.minutes,
        price,
        commissionPercent: commissionVal,
        customerName: customerName.trim(),
        paymentMethod: method,
        hotelCommission: pkg.hotelCommission
      });
      setMessage('Order oncall berhasil dicatat dan langsung lunas.');
      resetForm();
      await loadList();
    } catch (e) {
      setError(e.message || 'Gagal mencatat order oncall.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kasir-page">
      <h2>Oncall Full Body Massage</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Order massage ke hotel/tamu — tercatat langsung lunas, komisi hotel dihitung otomatis.
      </p>

      <section>
        <p>Pilih menu</p>
        <div className="grid-2">
          {ONCALL_PACKAGES.map((p) => (
            <button
              key={p.id}
              className={selPkg === p.id ? 'active' : ''}
              onClick={() => { setSelPkg(p.id); setSelDur(null); }}
            >
              <strong>{p.name}</strong>
              <span style={{ display: 'block', fontSize: 12 }}>Komisi hotel {rp(p.hotelCommission)}</span>
            </button>
          ))}
        </div>
      </section>

      {pkg && (
        <section>
          <p>Durasi</p>
          <div className="grid-2">
            {pkg.durations.map((d) => (
              <button
                key={d.minutes}
                className={selDur === d.minutes ? 'active' : ''}
                onClick={() => setSelDur(d.minutes)}
              >
                <strong>{d.minutes} menit</strong>
                <span style={{ display: 'block', fontSize: 12 }}>{rp(d.price)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <p>Terapis</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 180, overflowY: 'auto' }}>
          {therapistOptions.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada terapis tersedia saat ini (semua sedang bertugas / data kosong).</p>
          )}
          {therapistOptions.map((t) => {
            const busyT = (t.status || 'free') === 'ambil_tamu';
            return (
              <button
                key={t.id}
                className={busyT ? 'pos-chip pos-chip-busy' : therapistId === t.id ? 'pos-chip active' : 'pos-chip'}
                disabled={busyT}
                onClick={() => setTherapistId(t.id)}
              >
                {t.name}{t.homeOutletId && t.homeOutletId !== outletId ? ` · ${t.homeOutletId}` : ''}{busyT ? ' 🔴 Ambil Tamu' : ''}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p>Nama tamu / hotel</p>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="cth: Hotel xxx / Ms. yyy"
        />
      </section>

      <section>
        <p>Komisi terapis (%)</p>
        <input
          type="number"
          value={commissionPct}
          onChange={(e) => setCommissionPct(e.target.value)}
          style={{ maxWidth: 160 }}
        />
      </section>

      <section>
        <p>Metode pembayaran (wajib)</p>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([val, label]) => (
            <button key={val} className={method === val ? 'pos-chip active' : 'pos-chip'} onClick={() => setMethod(val)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {pkg && dur && (
        <div className="oil-card" style={{ marginTop: 8 }}>
          <strong>Ringkasan</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 13, marginTop: 6, color: 'var(--text-secondary)' }}>
            <div>Paket: {pkg.name} ({dur.minutes} mnt)</div>
            <div>Harga: {rp(price)}</div>
            <div>Komisi hotel: {rp(pkg.hotelCommission)}</div>
            <div>Komisi terapis ({commissionVal ?? 0}%): {rp(therapistCommissionRp)}</div>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {message && <p style={{ color: 'var(--success)' }}>{message}</p>}

      <button onClick={handleSubmit} disabled={saving}>
        {saving ? 'Menyimpan...' : 'Catat Order Oncall'}
      </button>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Transaksi Oncall Hari Ini</h3>
          {loadingList && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>memuat...</span>}
        </div>
        {oncallList.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada transaksi oncall hari ini.</p>
        ) : (
          oncallList.map((b) => (
            <div key={b.id} className="oil-card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <strong>{b.treatmentName}</strong>
                <span>{rp(b.treatmentPrice)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {b.therapistName} · {b.customerName || '-'} · {fmtWib(b.createdAt)} WIB ·{' '}
                {b.paymentMethod === 'cardless' ? 'Cardless' : 'Cash'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Komisi hotel {rp(b.hotelCommission)} · Komisi terapis {rp(b.commissionAmount)}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}