# Skema Input Stok Minyak — Panduan Kasir

> Berlaku untuk semua outlet: **DR, RR, DP, D1, D2, Y**
> Halaman yang dipakai: **Lainnya → Stok** (satu halaman untuk minyak DAN produk)
> dan **Lainnya → Order Stok** (untuk minta replenishment ke pusat)

---

## 1. Dua hal yang harus dibedakan

Ada **dua jenis stok** di aplikasi ini. Sekarang keduanya sudah digabung dalam
satu halaman **Stok**, dipisahkan lewat tab:

| Tab | Isi | Kapan dipakai |
|---|---|
| **Minyak** | Botol minyak & cream therapy | Treatment massage memakai minyak |
| **Produk & Laundry** | Produk treatment & Laundry (Facial, Scrub, Manicure, dll) | Treatment non-massage |

Jangan tertukar. Kalau treatment-nya **Massage** → catat di tab **Minyak**.
Kalau treatment-nya **Facial / Manicure / Body Scrub** → catat di tab **Produk & Laundry**.

---

## 2. Jenis & ukuran yang tersedia

8 jenis produk, ukuran berbeda-beda:

```
OIL (6 jenis)          2 ukuran:  Kecil (10 ml)  ·  Besar (30 ml)
  Relaxing
  Refreshing
  Herbal
  Hot Oil
  Cem-Ceman
  Aromatic Oil

CREAM / PRODUK (2 jenis) 1 ukuran saja (tanpa pilih ukuran)
  Aloevera Cream
  Foot Cream
```

**Cara memilihnya di kasir:**

- Treatment **Massage** → pilih salah satu dari 6 minyak di atas
- Treatment **Foot Massage** → pilih **Foot Cream** (satu-satunya pilihan)
- Kalau memang tidak pakai minyak → tekan **Tanpa Minyak**

---

## 3. Alur harian — apakah stok berkurang sendiri?

### ✅ Yang OTOMATIS berkurang

Stok minyak **dipotong otomatis saat transaksi disimpan**, bukan saat pembayaran.
Jadi begitu tekan **Simpan**, stok sudah keluar.

```
Kasir pilih treatment Massage
  → pilih minyak + ukuran
  → pilih terapis
  → Simpan
     ↓
  stok minyak outlet itu berkurang 1 (otomatis, database yang memotong)
```

Cara memastikan: buka **Lainnya → Stok**, angka di kartu minyak itu sudah berkurang.

### ⚠️ Yang TIDAK berkurang otomatis — HARUS diisi manual

| Situasi | Kenapa | Yang harus kasir lakukan |
|---|---|---|
| **Oncall / tamu hotel** | Booking oncall sengaja tidak memotong minyak | Kalau therapy-nya pakai minyak, **kurangi manual** di tab **Minyak** (`-1`) |
| **Pelanggan reservasi yang check-in** | Booking dari reservasi tercatat tanpa minyak | **Kurangi manual** (`-1`) sesuai minyak yang dipakai |
| **Stok awal / refill datang** | | Tambah manual (`+1` atau ketik angka) |

> Ini bukan salah aplikasi — sengaja dibiarkan begitu supaya kalau ternyata tidak
> dipakai minyak, stok tidak berkurang sendiri dan harus dikoreksi manual.

---

## 4. Cara input stok (langkah demi langkah)

### Step 1 — Buka halaman

```
Beranda → Lainnya → Stok
```

Di paling atas ada tiga kotak ringkasan:

```
8 jenis minyak      3 jenis produk      2 perlu diisi
236 botol            74 total            lihat di bawah
```

Kalau angka **perlu diisi** lebih dari 0, langsung muncul daftarnya di bawah —
sudah **digabung** minyak dan produk. Tinggal tekan **+1** (untuk minyak) atau
**Isi barang** (untuk produk), tidak perlu pindah tab.

### Step 2 — Pilih tab

```
[ Minyak (8) ]   [ Produk & Laundry (3) ]
```

### Step 3 — Pilih produk

Minyak dikelompokkan per jenis, jadi di bawahnya nanti tertulis
`Relaxing (2 ukuran)`, `Foot Cream (tube)`, dan seterusnya.

### Step 4 — Masukkan jumlah

Ada 3 cara, pilih salah satu:

```
┌────────────────────────────────────┐
│  Herbal (Kecil)                    │
│                                    │
│         [  12  ]                   │
│          ▲     ▲                   │
│         -1    +1                   │
└────────────────────────────────────┘
```

| Cara | Kapan dipakai |
|---|---|
| Tombol **+1** | Tambah 1 botol (refill kecil, biasanya 1-2 botol) |
| Tombol **−1** | Koreksi 1 botol (actually dipakai, tidak ada di list) |
| **Ketik angka** di kotak tengah | Set langsung ke jumlah tertentu (contoh: isi ulang 24 botol) |

### Step 5 — Otomatis tersimpan

Tidak ada tombol **Simpan**. Begitu diketuk atau diketik, langsung tersimpan dan muncul pesan:

```
Herbal (Kecil) diset ke 24
```

### Tips biar tidak salah

- **Selalu cek kartu produknya dulu** sebelum mengubah — angka di tengah adalah stok saat ini
- Kalau akan isi banyak botol sekaligus, **ketik angka langsung** daripada menekan +1 berkali-kali
- Setelah mengubah, **tunggu pesan muncul** — kalau tidak muncul berarti gagal
- Halaman ini **terbuka untuk semua kasir**, jadi jangan sampai keliru outlet

---

## 5. Kapan harus Order Stok

