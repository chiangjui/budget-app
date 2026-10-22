// 計算核心：帳單歸期、餘額、未來現金流、安全可花金額
// 日期一律用 'YYYY-MM-DD' 字串（本地時間），字串比大小 = 日期比先後

const pad = (n) => String(n).padStart(2, '0');
export const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => fmt(new Date());
export const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
};
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

// 某年某月的第 day 天；月份可超出 0–11，日期超過月底就取月底（例如 31 號在 2 月 → 28/29 號）
function dayOfMonth(y, m0, day) {
  const first = new Date(y, m0, 1);
  const Y = first.getFullYear();
  const M = first.getMonth();
  return new Date(Y, M, Math.min(day, daysInMonth(Y, M)));
}

// 零用錢入帳日（每月 5、20 號）中，after < 日期 <= upto 的那些
export function allowanceDates(after, upto) {
  const out = [];
  const start = parse(after);
  const end = parse(upto);
  for (let y = start.getFullYear(), m = start.getMonth(); y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth()); ) {
    for (const day of [5, 20]) {
      const d = fmt(new Date(y, m, day));
      if (d > after && d <= upto) out.push(d);
    }
    if (++m === 12) { m = 0; y++; }
  }
  return out;
}

// 一筆消費（第 offset 期）要在哪天繳款
// 結帳日當天（含）以前的消費算這個月的帳單，之後的算下個月；
// 繳款日比結帳日大 → 同月繳，否則下個月繳
export function dueDateFor(purchaseDate, method, offset = 0) {
  const p = parse(purchaseDate);
  const y = p.getFullYear();
  let m = p.getMonth() + offset;
  if (p.getDate() > Math.min(method.closing_day, daysInMonth(y, p.getMonth()))) m++;
  const closing = dayOfMonth(y, m, method.closing_day);
  const dueMonth = closing.getMonth() + (method.due_day > method.closing_day ? 0 : 1);
  return fmt(dayOfMonth(closing.getFullYear(), dueMonth, method.due_day));
}

// 把分期總額拆成每期金額，除不盡的零頭放第一期
export function splitInstallments(amount, n) {
  const base = Math.floor(amount / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? amount - base * (n - 1) : base));
}

// 把所有先用後付的消費歸到各張帳單（付款方式 + 繳款日），並扣掉已還的金額
export function buildBills(methods, purchases, transactions) {
  const byId = Object.fromEntries(methods.map((m) => [m.id, m]));
  const bills = new Map();
  for (const p of purchases) {
    const method = byId[p.method_id];
    if (!method) continue;
    const n = Math.max(1, Number(p.installments) || 1);
    splitInstallments(Number(p.amount), n).forEach((amount, i) => {
      const due = dueDateFor(p.date, method, i);
      const key = `${method.id}|${due}`;
      if (!bills.has(key)) bills.set(key, { key, method_id: method.id, method_name: method.name, due, total: 0, paid: 0, items: [] });
      const bill = bills.get(key);
      bill.total += amount;
      bill.items.push({ purchase: p, amount, index: i + 1, of: n });
    });
  }
  for (const t of transactions) {
    if (t.kind !== 'repayment') continue;
    const bill = bills.get(`${t.method_id}|${t.bill_due}`);
    if (bill) bill.paid += Number(t.amount);
  }
  return [...bills.values()]
    .map((b) => ({ ...b, remaining: Math.max(0, b.total - b.paid) }))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

// 固定支出中，到 upto 為止還沒付的每一期
export function recurringDue(recurring, transactions, upto) {
  const paid = new Set(transactions.filter((t) => t.recurring_id).map((t) => `${t.recurring_id}|${t.recurring_date}`));
  const out = [];
  for (const r of recurring) {
    if (r.active === false) continue;
    const start = parse(r.start_date);
    for (let i = 0; ; i++) {
      const date = fmt(dayOfMonth(start.getFullYear(), start.getMonth() + i, Number(r.day)));
      if (date > upto) break;
      if (date < r.start_date || paid.has(`${r.id}|${date}`)) continue;
      out.push({ recurring: r, date, amount: Number(r.amount) });
    }
  }
  return out;
}

// 目前手上的錢 = 起始金額 + 收入 − 即時支出 − 還款
export function currentBalance(settings, transactions) {
  return transactions.reduce(
    (sum, t) => sum + (t.kind === 'income' ? 1 : -1) * Number(t.amount),
    Number(settings.opening_balance) || 0,
  );
}

// 核心：模擬未來每一筆進帳和還款，找出餘額最低的那一刻。
// 現在多花 1 塊，未來每一刻都少 1 塊，所以「最低點 − 安全墊」就是現在最多能花的錢。
// extraPurchases：試算用，假設多刷了這些先用後付
export function forecast(state, t = today(), extraPurchases = []) {
  const { settings, methods, transactions, recurring } = state;
  const balance = currentBalance(settings, transactions);
  const bills = buildBills(methods, [...state.purchases, ...extraPurchases], transactions);
  const unpaid = bills.filter((b) => b.remaining > 0);

  let horizon = addDays(t, 62);
  if (unpaid.length && unpaid[unpaid.length - 1].due > horizon) horizon = unpaid[unpaid.length - 1].due;

  const events = [];
  for (const b of unpaid) {
    events.push({ type: 'bill', date: b.due < t ? t : b.due, due: b.due, amount: -b.remaining, label: `${b.method_name} 帳單`, key: b.key, overdue: b.due < t });
  }
  for (const o of recurringDue(recurring, transactions, horizon)) {
    events.push({ type: 'recurring', date: o.date < t ? t : o.date, due: o.date, amount: -o.amount, label: o.recurring.name, rid: o.recurring.id, overdue: o.date < t });
  }
  for (const d of allowanceDates(t, horizon)) {
    const day = Number(d.slice(8));
    const amount = Number(day === 5 ? settings.allowance_5 : settings.allowance_20) || 0;
    if (amount > 0) events.push({ type: 'allowance', date: d, due: d, amount, label: `${day} 號零用錢` });
  }
  // 同一天先進帳再扣款
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));

  let running = balance;
  let min = balance;
  let minDate = t;
  for (const e of events) {
    running += e.amount;
    e.running = running;
    if (running < min) { min = running; minDate = e.date; }
  }

  const reserve = Number(settings.reserve) || 0;
  const safe = min - reserve;
  const nextAllowance = allowanceDates(t, addDays(t, 40))[0];
  const daysLeft = daysBetween(t, nextAllowance);

  return {
    balance,
    safe,
    minDate,
    reserve,
    events,
    bills,
    unpaid,
    unpaidTotal: unpaid.reduce((s, b) => s + b.remaining, 0),
    nextAllowance,
    daysLeft,
    daily: Math.max(0, safe) / daysLeft,
  };
}
