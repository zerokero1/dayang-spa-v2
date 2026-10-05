import { useEffect, useState } from 'react';
import { OUTLETS, OIL_TYPES, OIL_SIZES, TREATMENT_CATEGORIES, treatmentUsesOil, oilChoicesFor, sizesForProduct, isSingleSizeProduct, SIZE_NONE } from '../lib/constants';
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
  // Sama dengan Kasir: mode menentukan kolom mana yang dibaca, bukan ditebak
  // dari nilai. Nominal menang kalau somehow keduanya menyala.
  const discountedPrice = (line) => {
    const base = line.treatment.price || 0;
    const amount = line.discountAmount || 0;
    const pakaiNominal = line.discountMode === 'amount' || amount > 0;
    if (pakaiNominal && amount > 0) return Math.max(0, Math.round(base - amount));
    return Math.round(base * (1 - (line.discountPct || 0) / 100));
  };
  const hasDiscount = (line) => (line.discountPct || 0) > 0 || (line.discountAmount || 0) > 0;
  const pctOfAmount = (line) => {
    const base = line.treatment?.price || 0;
    if (!base) return 0;
    return Math.round((line.discountAmount / base) * 1000) / 10;
  };
  const cartTotal = cart.reduce((sum, l) => sum + discountedPrice(l), 0);
  const grandTotal = cartTotal + (canAddLine ? selTreatment.price : 0);

  function resetLineSelection() {
    setSelTreatment(null); setSelOil(null); setSelSize(null); setSelNoOil(false); setSelTherapist(null);
  }

  function handleAddToCart() {
    if (!canAddLine) return;
    const useOil = usesOil(selTreatment) && !selNoOil;
    setCart((c) => [...c, {
      therapist: selTherapist, treatment: selTreatment,
      oil: useOil ? selOil : null, size: useOil ? selSize : null, noOil: selNoOil,
      discountMode: 'pct', discountPct: 0, discountAmount: 0, discountReason: ''
    }]);
    resetLineSelection();
  }

  function handleRemoveFromCart(index) {
    setCart((c) => c.filter((_, i) => i !== index));
  }

  // Nilai di mode yang ditinggalkan dibuang, supaya tidak muncul kembali
  // setelah kasir ganti mode lalu ganti balik.
  function handleDiscountMode(index, mode) {
    setCart((c) => c.map((l, i) => {
      if (i !== index) return l;
      if (mode === l.discountMode) return l;
      const sisa = mode === 'pct' ? l.discountPct : l.discountAmount;
      return {
        ...l,
        discountMode: mode,
        discountPct: mode === 'pct' ? l.discountPct : 0,
        discountAmount: mode === 'amount' ? l.discountAmount : 0,
        discountReason: sisa > 0 ? l.discountReason : ''
      };
    }));
  }

  function handleDiscount(index, pct) {
    setCart((c) => c.map((l, i) => (
      i === index
        ? { ...l, discountMode: 'pct', discountPct: pct, discountAmount: 0, discountReason: pct === 0 ? '' : l.discountReason }
        : l
    )));
  }

  function handleDiscountAmount(index, raw) {
    const clean = String(raw).replace(/[^\d]/g, '');
    setCart((c) => c.map((l, i) => {
      if (i !== index) return l;
      const base = l.treatment.price || 0;
      const amount = clean === '' ? 0 : Math.min(Math.max(0, Number(clean)), base);
      return {
        ...l,
        discountMode: 'amount',
        discountAmount: amount,
        discountPct: 0,
        discountReason: amount === 0 ? '' : l.discountReason
      };
    }));
  }

  function handleDiscountReason(index, reason) {
    setCart((c) => c.map((l, i) => (i === index ? { ...l, discountReason: reason } : l)));
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
    // Semua item berdiskon (persen ATAU nominal) wajib punya alasan.
    const missingReason = finalCart.find((l) => hasDiscount(l) && !(l.discountReason || '').trim());
    if (missingReason) {
      setError(`Alasan diskon wajib diisi untuk "${missingReason.treatment.name}".`);
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const items = finalCart.map((line) => {
        const useOil = treatmentUsesOil(line.treatment) && !line.noOil;
        const listPrice = line.treatment.price || 0;
        const harga = discountedPrice(line);
        // original_price hanya diisi kalau harga bayar benar-benar lebih kecil
        // dari harga daftar. Versi lama memakai `line.discountPct ?` sehingga
        // diskon nominal (discountPct 0) terkirim null: diskonnya hilang dari
        // laporan dan komisi dihitung dari harga daftar.
        const isDiscounted = harga < listPrice;
        return {
          outletId,
          therapistId: line.therapist.id,
          therapistName: line.therapist.name,
          treatmentId: line.treatment.id,
          treatmentName: line.treatment.name,
          treatmentPrice: harga,
          originalPrice: isDiscounted ? listPrice : null,
          discountReason: isDiscounted ? (line.discountReason || null) : null,
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
          {cart.map((line, i) => {
            const modePct = line.discountMode !== 'amount';
            const modeAmount = line.discountMode === 'amount';
            return (
            <div key={i} className="oil-card" style={{ marginBottom: 6, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13 }}>
                  <strong>{line.therapist.name}</strong> — {line.treatment.name}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                    {line.oil ? `Minyak ${line.oil} (${line.size}) · ` : (line.noOil ? 'Tanpa minyak · ' : '')}
                    <strong>{rp(discountedPrice(line))}</strong>
                    {hasDiscount(line) && (
                      <span style={{ color: 'var(--danger)' }}>
                        {' '}(potong {modeAmount
                          ? rp(line.discountAmount)
                          : `${line.discountPct}%`}
                        {modeAmount ? ` = ${pctOfAmount(line)}%` : ''})
                      </span>
                    )}
                  </div>
                </div>
                <button
                  style={{ width: 'auto', padding: '6px 10px', fontSize: 12, boxShadow: 'none', background: 'var(--danger)', color: '#fff' }}
                  onClick={() => handleRemoveFromCart(i)}
                >
                  Hapus
                </button>
              </div>

              <div style={{ display: 'flex', gap: 4, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Diskon:</span>
                <button
                  className={modePct ? 'pos-chip active' : 'pos-chip'}
                  onClick={() => handleDiscountMode(i, 'pct')}
                  style={{ fontSize: 11, padding: '2px 8px' }}
                >
                  Persen %
                </button>
                <button
                  className={modeAmount ? 'pos-chip active' : 'pos-chip'}
                  onClick={() => handleDiscountMode(i, 'amount')}
                  style={{ fontSize: 11, padding: '2px 8px' }}
                >
                  Potong Rp
                </button>
              </div>

              {modePct ? (
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                  {[5, 10, 15, 20, 25].map((p) => (
                    <button
                      key={p}
                      className={line.discountPct === p ? 'pos-chip active' : 'pos-chip'}
                      onClick={() => handleDiscount(i, p)}
                      style={{ fontSize: 11, padding: '2px 8px' }}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={line.discountAmount > 0 ? String(line.discountAmount) : ''}
                    onChange={(e) => handleDiscountAmount(i, e.target.value)}
                    style={{ fontSize: 12, padding: '4px 8px', width: 120 }}
                  />
                  {line.discountAmount > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>({pctOfAmount(line)}%)</span>
                  )}
                </div>
              )}

              {hasDiscount(line) && (
                <input
                  type="text"
                  placeholder="Alasan diskon (wajib)"
                  value={line.discountReason || ''}
                  onChange={(e) => handleDiscountReason(i, e.target.value)}
                  style={{ marginTop: 6, fontSize: 12, padding: '6px 8px' }}
                />
              )}
            </div>
            );
          })}
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
          {oilChoicesFor(selTreatment).map((oil) => (
            <div key={oil} className="oil-card">
              <div>{oil}</div>
              {isSingleSizeProduct(oil) ? (
                <button
                  className={selOil === oil ? 'active' : ''}
                  onClick={() => { setSelOil(oil); setSelSize(SIZE_NONE); setSelNoOil(false); }}
                  style={{ width: '100%' }}
                >
                  Pakai
                </button>
              ) : (
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
              )}
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
