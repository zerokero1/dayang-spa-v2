import { Capacitor, registerPlugin } from '@capacitor/core';
import { openWhatsAppMessage } from './whatsappLinks.js';

const NativeWhatsAppShare = registerPlugin('WhatsAppShare');

export async function shareWhatsAppMessage(message) {
  const text = message || '';
  if (Capacitor.getPlatform() === 'android') {
    await NativeWhatsAppShare.shareMessage({ text });
    return;
  }
  openWhatsAppMessage(text);
}
