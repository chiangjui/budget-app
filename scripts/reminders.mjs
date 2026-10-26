// 決定今天要提醒什麼（純計算，不碰網路，方便測試）
import { buildBills, recurringDue, daysBetween, addDays, parse } from '../js/calc.js';

// 到期前 3、2、1 天各提醒一次
export const REMIND_DAYS = [3, 2, 1];

// 某位使用者今天要提醒的帳單和固定支出
export function dueSoon({ methods, purchases, transactions, recurring }, today) {
  const last = addDays(today, Math.max(...REMIND_DAYS));
  const items = [];
  for (const b of buildBills(methods, purchases, transactions)) {
    const days = daysBetween(today, b.due);
    if (b.remaining > 0 && REMIND_DAYS.includes(days)) items.push({ type: 'bill', name: b.method_name, amount: b.remaining, due: b.due, days });
  }
  for (const o of recurringDue(recurring, transactions, last)) {
    const days = daysBetween(today, o.date);
    if (REMIND_DAYS.includes(days)) items.push({ type: 'recurring', name: o.recurring.name, amount: o.amount, due: o.date, days });
  }
  return items.sort((a, b) => a.days - b.days);
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const md = (s) => `${parse(s).getMonth() + 1}/${parse(s).getDate()}`;

// 組成通知的標題和內容
export function message(items, lang = 'zh') {
  if (lang === 'en') {
    const line = (it) => `${it.type === 'bill' ? `${it.name} bill` : it.name} ${money(it.amount)} — due in ${it.days} day${it.days === 1 ? '' : 's'} (${md(it.due)})`;
    return {
      title: items.length === 1 ? 'Payment reminder' : `Payment reminder: ${items.length} due soon`,
      body: items.map(line).join('\n'),
    };
  }
  const line = (it) => `${it.type === 'bill' ? `${it.name} 帳單` : it.name} ${money(it.amount)}｜再 ${it.days} 天（${md(it.due)}）`;
  return {
    title: items.length === 1 ? '繳款提醒' : `繳款提醒：${items.length} 筆快到期`,
    body: items.map(line).join('\n'),
  };
}
