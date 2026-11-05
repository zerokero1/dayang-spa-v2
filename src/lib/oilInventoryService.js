import { supabase } from './supabase';
import { businessRangeBoundsUtc } from './businessDate';

function mapRow(row) {
  return {
    id: `${row.oil_type}_${row.size}`,
    oilType: row.oil_type,
    size: row.size,
    stock: row.stock,
    unit: row.unit
  };
}

export function listenOilInventory(outletId, callback) {
  const channel = supabase
    .channel(`oil-inv-${outletId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'oil_inventory' }, () => {
      load();
    })
    .subscribe();

  async function load() {
    const { data, error } = await supabase
      .from('oil_inventory')
      .select('*')
      .eq('outlet_id', outletId);
    if (error) { console.warn(error); return; }
    callback((data || []).map(mapRow));
  }
  load();

  return () => supabase.removeChannel(channel);
}

export async function setOilStock(outletId, oilType, size, newStock) {
  const { error } = await supabase.rpc('set_oil_closing_stock', {
    p_outlet_id: outletId,
    p_oil_type: oilType,
    p_size: size,
    p_stock: newStock,
    p_note: 'Hitungan fisik saat closing'
  });
  if (error) throw error;
}

export async function adjustOilStock(outletId, oilType, size, delta) {
  const { error } = await supabase.rpc('adjust_oil_stock', {
    p_outlet_id: outletId, p_oil_type: oilType, p_size: size, p_delta: delta
  });
  if (error) throw error;
}

export async function getOilConsumptionByDate(outletId, date) {
  const { startUtc, endUtc } = businessRangeBoundsUtc(date, date);
  const { data, error } = await supabase
    .from('bookings')
    .select('oil_type, oil_size')
    .eq('outlet_id', outletId)
    .eq('uses_oil', true)
    .neq('status', 'batal')
    .gte('created_at', startUtc.toISOString())
    .lte('created_at', endUtc.toISOString());
  if (error) throw error;

  const usage = new Map();
  (data || []).forEach(({ oil_type: oilType, oil_size: size }) => {
    if (!oilType || !size) return;
    const key = `${oilType}|${size}`;
    const current = usage.get(key) || { oilType, size, qty: 0 };
    current.qty += 1;
    usage.set(key, current);
  });
  return [...usage.values()].sort(
    (a, b) => a.oilType.localeCompare(b.oilType) || a.size.localeCompare(b.size)
  );
}
