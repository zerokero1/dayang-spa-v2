import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt', bukan 'autoUpdate': versi baru tidak boleh memuat ulang
      // halaman diam-diam saat kasir sedang mengisi transaksi.
      // Promptnya ada di src/components/PwaUpdatePrompt.jsx.
      registerType: 'prompt',
      workbox: {
        // Cache lama dibersihkan agar tidak menumpuk setelah beberapa rilis.
        cleanupOutdatedCaches: true
      },
      manifest: {
        name: 'Dayang Spa',
        short_name: 'Dayang Spa',
        description: 'Manajemen Dayang Spa: kasir, inventori, absensi, komisi',
        theme_color: '#0F6E56',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
});
