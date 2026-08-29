import { supabase } from './supabase';

function mapTreatment(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price != null ? Number(row.price) : 0,
    category: row.category,
    durationMinutes: row.duration_minutes,
    commissionPercent: row.commission_percent != null ? Number(row.commission_percent) : 0,
    usesOil: row.uses_oil
  };
}

async function fetchAll() {
  const { data, error } = await supabase.from('treatments').select('*');
  if (error) throw error;
  return (data || []).map(mapTreatment);
}

let _refCount = 0;
let _unsub = null;
let _latest = [];
let _loading = false;
const _callbacks = new Set();

async function _sync() {
  if (_loading) return;
  _loading = true;
  try {
    _latest = await fetchAll();
    _callbacks.forEach((cb) => { try { cb([..._latest]); } catch (e) { console.error(e); } });
  } catch (e) {
    console.warn('treatments sync error:', e);
  } finally {
    _loading = false;
  }
}

function _start() {
  _sync();
  _unsub = supabase
    .channel('realtime-treatments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'treatments' }, () => {
      _sync();
    })
    .subscribe();
}

export function listenTreatments(callback) {
  if (_refCount === 0) _start();
  _refCount++;
  _callbacks.add(callback);
  callback([..._latest]);
  return () => {
    _callbacks.delete(callback);
    _refCount = Math.max(0, _refCount - 1);
    if (_refCount === 0 && _unsub) {
      supabase.removeChannel(_unsub);
      _unsub = null;
      _latest = [];
    }
  };
}
