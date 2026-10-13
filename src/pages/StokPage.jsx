import { useEffect, useMemo, useState } from 'react';
import { listenOilInventory, setOilStock, adjustOilStock } from '../lib/oilInventoryService';
import { listenInventory, addInventoryItem, stockIn, stockOut, deleteInventoryItem } from '../lib/inventoryService';
import { INVENTORY_CATEGORIES, DEFAULT_INVENTORY_CATEGORY, isSingleSizeProduct } from '../lib/constants';

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

// Batas stok menipis. Nilainya sama dengan OrderStockPage supaya angka yang
// muncul di kedua halaman tidak berbeda.
const LOW_OIL = 1;
const LOW_ITEM = 2;

function namaMinyak(o) {
  return o.oilType + (isSingleSizeProduct(o.oilType) ? '' : ` (${o.size})`);
}

export default function StokPage({ outletId, active, initialTab = 'minyak' }) {
  const [tab, setTab] = useState(initialTab === 'item' ? 'item' : 'minyak');

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
    const num = Number(value);
    if (isNaN(num) || num < 0 || num === oil.stock) return;
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

  // Minyak dikelompokkan per jenis supaya urutan di layar rapi dan mudah
  // dibandingkan dengan katalog.
  const minyakPerJenis = useMemo(() => {
    const peta = new Map();
    oils.forEach((o) => {
      if (!peta.has(o.oilType)) peta.set(o.oilType, []);
      peta.get(o.oilType).push(o);
    });
    return [...peta.entries()].map(([jenis, list]) => ({
      jenis,
      list: list.slice().sort((a, b) => String(a.size).localeCompare(String(b.size)))
    }));
  }, [oils]);

  // Gabungan minyak dan produk yang perlu attention.
  const perluAttention = useMemo(() => {
    const out = [];
    oils.forEach((o) => {
      if ((o.stock || 0) <= LOW_OIL) {
        out.push({
          key: o.id, nama: namaMinyak(o), stok: o.stock || 0,
          satuan: o.unit || 'botol', jenis: 'Minyak', dariMinyak: true
        });
      }
    });
    items.forEach((it) => {
      if ((it.stock || 0) <= LOW_ITEM) {
        out.push({
          key: it.id, nama: it.name, stok: it.stock || 0,
          satuan: it.unit, jenis: it.category || DEFAULT_INVENTORY_CATEGORY, dariMinyak: false
        });
      }
    });
    return out.sort((a, b) => (a.stok - b.stok) || a.nama.localeCompare(b.nama));
  }, [oils, items]);

  const totalMinyak = oils.reduce((s, o) => s + (o.stock || 0), 0);
  const totalProduk = items.reduce((s, it) => s + (it.stock || 0), 0);

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
          <p className="muted" style={{ marginBottom: 8 }}>
            Perlu diisi — minyak ≤ {LOW_OIL} botol, produk ≤ {LOW_ITEM}
          </p>
          <div className="grid-2">
            {perluAttention.map((p) => (
              <div key={p.key} className="oil-card stok-perlu">
                <div>
                  <strong>{p.nama}</strong>{' '}
                  <small className="muted">{p.jenis}</small>
                </div>
                <div style={{ fontSize: 12 }}>
                  {p.stok <= 0 ? '⚠ habis' : '⚠ menipis'} · sisa {p.stok} {p.satuan}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button disabled={busy || busyId === p.key} onClick={() => tambahSatu(p)}>
                    {p.dariMinyak ? '+1' : 'Isi barang'}
                  </button>
                </div>
              </div>
            ))}
          </div>
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
            <div key={g.jenis} style={{ marginBottom: 16 }}>
              <p className="muted" style={{ marginBottom: 6 }}>
                {g.jenis}
                {isSingleSizeProduct(g.jenis) ? ` (${g.list[0].unit})` : ` (${g.list.length} ukuran)`}
              </p>
              <div className="grid-2">
                {g.list.map((oil) => (
                  <div key={oil.id} className={(oil.stock || 0) <= LOW_OIL ? 'oil-card stok-menipis' : 'oil-card'}>
                    <div>
                      {isSingleSizeProduct(oil.oilType) ? oil.oilType : oil.size}
                      {(oil.stock || 0) <= LOW_OIL && (
                        <span className="stok-badge">
                          {' '}{oil.stock <= 0 ? '⚠ habis' : '⚠ menipis'}
                        </span>
                      )}
                    </div>
                    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                      <button disabled={busyId === oil.id} onClick={() => handleAdjustOil(oil, -1)}>
                        -1
                      </button>
                      <input
                        type="number"
                        style={{ width: 60, textAlign: 'center', margin: 0 }}
                        value={oil.stock}
                        onChange={(e) => handleSetOil(oil, e.target.value)}
                      />
                      <button disabled={busyId === oil.id} onClick={() => handleAdjustOil(oil, 1)}>
                        +1
                      </button>
                    </div>
                  </div>
                ))}
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