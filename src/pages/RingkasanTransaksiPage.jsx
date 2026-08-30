import { useEffect, useState } from 'react';
import { OUTLETS, OIL_TYPES, OIL_SIZES, TREATMENT_CATEGORIES, treatmentUsesOil } from '../lib/constants';
import { listenTreatments } from '../lib/treatmentService';
import { getDailyBookings } from '../lib/reportService';
import { editBookingDetails } from '../lib/bookingService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayId() {
  // Tanggal LOKAL WIB (UTC+7) — konsisten dengan reportService & Status Terapis
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

function EditRow({ booking, treatments, onSave, onCancel }) {
  const [category, setCategory] = useState(TREATMENT_CATEGORIES[0]);
  const [selTreatment, setSelTreatment] = useState(null);
  const [selOil, setSelOil] = useState(booking.oilType);
  const [selSize, setSelSize] = useState(booking.oilSize);
  const [selUsesOil, setSelUsesOil] = useState(booking.usesOil !== undefined ? booking.usesOil : (booking.oilType != null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const treatmentsInCategory = treatments.filter((t) => t.category === category);

  const activeTreatment = selTreatment || treatments.find((tt) => tt.id === booking.treatmentId) || null;
  const needsOil = activeTreatment ? treatmentUsesOil(activeTreatment) : selUsesOil;

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const t = selTreatment || treatments.find((tt) => tt.id === booking.treatmentId) || {
        id: booking.treatmentId, name: booking.treatmentName, price: booking.treatmentPrice,
        commissionPercent: booking.commissionPercent, durationMinutes: booking.durationMinutes
      };
      await editBookingDetails(booking.outletId, booking.id, {
        treatmentId: t.id, treatmentName: t.name, treatmentPrice: t.price,
        commissionPercent: t.commissionPercent, durationMinutes: t.durationMinutes,
        usesOil: treatmentUsesOil(t), oilType: selOil, oilSize: selSize
      });
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
      <p style={{ fontSize: 12, fontWeight: 600, marginTop: 0 }}>Edit — {booking.therapistName}</p>

      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Kategori</p>
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

      {needsOil && (
      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Minyak</p>
        {OIL_TYPES.map((oil) => (
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

      {error && <p className="error">{error}</p>}

      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} disabled={saving} onClick={handleSave}>
          {saving ? 'Menyimpan...' : 'Simpan perubahan'}
        </button>
        <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)' }} onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  );
}

export default function RingkasanTransaksiPage({ active }) {
  const [outletId, setOutletId] = useState(OUTLETS[0].id);
  const [date, setDate] = useState(todayId());
  const [bookings, setBookings] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    const unsub = listenTreatments(setTreatments);
    return () => unsub();
  }, []);

  async function loadBookings() {
    setLoading(true);
    try {
      const data = await getDailyBookings(outletId, date);
      const withOutlet = data.filter((b) => b.status !== 'batal').map((b) => ({ ...b, outletId }));
      setBookings(withOutlet.sort((a, b) => (b.startAt || 0) - (a.startAt || 0)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    loadBookings();
  }, [active, outletId, date]);

  const totals = bookings.reduce((acc, b) => {
    const charge = b.paid && b.paymentMethod !== 'cardless' ? b.treatmentPrice : 0;
    const card = b.paid && b.paymentMethod === 'cardless' ? b.treatmentPrice : 0;
    const noBill = !b.paid ? b.treatmentPrice : 0;
    acc.charge += charge; acc.card += card; acc.noBill += noBill;
    acc.revenue += b.treatmentPrice || 0; acc.komisi += b.commissionAmount || 0;
    return acc;
  }, { charge: 0, card: 0, noBill: 0, revenue: 0, komisi: 0 });

  return (
    <div className="kasir-page">
      <h2>Ringkasan Transaksi</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Klik "Edit" kalau salah input treatment/minyak. Mengganti terapis tidak didukung di sini — batalkan & buat ulang di Status Terapis kalau salah pilih terapis.
      </p>

      <section>
        <p>Outlet</p>
        <div className="grid-2">
          {OUTLETS.map((o) => (
            <button key={o.id} className={outletId === o.id ? 'active' : ''} onClick={() => setOutletId(o.id)}>{o.name}</button>
          ))}
        </div>
      </section>

      <section>
        <p>Tanggal</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </section>

      {loading && <p style={{ fontSize: 13 }}>Memuat...</p>}
      {!loading && bookings.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada transaksi di tanggal ini.</p>
      )}

      {bookings.map((b, i) => (
        <div key={b.id}>
          {editingId === b.id ? (
            <EditRow
              booking={b}
              treatments={treatments}
              onSave={() => { setEditingId(null); loadBookings(); }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{i + 1}. {b.therapistName}</strong>
                  <div style={{ fontSize: 13, marginTop: 2 }}>{b.treatmentName}</div>
                  {b.oilType && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Minyak: {b.oilType} ({b.oilSize})</div>}
                </div>
                <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={() => setEditingId(b.id)}>
                  Edit
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12, marginTop: 8, color: 'var(--text-secondary)' }}>
                <div>Charge (Cash): {rp(b.paid && b.paymentMethod !== 'cardless' ? b.treatmentPrice : 0)}</div>
                <div>Card: {rp(b.paid && b.paymentMethod === 'cardless' ? b.treatmentPrice : 0)}</div>
                <div>No Bill: {rp(!b.paid ? b.treatmentPrice : 0)}</div>
                <div>Total Revenue: {rp(b.treatmentPrice)}</div>
                <div>Komisi ({b.commissionPercent}%): {rp(b.commissionAmount)}</div>
                <div>Ket: {b.status === 'batal_sebagian' ? 'Potongan harga' : b.paid ? 'Lunas' : 'Belum bayar'}</div>
              </div>
            </div>
          )}
        </div>
      ))}

      {bookings.length > 0 && (
        <div className="oil-card" style={{ marginTop: 12, background: 'var(--primary-light)' }}>
          <strong>GRAND TOTAL</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 13, marginTop: 6 }}>
            <div>Charge: {rp(totals.charge)}</div>
            <div>Card: {rp(totals.card)}</div>
            <div>No Bill: {rp(totals.noBill)}</div>
            <div>Revenue: {rp(totals.revenue)}</div>
            <div>Komisi: {rp(totals.komisi)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
