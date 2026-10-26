// 每天由 GitHub Actions 執行：找出 3 天內要繳的款項，推播到每位使用者開了通知的裝置
//
// 需要的環境變數：
//   SUPABASE_SECRET_KEY  Supabase 的 secret key（可以讀所有使用者的資料，只放在 GitHub Secrets）
//   VAPID_PRIVATE_KEY    推播私鑰（只放在 GitHub Secrets）
//   TZ=Asia/Taipei       用台灣時間判斷「今天」
// 選用：
//   DRY_RUN=1            只印出會送什麼，不真的送
//   TEST=1               不管有沒有到期，送一則測試通知給所有裝置
import webpush from 'web-push';
import { SUPABASE_URL, VAPID_PUBLIC_KEY } from '../config.js';
import { today } from '../js/calc.js';
import { dueSoon, message } from './reminders.mjs';

const { SUPABASE_SECRET_KEY, VAPID_PRIVATE_KEY, DRY_RUN, TEST } = process.env;
if (!SUPABASE_SECRET_KEY || !VAPID_PRIVATE_KEY) {
  console.error('缺少 SUPABASE_SECRET_KEY 或 VAPID_PRIVATE_KEY');
  process.exit(1);
}

// 新版 secret key（sb_secret_…）只放 apikey；舊版 service_role JWT 兩個 header 都要
const headers = { apikey: SUPABASE_SECRET_KEY };
if (!SUPABASE_SECRET_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;

async function rows(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, { headers });
  if (!res.ok) throw new Error(`讀取 ${table} 失敗：${res.status} ${await res.text()}`);
  return res.json();
}

async function removeSubscription(endpoint) {
  await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE', headers });
}

webpush.setVapidDetails('https://chiangjui.github.io/budget-app/', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const day = today();
const [subs, methods, purchases, transactions, recurring] = await Promise.all(
  ['push_subscriptions', 'payment_methods', 'purchases', 'transactions', 'recurring'].map(rows),
);
const mine = (list, userId) => list.filter((r) => r.user_id === userId);

let sent = 0;
for (const userId of new Set(subs.map((s) => s.user_id))) {
  const items = dueSoon({
    methods: mine(methods, userId),
    purchases: mine(purchases, userId),
    transactions: mine(transactions, userId),
    recurring: mine(recurring, userId),
  }, day);
  if (!items.length && !TEST) continue;

  for (const sub of mine(subs, userId)) {
    const msg = items.length
      ? message(items, sub.lang)
      : sub.lang === 'en'
        ? { title: 'Payment reminder (test)', body: 'Push notifications are working. Nothing is due in the next 3 days.' }
        : { title: '繳款提醒（測試）', body: '推播正常運作。未來 3 天沒有要繳的款項。' };
    const payload = JSON.stringify({ ...msg, tag: `due-${day}`, url: './' });
    if (DRY_RUN) {
      console.log(`[dry run] ${userId.slice(0, 8)} → ${msg.title}\n${msg.body}`);
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
    } catch (e) {
      // 404／410 = 這台裝置已經取消通知或重裝，刪掉這筆訂閱
      if (e.statusCode === 404 || e.statusCode === 410) await removeSubscription(sub.endpoint);
      else console.error(`推播失敗 (${e.statusCode}): ${e.body || e.message}`);
    }
  }
}

console.log(`${day}：${subs.length} 台裝置，送出 ${sent} 則通知`);
