import { useEffect, useState } from 'react';
import { OUTLETS, OIL_SIZES, TREATMENT_CATEGORIES, treatmentUsesOil, oilChoicesFor } from '../lib/constants';
import { listenTreatments } from '../lib/treatmentService';
import { listenAllTherapists } from '../lib/therapistService';
import { getDailyBookings } from '../lib/reportService';
import { koreksiBooking } from '../lib/bookingService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayId() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

const STATUS_LABEL = { berjalan: 'Berjalan', selesai: 'Selesai', lunas: 'Lunas', batal_sebagian: 'Batal sebagian', batal: 'Batal' };

function EditRow({ booking, treatments, therapists, onSave, onCancel }) {
  const [category, setCategory] = useState(TREATMENT_CATEGORIES[0]);
  const [selTreatment, setSelTreatment] = useState(null);
  const [selTherapistId, setSelTherapistId] = useState(null);
  const [commission, setCommission] = useState(String(booking.commissionPercent ?? ''));
  const [selUsesOil, setSelUsesOil] = useState(booking.usesOil !== undefined ? booking.usesOil : (booking.oilType != null));
  const [selOil, setSelOil] = useState(booking.oilType);
  const [selSize, setSelSize] = useState(booking.oilSize);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const treatmentsInCategory = treatments.filter((t) => t.category === category);
  const activeTreatment = selTreatment || treatments.find((tt) => tt.id === booking.treatmentId) || null;
  const needsOil = activeTreatment ? treatmentUsesOil(activeTreatment) : selUsesOil;

  async function handleSave() {
    const t = selTreatment || treatments.find((tt) => tt.id === booking.treatmentId) || {
      id: booking.treatmentId, name: booking.treatmentName, price: booking.treatmentPrice,
      commissionPercent: booking.commissionPercent, durationMinutes: booking.durationMinutes
    };
    const commissionVal = commission !== '' ? Number(commission) : null;
    if (commissionVal !== null && (isNaN(commissionVal) || commissionVal < 0)) {
      setError('Komisi % tidak valid.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await koreksiBooking(booking.id, {
        treatmentId: t.id, treatmentName: t.name, treatmentPrice: t.price,
        commissionPercent: commissionVal !== null ? commissionVal : null,
        newTherapistId: selTherapistId || null,
        usesOil: needsOil,
        oilType: needsOil ? selOil : null,
        oilSize: needsOil ? selSize : null
      });
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="oil-card" style={{ marginBottom: 8, textAlign: 'left', borderLeft: '4px solid var(--primary)' }}>
      <p style={{ fontSize: 12, fontWeight: 600, marginTop: 0, color: 'var(--primary-dark)' }}>Koreksi — {booking.therapistName}</p>

      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Kategori treatment</p>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TREATMENT_CATEGORIES.map((c) => (
            <button key={c} className={category === c ? 'pos-chip active' : 'pos-chip'} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Treatment (kosongkan = tetap "{booking.treatmentName}")</p>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 140, overflowY: 'auto' }}>
          {treatmentsInCategory.map((t) => (
            <button key={t.id} className={selTreatment?.id === t.id ? 'pos-chip active' : 'pos-chip'} onClick={() => setSelTreatment(t)}>
              {t.name} - {rp(t.price)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Komisi % (kosongkan = pakai % treatment/tersimpan)</p>
        <input type="number" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder={`${booking.commissionPercent ?? 0}%`} style={{ margin: 0, maxWidth: 120 }} />
      </div>

      {needsOil && (
        <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Minyak</p>
          {oilChoicesFor(activeTreatment).map((oil) => (
            <div key={oil} style={{ display: 'inline-block', marginRight: 6, marginBottom: 4 }}>
              {OIL_SIZES.map((size) => (
                <button
                  key={size}
                  className={selOil === oil && selSize === size ? 'pos-chip active' : 'pos-chip'}
                  onClick={() => { setSelOil(oil); setSelSize(size); }}
                  style={{ marginRight: 2 }}
                >
                  {oil} ({size})
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Ganti terapis (opsional — saat ini "{booking.therapistName}")</p>
        <select value={selTherapistId || ''} onChange={(e) => setSelTherapistId(e.target.value || null)} style={{ width: '100%', padding: 11, borderRadius: 8, border: '1px solid var(--border)' }}>
          <option value="">- Tetap {booking.therapistName} -</option>
          {therapists.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.homeOutletId ? ` (${t.homeOutletId})` : ''}</option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}

      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} disabled={saving} onClick={handleSave}>
          {saving ? 'Menyimpan...' : 'Simpan koreksi'}
        </button>
        <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)', color: '#fff' }} onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  );
}

function selCommissionUnset() { return true; }

export default function KoreksiBookingPage({ active, isOffice }) {
  const [date, setDate] = useState(todayId());
  const [outletId, setOutletId] = useState('semua');
  const [bookings, setBookings] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsub = listenTreatments(setTreatments);
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = listenAllTherapists(setTherapists);
    return () => unsub();
  }, []);

  async function loadBookings() {
    setLoading(true);
    try {
      let list = [];
      if (outletId === 'semua') {
        const all = await Promise.all(OUTLETS.map((o) => getDailyBookings(o.id, date)));
        list = all.flat();
      } else {
        list = await getDailyBookings(outletId, date);
      }
      const filtered = list.filter((b) => b.status !== 'batal' && b.status !== 'batal_sebagian')
        .map((b) => ({ ...b, outletId: b.outletId }))
        .sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
      setBookings(filtered);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setEditingId(null);
    setMessage('Koreksi berhasil disimpan.');
    await loadBookings();
    setTimeout(() => setMessage(''), 3000);
  }

  const outletName = (id) => OUTLETS.find((o) => o.id === id)?.name || id;

  if (!isOffice) {
    return (
      <div className="kasir-page">
        <h2>Koreksi Booking</h2>
        <p>Halaman ini hanya tersedia untuk akun Office.</p>
      </div>
    );
  }

  return (
    <div className="kasir-page">
      <h2>Koreksi Booking</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Koreksi treatment, komisi, atau terapis pada booking yang salah input (khusus Office).
      </p>

      <section>
        <p>Outlet</p>
        <div className="grid-2">
          <button className={outletId === 'semua' ? 'active' : ''} onClick={() => setOutletId('semua')}>Semua outlet</button>
          {OUTLETS.map((o) => (
            <button key={o.id} className={outletId === o.id ? 'active' : ''} onClick={() => setOutletId(o.id)}>{o.name}</button>
          ))}
        </div>
      </section>

      <section>
        <p>Tanggal</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </section>

      <button onClick={loadBookings} disabled={loading}>
        {loading ? 'Memuat...' : 'Tampilkan booking'}
      </button>

      {message && <p style={{ fontSize: 13, color: 'var(--primary-dark)' }}>{message}</p>}
      {!loading && bookings.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada booking yang bisa dikoreksi pada tanggal ini.</p>
      )}

      {bookings.map((b, i) => (
        <div key={b.id}>
          {editingId === b.id ? (
            <EditRow
              booking={b}
              treatments={treatments}
              therapists={therapists}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{i + 1}. {b.therapistName}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>({outletName(b.outletId)})</span>
                  <div style={{ fontSize: 13, marginTop: 2 }}>{b.treatmentName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Komisi {b.commissionPercent ?? 0}% ({rp(b.commissionAmount)}) · {STATUS_LABEL[b.status] || b.status}
                  </div>
                </div>
                <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={() => setEditingId(b.id)}>
                  Koreksi
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
