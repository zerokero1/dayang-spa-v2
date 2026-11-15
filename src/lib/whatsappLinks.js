// Buka WhatsApp dengan pesan terisi. Penerima dipilih manual oleh pengguna.
//
// Supaya di HP langsung membuka aplikasi WhatsApp (bukan tinggal di browser/PWA):
//  - Android : pakai Android Intent (whatsapp://) + browser_fallback ke wa.me
//  - iPhone/iPad : pakai deep link whatsapp:// (tidak bisa auto-send pesan)
//  - Desktop : wa.me dibuka di tab baru (WA Web / app bila terpasang)
export function openWhatsAppMessage(message) {
  const text = encodeURIComponent(message || '');
  const fallback = `https://wa.me/?text=${text}`;
  const ua = navigator.userAgent;

  if (/Android/i.test(ua)) {
    const intentUrl =
      `intent://send?text=${text}#Intent;` +
      `scheme=whatsapp;package=com.whatsapp;` +
      `S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
    const a = document.createElement('a');
    a.href = intentUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  if (/iPhone|iPad|iPod/i.test(ua)) {
    const win = window.open(`whatsapp://send?text=${text}`, '_self');
    if (!win) window.location.href = fallback;
    return;
  }

  const win = window.open(fallback, '_blank');
  if (!win) window.location.href = fallback;
}
