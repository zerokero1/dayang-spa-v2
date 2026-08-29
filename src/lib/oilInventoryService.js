import { supabase } from './supabase';

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
  const { error } = await supabase
    .from('oil_inventory')
    .upsert({ outlet_id: outletId, oil_type: oilType, size, stock: newStock, unit: 'botol' });
  if (error) throw error;
}

export async function adjustOilStock(outletId, oilType, size, delta) {
  const { error } = await supabase.rpc('adjust_oil_stock', {
    p_outlet_id: outletId, p_oil_type: oilType, p_size: size, p_delta: delta
  });
  if (error) throw error;
}
