export default function UnpaidReminder({ count, overdue, onOpen }) {
  if (overdue === 0) return null;

  const label =
    overdue === 1
      ? '1 transaksi sudah lewat jam selesai tapi belum dibayar'
      : `${overdue} transaksi sudah lewat jam selesai tapi belum dibayar`;

  return (
    <div className="unpaid-banner">
      <div className="unpaid-banner-text">
        <strong>⚠️ Tagihan belum dibayar</strong>
        <span>{label}{count > overdue ? ` (total belum bayar ${count})` : ''}</span>
      </div>
      <button className="unpaid-banner-btn" onClick={onOpen}>
        Buka Payment & List
      </button>
    </div>
  );
}