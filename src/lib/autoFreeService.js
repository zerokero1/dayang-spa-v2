import { supabase } from './supabase';

let timer = null;

export function startAutoFreeTicker(intervalMs = 30000) {
  stopAutoFreeTicker();
  timer = setInterval(() => {
    supabase.rpc('auto_free_expired_therapists').then(({ error }) => {
      if (error) console.warn('[autoFree] gagal:', error.message);
    });
  }, intervalMs);
}

export function stopAutoFreeTicker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}