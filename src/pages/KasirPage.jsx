import { useEffect, useState } from 'react';
import {
  OIL_TYPES, OIL_SIZES, TREATMENT_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
  treatmentUsesOil, oilChoicesFor,
  HAPPY_HOUR_PRICE, HAPPY_HOUR_REASON, HAPPY_HOUR_TIMEZONE,
  isHappyHourTime, isHappyHourTreatment
} from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { listenTreatments } from '../lib/treatmentService';
import { createBooking, createBookingsBatch } from '../lib/bookingService';
import { listenInventory, fetchTreatmentConsumables } from '../lib/inventoryService';
import { forecastStockAlerts, describeStockAlerts } from '../lib/stockForecast';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

/* ============================================================
   MEMORI CEPAT (localStorage per perangkat)
   Gunanya supaya kasir tidak mengetik/mengetuk hal yang sama
   berulang-ulang: treatment terakhir, minyak terakhir, terapis
   terakhir, nama pelanggan & metode pembayaran.
   ============================================================ */
const LS_OIL = 'ds_last_oil';
const LS_THERAPIST = 'ds_last_therapist';
const LS_FORM = 'ds_kasir_form';

function loadLS(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
function saveLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage penuh / ditolak — abaikan, tidak boleh menggagalkan transaksi */
  }
}

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
  const [freeOnly, setFreeOnly] = useState(true);

  // Memori cepat
  const [oilMap, setOilMap] = useState(() => loadLS(LS_OIL, {}));
  const [therapistMap, setTherapistMap] = useState(() => loadLS(LS_THERAPIST, {}));
  const savedForm = loadLS(LS_FORM, {});
  const [customerName, setCustomerName] = useState(savedForm.customerName || '');
  const [markPaidNow, setMarkPaidNow] = useState(!!savedForm.markPaidNow);
  const [paymentMethod, setPaymentMethod] = useState(savedForm.paymentMethod || '');

  const [cart, setCart] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stockItems, setStockItems] = useState([]);
  const [consumables, setConsumables] = useState({});

  // Simpan form + pilihan terakhir setiap berubah.
  useEffect(() => { saveLS(LS_FORM, { customerName, markPaidNow, paymentMethod }); },
    [customerName, markPaidNow, paymentMethod]);
  useEffect(() => { saveLS(LS_OIL, oilMap); }, [oilMap]);
  useEffect(() => { saveLS(LS_THERAPIST, therapistMap); }, [therapistMap]);

  useEffect(() => {
    if (!active) return;
    const unsub1 = listenAllTherapists(setTherapists); // semua terapis, termasuk yang sibuk (untuk ditandai)
    const unsub2 = listenTreatments(setTreatments);
    return () => { unsub1(); unsub2(); };
  }, [active]);

  // Stok barang outlet ini (untuk peringatan produk kurang) + peta produk per treatment.
  useEffect(() => {
    if (!active || !outletId) return;
    return listenInventory(outletId, setStockItems);
  }, [active, outletId]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    fetchTreatmentConsumables()
      .then((map) => { if (alive) setConsumables(map); })
      .catch(() => { if (alive) setConsumables({}); });
    return () => { alive = false; };
  }, [active]);

  const cartTherapistIds = new Set(cart.map((c) => c.therapist.id));
  const cartCountByTherapist = {};
  cart.forEach((c) => { cartCountByTherapist[c.therapist.id] = (cartCountByTherapist[c.therapist.id] || 0) + 1; });
  const filteredTherapists = therapists
    .filter((t) => t.name.toLowerCase().includes(therapistSearch.toLowerCase()))
    .filter((t) => !freeOnly || (t.status || 'free') !== 'ambil_tamu')
    .sort((a, b) => {
      const ab = (a.status || 'free') === 'ambil_tamu' ? 1 : 0;
      const bb = (b.status || 'free') === 'ambil_tamu' ? 1 : 0;
      return ab - bb || a.name.localeCompare(b.name);
    });

  const productList = treatments
    .filter((t) => category === 'Semua' || t.category === category)
    .filter((t) => t.name.toLowerCase().includes(productSearch.toLowerCase()));

  const lastOil = pendingTreatment ? oilMap[pendingTreatment.id] : null;
  const lastTherapistId = outletId ? therapistMap[outletId] : null;
  const lastTherapist = lastTherapistId
    ? therapists.find((t) => t.id === lastTherapistId && (t.status || 'free') !== 'ambil_tamu')
    : null;

  const cartTotal = cart.reduce((sum, l) => sum + discountedPrice(l), 0);

  // Peringatan (bukan penghalang) bila produk treatment akan habis.
  const stockAlerts = forecastStockAlerts(cart, consumables, stockItems);

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

  // Jam ditampilkan dalam WITA (UTC+8) = jam lokal Lombok, sama dengan zona
  // waktu Happy Hour. Sebelumnya memakai jam perangkat tanpa timeZone eksplisit
  // tapi labelnya "WIB", jadi di tablet yang zona waktunya keliru jam yang
  // tampil tidak cocok dengan jendela Happy Hour. Sekarang keduanya WITA.
  const fmtTime = (d) => new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit', minute: '2-digit', timeZone: HAPPY_HOUR_TIMEZONE
  }).format(d);

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
    if (pendingTreatment) {
      setOilMap((m) => ({ ...m, [pendingTreatment.id]: { oil, size } }));
    }
    setStep('therapist');
  }

  function handleNoOil() {
    setPendingOil(null);
    setPendingSize(null);
    setPendingNoOil(true);
    if (pendingTreatment) {
      setOilMap((m) => ({ ...m, [pendingTreatment.id]: { noOil: true } }));
    }
    setStep('therapist');
  }

  /** 1 ketuk: pakai kombinasi minyak terakhir untuk treatment ini. */
  function handleUseLastOil() {
    if (!pendingTreatment || !lastOil) return;
    if (lastOil.noOil) {
      setPendingOil(null);
      setPendingSize(null);
      setPendingNoOil(true);
    } else {
      setPendingOil(lastOil.oil);
      setPendingSize(lastOil.size);
      setPendingNoOil(false);
    }
    setStep('therapist');
  }

