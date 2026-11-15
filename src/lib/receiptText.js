const PAPER_COLUMNS = 32;

function toPrinterText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\r\n]/g, '?');
}

function wrapText(value) {
  const words = toPrinterText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    if (word.length > PAPER_COLUMNS) {
      if (line) lines.push(line);
      line = '';
      for (let offset = 0; offset < word.length; offset += PAPER_COLUMNS) {
        lines.push(word.slice(offset, offset + PAPER_COLUMNS));
      }
      continue;
    }

    if (line && line.length + word.length + 1 > PAPER_COLUMNS) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function centerText(value) {
  const text = toPrinterText(value).slice(0, PAPER_COLUMNS);
  const padding = Math.max(0, PAPER_COLUMNS - text.length);
  const leftPadding = Math.floor(padding / 2);
  return `${' '.repeat(leftPadding)}${text}`;
}

function amountLine(label, value) {
  const amount = toPrinterText(value);
  const availableLabel = Math.max(1, PAPER_COLUMNS - amount.length - 1);
  const safeLabel = toPrinterText(label);

  if (safeLabel.length > availableLabel) {
    return [...wrapText(safeLabel), amount.padStart(PAPER_COLUMNS)].join('\n');
  }

  return `${safeLabel}${' '.repeat(PAPER_COLUMNS - safeLabel.length - amount.length)}${amount}`;
}

function formatDate(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatPrice(value) {
  const amount = Number(value) || 0;
  return `Rp${amount.toLocaleString('id-ID')}`;
}

export function formatEscPosReceipt(lines, outletName) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Struk tidak memiliki item.');
  }

  const text = [
    centerText('DAYANG SPA'),
    centerText(outletName),
    '-'.repeat(PAPER_COLUMNS),
  ];

  for (const line of lines) {
    const treatmentName = line.usesOil === false
      ? `${line.treatmentName} (tanpa minyak)`
      : line.treatmentName;
    text.push(
      ...wrapText(treatmentName),
      ...wrapText(`Terapis: ${line.therapistName}`),
    );

    if (line.customerName) text.push(...wrapText(`Pelanggan: ${line.customerName}`));
    text.push(...wrapText(`Tanggal: ${formatDate(line.startAt)}`));

    if (line.originalPrice != null && Number(line.originalPrice) > Number(line.treatmentPrice)) {
      const discount = Number(line.originalPrice) - Number(line.treatmentPrice);
      text.push(amountLine('Diskon', `-${formatPrice(discount)}`));
    }

    text.push(amountLine('Harga', formatPrice(line.treatmentPrice)), '');
  }

  const total = lines.reduce((sum, line) => sum + (Number(line.treatmentPrice) || 0), 0);
  text.push(
    '-'.repeat(PAPER_COLUMNS),
    amountLine('TOTAL', formatPrice(total)),
    ...wrapText(`Metode: ${lines[0].paymentMethod === 'cardless' ? 'Cardless' : 'Cash'}`),
    `Status: ${lines.every((line) => line.paid === true) ? 'LUNAS' : 'BELUM LUNAS'}`,
    '-'.repeat(PAPER_COLUMNS),
    centerText('Terima kasih atas kunjungan Anda'),
    '',
    '',
  );

  return text.map(toPrinterText).join('\n');
}

export function formatEscPosTestPrint(outletName) {
  return [
    centerText('DAYANG SPA'),
    centerText('TES PRINTER'),
    '-'.repeat(PAPER_COLUMNS),
    ...wrapText(`Outlet: ${outletName}`),
    ...wrapText(`Tanggal: ${formatDate(Date.now())}`),
    '',
    ...wrapText('Jika teks ini terbaca, data berhasil dikirim via Bluetooth Classic SPP.'),
    ...wrapText('Uji ESC/POS; kertas belum diverifikasi.'),
    '',
    '',
  ].map(toPrinterText).join('\n');
}
