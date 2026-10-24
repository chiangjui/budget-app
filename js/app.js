import * as db from './db.js';
import { today, parse, addDays, forecast, installmentDue, hasSchedule, splitInstallments, recurringDue, allowanceDates, currentBalance } from './calc.js';
import { t, lang, setLang, category, weekday } from './i18n.js';

// 分類存進資料庫時用中文，顯示時再翻譯
const CATEGORIES = ['餐飲', '交通', '娛樂', '購物', '學習', '生活', '其他'];
const TABLES = ['payment_methods', 'purchases', 'transactions', 'recurring'];

const state = {
  user: null,
  settings: null,
  payment_methods: [],
  purchases: [],
  transactions: [],
  recurring: [],
  tab: 'home',
  addMode: 'expense',
  month: today().slice(0, 7),
};

const $app = document.getElementById('app');

// ---- 小工具 ----

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mdShort = (s) => {
  const d = parse(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const md = (s) => (lang === 'zh' ? `${mdShort(s)}（${weekday(parse(s).getDay())}）` : `${mdShort(s)} (${weekday(parse(s).getDay())})`);
const calcState = () => ({ ...state, methods: state.payment_methods });

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// 彈出小表單，回傳填好的值；按取消回傳 null
function ask(title, fieldsHtml, okText = t('confirm')) {
  const dialog = document.getElementById('dialog');
  const form = document.getElementById('dialog-form');
  form.innerHTML = `<div class="stack" style="display:grid;gap:12px">
    <h3>${esc(title)}</h3>${fieldsHtml}
    <div class="actions"><button value="cancel" class="secondary" formnovalidate>${t('cancel')}</button><button value="ok">${esc(okText)}</button></div>
  </div>`;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? Object.fromEntries(new FormData(form)) : null);
    }, { once: true });
  });
}

// ---- 資料載入 ----

// 把 5 號、20 號的零用錢自動記成收入（只補到今天，刪掉的不會再長回來）
async function generateAllowances() {
  const s = state.settings;
  const t0 = today();
  const from = s.generated_through || s.start_date;
  if (from >= t0) return;
  for (const date of allowanceDates(from, t0)) {
    const day = Number(date.slice(8));
    const amount = Number(day === 5 ? s.allowance_5 : s.allowance_20);
    if (!(amount > 0)) continue;
    try {
      await db.insert('transactions', { date, kind: 'income', amount, category: '零用錢', note: `${day} 號零用錢`, source: 'allowance' });
    } catch (e) {
      if (e.code !== '23505') throw e;
    }
  }
  s.generated_through = t0;
  await db.saveSettings(s);
}

async function loadAll() {
  state.settings = await db.getSettings();
  if (state.settings) await generateAllowances();
  const rows = await Promise.all(TABLES.map((name) => db.list(name)));
  TABLES.forEach((name, i) => { state[name] = rows[i]; });
}

