import { useEffect, useState } from 'react';
import { OUTLETS, OIL_SIZES, TREATMENT_CATEGORIES, PAYMENT_METHOD_LABEL, treatmentUsesOil, oilChoicesFor } from '../lib/constants';
import { listenTreatments } from '../lib/treatmentService';
import { listenAllTherapists } from '../lib/therapistService';
import { getDailyBookings } from '../lib/reportService';
import { koreksiBooking, hapusBookingOffice, koreksiPembayaran } from '../lib/bookingService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

// Amankan label metode: hanya tampilkan Cash/Cardless, sisanya '-'.
function methodLabel(m) {
  if (!m || typeof m !== 'string') return '-';
  return PAYMENT_METHOD_LABEL[m] || '-';
}

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
  const [discount, setDiscount] = useState(booking.discountPct != null ? String(booking.discountPct) : '');
  const [discountReason, setDiscountReason] = useState(booking.discountReason || '');
  const [selUsesOil, setSelUsesOil] = useState(booking.usesOil !== undefined ? booking.usesOil : (booking.oilType != null));
  const [selOil, setSelOil] = useState(booking.oilType);
  const [selSize, setSelSize] = useState(booking.oilSize);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  async function savePayment(paid, method) {
    setPaySaving(true);
    setError('');
    try {
      await koreksiPembayaran(booking.id, { paid, paymentMethod: method });
      onSave();
    } catch (e) {
      setError('Gagal ubah pembayaran: ' + e.message);
    } finally {
      setPaySaving(false);
    }
  }

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
    const discountVal = discount !== '' ? Number(discount) : null;
    if (discountVal !== null && (isNaN(discountVal) || discountVal < 0 || discountVal > 100)) {
      setError('Diskon % harus antara 0 dan 100.');
      return;
    }
    if (discountVal !== null && discountVal > 0 && !discountReason.trim()) {
      setError('Alasan diskon wajib diisi.');
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
        oilSize: needsOil ? selSize : null,
        discountPct: discountVal,
        discountReason: discountVal != null && discountVal > 0 ? discountReason.trim() : null
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

      <div style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Diskon % (kosongkan = tidak diubah · 0 = hapus diskon)</p>
        {booking.originalPrice != null && booking.originalPrice > booking.treatmentPrice && (
          <p style={{ fontSize: 11, color: 'var(--primary-dark)', margin: '0 0 6px' }}>
            Saat ini: diskon {booking.discountPct != null ? `${booking.discountPct}%` : ''} — harga {rp(booking.treatmentPrice)} dari {rp(booking.originalPrice)}
            {booking.discountReason ? ` (${booking.discountReason})` : ''}
          </p>
        )}
        <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" style={{ margin: 0, maxWidth: 120, marginBottom: 6 }} />
        <input type="text" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Alasan diskon (wajib bila >0)" style={{ margin: 0, width: '100%' }} />
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

      <div style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
          Pembayaran — sekarang: {booking.paid
            ? <strong style={{ color: 'var(--primary-dark)' }}>✓ Lunas via {methodLabel(booking.paymentMethod)}</strong>
            : <strong style={{ color: 'var(--danger)' }}>Belum bayar</strong>}
        </p>
        {!booking.paid ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={{ width: 'auto', padding: '8px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--primary-dark)', color: '#fff' }} disabled={paySaving} onClick={() => savePayment(true, 'cash')}>
              Tandai Lunas (Cash)
            </button>
            <button style={{ width: 'auto', padding: '8px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--primary-dark)', color: '#fff' }} disabled={paySaving} onClick={() => savePayment(true, 'cardless')}>
              Tandai Lunas (Cardless)
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Ganti metode:</span>
            <button style={{ width: 'auto', padding: '8px 12px', fontSize: 12, boxShadow: 'none' }} disabled={paySaving} onClick={() => savePayment(true, 'cash')}>
              Cash
            </button>
            <button style={{ width: 'auto', padding: '8px 12px', fontSize: 12, boxShadow: 'none' }} disabled={paySaving} onClick={() => savePayment(true, 'cardless')}>
              Cardless
            </button>
            <button style={{ width: 'auto', padding: '8px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--busy)', color: '#fff' }} disabled={paySaving} onClick={() => savePayment(false)}>
              Batalkan lunas
            </button>
          </div>
        )}
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

  async function handleDelete(b) {
    if (!window.confirm(`Hapus treatment "${b.treatmentName}" milik ${b.therapistName}? Booking akan ditandai batal.`)) return;
    try {
      await hapusBookingOffice(b.id);
      setMessage(`Treatment ${b.therapistName} - ${b.treatmentName} dihapus (batal).`);
      await loadBookings();
      setTimeout(() => setMessage(''), 3000);
    } catch (e) {
      alert('Gagal menghapus: ' + e.message);
    }
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
        Koreksi treatment, komisi, terapis, minyak, atau diskon pada booking yang salah input (khusus Office).
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
                    {rp(b.treatmentPrice)}
                    {b.originalPrice != null && b.originalPrice > b.treatmentPrice
                      ? ` (dari ${rp(b.originalPrice)}${b.discountPct ? `, potong ${b.discountPct}%` : ''}${b.discountReason ? ` — ${b.discountReason}` : ''})`
                      : ''} · Komisi {b.commissionPercent ?? 0}% ({rp(b.commissionAmount)}) · {STATUS_LABEL[b.status] || b.status}
                      · {b.paid ? `Lunas (${methodLabel(b.paymentMethod)})` : 'Belum bayar'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={() => setEditingId(b.id)}>
                    Koreksi
                  </button>
                  <button
                    style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--danger)', color: '#fff' }}
                    onClick={() => handleDelete(b)}
                  >
                    Hapus treatment
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