Kalau di **Order Stok** produknya bertanda **⚠ akan habis**, berarti tinggal ≤ 1 botol.

```
Order Stok → ⚠ akan habis
```

### Step Order Stok

```
1. Buka  Lainnya → Order Stok
2. Lihat daftar di bawah "Stok saat ini"
3. Cari yang bertanda ⚠ akan habis
4. Isi "Jumlah order" di kolomnya
5. Isi "Catatan (opsional)" — cth: "butuh minggu ini / sekalian refill"
6. Tekan  📦 Kirim Order Stok
```

Pesan sukses:

```
Order stok terkirim (3 item). Menunggu diproses pihak pusat.
```

### Setelah dikirim

Kasir **tidak perlu** melakukan apa-apa lagi. Yang berikutnya:

```
Diajukan  →  Diproses  →  ✅ Tarni Selesai
   │            │              │
  kasir      pusat          pusat
kirim     lanjut proses   barang sudah dikirim
```

Tombol **Diproses**, **✅ Tandai Selesai**, dan **Batal** hanya untuk **Admin Pusat / Office**.

---

## 6. Kapan stok kembali (dikembalikan)

| Aksi | Stok minyak |
|---|---|
| Booking dibatalkan **penuh** (Status Terapis → Batal) | ✅ **Kembali +1** otomatis |
| Booking **selesai & dibayar** | ❌ Tetap berkurang (memang dipakai) |
| Booking dibatalkan **dengan potongan harga** | ❌ **Tidak kembali** — kasir harus `+1` manual |
| Booking dihapus oleh Office | ✅ Kembali +1 otomatis |
| Ganti minyak di Koreksi Booking | ✅ Oil lama +1, oil baru −1 (otomatis) |

> ⚠️ **Penting:** kalau membatalkan dengan potongan, stiknya **tidak** balik.
> Kasir wajib remembers untuk_+1_ manual.

---

## 7. Kalau Treatment-nya Pakai Minyak tapi Stok NOL

Aplikasi **tidak memblokir** transaksi kalau stok habis — booking tetap diproses,
stoknya dijepit di angka 0.

Kasir wajib mengoreksi sendiri di halaman Stok, tab Minyak:

```
1. Jangan panik, transaksi tetap jalan
2. Pakai minyak lain yang stoknya masih ada
3. Kalau tidak ada satu pun yang tersedia → pilih  Tanpa Minimum
4. Setelah itu → catat di Order Stok supaya replenishment dipesan
5. Kalau treatment-nya tetap harus pakai minyak →
   isi +1 manual di tab Minyak sambil menunggu barang datang
```

---

## 8. Cek Stok Cepat

### Kalau mau lihat semua movement
```
Lainnya → Laporan Inventory → Download Excel
```
Berisi: Stok / Masuk / Keluar / Sisa per hari. Ada penanda **menipis** dan **habis**.

### Kalau mau tahu minyak terpakai bulan ini
```
Laporan Produksi →  Total Minyak Terpakai
```

### Kalau mau lihat pergerakan hari ini
```
Laporan Pemakaian Stok
```
Tabel 7 hari ke belakang: stok → masuk → keluar → sisa per hari.

---

## 9. Ringkasan Sehari

| Waktu | Yang dilakukan |
|---|---|
| **Buka shift** | Buka **Stok** — lihat angka di kotak **perlu diisi** |
| **Transaksi** | Pilih minyak saat input order. Stok **otomatis** berkurang |
| **Pelayanan oncall** | Jangan lupa **−1 manual** kalau dipakai minyak |
| **Check-in reservasi** | Jangan lupa **−1 manual** |
| **Batal + potongan** | Jangan lupa **+1 manual** |
| **Tutup shift** | Buka **Order Stok** → isi yang ⚠ akan habis → **📦 Kirim Order Stok** |

---

## 10. Jebakan yang Perlu Diketahui

| Jebakan | Kenapa |
|---|---|
| Stok **tidak** berkurang otomatis | Kalau treatment-nya `-Tanpa Minyak-`, disengaja |
| Booking oncall **tidak** memotong minyak | Harus manual, lihat §3 |
| Reservasi check-in **tidak** memotong minyak | Harus manual, lihat §3 |
| Batal + potongan **tidak** mengembalikan stok | Harus manual, lihat §6 |
| Tidak ada tombol **Simpan** | Langsung tersimpan saat diketuk |
| Stok 0 **tidak** memblokir transaksi | Transaksi tetap jalan, lihat §7 |
| Halaman Stok **tanpa batas outlet** | Kasir bisa saja mengubah stok outlet lain — hati-hati |
| Tidak ada pengaturan "stok minimum" | Tanda **⚠ akan habis** selalu muncul di angka ≤ 1 |

---

## 11. Kalau Ada yang Tidak Beres

| Gejala | Yang harus dicek |
|---|---|
| Stok tidak berubah setelah +1 | Coba klik lagi sampai muncul pesan "diset ke" |
| Stok tidak berkurang setelah transaksi | Booking dibuat pakai **Tanpa Minyak**? |
| Jumlah tidak sesuai hasil hitung | Buka **Laporan Pemakaian Stok** — bisa jadi ada pembatalan yang tidak tercatat |
| Salah input dalam jumlah besar | Jangan diperbaiki sendiri - minta **Office** untuk **Koreksi Booking** |

---

*Dokumen ini menjelaskan cara input stok minyak sesuai aplikasi yang berjalan
saat ini (database `oil_inventory`). Kalau ada perubahan di aplikasi, perbarui
dokumen ini ya.*