async function boot() {
  try {
    state.user = await db.getUser();
    if (!state.user) return renderLogin();
    await loadAll();
    render();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="auth"><h1>${t('errorTitle')}</h1><p>${esc(e.message)}</p><button data-action="reload">${t('reload')}</button></div>`;
  }
}

// 依目前狀態重畫整個畫面（切換語言時用）
const rerender = () => (state.user ? render() : renderLogin());

// 執行一個會改資料的動作，完成後重新載入畫面
async function mutate(fn, msg) {
  try {
    await fn();
    await loadAll();
    render();
    if (msg) toast(msg);
  } catch (e) {
    console.error(e);
    toast(t('failed', e.message));
  }
}

// 細線圖示（stroke 1.5、直角）
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>',
  add: '<path d="M12 4v16M4 12h16"/>',
  bills: '<path d="M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21z"/><path d="M9 8h6M9 12h6"/>',
  history: '<path d="M12 6v15"/><path d="M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><path d="M14 5h4v4h-4zM8 15h4v4H8z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter" aria-hidden="true">${ICONS[name]}</svg>`;

// 中／EN 切換
const langToggle = () => `<div class="lang" role="group" aria-label="${t('langGroup')}">
  ${[['zh', '中'], ['en', 'EN']].map(([id, label]) => `<button type="button" data-action="lang" data-lang="${id}" class="${lang === id ? 'on' : ''}" aria-pressed="${lang === id}">${label}</button>`).join('')}
</div>`;

// 刊頭：日期線 + 大標題 + 粗線
function masthead() {
  const d = today();
  return `<header class="mast">
    <div class="mast-meta"><span>${d.replaceAll('-', '.')} · ${lang === 'zh' ? `週${weekday(parse(d).getDay())}` : weekday(parse(d).getDay())}</span>${langToggle()}</div>
    <h1>${esc(t('appName'))}</h1>
    <div class="rule"></div>
  </header>`;
}

// ---- 畫面：登入、初次設定 ----

function renderLogin() {
  $app.innerHTML = `
  <div class="auth">
    <div class="kicker"><span>${t('kicker')}</span>${langToggle()}</div>
    <h1>${t('appNameHtml')}</h1>
    <div class="rule"></div>
    <p class="lede">${t('tagline')}</p>
    <form class="stack card" data-form="login">
      <label>${t('email')}<input type="email" name="email" required autocomplete="email"></label>
      <label>${t('password')}<input type="password" name="password" required minlength="6" autocomplete="current-password"><span class="hint">${t('passwordHint')}</span></label>
      <div class="buttons">
        <button value="in">${t('login')}</button>
        <button value="up" class="secondary">${t('signup')}</button>
      </div>
    </form>
  </div>`;
}

function renderSetup() {
  $app.innerHTML = `
  <div class="auth">
    <div class="kicker"><span>${t('setupKicker')}</span>${langToggle()}</div>
    <h1>${t('setupTitleHtml')}</h1>
    <div class="rule"></div>
    <p class="lede">${t('setupLede')}</p>
    <form class="stack card" data-form="setup">
      <label>${t('openingBalance')}<input type="number" name="opening_balance" required inputmode="numeric" step="any"><span class="hint">${t('openingHint')}</span></label>
      <div class="grid2">
        <label>${t('allowance5Full')}<input type="number" name="allowance_5" required inputmode="numeric" min="0" step="any"></label>
        <label>${t('allowance20Full')}<input type="number" name="allowance_20" required inputmode="numeric" min="0" step="any"></label>
      </div>
      <label>${t('reserve')}<input type="number" name="reserve" value="0" inputmode="numeric" min="0" step="any"><span class="hint">${t('reserveSetupHint')}</span></label>
      <button>${t('start')}</button>
    </form>
  </div>`;
}

// ---- 畫面：主架構 ----

function render() {
  if (!state.settings) return renderSetup();
  const f = forecast(calcState());
  const views = { home: viewHome, add: viewAdd, bills: viewBills, history: viewHistory, settings: viewSettings };
  const tabs = [
    ['home', t('tabHome')],
    ['add', t('tabAdd')],
    ['bills', t('tabBills')],
    ['history', t('tabHistory')],
    ['settings', t('tabSettings')],
  ];
  $app.innerHTML = `
    ${masthead()}
    ${db.demo ? `<div class="banner"><b class="badge">${t('demoBadge')}</b><span>${t('demoText')}</span></div>` : ''}
    ${views[state.tab](f)}
    <nav class="tabs" aria-label="${t('mainNav')}"><div class="inner">
      ${tabs.map(([id, name]) => `<button data-action="tab" data-tab="${id}" class="${state.tab === id ? 'on' : ''}" ${state.tab === id ? 'aria-current="page"' : ''}>${icon(id)}${name}</button>`).join('')}
    </div></nav>`;
  if (state.tab === 'add' && state.addMode === 'bnpl') updateBnplPreview();
}

// 未來事件的顯示名稱
function eventLabel(e) {
  if (e.type === 'bill') return t('billLabel', e.name);
  if (e.type === 'allowance') return t('allowanceLabel', e.day);
  return e.name;
}

// 一筆未來事件（進帳／帳單／固定支出）的列
function eventRow(e, { showRunning = false, warnBelow = null } = {}) {
  const warn = warnBelow !== null && e.running < warnBelow;
  const tag = e.overdue ? `<span class="badge">${t('overdueOn', md(e.due))}</span>` : '';
  let button = '';
  if (e.type === 'bill') button = `<button class="small secondary" data-action="pay-bill" data-key="${esc(e.key)}">${t('pay')}</button>`;
  if (e.type === 'recurring') button = `<button class="small secondary" data-action="pay-rec" data-id="${esc(e.rid)}" data-date="${e.due}">${t('markPaid')}</button>`;
  return `<div class="row ${warn ? 'warn' : ''}">
    <div class="main"><div class="title">${esc(eventLabel(e))}${tag}</div><div class="meta">${md(e.date)}</div></div>
    <div class="amt ${e.amount > 0 ? 'plus' : 'minus'}">${e.amount > 0 ? '+' : ''}${money(e.amount)}${showRunning ? `<span class="run">${t('left', money(e.running))}</span>` : ''}</div>
    ${button}
  </div>`;
}

// ---- 首頁 ----

function viewHome(f) {
  const ok = f.safe >= 0;
  const reserve = f.reserve > 0 ? money(f.reserve) : '';
  const outflows = f.events.filter((e) => e.amount < 0).slice(0, 4);
  const timeline = f.events.filter((e) => e.date <= addDays(today(), 62));
  return `
  <section class="hero ${ok ? 'ok' : 'bad'}">
    <div class="label">${ok ? t('safeOk') : t('safeBad')}</div>
    <div class="big"><span class="cur">$</span>${Math.round(Math.max(0, f.safe)).toLocaleString('en-US')}</div>
    <div class="sub">${ok ? t('subOk', reserve) : t('subBad', f.minDate === today() ? '' : md(f.minDate), money(-f.safe), reserve)}</div>
  </section>
  <div class="stats">
    <div class="stat"><div class="k">${t('balance')}</div><div class="v">${money(f.balance)}</div></div>
    <div class="stat"><div class="k">${t('unpaid')}</div><div class="v">${money(f.unpaidTotal)}</div></div>
    <div class="stat"><div class="k">${t('nextAllowance')}</div><div class="v">${mdShort(f.nextAllowance)}</div><div class="h">${t('daysLeft', f.daysLeft)}</div></div>
    <div class="stat"><div class="k">${t('perDay')}</div><div class="v">${money(f.daily)}</div><div class="h">${t('untilNext')}</div></div>
  </div>
  <h2>${t('upcoming')}</h2>
  <div class="list">${outflows.length ? outflows.map((e) => eventRow(e)).join('') : `<div class="empty">${t('noBills')}</div>`}</div>
  <h2>${t('cashflow')}</h2>
  <div class="list">
    <div class="row"><div class="main"><div class="title">${t('today')}</div><div class="meta">${md(today())}</div></div><div class="amt">${money(f.balance)}</div></div>
    ${timeline.map((e) => eventRow(e, { showRunning: true, warnBelow: f.reserve })).join('')}
  </div>
  <p class="footnote">${t('footnote', f.reserve > 0)}</p>`;
}

// ---- 記一筆 ----

const categoryChips = (name = 'category', checked = '餐飲') =>
  `<div class="chips">${CATEGORIES.map((c) => `<label><input type="radio" name="${name}" value="${c}" ${c === checked ? 'checked' : ''}><span>${category(c)}</span></label>`).join('')}</div>`;

function viewAdd() {
  const modes = [['expense', t('modeExpense')], ['bnpl', t('modeBnpl')], ['income', t('modeIncome')]];
  const dateNote = (dateLabel) => `<div class="grid2"><label>${dateLabel}<input type="date" name="date" value="${today()}" required></label><label>${t('note')}<input name="note" placeholder="${t('optional')}"></label></div>`;
  let form = '';
  if (state.addMode === 'expense') {
    form = `<form class="stack card" data-form="expense">
      <label>${t('amount')}<input type="number" name="amount" required min="1" step="any" inputmode="decimal" autofocus></label>
      ${categoryChips()}
      ${dateNote(t('date'))}
      <button>${t('record')}</button>
    </form>`;
  } else if (state.addMode === 'bnpl') {
    const methods = state.payment_methods;
    form = methods.length
      ? `<form class="stack card" data-form="bnpl">
        <label>${t('totalAmount')}<input type="number" name="amount" required min="1" step="any" inputmode="decimal" autofocus></label>
        <div class="grid2">
          <label>${t('method')}<select name="method_id">${methods.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>
          <label>${t('installments')}<select name="installments">${[1, 3, 6, 12, 24].map((n) => `<option value="${n}">${n === 1 ? t('noInstallment') : t('nInstallments', n)}</option>`).join('')}</select></label>
        </div>
        ${categoryChips('category', '購物')}
        ${dateNote(t('purchaseDate'))}
        <div class="due-block">
          <label class="check"><input type="checkbox" name="manual_due" value="1"><span>${t('manualDue')}</span></label>
          <p class="footnote due-forced" hidden>${t('dueForced')}</p>
          <label class="due-field" hidden>${t('dueDate')}<input type="date" name="due_date"><span class="hint">${t('dueDateHint')}</span></label>
        </div>
        <div class="preview" id="bnpl-preview"></div>
        <button>${t('record')}</button>
      </form>`
      : `<div class="card"><p style="margin-top:0">${t('noMethods')}</p><button data-action="tab" data-tab="settings">${t('goSettings')}</button></div>`;
  } else {
    form = `<form class="stack card" data-form="income">
      <label>${t('amount')}<input type="number" name="amount" required min="1" step="any" inputmode="decimal" autofocus></label>
      <div class="grid2"><label>${t('date')}<input type="date" name="date" value="${today()}" required></label><label>${t('source')}<input name="note" placeholder="${t('sourcePlaceholder')}"></label></div>
      <p class="footnote" style="margin:0">${t('autoAllowance')}</p>
      <button>${t('record')}</button>
    </form>`;
  }
  return `<div class="seg">${modes.map(([id, name]) => `<button data-action="add-mode" data-mode="${id}" class="${state.addMode === id ? 'on' : ''}">${name}</button>`).join('')}</div>${form}`;
}

// 「自己填繳款日」的開關：沒有結帳日的付款方式一定要填。回傳這筆是不是自己填
function syncDueField(form, method) {
  const check = form.elements.manual_due;
  const input = form.elements.due_date;
  const forced = !hasSchedule(method);
  if (forced) check.checked = true;
  check.disabled = forced;
  form.querySelector('.due-forced').hidden = !forced;
  form.querySelector('.due-field').hidden = !check.checked;
  input.required = check.checked;
  // 剛打開時先帶入照結帳日算出來的日期，方便直接改
  if (check.checked && !input.value && !forced) input.value = installmentDue({ date: form.elements.date.value || today() }, method);
  return check.checked;
}

// 先用後付：即時顯示什麼時候要繳、刷下去之後還能花多少
function updateBnplPreview() {
  const form = $app.querySelector('form[data-form="bnpl"]');
  const box = document.getElementById('bnpl-preview');
  if (!form || !box) return;
  const method = state.payment_methods.find((m) => m.id === form.elements.method_id.value);
  const manual = method ? syncDueField(form, method) : false;
  const d = Object.fromEntries(new FormData(form));
  const amount = Number(d.amount);
  if (!(amount > 0) || !method || !d.date || (manual && !d.due_date)) { box.textContent = ''; return; }
  const n = Number(d.installments);
  const purchase = { id: 'preview', method_id: method.id, date: d.date, amount, installments: n, due_date: manual ? d.due_date : null };
  const parts = splitInstallments(amount, n);
  const dues = parts.map((_, i) => installmentDue(purchase, method, i));
  const after = forecast(calcState(), today(), [purchase]);
  const when = n === 1 ? t('previewOnce', md(dues[0]), money(amount)) : t('previewSplit', md(dues[0]), money(parts[1]), md(dues[n - 1]));
  box.className = `preview ${after.safe < 0 ? 'bad' : ''}`;
  box.innerHTML = after.safe < 0
    ? `${when}<br><strong>${t('previewBad', md(after.minDate), money(-after.safe))}</strong>`
    : `${when}<br>${t('previewOk', money(after.safe))}`;
}

// ---- 帳單 ----

function viewBills(f) {
  const unpaid = f.unpaid;
  const paid = f.bills.filter((b) => b.remaining <= 0).reverse().slice(0, 6);
  const recDue = recurringDue(state.recurring, state.transactions, addDays(today(), 31));
  const billRow = (b) => `<div class="row">
    <div class="main">
      <div class="title">${esc(b.method_name)}${b.due < today() && b.remaining > 0 ? `<span class="badge">${t('overdue')}</span>` : ''}${b.paid > 0 && b.remaining > 0 ? `<span class="badge info">${t('partlyPaid')}</span>` : ''}</div>
      <div class="meta">${t('billMeta', md(b.due), money(b.total), b.paid > 0 ? money(b.paid) : '')}</div>
      <details class="items"><summary>${t('nItems', b.items.length)}</summary>
        ${b.items.map((it) => `<div>${mdShort(it.purchase.date)} ${esc(it.purchase.note || category(it.purchase.category) || '')} ${money(it.amount)}${it.of > 1 ? t('installmentOf', it.index, it.of) : ''}</div>`).join('')}
      </details>
    </div>
    <div class="amt">${money(b.remaining > 0 ? b.remaining : b.total)}</div>
    ${b.remaining > 0 ? `<button class="small secondary" data-action="pay-bill" data-key="${esc(b.key)}">${t('pay')}</button>` : ''}
  </div>`;
  return `
  <h2>${t('unpaidBills', money(f.unpaidTotal))}</h2>
  <div class="list">${unpaid.length ? unpaid.map(billRow).join('') : `<div class="empty">${t('allPaid')}</div>`}</div>
  <h2>${t('recurringSoon')}</h2>
  <div class="list">${recDue.length
    ? recDue.map((o) => eventRow({ type: 'recurring', name: o.recurring.name, date: o.date, due: o.date, amount: -o.amount, rid: o.recurring.id, overdue: o.date < today() })).join('')
    : `<div class="empty">${t('noRecurring')}</div>`}</div>
  ${paid.length ? `<h2>${t('recentlyPaid')}</h2><div class="list">${paid.map(billRow).join('')}</div>` : ''}`;
}

async function payBill(key) {
  const bill = forecast(calcState()).bills.find((b) => b.key === key);
  if (!bill) return;
  const v = await ask(t('payTitle', bill.method_name, md(bill.due)), `
    <label>${t('repayAmount')}<input type="number" name="amount" value="${bill.remaining}" min="1" step="any" required></label>
    <label>${t('repayDate')}<input type="date" name="date" value="${today()}" required></label>`, t('confirmRepay'));
  if (!v) return;
  await mutate(() => db.insert('transactions', {
    date: v.date, kind: 'repayment', amount: Number(v.amount), category: '還款', note: `${bill.method_name} ${bill.due} 帳單`,
    method_id: bill.method_id, bill_due: bill.due,
  }), t('repaid'));
}

async function payRecurring(id, date) {
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return;
  const v = await ask(`${r.name} (${md(date)})`, `
    <label>${t('actualPaid')}<input type="number" name="amount" value="${r.amount}" min="0" step="any" required><span class="hint">${t('zeroHint')}</span></label>
    <label>${t('payDate')}<input type="date" name="date" value="${today()}" required></label>`);
  if (!v) return;
  await mutate(() => db.insert('transactions', {
    date: v.date, kind: 'expense', amount: Number(v.amount), category: '生活', note: r.name, recurring_id: r.id, recurring_date: date,
  }), t('recorded'));
}

// ---- 明細 ----

function viewHistory() {
  const m = state.month;
  const methodName = Object.fromEntries(state.payment_methods.map((x) => [x.id, x.name]));
  const items = [
    ...state.transactions.filter((tx) => tx.date.startsWith(m)).map((tx) => ({ ...tx, table: 'transactions' })),
    ...state.purchases.filter((p) => p.date.startsWith(m)).map((p) => ({ ...p, table: 'purchases', kind: 'bnpl' })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))));

  // 花費統計：一般支出 + 先用後付（以消費當下算），還款不重複算
  const byCat = {};
  for (const it of items) {
    if (it.kind === 'expense' || it.kind === 'bnpl') byCat[it.category || '其他'] = (byCat[it.category || '其他'] || 0) + Number(it.amount);
  }
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const spent = cats.reduce((s, [, v]) => s + v, 0);
  const income = items.filter((i) => i.kind === 'income').reduce((s, i) => s + Number(i.amount), 0);

  const kindLabel = { income: t('kindIncome'), expense: t('kindExpense'), repayment: t('kindRepayment'), bnpl: t('kindBnpl') };
  // 自動產生的紀錄（零用錢、還款、校正）用目前語言重組標題；其他用使用者自己打的備註
  const title = (it) => {
    if (it.source === 'allowance') return t('allowanceLabel', Number(it.date.slice(8)));
    if (it.kind === 'repayment' && it.bill_due && methodName[it.method_id]) return t('repayNote', methodName[it.method_id], md(it.bill_due));
    if (it.source === 'adjust' || it.note === '餘額校正') return t('adjustNote');
    return it.note || category(it.category) || kindLabel[it.kind];
  };
  const row = (it) => {
    const sign = it.kind === 'income' ? '+' : '-';
    const meta = it.kind === 'bnpl'
      ? `${esc(methodName[it.method_id] ?? '')}${it.installments > 1 ? ` · ${t('splitInto', it.installments)}` : ''}${it.due_date ? ` · ${t('dueOn', md(it.due_date))}` : ''}`
      : kindLabel[it.kind];
    const showCategory = (it.kind === 'expense' || it.kind === 'bnpl') && it.note && it.category;
    return `<div class="row">
      <div class="main"><div class="title">${esc(title(it))}</div><div class="meta">${md(it.date)} · ${meta}${showCategory ? ` · ${esc(category(it.category))}` : ''}</div></div>
      <div class="amt ${it.kind === 'income' ? 'plus' : 'minus'}">${sign}${money(Number(it.amount))}</div>
      <button class="danger" data-action="delete" data-table="${it.table}" data-id="${esc(it.id)}" aria-label="${t('delete')}">✕</button>
    </div>`;
  };

  return `
  <label style="margin-top:24px">${t('month')}<input type="month" value="${m}" data-input="month"></label>
  <div class="stats two">
    <div class="stat"><div class="k">${t('spentThisMonth')}</div><div class="v">${money(spent)}</div><div class="h">${t('inclBnpl')}</div></div>
    <div class="stat"><div class="k">${t('incomeThisMonth')}</div><div class="v">${money(income)}</div></div>
  </div>
  ${cats.length ? `<h2>${t('whereSpent')}</h2><div class="card">${cats.map(([c, v]) => `
    <div class="cat"><div class="top"><span>${esc(category(c))}</span><span class="num">${money(v)}</span></div>
    <div class="track"><div class="bar" style="width:${Math.max(2, (v / cats[0][1]) * 100)}%"></div></div></div>`).join('')}</div>` : ''}
  <h2>${t('everyItem')}</h2>
  <div class="list">${items.length ? items.map(row).join('') : `<div class="empty">${t('noRecords')}</div>`}</div>`;
}

