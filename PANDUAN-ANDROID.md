# Aplikasi Android Dayang Spa

Aplikasi Android membungkus build web Dayang Spa dengan Capacitor. Backend, login,
dan konfigurasi API tetap sama dengan aplikasi web; Android memuat frontend dari
folder build lokal `dist`.

## Menyiapkan dan menjalankan

Persyaratan: Node.js, Android Studio dengan JDK 21, Android SDK Platform 35
dengan Build Tools 35.0.0, serta perangkat atau emulator Android. Buka proyek ini
di terminal:

```bash
npm ci
npm run android:sync
npm run android:open
```

`android:sync` menjalankan pemeriksaan dan build web, lalu menyalin hasilnya ke
proyek Android. Di Android Studio, pilih perangkat/emulator dan jalankan aplikasi
dengan tombol **Run**. Ulangi `npm run android:sync` setelah perubahan frontend
sebelum menjalankan aplikasi lagi.

## Cetak struk Bluetooth

Halaman **Struk** di Android dapat menampilkan perangkat Bluetooth yang sudah
dipasangkan, menyimpan printer pilihan di perangkat, mengirim cetak uji, dan
mengirim struk langsung. Pasangkan printer dahulu di pengaturan Bluetooth
Android, lalu tekan **Muat ulang**. Izin Bluetooth Connect diminta saat daftar
printer dibuka.

**Mode cetak masih eksperimen, bukan kompatibilitas yang sudah dikonfirmasi.**
Karena nama yang terlihat hanya “Mobile Printer” dan tidak ada model/API yang
diketahui, implementasi untuk sementara berasumsi printer menggunakan
Bluetooth Classic RFCOMM/SPP (`00001101-0000-1000-8000-00805F9B34FB`) dan
menerima teks ESC/POS ASCII dengan lebar kertas 32 kolom. Tidak ada pemindaian
printer BLE, driver merek tertentu, code page non-ASCII, atau perintah potong
kertas. Printer yang memakai BLE, UUID SPP berbeda, atau protokol/vendor
tertutup tidak akan bekerja dengan jalur ini. Hasil cetak fisik belum dapat
diverifikasi tanpa mencoba printer sungguhan; tombol cetak menyatakan data
terkirim, bukan sensor bahwa kertas keluar.

Cetak struk dari browser/PWA tetap memakai `window.print()`. Backend, autentikasi,
dan konfigurasi API tidak berubah.
