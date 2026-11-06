import { useEffect, useMemo, useState } from 'react';
import { listenOilInventory, setOilStock, adjustOilStock, getOilConsumptionByDate } from '../lib/oilInventoryService';
import { listenInventory, addInventoryItem, stockIn, stockOut, setLaundryClosingStock, deleteInventoryItem } from '../lib/inventoryService';
import { INVENTORY_CATEGORIES, DEFAULT_INVENTORY_CATEGORY, isSingleSizeProduct } from '../lib/constants';
import { LOW_OIL, LOW_ITEM, namaMinyak, kelompokkanMinyak, hitungPerluAttention, totalStok } from '../lib/stokRingkas';
import { businessDate } from '../lib/businessDate';

/**
 * Halaman Stok - satu tempat untuk minyak DAN produk treatment.
 *
 * Sebelumnya ada dua halaman terpisah (Stok Minyak dan Inventory). Cara
 * mengisinya mirip tapi tidak sama: minyak memakai tombol -1/+1 atau set
 * langsung, produk memakai barang masuk/keluar secatatan. Kasir sering salah
 * buka halaman lalu mengira datanya tidak sinkron, jadi keduanya disatukan di
 * sini dengan tab, lalu ditambah ringkasan "perlu diisi" yang menggabungkan
 * keduanya supaya tidak perlu pindah tab untuk tahu apa yang akan habis.
 *
 * Data di database tetap dua tabel terpisah (oil_inventory dan inventory).
 * Halaman ini hanya menyatukan antarmukanya; tidak ada RPC yang berubah.
 */

// Batas stok menipis, pengelompokan minyak, dan daftar "perlu diisi" semuanya
// hidup di lib/stokRingkas.js supaya bisa diuji tanpa browser.

// Berapa item "perlu diisi" yang ditampilkan sebelum harus ditekan "Lihat semua".
const PERLU_AWAL = 6;