// ---- 設定 ----

function viewSettings(f) {
  const s = state.settings;
  return `
  <h2>${t('allowanceSection')}</h2>
  <form class="stack card" data-form="settings">
    <div class="grid2">
      <label>${t('day5')}<input type="number" name="allowance_5" value="${s.allowance_5}" min="0" step="any" required></label>
      <label>${t('day20')}<input type="number" name="allowance_20" value="${s.allowance_20}" min="0" step="any" required></label>
    </div>
    <label>${t('reserve')}<input type="number" name="reserve" value="${s.reserve}" min="0" step="any" required><span class="hint">${t('reserveHint')}</span></label>
    <button>${t('save')}</button>
  </form>

  <h2>${t('adjustTitle')}</h2>
  <form class="stack card" data-form="adjust">
    <label>${t('actualBalance')}<input type="number" name="actual" step="any" required placeholder="${t('actualPlaceholder', Math.round(f.balance))}"><span class="hint">${t('adjustHint')}</span></label>
    <button class="secondary">${t('adjust')}</button>
  </form>

  <h2>${t('methodsTitle')}</h2>
  <div class="list">${state.payment_methods.length
    ? state.payment_methods.map((m) => `<div class="row">
        <div class="main"><div class="title">${esc(m.name)}</div><div class="meta">${hasSchedule(m) ? t('methodMeta', m.closing_day, m.due_day > m.closing_day, m.due_day) : t('methodManual')}</div></div>
        <button class="danger" data-action="delete" data-table="payment_methods" data-id="${esc(m.id)}" aria-label="${t('delete')}">✕</button>
      </div>`).join('')
    : `<div class="empty">${t('none')}</div>`}</div>
  <form class="stack card" data-form="method" style="margin-top:10px">
    <label>${t('name')}<input name="name" required placeholder="${t('methodPlaceholder')}"></label>
    <label class="check"><input type="checkbox" name="no_schedule" value="1"><span>${t('noSchedule')}</span></label>
    <div class="grid2 schedule-fields">
      <label>${t('closingDay')}<input type="number" name="closing_day" min="1" max="31" required inputmode="numeric"><span class="hint">${t('closingHint')}</span></label>
      <label>${t('dueDay')}<input type="number" name="due_day" min="1" max="31" required inputmode="numeric"><span class="hint">${t('dueHint')}</span></label>
    </div>
    <button class="secondary">${t('addMethod')}</button>
  </form>

  <h2>${t('recurringTitle')}</h2>
  <div class="list">${state.recurring.length
    ? state.recurring.map((r) => `<div class="row">
        <div class="main"><div class="title">${esc(r.name)}</div><div class="meta">${t('monthlyOn', r.day)}</div></div>
        <div class="amt">${money(Number(r.amount))}</div>
        <button class="danger" data-action="delete" data-table="recurring" data-id="${esc(r.id)}" aria-label="${t('delete')}">✕</button>
      </div>`).join('')
    : `<div class="empty">${t('none')}</div>`}</div>
  <form class="stack card" data-form="recurring" style="margin-top:10px">
    <div class="grid2">
      <label>${t('name')}<input name="name" required placeholder="${t('recurringPlaceholder')}"></label>
      <label>${t('amount')}<input type="number" name="amount" min="1" step="any" required></label>
    </div>
    <label>${t('payDay')}<input type="number" name="day" min="1" max="31" required inputmode="numeric"></label>
    <button class="secondary">${t('addRecurring')}</button>
  </form>

  <h2>${t('account')}</h2>
  <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
    <span style="overflow:hidden;text-overflow:ellipsis">${db.demo ? t('demoBadge') : esc(state.user.email)}</span>
    ${db.demo ? '' : `<button class="secondary small" data-action="logout">${t('logout')}</button>`}
  </div>`;
}

