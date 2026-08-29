import { supabase } from './supabase';

export async function addInventoryItem(outletId, { name, unit, initialStock }) {
  const { data, error } = await supabase.from('inventory').insert({
    outlet_id: outletId,
    name,
    unit: unit || 'pcs',
    stock: initialStock || 0
  }).select().single();
  if (error) throw error;
  return data.id;
}

export async function stockIn(outletId, itemId, qty, note) {
  const { error } = await supabase.rpc('stock_in_out', {
    p_outlet_id: outletId, p_item_id: itemId, p_qty: qty, p_note: note || ''
  });
  if (error) throw error;
}

export async function stockOut(outletId, itemId, qty, note) {
  const { error } = await supabase.rpc('stock_in_out', {
    p_outlet_id: outletId, p_item_id: itemId, p_qty: -qty, p_note: note || ''
  });
  if (error) throw error;
}

export function listenInventory(outletId, callback) {
  const channel = supabase
    .channel(`inv-${outletId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
      load();
    })
    .subscribe();

  async function load() {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('outlet_id', outletId)
      .order('created_at');
    if (error) { console.warn(error); return; }
    callback((data || []).map((r) => ({ id: r.id, name: r.name, unit: r.unit, stock: r.stock })));
  }
  load();

  return () => supabase.removeChannel(channel);
}
