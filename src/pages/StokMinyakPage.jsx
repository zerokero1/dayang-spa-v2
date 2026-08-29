import { useEffect, useState } from 'react';
import { listenOilInventory, setOilStock, adjustOilStock } from '../lib/oilInventoryService';

export default function StokMinyakPage({ outletId }) {
  const [oils, setOils] = useState([]);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => listenOilInventory(outletId, setOils), [outletId]);

  async function handleAdjust(oil, delta) {
    setBusyId(oil.id);
    try {
      await adjustOilStock(outletId, oil.oilType, oil.size, delta);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDirect(oil, value) {
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
    setBusyId(oil.id);
    try {
      await setOilStock(outletId, oil.oilType, oil.size, num);
      setMessage(`${oil.oilType} (${oil.size}) diset ke ${num}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="kasir-page">
      <h2>Stok Minyak - {outletId}</h2>
      {message && <p>{message}</p>}

      <div className="grid-2">
        {oils.map((oil) => (
          <div key={oil.id} className="oil-card">
            <div>{oil.oilType} ({oil.size})</div>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <button
                disabled={busyId === oil.id}
                onClick={() => handleAdjust(oil, -1)}
              >
                -1
              </button>
              <input
                type="number"
                style={{ width: 60, textAlign: 'center', margin: 0 }}
                value={oil.stock}
                onChange={(e) => handleSetDirect(oil, e.target.value)}
              />
              <button
                disabled={busyId === oil.id}
                onClick={() => handleAdjust(oil, 1)}
              >
                +1
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