// ---- 事件處理 ----

const forms = {
  async login(d, submitter) {
    try {
      if (submitter?.value === 'up') {
        const needConfirm = await db.signUp(d.email, d.password);
        if (needConfirm) return toast(t('signupConfirm'));
      } else {
        await db.signIn(d.email, d.password);
      }
      await boot();
    } catch (e) {
      toast(e.message === 'Invalid login credentials' ? t('badLogin') : t('failed', e.message));
    }
  },
  async setup(d) {
    const t0 = today();
    await mutate(() => db.saveSettings({
      opening_balance: Number(d.opening_balance), allowance_5: Number(d.allowance_5), allowance_20: Number(d.allowance_20),
      reserve: Number(d.reserve) || 0, start_date: t0, generated_through: t0,
    }), t('setupDone'));
  },
  expense: (d) => mutate(() => db.insert('transactions', { date: d.date, kind: 'expense', amount: Number(d.amount), category: d.category, note: d.note }), t('expenseSaved')),
  income: (d) => mutate(() => db.insert('transactions', { date: d.date, kind: 'income', amount: Number(d.amount), category: '收入', note: d.note }), t('incomeSaved')),
  bnpl(d) {
    const method = state.payment_methods.find((m) => m.id === d.method_id);
    const row = { method_id: d.method_id, date: d.date, amount: Number(d.amount), installments: Number(d.installments), category: d.category, note: d.note };
    // 只有自己填繳款日時才送 due_date 欄位
    if ((d.manual_due || !hasSchedule(method)) && d.due_date) row.due_date = d.due_date;
    return mutate(() => db.insert('purchases', row), t('bnplSaved'));
  },
  settings: (d) => mutate(() => db.saveSettings({
    ...state.settings, allowance_5: Number(d.allowance_5), allowance_20: Number(d.allowance_20), reserve: Number(d.reserve),
  }), t('saved')),
  adjust(d) {
    const diff = Number(d.actual) - currentBalance(state.settings, state.transactions);
    if (Math.abs(diff) < 0.01) return toast(t('noAdjust'));
    return mutate(() => db.insert('transactions', {
      date: today(), kind: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff), category: '其他', note: '餘額校正', source: 'adjust',
    }), t('adjusted', `${diff > 0 ? '+' : ''}${money(diff)}`));
  },
  method: (d) => mutate(() => db.insert('payment_methods', d.no_schedule
    ? { name: d.name, closing_day: null, due_day: null }
    : { name: d.name, closing_day: Number(d.closing_day), due_day: Number(d.due_day) }), t('added')),
  recurring: (d) => mutate(() => db.insert('recurring', { name: d.name, amount: Number(d.amount), day: Number(d.day), start_date: today(), active: true }), t('added')),
};

