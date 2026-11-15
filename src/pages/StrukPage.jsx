import { useCallback, useEffect, useRef, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getDailyReceiptBookings } from '../lib/reportService';
import { ReceiptLines } from '../components/Receipt';
import { businessDate } from '../lib/businessDate';
import { Capacitor } from '@capacitor/core';
import { bluetoothPrinter, PRINTER_ID_STORAGE_KEY } from '../lib/bluetoothPrinter';
import { formatEscPosReceipt, formatEscPosTestPrint } from '../lib/receiptText';
import { notifyError, notifySuccess } from '../lib/notifications';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

export default function StrukPage({ outletId, active }) {
  const [date, setDate] = useState(businessDate());
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [printingBooking, setPrintingBooking] = useState(null);
  const [printerDevices, setPrinterDevices] = useState([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState(
    () => globalThis.localStorage?.getItem(PRINTER_ID_STORAGE_KEY) || '',
  );
  const selectedPrinterIdRef = useRef(selectedPrinterId);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerError, setPrinterError] = useState('');
  const [printerMessage, setPrinterMessage] = useState('');
  const isAndroidApp = Capacitor.getPlatform() === 'android';

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    getDailyReceiptBookings(outletId, date)
      .then((data) => {
        if (!cancelled) setBookings(data.filter((b) => b.status !== 'batal'));
      })
      .catch((error) => {
        if (!cancelled) notifyError('Gagal memuat daftar nota: ' + (error.message || 'Terjadi kesalahan.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [active, date, outletId]);

  const loadPrinterDevices = useCallback(async () => {
    setPrinterError('');
    setPrinterMessage('');
    try {
      const result = await bluetoothPrinter.listPairedDevices();
      const devices = result.devices || [];
      setPrinterDevices(devices);
      if (!devices.some((device) => device.id === selectedPrinterIdRef.current)) {
        setSelectedPrinterId('');
        selectedPrinterIdRef.current = '';
        globalThis.localStorage?.removeItem(PRINTER_ID_STORAGE_KEY);
      }
    } catch (error) {
      setPrinterError(error.message || 'Tidak dapat memuat printer Bluetooth.');
    }
  }, []);

  useEffect(() => {
    if (active && isAndroidApp) loadPrinterDevices();
  }, [active, isAndroidApp, loadPrinterDevices]);

  async function handlePrint(booking) {
    setPrinterError('');
    setPrinterMessage('');

    if (isAndroidApp) {
      if (!selectedPrinterId) {
        setPrinterError('Pilih printer yang sudah dipasangkan terlebih dahulu.');
        return;
      }

      setPrinterBusy(true);
      try {
        await bluetoothPrinter.printText({
          deviceId: selectedPrinterId,
          text: formatEscPosReceipt([booking], outletName),
        });
        setPrinterMessage('Data struk dikirim. Hasil cetak kertas belum dapat diverifikasi.');
        notifySuccess('Data struk berhasil dikirim ke printer.');
      } catch (error) {
        setPrinterError(error.message || 'Gagal mengirim struk ke printer Bluetooth.');
        notifyError('Gagal mengirim struk ke printer.');
      } finally {
        setPrinterBusy(false);
      }
      return;
    }

    setPrintingBooking(booking);
    setTimeout(() => {
      try {
        window.print();
        notifySuccess('Dialog cetak struk berhasil dibuka.');
      } catch (error) {
        setPrinterError(error.message || 'Gagal membuka dialog cetak struk.');
        notifyError('Gagal membuka dialog cetak struk.');
      } finally {
        setPrintingBooking(null);
      }
    }, 100);
  }

  async function handleTestPrint() {
    if (!selectedPrinterId) {
      setPrinterError('Pilih printer yang sudah dipasangkan terlebih dahulu.');
      return;
    }

    setPrinterBusy(true);
    setPrinterError('');
    setPrinterMessage('');
    try {
      await bluetoothPrinter.printText({
        deviceId: selectedPrinterId,
        text: formatEscPosTestPrint(outletName),
      });
      setPrinterMessage('Data tes dikirim. Periksa apakah printer mencetak teks uji.');
      notifySuccess('Data tes berhasil dikirim ke printer.');
    } catch (error) {
      setPrinterError(error.message || 'Gagal mengirim tes ke printer Bluetooth.');
      notifyError('Gagal mengirim tes ke printer.');
    } finally {
      setPrinterBusy(false);
    }
  }

  function handlePrinterSelection(event) {
    const deviceId = event.target.value;
    setSelectedPrinterId(deviceId);
    selectedPrinterIdRef.current = deviceId;
    if (deviceId) globalThis.localStorage?.setItem(PRINTER_ID_STORAGE_KEY, deviceId);
    else globalThis.localStorage?.removeItem(PRINTER_ID_STORAGE_KEY);
    setPrinterError('');
    setPrinterMessage('');
  }

  const outletName = OUTLETS.find((o) => o.id === outletId)?.name || outletId;

  return (
    <div className="kasir-page">
      <h2>Struk - {outletName}</h2>

      <section>
        <p>Tanggal</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </section>

      {isAndroidApp && (
        <section>
          <p>Printer Bluetooth — uji coba ESC/POS</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              aria-label="Pilih printer Bluetooth"
              value={selectedPrinterId}
              onChange={handlePrinterSelection}
              disabled={printerBusy}
            >
              <option value="">Pilih printer yang sudah dipasangkan</option>
              {printerDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name || 'Printer Bluetooth'} ({device.id})
                </option>
              ))}
            </select>
            <button className="btn btn-outline btn-sm" onClick={loadPrinterDevices} disabled={printerBusy}>
              Muat ulang
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleTestPrint} disabled={printerBusy || !selectedPrinterId}>
              {printerBusy ? 'Mengirim...' : 'Cetak uji'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Pasangkan printer di pengaturan Bluetooth Android. Mode uji mengasumsikan Bluetooth Classic SPP
            dan ESC/POS teks 32 kolom; kompatibilitas printer belum diverifikasi.
          </p>
          {printerError && <p role="alert" style={{ fontSize: 13, color: 'var(--danger, #b42318)' }}>{printerError}</p>}
          {printerMessage && <p role="status" style={{ fontSize: 13 }}>{printerMessage}</p>}
        </section>
      )}

      {loading && <p style={{ fontSize: 13 }}>Memuat...</p>}
      {!loading && bookings.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada transaksi di tanggal ini.</p>
      )}

      {bookings.map((b) => (
        <div key={b.id} className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: 13 }}>{b.treatmentName}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {b.therapistName} · {b.customerName || 'Tanpa nama'} · {rp(b.treatmentPrice)}
              </div>
            </div>
            <button className="btn btn-outline btn-sm"
              onClick={() => handlePrint(b)}
              disabled={printerBusy}
            >
              Cetak
            </button>
          </div>
        </div>
      ))}

      {printingBooking && <ReceiptLines lines={[printingBooking]} outletName={outletName} />}
    </div>
  );
}
