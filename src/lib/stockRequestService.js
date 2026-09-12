import { supabase } from './supabase';

export async function submitStockRequests({ outletId, createdBy, items }) {
  const { error } = await supabase.from('stock_requests').insert(
    items.map((i) => ({
      outlet_id: outletId,
      item_type: i.itemType,
      name: i.name,
      size: i.size || '',
      unit: i.unit || '',
      qty: i.qty,
      note: i.note || '',
      created_by: createdBy || ''
    }))
  );
  if (error) throw error;
}

// outletId = null / undefined -> semua outlet (untuk admin pusat / office).
export async function getStockRequests(outletId, limit = 200) {
  let q = supabase.from('stock_requests').select('*');
  if (outletId) q = q.eq('outlet_id', outletId);
  q = q.order('created_at', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    outletId: r.outlet_id,
    itemType: r.item_type,
    name: r.name,
    size: r.size,
    unit: r.unit,
    qty: r.qty,
    note: r.note,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    doneAt: r.done_at
  }));
}

export async function updateStockRequestStatus(id, status) {
  const patch = { status };
  if (status === 'diproses') patch.processed_at = new Date().toISOString();
  if (status === 'selesai') patch.done_at = new Date().toISOString();
  if (status === 'batal') patch.done_at = null;
  const { error } = await supabase.from('stock_requests').update(patch).eq('id', id);
  if (error) throw error;
}