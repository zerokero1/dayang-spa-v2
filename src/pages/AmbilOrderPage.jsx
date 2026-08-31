import { useEffect, useState } from 'react';
import { OUTLETS, OIL_TYPES, OIL_SIZES, TREATMENT_CATEGORIES, treatmentUsesOil } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { listenTreatments } from '../lib/treatmentService';
import { createBooking, createBookingsBatch } from '../lib/bookingService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

export default function AmbilOrderPage({ active }) {
  const [outletId, setOutletId] = useState(OUTLETS[0].id);
  const [therapists, setTherapists] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [category, setCategory] = useState(TREATMENT_CATEGORIES[0]);
  const [treatmentSearch, setTreatmentSearch] = useState('');
  const [therapistSearch, setTherapistSearch] = useState('');

  const [selTreatment, setSelTreatment] = useState(null);
  const [selOil, setSelOil] = useState(null);
  const [selSize, setSelSize] = useState(null);
  const [selNoOil, setSelNoOil] = useState(false);
  const [selTherapist, setSelTherapist] = useState(null);

  const [customerName, setCustomerName] = useState('');
  const [cart, setCart] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!active) return;
    const unsub1 = listenAllTherapists(setTherapists);
    const unsub2 = listenTreatments(setTreatments);
    return () => { unsub1(); unsub2(); };
  }, [active]);

  const treatmentsInCategory = treatments
    .filter((t) => t.category === category)
    .filter((t) => t.name.toLowerCase().includes(treatmentSearch.toLowerCase()));

  const cartTherapistIds = new Set(cart.map((c) => c.therapist.id));
  const cartCountByTherapist = {};
  cart.forEach((c) => { cartCountByTherapist[c.therapist.id] = (cartCountByTherapist[c.therapist.id] || 0) + 1; });
  const filteredTherapists = therapists.filter((t) => t.name.toLowerCase().includes(therapistSearch.toLowerCase()));

  const usesOil = (t) => treatmentUsesOil(t);
  const lineNeedsOil = usesOil(selTreatment);
  const canAddLine = selTreatment && selTherapist && (!lineNeedsOil || selNoOil || (selOil && selSize));
  const discountedPrice = (line) => Math.round((line.treatment.price || 0) * (1 - (line.discountPct || 0) / 100));
  const cartTotal = cart.reduce((sum, l) => sum + discountedPrice(l), 0);
  const grandTotal = cartTotal + (canAddLine ? selTreatment.price : 0);

  function resetLineSelection() {
    setSelTreatment(null); setSelOil(null); setSelSize(null); setSelNoOil(false); setSelTherapist(null);
  }

  function handleAddToCart() {
    if (!canAddLine) return;
    const useOil = usesOil(selTreatment) && !selNoOil;
    setCart((c) => [...c, { therapist: selTherapist, treatment: selTreatment, oil: useOil ? selOil : null, size: useOil ? selSize : null, noOil: selNoOil, discountPct: 0 }]);
    resetLineSelection();
  }

  function handleRemoveFromCart(index) {
    setCart((c) => c.filter((_, i) => i !== index));
  }

  function handleDiscount(index, pct) {
    setCart((c) => c.map((l, i) => (i === index ? { ...l, discountPct: pct } : l)));
  }

  async function handleSaveAll() {
    const finalCart = canAddLine
      ? [...cart, {
          therapist: selTherapist, treatment: selTreatment,
          oil: (usesOil(selTreatment) && !selNoOil) ? selOil : null,
          size: (usesOil(selTreatment) && !selNoOil) ? selSize : null,
          noOil: selNoOil
        }]
      : cart;
    if (finalCart.length === 0) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const items = finalCart.map((line) => {
        const useOil = treatmentUsesOil(line.treatment) && !line.noOil;
        return {
          outletId,
          therapistId: line.therapist.id,
          therapistName: line.therapist.name,
          treatmentId: line.treatment.id,
          treatmentName: line.treatment.name,
          treatmentPrice: discountedPrice(line),
          originalPrice: line.discountPct ? (line.treatment.price || 0) : null,
          commissionPercent: line.treatment.commissionPercent,
          durationMinutes: line.treatment.durationMinutes,
          usesOil: useOil,
          oilType: useOil ? line.oil : null,
          oilSize: useOil ? line.size : null,
          customerName
        };
      });
      if (items.length === 1) {
        await createBooking(items[0]);
      } else {
        await createBookingsBatch(items);
      }
      // WhatsApp terbuka di tab terpisah; form di tab ini langsung dibersihkan.
      setCart([]);
      resetLineSelection();
      setCustomerName('');
      setSaving(false);
    } catch (e) {
      console.error('handleSaveAll error:', e, e && e.stack);
      setError((e && e.message) || String(e));
      setSaving(false);
    }
  }

  return (
    <div className="kasir-page">
      <h2>Ambil Order</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Setelah disimpan, order langsung muncul real-time di aplikasi Kasir & membuka WhatsApp untuk notifikasi.
      </p>

      {message && <p style={{ fontSize: 13, color: 'var(--primary-dark)' }}>{message}</p>}
      {error && <p className="error">{error}</p>}

      <section>
        <p>Outlet tujuan</p>
        <div className="grid-2">
          {OUTLETS.map((o) => (
            <button key={o.id} className={outletId === o.id ? 'active' : ''} onClick={() => setOutletId(o.id)}>
              {o.name}
            </button>
          ))}
        </div>
      </section>

      {cart.length > 0 && (
        <section>
          <p>Treatment sudah ditambahkan ({cart.length})</p>
          {cart.map((line, i) => (
            <div key={i} className="oil-card" style={{ marginBottom: 6, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13 }}>
                  <strong>{line.therapist.name}</strong> — {line.treatment.name}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                    {line.oil ? `Minyak ${line.oil} (${line.size}) · ` : (line.noOil ? 'Tanpa minyak · ' : '')}
                    <strong>{rp(discountedPrice(line))}</strong>
                    {line.discountPct ? (
                      <span style={{ color: 'var(--danger)' }}> (diskon {line.discountPct}%)</span>
                    ) : null}
                  </div>
                </div>
                <button
                  style={{ width: 'auto', padding: '6px 10px', fontSize: 12, boxShadow: 'none', background: 'var(--danger)', color: '#fff' }}
                  onClick={() => handleRemoveFromCart(i)}
                >
                  Hapus
                </button>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                {[0, 5, 10, 15, 20, 25].map((p) => (
                  <button
                    key={p}
                    className={line.discountPct === p ? 'pos-chip active' : 'pos-chip'}
                    onClick={() => handleDiscount(i, p)}
                    style={{ fontSize: 11, padding: '2px 8px' }}
                  >
                    {p === 0 ? '-' : `${p}%`}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, padding: '8px 4px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <span>Subtotal</span>
            <span>{rp(cartTotal)}</span>
          </div>
        </section>
      )}

      <section>
        <p>Kategori treatment</p>
        <div className="grid-2">
          {TREATMENT_CATEGORIES.map((c) => (
            <button key={c} className={category === c ? 'active' : ''} onClick={() => { setCategory(c); setSelTreatment(null); }}>
              {c}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p>Pilih treatment</p>
        <input placeholder="Cari treatment..." value={treatmentSearch} onChange={(e) => setTreatmentSearch(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="grid-2">
          {treatmentsInCategory.map((t) => (
            <button key={t.id} className={selTreatment?.id === t.id ? 'active' : ''} onClick={() => setSelTreatment(t)}>
              {t.name} - {rp(t.price)}
            </button>
          ))}
        </div>
      </section>

      {lineNeedsOil && (
      <section>
        <p>Pilih minyak & ukuran</p>
        <div className={`grid-2 ${selNoOil ? 'oil-card-disabled' : ''}`} style={selNoOil ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          {OIL_TYPES.map((oil) => (
            <div key={oil} className="oil-card">
              <div>{oil}</div>
              <div className="row">
                {OIL_SIZES.map((size) => (
                  <button
                    key={size}
                    className={selOil === oil && selSize === size ? 'active' : ''}
                    onClick={() => { setSelOil(oil); setSelSize(size); setSelNoOil(false); }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          className={selNoOil ? 'active' : ''}
          onClick={() => { setSelOil(null); setSelSize(null); setSelNoOil(true); }}
          style={{ marginTop: 10, boxShadow: 'none' }}
        >
          Tanpa Minyak
        </button>
      </section>
      )}

      <section>
        <p>Pilih terapis (yang sudah dipakai di daftar ini ditandai)</p>
        <input placeholder="Cari nama terapis..." value={therapistSearch} onChange={(e) => setTherapistSearch(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="grid-2">
          {filteredTherapists.map((t) => {
            const busy = (t.status || 'free') === 'ambil_tamu';
            const inCart = cartTherapistIds.has(t.id);
            // Satu terapis boleh mengambil beberapa treatment sekaligus
            // (double treatment), baik Massage maupun bukan.
            const disabled = busy;
            return (
              <button
                key={t.id}
                disabled={disabled}
                className={selTherapist?.id === t.id ? 'active' : disabled ? 'pos-chip-busy' : ''}
                onClick={() => setSelTherapist(t)}
              >
                {t.name}{t.homeOutletId ? ` (${t.homeOutletId})` : ''}
                {busy && ' 🔴 Ambil Tamu'}
                {!busy && inCart && ` · ${cartCountByTherapist[t.id]} treatment di daftar`}
              </button>
            );
          })}
        </div>
      </section>

      <input
        placeholder="Nama pelanggan"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
      />

      {canAddLine && (
        <button
          style={{ background: 'var(--text)', marginBottom: 8 }}
          onClick={handleAddToCart}
        >
          + Tambah treatment lain untuk pelanggan ini
        </button>
      )}

      {grandTotal > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, padding: '10px 4px', marginBottom: 4 }}>
          <span>Total Pembayaran</span>
          <span style={{ color: 'var(--primary-dark)' }}>{rp(grandTotal)}</span>
        </div>
      )}

      <button disabled={(cart.length === 0 && !canAddLine) || saving} onClick={handleSaveAll}>
        {saving ? 'Menyimpan...' : 'Simpan & buka WhatsApp'}
      </button>
    </div>
  );
}
