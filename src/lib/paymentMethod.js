const NON_CASH_METHODS = new Set([
  'cardless', 'qris', 'transfer', 'debit', 'kredit', 'edc',
  'ovo', 'dana', 'gopay', 'shopeepay'
]);

export function classifyPaymentMethod(raw) {
  const method = String(raw ?? '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (NON_CASH_METHODS.has(method)) return 'nonCash';
  return 'unknown';
}
