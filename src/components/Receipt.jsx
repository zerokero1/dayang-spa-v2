const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function formatDate(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ReceiptLines({ lines, outletName }) {
  return (
    <div className="receipt-print">
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>DAYANG SPA</strong>
        <div style={{ fontSize: 10 }}>{outletName}</div>
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
      {lines.map((line, i) => {
        const discount =
          line.originalPrice != null && Number(line.originalPrice) > Number(line.treatmentPrice)
            ? Number(line.originalPrice) - Number(line.treatmentPrice)
            : null;
        return (
          <div key={i} style={{ fontSize: 10, marginBottom: line.virtual ? 0 : 6 }}>
            <div>
              {line.treatmentName}
              {line.virtual ? '' : line.usesOil === false ? ' (tanpa minyak)' : ''}
            </div>
            <div>Terapis: {line.therapistName}</div>
            {line.customerName && <div>Pelanggan: {line.customerName}</div>}
            <div>Tanggal: {formatDate(line.startAt)}</div>
            {discount != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
                <span>Diskon</span>
                <span>-{rp(discount)}</span>
              </div>
            )}
            <div style={line.virtual ? undefined : { display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <span>Harga</span>
              <span>{rp(line.treatmentPrice)}</span>
            </div>
          </div>
        );
      })}
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
      {lines.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 12 }}>
          <span>TOTAL</span>
          <span>{rp(lines.reduce((s, l) => s + (Number(l.treatmentPrice) || 0), 0))}</span>
        </div>
      )}
      {lines.length === 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 12 }}>
          <span>TOTAL</span>
          <span>{rp(lines[0].treatmentPrice)}</span>
        </div>
      )}
      <div style={{ fontSize: 10, marginTop: 4 }}>
        {lines[0] && <div>Metode: {lines[0].paymentMethod === 'cardless' ? 'Cardless' : 'Cash'}</div>}
        <div>Status: LUNAS</div>
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
      <div style={{ textAlign: 'center', fontSize: 10, marginTop: 8 }}>
        Terima kasih atas kunjungan Anda
      </div>
    </div>
  );
}
