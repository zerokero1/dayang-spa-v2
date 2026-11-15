import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDailyBookings } from '../src/lib/reportService.js';

test('summarizeDailyBookings menjumlahkan kas riil (cash, cardless) dan belum bayar secara konsisten', () => {
  const mockBookings = [
    // 1. Reguler lunas Cash: Rp 200.000, komisi Rp 20.000
    {
      id: '1',
      therapistId: 't1',
      therapistName: 'Terapis 1',
      treatmentPrice: 200000,
      commissionAmount: 20000,
      paid: true,
      paymentMethod: 'cash',
      bookingSource: 'in_house',
      status: 'selesai'
    },
    // 2. Reguler lunas Cardless: Rp 150.000, komisi Rp 15.000
    {
      id: '2',
      therapistId: 't2',
      therapistName: 'Terapis 2',
      treatmentPrice: 150000,
      commissionAmount: 15000,
      paid: true,
      paymentMethod: 'cardless',
      bookingSource: 'in_house',
      status: 'selesai'
    },
    // 3. Reguler belum bayar (unpaid): Rp 100.000, komisi Rp 10.000
    {
      id: '3',
      therapistId: 't1',
      therapistName: 'Terapis 1',
      treatmentPrice: 100000,
      commissionAmount: 10000,
      paid: false,
      paymentMethod: 'cash',
      bookingSource: 'in_house',
      status: 'berjalan'
    },
    // 4. Oncall lunas Cash: harga Rp 300.000, komisi hotel Rp 50.000 -> net Rp 250.000, komisi Rp 25.000
    {
      id: '4',
      therapistId: 't2',
      therapistName: 'Terapis 2',
      treatmentPrice: 300000,
      hotelCommission: 50000,
      commissionAmount: 25000,
      paid: true,
      paymentMethod: 'cash',
      bookingSource: 'oncall',
      status: 'selesai'
    },
    // 5. Oncall belum bayar: harga Rp 200.000, komisi hotel Rp 40.000 -> net Rp 160.000, komisi Rp 16.000
    {
      id: '5',
      therapistId: 't3',
      therapistName: 'Terapis 3',
      treatmentPrice: 200000,
      hotelCommission: 40000,
      commissionAmount: 16000,
      paid: false,
      paymentMethod: 'cardless',
      bookingSource: 'oncall',
      status: 'berjalan'
    },
    // 6. Transaksi batal (tidak boleh dihitung sama sekali)
    {
      id: '6',
      therapistId: 't1',
      therapistName: 'Terapis 1',
      treatmentPrice: 500000,
      paid: false,
      status: 'batal'
    }
  ];

  const summary = summarizeDailyBookings(mockBookings);

  // 1. Reguler omzet = 200k + 150k + 100k = 450k
  assert.equal(summary.totalRevenue, 450000);
  assert.equal(summary.totalTreatment, 3);

  // 2. Oncall omzet net = (300k - 50k) + (200k - 40k) = 250k + 160k = 410k
  assert.equal(summary.oncallRevenue, 410000);
  assert.equal(summary.oncallCount, 2);
  assert.equal(summary.totalHotelCommission, 90000);

  // 3. Total Revenue Net = 450k + 410k = 860k
  assert.equal(summary.totalRevenueNet, 860000);

  // 4. Kas Masuk Riil:
  // - Cash lunas = Reguler (200k) + Oncall Net (250k) = 450k
  // - Cardless lunas = Reguler (150k) = 150k
  assert.equal(summary.cashRevenue, 450000);
  assert.equal(summary.cardlessRevenue, 150000);
  assert.equal(summary.paidRevenue, 600000);

  // 5. Belum Bayar (Unpaid):
  // - Reguler (100k) + Oncall Net (160k) = 260k
  assert.equal(summary.unpaidRevenue, 260000);
  assert.equal(summary.unpaidCount, 2);

  // 6. Hubungan matematika wajib exact:
  // paidRevenue + unpaidRevenue === totalRevenueNet
  assert.equal(summary.paidRevenue + summary.unpaidRevenue, summary.totalRevenueNet);
  assert.equal(summary.cashRevenue + summary.cardlessRevenue, summary.paidRevenue);

  // 7. Batal tercatat
  assert.equal(summary.totalBatal, 1);
});