$app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const handler = forms[form.dataset.form];
  if (!handler) return;
  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await handler(Object.fromEntries(new FormData(form)), e.submitter);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
});

$app.addEventListener('input', (e) => {
  if (e.target.closest('form[data-form="bnpl"]')) updateBnplPreview();
  if (e.target.name === 'no_schedule') {
    const fields = e.target.form.querySelector('.schedule-fields');
    fields.hidden = e.target.checked;
    fields.querySelectorAll('input').forEach((input) => { input.required = !e.target.checked; });
  }
  if (e.target.dataset.input === 'month' && e.target.value) {
    state.month = e.target.value;
    render();
  }
});

const deleteWarnings = {
  payment_methods: 'deleteMethod',
  recurring: 'deleteRecurring',
  purchases: 'deletePurchase',
  transactions: 'deleteTransaction',
};

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  if (action === 'tab') {
    state.tab = el.dataset.tab;
    render();
    window.scrollTo(0, 0);
  } else if (action === 'lang') {
    if (el.dataset.lang !== lang) {
      setLang(el.dataset.lang);
      rerender();
    }
  } else if (action === 'add-mode') {
    state.addMode = el.dataset.mode;
    render();
  } else if (action === 'pay-bill') {
    await payBill(el.dataset.key);
  } else if (action === 'pay-rec') {
    await payRecurring(el.dataset.id, el.dataset.date);
  } else if (action === 'delete') {
    if (confirm(t(deleteWarnings[el.dataset.table]))) await mutate(() => db.remove(el.dataset.table, el.dataset.id), t('deleted'));
  } else if (action === 'logout') {
    await db.signOut();
    state.settings = null;
    await boot();
  } else if (action === 'reload') {
    location.reload();
  }
});

document.querySelector('.loading')?.replaceChildren(t('loading'));
boot();
