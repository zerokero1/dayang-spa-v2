import { useEffect, useMemo, useState } from 'react';
import { listenOilInventory, setOilStock, adjustOilStock } from '../lib/oilInventoryService';
import { listenInventory, addInventoryItem, stockIn, stockOut, deleteInventoryItem } from '../lib/inventoryService';
import { INVENTORY_CATEGORIES, DEFAULT_INVENTORY_CATEGORY, isSingleSizeProduct } from '../lib/constants';
import { LOW_OIL, LOW_ITEM, namaMinyak, kelompokkanMinyak, hitungPerluAttention, totalStok } from '../lib/stokRingkas';

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

  // Halaman bisa dibuka lewat tautan lama (menu Stok Minyak / Inventory),
  // jadi tab harus ikut menyesuaikan kalau prop-nya berubah.
  useEffect(() => {
    setTab(initialTab === 'item' ? 'item' : 'minyak');
  }, [initialTab]);

  /* ---------------- minyak ---------------- */

  async function handleAdjustOil(oil, delta) {
    setBusyId(oil.id);
    setMessage('');
    try {
      await adjustOilStock(outletId, oil.oilType, oil.size, delta);
    } catch (e) {
      setMessage('Gagal: ' + e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetOil(oil, value) {
    // Penting: jangan menulis apa pun kalau kotaknya dikosongkan. Number('')
    // bernilai 0, jadi tanpa penjaga ini kasir yang mengetik ulang angka akan
    // membuat stok langsung tersimpan 0.
    if (value === '' || value === null || value === undefined) return;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return;
    // Pecahan tidak masuk akal untuk stok botol / tube.
    if (!Number.isInteger(num)) return;
    if (num === oil.stock) return;
    setBusyId(oil.id);
    setMessage('');
    try {
      await setOilStock(outletId, oil.oilType, oil.size, num);
      setMessage(`${namaMinyak(oil)} diset ke ${num}`);
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

  function tambahSatu(p) {
    if (p.dariMinyak) {
      const o = oils.find((x) => x.id === p.key);
      if (o) handleAdjustOil(o, 1);
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
                        onClick={() => tambahSatu(p)}
                      >
                        <span className="stok-tombol-ikon">+</span>
                        <span className="stok-tombol-teks">
                          {p.dariMinyak ? 'Tambah 1' : 'Isi barang'}
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
                        <button
                          className="stok-tombol kurangi"
                          disabled={busyId === oil.id || (oil.stock || 0) <= 0}
                          onClick={() => handleAdjustOil(oil, -1)}
                          title={`Kurangi ${namaLengkap} 1 botol`}
                        >
                          <span className="stok-tombol-ikon">−</span>
                          <span className="stok-tombol-teks">Kurang</span>
                        </button>

                        <label className="stok-jumlah">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={oil.stock == null ? 0 : oil.stock}
                            onChange={(e) => handleSetOil(oil, e.target.value)}
                            aria-label={`Jumlah ${namaLengkap}`}
                          />
                          <span className="stok-jumlah-satuan">{oil.unit || 'botol'}</span>
                        </label>

                        <button
                          className="stok-tombol tambah"
                          disabled={busyId === oil.id}
                          onClick={() => handleAdjustOil(oil, 1)}
                          title={`Tambah ${namaLengkap} 1 botol`}
                        >
                          <span className="stok-tombol-ikon">+</span>
                          <span className="stok-tombol-teks">Tambah</span>
                        </button>
                      </div>

                      <div className="stok-cepat">
                        <span className="stok-cepat-label">Cepat:</span>
                        {[6, 12, 24].map((n) => (
                          <button
                            key={n}
                            className="stok-cepat-tombol"
                            disabled={busyId === oil.id}
                            onClick={() => handleSetOil(oil, n)}
                            title={`Isi langsung jadi ${n} botol`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>
            Stok minyak berkurang otomatis saat transaksi disimpan. Yang harus diisi
            manual: oncall, check-in reservasi, dan pembatalan dengan potongan harga.
          </p>
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
            <section>
              <p>Jumlah untuk {selItem.name}</p>
              <input type="number" placeholder="Jumlah" value={qty} onChange={(e) => setQty(e.target.value)} />
              <input placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="grid-2">
                <button onClick={handleIn} disabled={busy || !qty}>Barang masuk</button>
                <button onClick={handleOut} disabled={busy || !qty}>Barang keluar</button>
              </div>
            </section>
          )}

          {selItem && (
            <button
              onClick={handleDelete}
              disabled={busy}
              style={{ width: 'auto', padding: '6px 12px', fontSize: 12, background: 'var(--danger)', color: '#fff', boxShadow: 'none', marginTop: 8 }}
            >
              Hapus item ini
            </button>
          )}

          <section style={{ marginTop: 20 }}>
            <p>Tambah item baru</p>
            <input placeholder="Nama barang" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input placeholder="Satuan (pcs/botol/lusin)" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={{ width: '100%', padding: 11, marginBottom: 8, borderRadius: 8, border: '1px solid var(--border)' }}
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