function addLine(t, tera, opts = {}) {
    const pakaiMinyak = usesOil(t) && !opts.noOil && !opts.noOilChosen;
    // Kelayakan Happy Hour DIBEKUK saat item masuk keranjang. Kalau dicek
    // ulang tiap render, item yang ditambahkan sebelum jam 11:00 tapi dibayar
    // setelahnya akan berubah-ubah tampilan (250.000 vs 300.000) hanya karena
    // jam berjalan, sehingga kasir bisa salah hitung kembalian.
    const happyHour = isHappyHourTime() && isHappyHourTreatment(t);
    setCart((c) => [...c, {
      therapist: tera,
      treatment: t,
      oil: pakaiMinyak ? (opts.oil || null) : null,
      size: pakaiMinyak ? (opts.size || null) : null,
      noOil: !!opts.noOilChosen,
      happyHour,
      // Selalu 0: Happy Hour sudah berupa harga flat (Rp 250.000), bukan
      // persen, dan treatment lain TIDAK dapat diskon otomatis.
      discountPct: 0,
      discountReason: happyHour ? HAPPY_HOUR_REASON : ''
    }]);
    if (outletId) setTherapistMap((m) => ({ ...m, [outletId]: tera.id }));
  }

  function handlePickTherapist(t) {
    const busy = (t.status || 'free') === 'ambil_tamu';
    // Terapis yang sibuk tidak bisa dipilih. Satu terapis boleh mengambil
    // beberapa treatment sekaligus (double treatment), baik Massage maupun bukan.
    if (busy || !pendingTreatment) return;

    addLine(pendingTreatment, t, { oil: pendingOil, size: pendingSize, noOilChosen: pendingNoOil });
    setPendingTreatment(null); setPendingOil(null); setPendingSize(null); setPendingNoOil(false);
    setStep(null);
    setError('');
  }

  function handleRemoveFromCart(index) {
    setCart((c) => c.filter((_, i) => i !== index));
  }

  // Harga efektif per item. Happy Hour memakai harga flat Rp 250.000 yang
  // sudah dibekukan saat item masuk keranjang; treatment lain memakai harga
  // daftar dikali diskon manual yang dipilih kasir.
  function discountedPrice(line) {
    const base = line.treatment.price || 0;
    if (line.happyHour) return HAPPY_HOUR_PRICE;
    const pct = line.discountPct || 0;
    return Math.round(base * (1 - pct / 100));
  }

  // Harga Happy Hour sudah flat (Rp 250.000) jadi chip persen tidak boleh
  // mengubahnya — kalau boleh, price tetap Rp 250.000 tapi discountReason masih
  // berbunyi "Happy Hour" padahal yang dipotong diskon kasir.
  function handleDiscount(index, pct) {
    setCart((c) => c.map((l, i) => {
      if (i !== index) return l;
      if (l.happyHour) return l;
      return { ...l, discountPct: pct, discountReason: pct === 0 ? '' : l.discountReason };
    }));
  }

  function handleDiscountReason(index, reason) {
    setCart((c) => c.map((l, i) => (i === index ? { ...l, discountReason: reason } : l)));
  }

  function cancelPicking() {
    setPendingTreatment(null); setPendingOil(null); setPendingSize(null);
    setStep(null);
  }

  async function handlePay() {
    if (cart.length === 0) return;
    // Validasi: semua item berdiskon wajib punya alasan
    const missingReason = cart.find((line) => line.discountPct > 0 && !(line.discountReason || '').trim());
    if (missingReason) {
      setError(`Alasan diskon wajib diisi untuk "${missingReason.treatment.name}".`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (markPaidNow && !paymentMethod) {
        setError('Pilih metode pembayaran (Cash/Cardless) terlebih dahulu.');
        setSaving(false);
        return;
      }
      const items = cart.map((line) => {
        const discounted = discountedPrice(line);
        const listPrice = line.treatment.price || 0;
        const useOil = treatmentUsesOil(line.treatment) && !line.noOil;
        // original_price hanya diisi kalau harga bayar benar-benar lebih kecil
        // dari harga daftar. Versi lama memakai `line.discountPct ?` sehingga
        // Happy Hour (yang discountPct-nya 0) terkirim null: diskonnya hilang
        // dari laporan dan komisi jadi dihitung dari Rp 250.000.
        const isDiscounted = discounted < listPrice;
        return {
          outletId,
          therapistId: line.therapist.id,
          therapistName: line.therapist.name,
          treatmentId: line.treatment.id,
          treatmentName: line.treatment.name,
          treatmentPrice: discounted,
          originalPrice: isDiscounted ? listPrice : null,
          discountReason: isDiscounted ? (line.discountReason || HAPPY_HOUR_REASON) : null,
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
      // Sukses: bersihkan keranjang saja. Nama pelanggan, metode pembayaran,
      // dan status "sudah dibayar" sengaja DIKEEP supaya transaksi berikutnya
      // tidak perlu diisi ulang.
      setCart([]);
      setPendingTreatment(null); setPendingOil(null); setPendingSize(null);
      setStep(null);
      setSaving(false);
    } catch (e) {
      console.error('handlePay error:', e, e && e.stack);
      setError((e && e.message) || String(e));
      setSaving(false);
    }
  }

  // Shortcut PC: Ctrl+Enter / Cmd+Enter = simpan pesanan.
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (cart.length > 0 && !saving) handlePay();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, saving, customerName, paymentMethod, markPaidNow]);

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
            <p className="pos-picker-title">
              {pendingTreatment.name} — pilih minyak (1 ketuk langsung jadi)
            </p>
            {lastOil && (
              <button className="pos-quick" onClick={handleUseLastOil}>
                ⚡ Pakai lagi: {lastOil.noOil ? 'Tanpa Minyak' : `${lastOil.oil} · ${lastOil.size}`}
              </button>
            )}
            <div className="pos-chip-list">
              {oilChoicesFor(pendingTreatment).flatMap((oil) =>
                OIL_SIZES.map((size) => (
                  <button key={`${oil}-${size}`} className="pos-chip" onClick={() => handlePickOil(oil, size)}>
                    {oil} · {size}
                  </button>
                ))
              )}
              <button className="pos-chip pos-chip-nooil" onClick={handleNoOil}>
                Tanpa Minyak
              </button>
            </div>
            <button className="pos-cancel" onClick={cancelPicking}>Batal</button>
          </div>
        )}

        {step === 'therapist' && (
          <div className="pos-picker-panel">
            <p className="pos-picker-title">
              {pendingTreatment.name}{pendingOil ? ` · ${pendingOil} (${pendingSize})` : (pendingNoOil ? ' · tanpa minyak' : '')}
              {' '}— pilih terapis
            </p>
            <div className="pos-quick-row">
              <input
                placeholder="Cari nama terapis..."
                value={therapistSearch}
                onChange={(e) => setTherapistSearch(e.target.value)}
                style={{ marginBottom: 0, flex: 1, minWidth: 140 }}
              />
              <button
                className={freeOnly ? 'pos-toggle on' : 'pos-toggle'}
                onClick={() => setFreeOnly(!freeOnly)}
                title="Sembunyikan terapis yang sedang ambil tamu"
              >
                {freeOnly ? '✓ Bebas saja' : 'Semua terapis'}
              </button>
            </div>
            {lastTherapist && !therapistSearch && (
              <button className="pos-quick" onClick={() => handlePickTherapist(lastTherapist)}>
                ⚡ Pakai lagi: {lastTherapist.name}
              </button>
            )}
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
                    {!busy && alreadyInCart && ` · ${cartCountByTherapist[t.id]} di keranjang`}
                  </button>
                );
              })}
              {filteredTherapists.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                  Tidak ada terapis bebas. Matikan “Bebas saja” untuk melihat semua.
                </p>
              )}
            </div>
            <button className="pos-cancel" onClick={cancelPicking}>Batal</button>
          </div>
        )}

        <input
          placeholder="Cari treatment... (Ctrl+Enter = simpan)"
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
                  {fmtTime(line.start)} – {fmtTime(line.end)} WITA ({line.treatment.durationMinutes || 0} mnt)
                </div>
                {line.happyHour ? (
                  <div style={{ fontSize: 11, color: 'var(--primary)', marginTop: 6 }}>
                    Happy Hour — harga tetap Rp250.000 (chip diskon tidak dipakai)
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
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
                    {line.discountPct > 0 && (
                      <input
                        placeholder="Alasan diskon (wajib)"
                        value={line.discountReason}
                        onChange={(e) => handleDiscountReason(i, e.target.value)}
                        style={{ marginTop: 6, fontSize: 12, padding: '6px 8px' }}
                      />
                    )}
                  </>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {(() => {
                    const list = line.treatment.price || 0;
                    const disc = discountedPrice(line);
                    // Harga dicoret hanya kalau benar-benar ada diskon. Versi
                    // lama memakai `line.discountPct ?` sehingga Happy Hour
                    // (discountPct 0) menampilkan Rp300.000 seolah-olah tidak
                    // ada diskon, padahal dibayar Rp250.000.
                    return disc < list ? (
                      <>
                        <span style={{ textDecoration: 'line-through', color: 'var(--text-secondary)', marginRight: 4 }}>{rp(list)}</span>
                        {rp(disc)}
                      </>
                    ) : rp(list);
                  })()}
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
        {markPaidNow && !paymentMethod && (
          <p style={{ fontSize: 12, color: 'var(--danger)' }}>Wajib pilih metode pembayaran di atas.</p>
        )}

        <div className="pos-cart-footer">
          {stockAlerts.length > 0 && (
            <div className="message warn" style={{ marginBottom: 8 }}>
              ⚠ Stok kurang: {describeStockAlerts(stockAlerts, stockItems)}.
              Transaksi tetap diproses, stok jadi 0 — segera isi di Inventory.
            </div>
          )}
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