export default function StokPage({ outletId, active, initialTab = 'minyak' }) {
  const [tab, setTab] = useState(initialTab === 'item' ? 'item' : 'minyak');
  // Daftar "perlu diisi" bisa panjang (>20 item di outlet yang/laundry-nya
  // banyak), jadi default-nya diringkas. Kasir bisa membuka semuanya bila perlu.
  const [lihatSemua, setLihatSemua] = useState(false);

  // oil_inventory
  const [oils, setOils] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [oilCountDrafts, setOilCountDrafts] = useState({});
  const [oilInQty, setOilInQty] = useState({});
  const [oilOutQty, setOilOutQty] = useState({});
  const [oilOutReason, setOilOutReason] = useState({});
  const [oilUsageDate, setOilUsageDate] = useState(() => businessDate());
  const [oilUsage, setOilUsage] = useState([]);
  const [oilUsageBusy, setOilUsageBusy] = useState(false);
  const [oilUsageError, setOilUsageError] = useState('');

  // inventory (produk dan laundry)
  const [items, setItems] = useState([]);
  const [selItem, setSelItem] = useState(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newCategory, setNewCategory] = useState(DEFAULT_INVENTORY_CATEGORY);
  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!active) return;
    return listenOilInventory(outletId, setOils);
  }, [active, outletId]);

  useEffect(() => {
    if (!active) return;
    return listenInventory(outletId, setItems);
  }, [active, outletId]);

  useEffect(() => {
    if (!active || !outletId || !oilUsageDate) return;
    let alive = true;
    setOilUsageBusy(true);
    setOilUsageError('');
    getOilConsumptionByDate(outletId, oilUsageDate)
      .then((rows) => { if (alive) setOilUsage(rows); })
      .catch((e) => {
        if (alive) {
          setOilUsage([]);
          setOilUsageError('Gagal memuat pemakaian minyak: ' + e.message);
        }
      })
      .finally(() => { if (alive) setOilUsageBusy(false); });
    return () => { alive = false; };
  }, [active, outletId, oilUsageDate]);

  // Halaman bisa dibuka lewat tautan lama (menu Stok Minyak / Inventory),
  // jadi tab harus ikut menyesuaikan kalau prop-nya berubah.
  useEffect(() => {
    setTab(initialTab === 'item' ? 'item' : 'minyak');
  }, [initialTab]);

  /* ---------------- minyak ---------------- */

  function getOilMovementError(e) {
    const needsMigration = e?.code === 'PGRST202'
      || /could not find the function.*adjust_oil_stock/i.test(e?.message || '');
    return needsMigration
      ? 'Fitur ini perlu pembaruan database. Jalankan supabase/input_keluar_minyak_dengan_alasan.sql terlebih dahulu.'
      : e.message;
  }

  async function handleOilStockIn(oil) {
    const amount = Number(oilInQty[oil.id] || '');
    if (!Number.isInteger(amount) || amount <= 0) {
      setMessage('Masukkan jumlah minyak masuk berupa bilangan bulat lebih dari 0.');
      return;
    }

    setBusyId(oil.id);
    setMessage('');
    try {
      await adjustOilStock(outletId, oil.oilType, oil.size, amount, 'Penerimaan stok minyak manual');
      setMessage(`${namaMinyak(oil)}: barang masuk ${amount} ${oil.unit || 'botol'} berhasil dicatat.`);
      setOilCountDrafts((drafts) => ({
        ...drafts, [oil.id]: String((Number(oil.stock) || 0) + amount)
      }));
      setOilInQty((current) => ({ ...current, [oil.id]: '' }));
    } catch (e) {
      setMessage('Gagal mencatat minyak masuk: ' + getOilMovementError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleOilStockOut(oil) {
    const amount = Number(oilOutQty[oil.id] || '');
    const reason = (oilOutReason[oil.id] || '').trim();
    if (!Number.isInteger(amount) || amount <= 0) {
      setMessage('Masukkan jumlah minyak keluar berupa bilangan bulat lebih dari 0.');
      return;
    }
    if (!reason) {
      setMessage('Alasan minyak keluar wajib diisi.');
      return;
    }
    if (amount > (Number(oil.stock) || 0)) {
      setMessage(`Stok ${namaMinyak(oil)} tidak cukup. Stok tersedia ${oil.stock || 0} ${oil.unit || 'botol'}.`);
      return;
    }

    setBusyId(oil.id);
    setMessage('');
    try {
      await adjustOilStock(outletId, oil.oilType, oil.size, -amount, reason);
      setMessage(`${namaMinyak(oil)}: barang keluar ${amount} ${oil.unit || 'botol'} berhasil dicatat.`);
      setOilCountDrafts((drafts) => ({
        ...drafts, [oil.id]: String(Math.max((Number(oil.stock) || 0) - amount, 0))
      }));
      setOilOutQty((current) => ({ ...current, [oil.id]: '' }));
      setOilOutReason((current) => ({ ...current, [oil.id]: '' }));
    } catch (e) {
      setMessage('Gagal mencatat minyak keluar: ' + getOilMovementError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetOil(oil, value) {
    if (value === '' || value === null || value === undefined) return;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return;
    // Pecahan tidak masuk akal untuk stok botol / tube.
    if (!Number.isInteger(num)) return;
    setBusyId(oil.id);
    setMessage('');
    try {
      await setOilStock(outletId, oil.oilType, oil.size, num);
      setMessage(`${namaMinyak(oil)} diset ke ${num}`);
      setOilCountDrafts((drafts) => ({ ...drafts, [oil.id]: String(num) }));
    } catch (e) {
      setMessage('Gagal: ' + e.message);
    } finally {
      setBusyId(null);
    }
  }

  /* ---------------- produk dan laundry ---------------- */

  function pickItem(it) {
    setSelItem(it);
    setQty('');
    setNote('');
    setMessage('');
  }

  async function handleAddItem() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await addInventoryItem(outletId, {
        name: newName.trim(),
        unit: newUnit || 'pcs',
        initialStock: 0,
        category: newCategory || DEFAULT_INVENTORY_CATEGORY
      });
      setMessage(`Item "${newName.trim()}" ditambahkan (${newCategory})`);
      setNewName(''); setNewUnit('');
    } catch (e) {
      setMessage('Gagal: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleIn() {
    if (!selItem || !qty) return;
    setBusy(true);
    setMessage('');
    try {
      await stockIn(outletId, selItem.id, Number(qty), note);
      setMessage(`${selItem.name}: barang masuk ${qty}`);
      setQty(''); setNote('');
    } catch (e) {
      setMessage('Gagal: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleOut() {
    if (!selItem || !qty) return;
    setBusy(true);
    setMessage('');
    try {
      await stockOut(outletId, selItem.id, Number(qty), note);
      setMessage(`${selItem.name}: barang keluar ${qty}`);
      setQty(''); setNote('');
    } catch (e) {
      setMessage('Gagal: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClosingCount() {
    if (!selItem || qty === '') return;
    const stock = Number(qty);
    if (!Number.isInteger(stock) || stock < 0) {
      setMessage('Jumlah stok closing harus berupa bilangan bulat minimal 0');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await setLaundryClosingStock(outletId, selItem.id, stock, note);
      setMessage(`${selItem.name}: stok closing ${stock} ${selItem.unit} dicatat`);
      setQty('');
      setNote('');
    } catch (e) {
      setMessage('Gagal: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selItem) return;
    if (!window.confirm(`Hapus item "${selItem.name}" (${selItem.stock} ${selItem.unit}) beserta riwayatnya?`)) return;
    setBusy(true);
    setMessage('');
    try {
      await deleteInventoryItem(outletId, selItem.id);
      setMessage(`Item "${selItem.name}" dihapus`);
      setSelItem(null); setQty(''); setNote('');
    } catch (e) {
      setMessage('Gagal: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- rekap ---------------- */

  // Hitungan rinci ada di lib/stokRingkas.js supaya bisa diuji tanpa browser.
  const minyakPerJenis = useMemo(() => kelompokkanMinyak(oils), [oils]);
  const perluAttention = useMemo(
    () => hitungPerluAttention(oils, items, { kategoriDefault: DEFAULT_INVENTORY_CATEGORY }),
    [oils, items]
  );
  const totalMinyak = totalStok(oils);
  const totalProduk = totalStok(items);

  function tindakLanjutPerluIsi(p) {
    if (p.dariMinyak) {
      setTab('minyak');
      return;
    }
    const it = items.find((x) => x.id === p.key);
    if (it) pickItem(it);
    setTab('item');
  }

  return (
    <div className="kasir-page">
      <h2>Stok - {outletId}</h2>

      {/* ---------- Ringkasan ---------- */}
      <div className="stok-ringkas">
        <div className="stok-ringkas-kartu">
          <span className="stok-ringkas-angka">{oils.length}</span>
          <span className="stok-ringkas-label">jenis minyak</span>
          <span className="stok-ringkas-ket">{totalMinyak} botol</span>
        </div>
        <div className="stok-ringkas-kartu">
          <span className="stok-ringkas-angka">{items.length}</span>
          <span className="stok-ringkas-label">jenis produk</span>
          <span className="stok-ringkas-ket">{totalProduk} total</span>
        </div>
        <div className={perluAttention.length ? 'stok-ringkas-kartu bahaya' : 'stok-ringkas-kartu'}>
          <span className="stok-ringkas-angka">{perluAttention.length}</span>
          <span className="stok-ringkas-label">perlu diisi</span>
          <span className="stok-ringkas-ket">{perluAttention.length ? 'lihat di bawah' : 'semua aman'}</span>
        </div>
      </div>

      {/* ---------- Perlu diisi, digabung dari dua sumber ---------- */}
      {perluAttention.length > 0 && (
<section>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                <p className="muted" style={{ margin: 0 }}>
                  Perlu diisi — minyak ≤ {LOW_OIL} botol, produk ≤ {LOW_ITEM}
                </p>
                {perluAttention.length > PERLU_AWAL && (
                  <button
                    className="stok-lihat-lebih"
                    onClick={() => setLihatSemua((v) => !v)}
                  >
                    {lihatSemua ? 'Tampilkan ringkas' : `Lihat semua (${perluAttention.length})`}
                  </button>
                )}
              </div>
              <div className="stok-kartu-grid">
                {perluAttention.slice(0, lihatSemua ? Infinity : PERLU_AWAL).map((p) => (
                  <div key={p.key} className="stok-kartu menipis">
                    <div className="stok-kartu-kepala">
                      <span className="stok-kartu-nama">{p.nama}</span>
                      <span className="stok-badge">{p.stok <= 0 ? 'habis' : 'menipis'}</span>
                    </div>
                    <div className="stok-kartu-sisa">
                      sisa <strong>{p.stok}</strong> {p.satuan}
                      <span className="stok-kartu-jenis">{p.jenis}</span>
                    </div>
                    <div className="stok-kartu-tombol">
                      <button
                        className="stok-tombol tambah"
                        disabled={busy || busyId === p.key}
                        onClick={() => tindakLanjutPerluIsi(p)}
                      >
                        <span className="stok-tombol-ikon">+</span>
                        <span className="stok-tombol-teks">
                          {p.dariMinyak ? 'Buka minyak' : 'Isi barang'}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {!lihatSemua && perluAttention.length > PERLU_AWAL && (
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Menampilkan {PERLU_AWAL} yang paling kosong dari {perluAttention.length} item.
                </p>
              )}
            </section>
          )}

      {/* ---------- Tab ---------- */}
      <div className="stok-tab">
        <button className={tab === 'minyak' ? 'active' : ''} onClick={() => setTab('minyak')}>
          Minyak ({oils.length})
        </button>
        <button className={tab === 'item' ? 'active' : ''} onClick={() => setTab('item')}>
          Produk &amp; Laundry ({items.length})
        </button>
      </div>

      {message && <p className="message">{message}</p>}

      {/* ---------- Isi tab minyak ---------- */}
      {tab === 'minyak' && (
        <section>
          {minyakPerJenis.length === 0 && (
            <p className="muted">Belum ada data minyak untuk outlet ini.</p>
          )}
          {minyakPerJenis.map((g) => (
            <div key={g.jenis} className="stok-grup">
              <p className="stok-grup-judul">
                {g.jenis}
                <span className="stok-grup-ket">
                  {isSingleSizeProduct(g.jenis) ? `1 ukuran · ${g.list[0].unit}` : `${g.list.length} ukuran`}
                </span>
              </p>
              <div className="stok-kartu-grid">
                {g.list.map((oil) => {
                  const menipis = (oil.stock || 0) <= LOW_OIL;
                  const namaLengkap = namaMinyak(oil);
                  return (
                    <div key={oil.id} className={menipis ? 'stok-kartu menipis' : 'stok-kartu'}>
                      <div className="stok-kartu-kepala">
                        <span className="stok-kartu-nama">{namaLengkap}</span>
                        {menipis && (
                          <span className="stok-badge">{oil.stock <= 0 ? 'habis' : 'menipis'}</span>
                        )}
                      </div>

                      <div className="stok-kartu-isian">
                        <label className="stok-jumlah">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={oilCountDrafts[oil.id] ?? (oil.stock == null ? 0 : oil.stock)}
                            onChange={(e) => setOilCountDrafts((drafts) => ({ ...drafts, [oil.id]: e.target.value }))}
                            aria-label={`Hitungan stok closing ${namaLengkap}`}
                          />
                          <span className="stok-jumlah-satuan">closing</span>
                        </label>
                        <button
                          className="stok-cepat-tombol"
                          disabled={busyId === oil.id}
                          onClick={() => handleSetOil(oil, oilCountDrafts[oil.id] ?? String(oil.stock || 0))}
                        >
                          Simpan closing
                        </button>
                        <label className="stok-jumlah">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            value={oilInQty[oil.id] || ''}
                            onChange={(e) => setOilInQty((current) => ({ ...current, [oil.id]: e.target.value }))}
                            aria-label={`Jumlah ${namaLengkap} yang masuk`}
                            placeholder="0"
                          />
                          <span className="stok-jumlah-satuan">masuk</span>
                        </label>
                        <button
                          className="stok-tombol tambah"
                          disabled={busyId === oil.id || !oilInQty[oil.id]}
                          onClick={() => handleOilStockIn(oil)}
                          title={`Catat jumlah ${namaLengkap} yang diterima`}
                        >
                          <span className="stok-tombol-ikon">+</span>
                          <span className="stok-tombol-teks">Barang masuk</span>
                        </button>
                        <label className="stok-jumlah">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max={oil.stock}
                            step="1"
                            value={oilOutQty[oil.id] || ''}
                            onChange={(e) => setOilOutQty((current) => ({ ...current, [oil.id]: e.target.value }))}
                            aria-label={`Jumlah ${namaLengkap} yang keluar`}
                            placeholder="0"
                          />
                          <span className="stok-jumlah-satuan">keluar</span>
                        </label>
                        <button
                          className="stok-tombol kurangi"
                          disabled={busyId === oil.id || !oilOutQty[oil.id] || !(oilOutReason[oil.id] || '').trim()}
                          onClick={() => handleOilStockOut(oil)}
                          title={`Catat jumlah ${namaLengkap} yang keluar beserta alasannya`}
                        >
                          <span className="stok-tombol-ikon">−</span>
                          <span className="stok-tombol-teks">Barang keluar</span>
                        </button>
                        <label className="stok-alasan-keluar">
                          <span>Alasan keluar (wajib)</span>
                          <input
                            type="text"
                            maxLength={240}
                            value={oilOutReason[oil.id] || ''}
                            onChange={(e) => setOilOutReason((current) => ({ ...current, [oil.id]: e.target.value }))}
                            aria-label={`Alasan ${namaLengkap} keluar`}
                            placeholder="Contoh: botol pecah / dipakai di luar transaksi"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>
            Saldo stok minyak diisi manual berdasarkan hitungan fisik saat closing.
            Gunakan input barang masuk/keluar untuk penyesuaian manual; pemakaian dari
            booking ditampilkan terpisah di bawah.
          </p>
          <section>
            <h3>Pemakaian minyak dari transaksi</h3>
            <label>
              Tanggal
              <input
                type="date"
                value={oilUsageDate}
                onChange={(e) => setOilUsageDate(e.target.value)}
              />
            </label>
            <p className="muted" style={{ fontSize: 12 }}>
              Ringkasan booking yang memakai minyak. Transaksi tidak mengubah saldo; tampilan ini hanya membaca data dan tidak menambah pergerakan stok.
            </p>
            {oilUsageBusy ? (
              <p className="muted">Memuat pemakaian...</p>
            ) : oilUsageError ? (
              <p className="message">{oilUsageError}</p>
            ) : oilUsage.length === 0 ? (
              <p className="muted">Tidak ada transaksi memakai minyak pada tanggal ini.</p>
            ) : (
              <div className="grid-2">
                {oilUsage.map((row) => (
                  <div key={`${row.oilType}|${row.size}`}>
                    {row.oilType} ({row.size}): <strong>{row.qty} botol</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      )}

      {/* ---------- Isi tab produk dan laundry ---------- */}
      {tab === 'item' && (
        <>
          <section>
            <p>Daftar barang</p>
            {INVENTORY_CATEGORIES.map((cat) => {
              const rows = items.filter((it) => (it.category || DEFAULT_INVENTORY_CATEGORY) === cat);
              if (rows.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <p className="muted" style={{ marginBottom: 6 }}>{cat} ({rows.length})</p>
                  <div className="grid-2">
                    {rows.map((it) => (
                      <button
                        key={it.id}
                        className={selItem?.id === it.id ? 'active' : ''}
                        onClick={() => pickItem(it)}
                      >
                        {it.name} ({it.stock} {it.unit}){(it.stock || 0) <= LOW_ITEM ? ' ⚠' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {items.length === 0 && (
              <p className="muted">Belum ada barang tercatat.</p>
            )}
          </section>

          {selItem && (
            <section className="stok-aksi">
              <p>
                {(selItem.category || DEFAULT_INVENTORY_CATEGORY) === 'Laundry'
                  ? `Hitungan fisik saat closing untuk ${selItem.name}`
                  : `Jumlah untuk ${selItem.name}`}
              </p>
              <input
                type="number"
                min="0"
                step="1"
                placeholder={(selItem.category || DEFAULT_INVENTORY_CATEGORY) === 'Laundry' ? 'Jumlah hasil hitung fisik' : 'Jumlah'}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <input placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
              {(selItem.category || DEFAULT_INVENTORY_CATEGORY) === 'Laundry' ? (
                <>
                  <p className="muted">Masukkan jumlah laundry yang benar-benar dihitung saat tutup shift. Stok akan disesuaikan dan selisihnya dicatat.</p>
                  <button className="btn btn-primary" onClick={handleClosingCount} disabled={busy || qty === ''}>
                    Simpan stok closing
                  </button>
                </>
              ) : (
                <div className="stok-aksi-grup">
                  <button className="btn btn-primary" onClick={handleIn} disabled={busy || !qty}>
                    Barang masuk
                  </button>
                  <button className="btn btn-outline" onClick={handleOut} disabled={busy || !qty}>
                    Barang keluar
                  </button>
                </div>
              )}
              <button className="btn btn-danger-outline btn-sm stok-hapus" onClick={handleDelete} disabled={busy}>
                Hapus item ini
              </button>
            </section>
          )}

          <section className="stok-tambah">
            <p>Tambah item baru</p>
            <input placeholder="Nama barang" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input placeholder="Satuan (pcs/botol/lusin)" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
            <select
              className="stok-pilih-kategori"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={handleAddItem} disabled={busy || !newName.trim()}>Tambah item</button>
          </section>
        </>
      )}
    </div>
  );
}