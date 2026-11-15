import { Capacitor } from '@capacitor/core';
import { OUTLETS } from './constants';
import { bluetoothPrinter, PRINTER_ID_STORAGE_KEY } from './bluetoothPrinter';
import { formatEscPosReceipt } from './receiptText';

export async function preparePaidReceiptPrinter() {
  if (Capacitor.getPlatform() !== 'android') return false;

  const deviceId = globalThis.localStorage?.getItem(PRINTER_ID_STORAGE_KEY);
  if (!deviceId) {
    throw new Error('Pilih printer terlebih dahulu di menu Struk.');
  }
  await bluetoothPrinter.preparePrinter({ deviceId });
  return true;
}

export async function printPaidReceipt(lines, outletId) {
  if (Capacitor.getPlatform() !== 'android') return false;

  const deviceId = globalThis.localStorage?.getItem(PRINTER_ID_STORAGE_KEY);
  if (!deviceId) {
    throw new Error('Pilih printer terlebih dahulu di menu Struk.');
  }

  const outletName = OUTLETS.find((outlet) => outlet.id === outletId)?.name || outletId;
  const paidLines = lines.map((line) => ({ ...line, paid: true }));
  await bluetoothPrinter.printText({
    deviceId,
    text: formatEscPosReceipt(paidLines, outletName),
  });
  return true;
}
