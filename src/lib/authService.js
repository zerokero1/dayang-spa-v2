import { supabase } from './supabase';

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, role: data.role, outletId: data.outlet_id, name: data.name };
}

export function listenAuthState(callback) {
  const handle = supabase.auth.onAuthStateChange(async (event, session) => {
    const user = session?.user ?? null;
    if (!user) {
      callback(null, null);
      return;
    }
    try {
      const profile = await getUserProfile(user.id);
      callback(user, profile);
    } catch (e) {
      console.error('profile error', e);
      callback(user, null);
    }
  });

  // Bentuk return bisa { data: { subscription } } atau langsung subscription,
  // dan subscription bisa berupa object ({unsubscribe}) atau fungsi(). Tangani semuanya.
  const sub = (handle && handle.data && handle.data.subscription)
    || (handle && handle.subscription)
    || null;

  return () => {
    try {
      if (!sub) return;
      if (typeof sub.unsubscribe === 'function') sub.unsubscribe();
      else if (typeof sub === 'function') sub();
    } catch (e) {
      console.warn('auth unsubscribe error', e);
    }
  };
}
