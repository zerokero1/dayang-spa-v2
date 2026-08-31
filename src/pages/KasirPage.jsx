import { useEffect, useState } from 'react';
import { OIL_TYPES, OIL_SIZES, TREATMENT_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, treatmentUsesOil } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { listenTreatments } from '../lib/treatmentService';
import { createBooking, createBookingsBatch } from '../lib/bookingService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

export default function KasirPage({ outletId, active }) {
  const [therapists, setTherapists] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [category, setCategory] = useState('Semua');
  const [productSearch, setProductSearch] = useState('');

  // Alur: pilih treatment -> pilih minyak -> pilih terapis (yang free)
  const [pendingTreatment, setPendingTreatment] = useState(null);
  const [pendingOil, setPendingOil] = useState(null);
  const [pendingSize, setPendingSize] = useState(null);
  const [pendingNoOil, setPendingNoOil] = useState(false);
  const [step, setStep] = useState(null); // null | 'oil' | 'therapist'
  const [therapistSearch, setTherapistSearch] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [cart, setCart] = useState([]);
  const [markPaidNow, setMarkPaidNow] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS.CASH);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    const unsub1 = listenAllTherapists(setTherapists); // semua terapis, termasuk yang sibuk (untuk ditandai)
    const unsub2 = listenTreatments(setTreatments);
    return () => { unsub1(); unsub2(); };
  }, [active]);

  const cartTherapistIds = new Set(cart.map((c) => c.therapist.id));
  const cartCountByTherapist = {};
  cart.forEach((c) => { cartCountByTherapist[c.therapist.id] = (cartCountByTherapist[c.therapist.id] || 0) + 1; });
  const filteredTherapists = therapists
    .filter((t) => t.name.toLowerCase().includes(therapistSearch.toLowerCase()));

  const productList = treatments
    .filter((t) => category === 'Semua' || t.category === category)
    .filter((t) => t.name.toLowerCase().includes(productSearch.toLowerCase()));

  const cartTotal = cart.reduce((sum, l) => sum + discountedPrice(l), 0);

  // Perkiraan jam mulai & selesai tiap item berdasarkan banyaknya therapist
  // dan akumulasi durasi treatment berurutan per therapist.
  const now = new Date();
  const therapistDurationAcc = {};
  const cartWithTimes = cart.map((line) => {
    const dur = Math.max(line.treatment.durationMinutes || 0, 0);
    const startMin = Math.floor(now.getTime() / 60000) + (therapistDurationAcc[line.therapist.id] || 0);
    therapistDurationAcc[line.therapist.id] = (therapistDurationAcc[line.therapist.id] || 0) + dur;
    const start = new Date(startMin * 60000);
    const end = new Date((startMin + dur) * 60000);
    return { ...line, start, end };
  });

  const fmtTime = (d) => d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  function usesOil(treatment) {
    return treatmentUsesOil(treatment);
  }

  function handlePickTreatment(treatment) {
    setPendingTreatment(treatment);
    setPendingOil(null);
    setPendingSize(null);
    setPendingNoOil(false);
    setStep(usesOil(treatment) ? 'oil' : 'therapist');
  }

  function handlePickOil(oil, size) {
    setPendingOil(oil);
    setPendingSize(size);
    setPendingNoOil(false);
    setStep('therapist');
  }

  function handleNoOil() {
    setPendingOil(null);
    setPendingSize(null);
    setPendingNoOil(true);
    setStep('therapist');
  }

  function handlePickTherapist(t) {
    const busy = (t.status || 'free') === 'ambil_tamu';
    // Terapis yang sibuk tidak bisa dipilih. Satu terapis boleh mengambil
    // beberapa treatment sekaligus (double treatment), baik Massage maupun bukan.
    if (busy) return;

    setCart((c) => [...c, { therapist: t, treatment: pendingTreatment, oil: (usesOil(pendingTreatment) && !pendingNoOil) ? pendingOil : null, size: (usesOil(pendingTreatment) && !pendingNoOil) ? pendingSize : null, noOil: pendingNoOil, discountPct: 0 }]);
    setPendingTreatment(null); setPendingOil(null); setPendingSize(null); setPendingNoOil(false);
    setStep(null);
    setError('');
  }

  function handleRemoveFromCart(index) {
    setCart((c) => c.filter((_, i) => i !== index));
  }

  // Harga efektif per item setelah diskon (kelipatan 5/10/15/20%).
  function discountedPrice(line) {
    const base = line.treatment.price || 0;
    const pct = line.discountPct || 0;
    return Math.round(base * (1 - pct / 100));
  }

  function handleDiscount(index, pct) {
    setCart((c) => c.map((l, i) => (i === index ? { ...l, discountPct: pct } : l)));
  }

  function cancelPicking() {
    setPendingTreatment(null); setPendingOil(null); setPendingSize(null);
    setStep(null);
  }

  async function handlePay() {
    if (cart.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const items = cart.map((line) => {
        const discounted = discountedPrice(line);
        const useOil = treatmentUsesOil(line.treatment) && !line.noOil;
        return {
          outletId,
          therapistId: line.therapist.id,
          therapistName: line.therapist.name,
          treatmentId: line.treatment.id,
          treatmentName: line.treatment.name,
          treatmentPrice: discounted,
          originalPrice: line.discountPct ? (line.treatment.price || 0) : null,
          commissionPercent: line.treatment.commissionPercent,
          durationMinutes: line.treatment.durationMinutes,
          usesOil: useOil,
          oilType: useOil ? line.oil : null,
          oilSize: useOil ? line.size : null,
          customerName,
          paid: markPaidNow,
          paymentMethod
        };
      });
      if (items.length === 1) {
        await createBooking(items[0]);
      } else {
        await createBookingsBatch(items);
      }
      // Sukses: bersihkan form & aktifkan ulang tombol (aplikasi tetap
      // terbuka di tab ini; WhatsApp sudah terbuka di tab terpisah).
      setCart([]);
      setCustomerName('');
      setPendingTreatment(null); setPendingOil(null); setPendingSize(null);
      setStep(null);
      setSaving(false);
    } catch (e) {
      console.error('handlePay error:', e, e && e.stack);
      setError((e && e.message) || String(e));
      setSaving(false);
    }
  }

  return (
    <div className="pos-layout">
      {/* Kolom kiri: kategori */}
      <div className="pos-sidebar">
        <button className={category === 'Semua' ? 'active' : ''} onClick={() => setCategory('Semua')}>
          Semua Kategori
        </button>
        {TREATMENT_CATEGORIES.map((c) => (
          <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      {/* Kolom tengah: daftar produk (langkah 1), lalu panel minyak/terapis muncul di atas saat diperlukan */}
      <div className="pos-main">
        {step === 'oil' && (
          <div className="pos-picker-panel">
            <p style={{ fontSize: 13, fontWeight: 600, marginTop: 0 }}>
              {pendingTreatment.name} — pilih minyak & ukuran
            </p>
            {OIL_TYPES.map((oil) => (
              <div key={oil} style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{oil}</span>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {OIL_SIZES.map((size) => (
                    <button key={size} className="pos-chip" onClick={() => handlePickOil(oil, size)}>
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--busy)', color: '#fff', marginTop: 8, fontWeight: 600 }} onClick={handleNoOil}>
              Tanpa Minyak
            </button>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)', color: '#fff', marginTop: 6 }} onClick={cancelPicking}>
              Batal
            </button>
          </div>
        )}

        {step === 'therapist' && (
          <div className="pos-picker-panel">
            <p style={{ fontSize: 13, fontWeight: 600, marginTop: 0 }}>
              {pendingTreatment.name}{pendingOil ? ` · ${pendingOil} (${pendingSize})` : ''} — pilih terapis
            </p>
            <input
              placeholder="Cari nama terapis..."
              value={therapistSearch}
              onChange={(e) => setTherapistSearch(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div className="pos-chip-list">
              {filteredTherapists.map((t) => {
                const busy = (t.status || 'free') === 'ambil_tamu';
                const alreadyInCart = cartTherapistIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    className={busy ? 'pos-chip pos-chip-busy' : 'pos-chip'}
                    disabled={busy}
                    onClick={() => handlePickTherapist(t)}
                  >
                    {t.name}{t.homeOutletId ? ` (${t.homeOutletId})` : ''}
                    {busy && ' 🔴 Ambil Tamu'}
                    {!busy && alreadyInCart && ` · ${cartCountByTherapist[t.id]} treatment di keranjang`}
                  </button>
                );
              })}
            </div>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)', color: '#fff', marginTop: 8 }} onClick={cancelPicking}>
              Batal
            </button>
          </div>
        )}

        <input
          placeholder="Cari treatment..."
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          style={{ marginBottom: 10 }}
        />

        <div className="pos-product-table">
          <div className="pos-product-header">
            <span>Treatment</span>
            <span>Durasi</span>
            <span>Harga</span>
          </div>
          <div className="pos-product-list">
            {productList.map((t) => (
              <div key={t.id} className="pos-product-row" onClick={() => handlePickTreatment(t)}>
                <span>{t.name}</span>
                <span className="pos-product-muted">{t.durationMinutes ? `${t.durationMinutes} mnt` : '-'}</span>
                <span className="pos-product-price">{rp(t.price)}</span>
              </div>
            ))}
            {productList.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 12 }}>Tidak ada treatment.</p>
            )}
          </div>
        </div>
      </div>

      {/* Kolom kanan: keranjang & bayar */}
      <div className="pos-cart">
        <p className="pos-cart-title">Pesanan</p>
        <input
          placeholder="Nama pelanggan (opsional)"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />

        <div className="pos-cart-list">
          {cart.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 24 }}>
              Klik treatment di tengah untuk mulai
            </p>
          )}
          {cartWithTimes.map((line, i) => (
            <div key={i} className="pos-cart-item">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{line.treatment.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {line.therapist.name}{line.oil ? ` · ${line.oil} (${line.size})` : (line.noOil ? ' · tanpa minyak' : '')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--primary)', marginTop: 2 }}>
                  {fmtTime(line.start)} – {fmtTime(line.end)} WIB ({line.treatment.durationMinutes || 0} mnt)
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                  {[0, 5, 10, 15, 20].map((p) => (
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {line.discountPct ? (
                    <>
                      <span style={{ textDecoration: 'line-through', color: 'var(--text-secondary)', marginRight: 4 }}>{rp(line.treatment.price)}</span>
                      {rp(discountedPrice(line))}
                    </>
                  ) : rp(line.treatment.price)}
                </span>
                <button
                  style={{ width: 'auto', padding: '4px 8px', fontSize: 11, boxShadow: 'none', background: 'var(--danger)', color: '#fff' }}
                  onClick={() => handleRemoveFromCart(i)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([val, label]) => (
            <button
              key={val}
              className={paymentMethod === val ? 'pos-chip active' : 'pos-chip'}
              onClick={() => setPaymentMethod(val)}
            >
              {label}
            </button>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
          <input
            type="checkbox"
            checked={markPaidNow}
            onChange={(e) => setMarkPaidNow(e.target.checked)}
            style={{ width: 'auto', margin: 0 }}
          />
          Sudah dibayar sekarang
        </label>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: -4, marginBottom: 8 }}>
          Kalau belum dicentang, bisa ditandai lunas nanti (sebelum/sesudah treatment) di tab Status Terapis.
        </p>

        <div className="pos-cart-footer">
          <div className="pos-cart-total">
            <span>Total</span>
            <strong>{rp(cartTotal)}</strong>
          </div>
          <button disabled={cart.length === 0 || saving} onClick={handlePay}>
            {saving ? 'Menyimpan...' : 'Simpan & buka WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  );
}
