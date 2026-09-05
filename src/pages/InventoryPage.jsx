import { useEffect, useState } from 'react';
import { listenInventory, addInventoryItem, stockIn, stockOut, deleteInventoryItem } from '../lib/inventoryService';

export default function InventoryPage({ outletId, active }) {
  const [items, setItems] = useState([]);
  const [selItem, setSelItem] = useState(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    return listenInventory(outletId, setItems);
  }, [active, outletId]);

  async function handleAddItem() {
    if (!newName) return;
    setBusy(true);
    try {
      await addInventoryItem(outletId, { name: newName, unit: newUnit || 'pcs', initialStock: 0 });
      setNewName(''); setNewUnit('');
      setMessage('Item baru ditambahkan');
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

  return (
    <div className="kasir-page">
      <h2>Inventory - {outletId}</h2>

      <section>
        <p>Daftar barang</p>
        <div className="grid-2">
          {items.map((it) => (
            <button
              key={it.id}
              className={selItem?.id === it.id ? 'active' : ''}
              onClick={() => setSelItem(it)}
            >
              {it.name} ({it.stock} {it.unit})
            </button>
          ))}
        </div>
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
          <button
            onClick={handleDelete}
            disabled={busy}
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12, background: 'var(--danger)', color: '#fff', boxShadow: 'none', marginTop: 8 }}
          >
            Hapus item ini
          </button>
        </section>
      )}

      {message && <p>{message}</p>}

      <section style={{ marginTop: 20 }}>
        <p>Tambah item baru</p>
        <input placeholder="Nama barang" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder="Satuan (pcs/botol/lusin)" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
        <button onClick={handleAddItem} disabled={busy || !newName}>Tambah item</button>
      </section>
    </div>
  );
}
