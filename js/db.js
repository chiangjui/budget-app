// 資料存取層：有設定 Supabase 就用雲端，否則用瀏覽器 localStorage（示範模式）
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const demo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

let sb = null;
if (!demo) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const key = (name) => `budget-demo:${name}`;
const readLocal = (name, fallback) => {
  try { return JSON.parse(localStorage.getItem(key(name))) ?? fallback; } catch { return fallback; }
};
const writeLocal = (name, value) => localStorage.setItem(key(name), JSON.stringify(value));

function check({ data, error }) {
  if (error) throw error;
  return data;
}

// ---- 登入 ----

export async function getUser() {
  if (demo) return { email: '示範模式' };
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function signIn(email, password) {
  check(await sb.auth.signInWithPassword({ email, password }));
}

// 回傳 true 代表需要先去信箱點確認信
export async function signUp(email, password) {
  // 確認信的連結點下去後，回到註冊時的這個網址
  const emailRedirectTo = location.origin + location.pathname;
  const data = check(await sb.auth.signUp({ email, password, options: { emailRedirectTo } }));
  return !data.session;
}

export async function signOut() {
  if (!demo) await sb.auth.signOut();
}

// ---- 設定 ----

export async function getSettings() {
  if (demo) return readLocal('settings', null);
  return check(await sb.from('settings').select('*').maybeSingle());
}

export async function saveSettings(settings) {
  if (demo) return writeLocal('settings', settings);
  const user = await getUser();
  check(await sb.from('settings').upsert({ ...settings, user_id: user.id }));
}

// ---- 一般資料表 ----

export async function list(table) {
  if (demo) return readLocal(table, []);
  return check(await sb.from(table).select('*'));
}

export async function insert(table, row) {
  row = { id: crypto.randomUUID(), ...row };
  if (demo) {
    const rows = readLocal(table, []);
    if (row.source === 'allowance' && rows.some((r) => r.source === 'allowance' && r.date === row.date)) {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    }
    writeLocal(table, [...rows, row]);
    return;
  }
  check(await sb.from(table).insert(row));
}

export async function update(table, id, patch) {
  if (demo) return writeLocal(table, readLocal(table, []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  check(await sb.from(table).update(patch).eq('id', id));
}

export async function remove(table, id) {
  if (demo) {
    writeLocal(table, readLocal(table, []).filter((r) => r.id !== id));
    // 模擬資料庫的 on delete cascade
    if (table === 'payment_methods') writeLocal('purchases', readLocal('purchases', []).filter((p) => p.method_id !== id));
    return;
  }
  check(await sb.from(table).delete().eq('id', id));
}
