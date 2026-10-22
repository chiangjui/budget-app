import * as db from './db.js';
import { today, parse, addDays, forecast, dueDateFor, splitInstallments, recurringDue, allowanceDates, currentBalance } from './calc.js';

const CATEGORIES = ['餐飲', '交通', '娛樂', '購物', '學習', '生活', '其他'];
const TABLES = ['payment_methods', 'purchases', 'transactions', 'recurring'];
const WEEK = '日一二三四五六';

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

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('zh-TW')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = (s) => {
  const d = parse(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
};
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
function ask(title, fieldsHtml, okText = '確定') {
  const dialog = document.getElementById('dialog');
  const form = document.getElementById('dialog-form');
  form.innerHTML = `<div class="stack" style="display:grid;gap:12px">
    <h3>${esc(title)}</h3>${fieldsHtml}
    <div class="actions"><button value="cancel" class="secondary" formnovalidate>取消</button><button value="ok">${esc(okText)}</button></div>
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
  const t = today();
  const from = s.generated_through || s.start_date;
  if (from >= t) return;
  for (const date of allowanceDates(from, t)) {
    const day = Number(date.slice(8));
    const amount = Number(day === 5 ? s.allowance_5 : s.allowance_20);
    if (!(amount > 0)) continue;
    try {
      await db.insert('transactions', { date, kind: 'income', amount, category: '零用錢', note: `${day} 號零用錢`, source: 'allowance' });
    } catch (e) {
      if (e.code !== '23505') throw e;
    }
  }
  s.generated_through = t;
  await db.saveSettings(s);
}

async function loadAll() {
  state.settings = await db.getSettings();
  if (state.settings) await generateAllowances();
  const rows = await Promise.all(TABLES.map((t) => db.list(t)));
  TABLES.forEach((t, i) => { state[t] = rows[i]; });
}

async function boot() {
  try {
    state.user = await db.getUser();
    if (!state.user) return renderLogin();
    await loadAll();
    render();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="auth"><h1>出了點問題</h1><p>${esc(e.message)}</p><button data-action="reload">重新整理</button></div>`;
  }
}

// 執行一個會改資料的動作，完成後重新載入畫面
async function mutate(fn, msg) {
  try {
    await fn();
    await loadAll();
    render();
    if (msg) toast(msg);
  } catch (e) {
    console.error(e);
    toast(`失敗：${e.message}`);
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

// 刊頭：日期線 + 大標題 + 粗線
function masthead(title = '零用錢管家') {
  const t = today();
  return `<header class="mast">
    <div class="mast-meta"><span>${t.replaceAll('-', '.')} · 週${WEEK[parse(t).getDay()]}</span><span>${esc(state.user?.email ?? '')}</span></div>
    <h1>${esc(title)}</h1>
    <div class="rule"></div>
  </header>`;
}

// ---- 畫面：登入、初次設定 ----

function renderLogin() {
  $app.innerHTML = `
  <div class="auth">
    <div class="kicker">The Allowance Ledger</div>
    <h1>零用錢<br>管家</h1>
    <div class="rule"></div>
    <p class="lede">知道還完帳單之後，現在還能花多少。</p>
    <form class="stack card" data-form="login">
      <label>Email<input type="email" name="email" required autocomplete="email"></label>
      <label>密碼<input type="password" name="password" required minlength="6" autocomplete="current-password"><span class="hint">至少 6 個字元</span></label>
      <div class="buttons">
        <button value="in">登入</button>
        <button value="up" class="secondary">註冊新帳號</button>
      </div>
    </form>
  </div>`;
}

function renderSetup() {
  $app.innerHTML = `
  <div class="auth">
    <div class="kicker">Step 01 — Setup</div>
    <h1>先設定<br>一下</h1>
    <div class="rule"></div>
    <p class="lede">之後都可以在「設定」裡修改。</p>
    <form class="stack card" data-form="setup">
      <label>現在手上有多少錢<input type="number" name="opening_balance" required inputmode="numeric" step="any"><span class="hint">今天已經拿到的零用錢也算進去</span></label>
      <div class="grid2">
        <label>每月 5 號零用錢<input type="number" name="allowance_5" required inputmode="numeric" min="0" step="any"></label>
        <label>每月 20 號零用錢<input type="number" name="allowance_20" required inputmode="numeric" min="0" step="any"></label>
      </div>
      <label>安全墊<input type="number" name="reserve" value="0" inputmode="numeric" min="0" step="any"><span class="hint">永遠留著不花的錢，例如 500。可以填 0。</span></label>
      <button>開始使用</button>
    </form>
  </div>`;
}

// ---- 畫面：主架構 ----

function render() {
  if (!state.settings) return renderSetup();
  const f = forecast(calcState());
  const views = { home: viewHome, add: viewAdd, bills: viewBills, history: viewHistory, settings: viewSettings };
  const tabs = [
    ['home', '首頁'],
    ['add', '記一筆'],
    ['bills', '帳單'],
    ['history', '明細'],
    ['settings', '設定'],
  ];
  $app.innerHTML = `
    ${masthead()}
    ${db.demo ? '<div class="banner"><b class="badge">示範模式</b><span>資料只存在這台瀏覽器。照 README 設定 Supabase 後就能登入、跨裝置同步。</span></div>' : ''}
    ${views[state.tab](f)}
    <nav class="tabs" aria-label="主選單"><div class="inner">
      ${tabs.map(([id, name]) => `<button data-action="tab" data-tab="${id}" class="${state.tab === id ? 'on' : ''}" ${state.tab === id ? 'aria-current="page"' : ''}>${icon(id)}${name}</button>`).join('')}
    </div></nav>`;
  if (state.tab === 'add' && state.addMode === 'bnpl') updateBnplPreview();
}

// 一筆未來事件（進帳／帳單／固定支出）的列
function eventRow(e, { showRunning = false, warnBelow = null } = {}) {
  const warn = warnBelow !== null && e.running < warnBelow;
  const tag = e.overdue ? `<span class="badge">逾期 ${md(e.due)}</span>` : '';
  let button = '';
  if (e.type === 'bill') button = `<button class="small secondary" data-action="pay-bill" data-key="${esc(e.key)}">還款</button>`;
  if (e.type === 'recurring') button = `<button class="small secondary" data-action="pay-rec" data-id="${esc(e.rid)}" data-date="${e.due}">已付</button>`;
  return `<div class="row ${warn ? 'warn' : ''}">
    <div class="main"><div class="title">${esc(e.label)}${tag}</div><div class="meta">${md(e.date)}</div></div>
    <div class="amt ${e.amount > 0 ? 'plus' : 'minus'}">${e.amount > 0 ? '+' : ''}${money(e.amount)}${showRunning ? `<span class="run">剩 ${money(e.running)}</span>` : ''}</div>
    ${button}
  </div>`;
}

// ---- 首頁 ----

function viewHome(f) {
  const ok = f.safe >= 0;
  const outflows = f.events.filter((e) => e.amount < 0).slice(0, 4);
  const timeline = f.events.filter((e) => e.date <= addDays(today(), 62));
  return `
  <section class="hero ${ok ? 'ok' : 'bad'}">
    <div class="label">${ok ? '現在可以安心花' : '現在先不要花錢'}</div>
    <div class="big"><span class="cur">$</span>${Math.round(Math.max(0, f.safe)).toLocaleString('zh-TW')}</div>
    <div class="sub">${ok
      ? `在這個金額內花錢，之後每一筆帳單都還得起${f.reserve > 0 ? `（已保留安全墊 ${money(f.reserve)}）` : ''}`
      : `${f.minDate === today() ? '現在手上的錢已經不夠' : `到 ${md(f.minDate)} 會不夠付`}，還差 ${money(-f.safe)}${f.reserve > 0 ? `（含安全墊 ${money(f.reserve)}）` : ''}`}</div>
  </section>
  <div class="stats">
    <div class="stat"><div class="k">目前手上</div><div class="v">${money(f.balance)}</div></div>
    <div class="stat"><div class="k">待還款</div><div class="v">${money(f.unpaidTotal)}</div></div>
    <div class="stat"><div class="k">下次零用錢</div><div class="v">${md(f.nextAllowance).split('（')[0]}</div><div class="h">還有 ${f.daysLeft} 天</div></div>
    <div class="stat"><div class="k">每天可花</div><div class="v">${money(f.daily)}</div><div class="h">到下次零用錢前</div></div>
  </div>
  <h2>接下來要付的</h2>
  <div class="list">${outflows.length ? outflows.map((e) => eventRow(e)).join('') : '<div class="empty">沒有待付的帳單</div>'}</div>
  <h2>未來兩個月的現金流</h2>
  <div class="list">
    <div class="row"><div class="main"><div class="title">今天</div><div class="meta">${md(today())}</div></div><div class="amt">${money(f.balance)}</div></div>
    ${timeline.map((e) => eventRow(e, { showRunning: true, warnBelow: f.reserve })).join('')}
  </div>
  <p class="footnote">斜線底的日子，錢會低於${f.reserve > 0 ? '安全墊' : ' 0'}。「可以安心花」＝整條現金流最低點的餘額。</p>`;
}

// ---- 記一筆 ----

const categoryChips = (name = 'category', checked = '餐飲') =>
  `<div class="chips">${CATEGORIES.map((c) => `<label><input type="radio" name="${name}" value="${c}" ${c === checked ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div>`;

function viewAdd() {
  const modes = [['expense', '一般支出'], ['bnpl', '先用後付'], ['income', '收入']];
  let form = '';
  if (state.addMode === 'expense') {
    form = `<form class="stack card" data-form="expense">
      <label>金額<input type="number" name="amount" required min="1" step="any" inputmode="decimal" autofocus></label>
      ${categoryChips()}
      <div class="grid2"><label>日期<input type="date" name="date" value="${today()}" required></label><label>備註<input name="note" placeholder="選填"></label></div>
      <button>記下來</button>
    </form>`;
  } else if (state.addMode === 'bnpl') {
    const methods = state.payment_methods;
    form = methods.length
      ? `<form class="stack card" data-form="bnpl">
        <label>總金額<input type="number" name="amount" required min="1" step="any" inputmode="decimal" autofocus></label>
        <div class="grid2">
          <label>付款方式<select name="method_id">${methods.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>
          <label>分幾期<select name="installments">${[1, 3, 6, 12, 24].map((n) => `<option value="${n}">${n === 1 ? '不分期' : `${n} 期`}</option>`).join('')}</select></label>
        </div>
        ${categoryChips('category', '購物')}
        <div class="grid2"><label>消費日期<input type="date" name="date" value="${today()}" required></label><label>備註<input name="note" placeholder="選填"></label></div>
        <div class="preview" id="bnpl-preview"></div>
        <button>記下來</button>
      </form>`
      : `<div class="card"><p style="margin-top:0">還沒有設定先用後付的付款方式（信用卡、先享後付…）。</p><button data-action="tab" data-tab="settings">去設定</button></div>`;
  } else {
    form = `<form class="stack card" data-form="income">
      <label>金額<input type="number" name="amount" required min="1" step="any" inputmode="decimal" autofocus></label>
      <div class="grid2"><label>日期<input type="date" name="date" value="${today()}" required></label><label>來源<input name="note" placeholder="例如：紅包、打工"></label></div>
      <p class="footnote" style="margin:0">5 號、20 號的零用錢會自動記，不用手動加。</p>
      <button>記下來</button>
    </form>`;
  }
  return `<div class="seg">${modes.map(([id, name]) => `<button data-action="add-mode" data-mode="${id}" class="${state.addMode === id ? 'on' : ''}">${name}</button>`).join('')}</div>${form}`;
}

// 先用後付：即時顯示什麼時候要繳、刷下去之後還能花多少
function updateBnplPreview() {
  const form = $app.querySelector('form[data-form="bnpl"]');
  const box = document.getElementById('bnpl-preview');
  if (!form || !box) return;
  const d = Object.fromEntries(new FormData(form));
  const amount = Number(d.amount);
  const method = state.payment_methods.find((m) => m.id === d.method_id);
  if (!(amount > 0) || !method || !d.date) { box.textContent = ''; return; }
  const n = Number(d.installments);
  const parts = splitInstallments(amount, n);
  const dues = parts.map((_, i) => dueDateFor(d.date, method, i));
  const after = forecast(calcState(), today(), [{ id: 'preview', method_id: method.id, date: d.date, amount, installments: n }]);
  const when = n === 1
    ? `${md(dues[0])} 要繳 ${money(amount)}`
    : `從 ${md(dues[0])} 開始，每期約 ${money(parts[1])}，最後一期 ${md(dues[n - 1])}`;
  box.className = `preview ${after.safe < 0 ? 'bad' : ''}`;
  box.innerHTML = after.safe < 0
    ? `${when}<br><strong>刷下去的話，到 ${md(after.minDate)} 會差 ${money(-after.safe)}</strong>`
    : `${when}<br>刷下去之後還能安心花 <strong>${money(after.safe)}</strong>`;
}

// ---- 帳單 ----

function viewBills(f) {
  const unpaid = f.unpaid;
  const paid = f.bills.filter((b) => b.remaining <= 0).reverse().slice(0, 6);
  const recDue = recurringDue(state.recurring, state.transactions, addDays(today(), 31));
  const billRow = (b) => `<div class="row">
    <div class="main">
      <div class="title">${esc(b.method_name)}${b.due < today() && b.remaining > 0 ? '<span class="badge">逾期</span>' : ''}${b.paid > 0 && b.remaining > 0 ? '<span class="badge info">已還部分</span>' : ''}</div>
      <div class="meta">${md(b.due)} 繳款 · 共 ${money(b.total)}${b.paid > 0 ? ` · 已還 ${money(b.paid)}` : ''}</div>
      <details class="items"><summary>${b.items.length} 筆消費</summary>
        ${b.items.map((it) => `<div>${esc(it.purchase.date.slice(5).replace('-', '/'))} ${esc(it.purchase.note || it.purchase.category || '')} ${money(it.amount)}${it.of > 1 ? `（第 ${it.index}/${it.of} 期）` : ''}</div>`).join('')}
      </details>
    </div>
    <div class="amt">${money(b.remaining > 0 ? b.remaining : b.total)}</div>
    ${b.remaining > 0 ? `<button class="small secondary" data-action="pay-bill" data-key="${esc(b.key)}">還款</button>` : ''}
  </div>`;
  return `
  <h2>還沒繳的帳單 · 共 ${money(f.unpaidTotal)}</h2>
  <div class="list">${unpaid.length ? unpaid.map(billRow).join('') : '<div class="empty">全部繳清了</div>'}</div>
  <h2>固定支出（一個月內）</h2>
  <div class="list">${recDue.length
    ? recDue.map((o) => eventRow({ type: 'recurring', label: o.recurring.name, date: o.date, due: o.date, amount: -o.amount, rid: o.recurring.id, overdue: o.date < today() })).join('')
    : '<div class="empty">沒有固定支出。可以在「設定」新增手機費、訂閱等。</div>'}</div>
  ${paid.length ? `<h2>最近繳清的</h2><div class="list">${paid.map(billRow).join('')}</div>` : ''}`;
}

async function payBill(key) {
  const bill = forecast(calcState()).bills.find((b) => b.key === key);
  if (!bill) return;
  const v = await ask(`還 ${bill.method_name}（${md(bill.due)}）`, `
    <label>還款金額<input type="number" name="amount" value="${bill.remaining}" min="1" step="any" required></label>
    <label>還款日期<input type="date" name="date" value="${today()}" required></label>`, '確認還款');
  if (!v) return;
  await mutate(() => db.insert('transactions', {
    date: v.date, kind: 'repayment', amount: Number(v.amount), category: '還款', note: `${bill.method_name} ${bill.due} 帳單`,
    method_id: bill.method_id, bill_due: bill.due,
  }), '已記錄還款');
}

async function payRecurring(id, date) {
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return;
  const v = await ask(`${r.name}（${md(date)}）`, `
    <label>實際付了多少<input type="number" name="amount" value="${r.amount}" min="0" step="any" required><span class="hint">這期不用付就填 0</span></label>
    <label>付款日期<input type="date" name="date" value="${today()}" required></label>`, '確認');
  if (!v) return;
  await mutate(() => db.insert('transactions', {
    date: v.date, kind: 'expense', amount: Number(v.amount), category: '生活', note: r.name, recurring_id: r.id, recurring_date: date,
  }), '已記錄');
}

// ---- 明細 ----

function viewHistory() {
  const m = state.month;
  const methodName = Object.fromEntries(state.payment_methods.map((x) => [x.id, x.name]));
  const items = [
    ...state.transactions.filter((t) => t.date.startsWith(m)).map((t) => ({ ...t, table: 'transactions' })),
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

  const kindLabel = { income: '收入', expense: '支出', repayment: '還款', bnpl: '先用後付' };
  const row = (it) => {
    const sign = it.kind === 'income' ? '+' : '-';
    const meta = it.kind === 'bnpl'
      ? `${esc(methodName[it.method_id] ?? '')}${it.installments > 1 ? ` · 分 ${it.installments} 期` : ''}`
      : kindLabel[it.kind];
    return `<div class="row">
      <div class="main"><div class="title">${esc(it.note || it.category || kindLabel[it.kind])}</div><div class="meta">${md(it.date)} · ${meta}${it.category && it.note && it.category !== kindLabel[it.kind] ? ` · ${esc(it.category)}` : ''}</div></div>
      <div class="amt ${it.kind === 'income' ? 'plus' : 'minus'}">${sign}${money(Number(it.amount))}</div>
      <button class="danger" data-action="delete" data-table="${it.table}" data-id="${esc(it.id)}" aria-label="刪除">✕</button>
    </div>`;
  };

  return `
  <label style="margin-top:24px">月份<input type="month" value="${m}" data-input="month"></label>
  <div class="stats two">
    <div class="stat"><div class="k">這個月花了</div><div class="v">${money(spent)}</div><div class="h">含先用後付</div></div>
    <div class="stat"><div class="k">這個月收入</div><div class="v">${money(income)}</div></div>
  </div>
  ${cats.length ? `<h2>花在哪裡</h2><div class="card">${cats.map(([c, v]) => `
    <div class="cat"><div class="top"><span>${esc(c)}</span><span class="num">${money(v)}</span></div>
    <div class="track"><div class="bar" style="width:${Math.max(2, (v / cats[0][1]) * 100)}%"></div></div></div>`).join('')}</div>` : ''}
  <h2>每一筆</h2>
  <div class="list">${items.length ? items.map(row).join('') : '<div class="empty">這個月還沒有紀錄</div>'}</div>`;
}

// ---- 設定 ----

function viewSettings(f) {
  const s = state.settings;
  return `
  <h2>零用錢</h2>
  <form class="stack card" data-form="settings">
    <div class="grid2">
      <label>5 號<input type="number" name="allowance_5" value="${s.allowance_5}" min="0" step="any" required></label>
      <label>20 號<input type="number" name="allowance_20" value="${s.allowance_20}" min="0" step="any" required></label>
    </div>
    <label>安全墊<input type="number" name="reserve" value="${s.reserve}" min="0" step="any" required><span class="hint">永遠保留不花的錢</span></label>
    <button>儲存</button>
  </form>

  <h2>校正餘額</h2>
  <form class="stack card" data-form="adjust">
    <label>手上實際有多少錢<input type="number" name="actual" step="any" required placeholder="系統算的是 ${Math.round(f.balance)}"><span class="hint">跟系統算的不一樣時用，會自動補一筆差額</span></label>
    <button class="secondary">校正</button>
  </form>

  <h2>先用後付的付款方式</h2>
  <div class="list">${state.payment_methods.length
    ? state.payment_methods.map((m) => `<div class="row">
        <div class="main"><div class="title">${esc(m.name)}</div><div class="meta">每月 ${m.closing_day} 號結帳 · ${m.due_day > m.closing_day ? '當月' : '隔月'} ${m.due_day} 號繳款</div></div>
        <button class="danger" data-action="delete" data-table="payment_methods" data-id="${esc(m.id)}" aria-label="刪除">✕</button>
      </div>`).join('')
    : '<div class="empty">還沒有</div>'}</div>
  <form class="stack card" data-form="method" style="margin-top:10px">
    <label>名稱<input name="name" required placeholder="例如：國泰信用卡、LINE Pay 先享後付"></label>
    <div class="grid2">
      <label>結帳日<input type="number" name="closing_day" min="1" max="31" required inputmode="numeric"><span class="hint">這天以前的消費算這期</span></label>
      <label>繳款日<input type="number" name="due_day" min="1" max="31" required inputmode="numeric"><span class="hint">最晚要還錢的日子</span></label>
    </div>
    <button class="secondary">新增付款方式</button>
  </form>

  <h2>固定支出</h2>
  <div class="list">${state.recurring.length
    ? state.recurring.map((r) => `<div class="row">
        <div class="main"><div class="title">${esc(r.name)}</div><div class="meta">每月 ${r.day} 號</div></div>
        <div class="amt">${money(Number(r.amount))}</div>
        <button class="danger" data-action="delete" data-table="recurring" data-id="${esc(r.id)}" aria-label="刪除">✕</button>
      </div>`).join('')
    : '<div class="empty">還沒有</div>'}</div>
  <form class="stack card" data-form="recurring" style="margin-top:10px">
    <div class="grid2">
      <label>名稱<input name="name" required placeholder="例如：手機費"></label>
      <label>金額<input type="number" name="amount" min="1" step="any" required></label>
    </div>
    <label>每月幾號付<input type="number" name="day" min="1" max="31" required inputmode="numeric"></label>
    <button class="secondary">新增固定支出</button>
  </form>

  <h2>帳號</h2>
  <div class="card" style="display:flex;justify-content:space-between;align-items:center">
    <span>${esc(state.user.email)}</span>
    ${db.demo ? '' : '<button class="secondary small" data-action="logout">登出</button>'}
  </div>`;
}

// ---- 事件處理 ----

const forms = {
  async login(d, submitter) {
    try {
      if (submitter?.value === 'up') {
        const needConfirm = await db.signUp(d.email, d.password);
        if (needConfirm) return toast('註冊成功！請到信箱點確認信，再回來登入');
      } else {
        await db.signIn(d.email, d.password);
      }
      await boot();
    } catch (e) {
      toast(e.message === 'Invalid login credentials' ? '帳號或密碼錯誤' : `失敗：${e.message}`);
    }
  },
  async setup(d) {
    const t = today();
    await mutate(() => db.saveSettings({
      opening_balance: Number(d.opening_balance), allowance_5: Number(d.allowance_5), allowance_20: Number(d.allowance_20),
      reserve: Number(d.reserve) || 0, start_date: t, generated_through: t,
    }), '設定完成');
  },
  expense: (d) => mutate(() => db.insert('transactions', { date: d.date, kind: 'expense', amount: Number(d.amount), category: d.category, note: d.note }), '已記錄支出'),
  income: (d) => mutate(() => db.insert('transactions', { date: d.date, kind: 'income', amount: Number(d.amount), category: '收入', note: d.note }), '已記錄收入'),
  bnpl: (d) => mutate(() => db.insert('purchases', {
    method_id: d.method_id, date: d.date, amount: Number(d.amount), installments: Number(d.installments), category: d.category, note: d.note,
  }), '已記錄先用後付'),
  settings: (d) => mutate(() => db.saveSettings({
    ...state.settings, allowance_5: Number(d.allowance_5), allowance_20: Number(d.allowance_20), reserve: Number(d.reserve),
  }), '已儲存'),
  adjust(d) {
    const diff = Number(d.actual) - currentBalance(state.settings, state.transactions);
    if (Math.abs(diff) < 0.01) return toast('跟系統算的一樣，不用校正');
    return mutate(() => db.insert('transactions', {
      date: today(), kind: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff), category: '其他', note: '餘額校正',
    }), `已校正 ${diff > 0 ? '+' : ''}${money(diff)}`);
  },
  method: (d) => mutate(() => db.insert('payment_methods', { name: d.name, closing_day: Number(d.closing_day), due_day: Number(d.due_day) }), '已新增'),
  recurring: (d) => mutate(() => db.insert('recurring', { name: d.name, amount: Number(d.amount), day: Number(d.day), start_date: today(), active: true }), '已新增'),
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
  if (e.target.dataset.input === 'month' && e.target.value) {
    state.month = e.target.value;
    render();
  }
});

const deleteWarnings = {
  payment_methods: '刪除這個付款方式，底下所有先用後付的消費也會一起刪掉。確定嗎？',
  recurring: '確定刪除這個固定支出？',
  purchases: '確定刪除這筆先用後付？相關帳單金額會跟著變。',
  transactions: '確定刪除這筆紀錄？',
};

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  if (action === 'tab') {
    state.tab = el.dataset.tab;
    render();
    window.scrollTo(0, 0);
  } else if (action === 'add-mode') {
    state.addMode = el.dataset.mode;
    render();
  } else if (action === 'pay-bill') {
    await payBill(el.dataset.key);
  } else if (action === 'pay-rec') {
    await payRecurring(el.dataset.id, el.dataset.date);
  } else if (action === 'delete') {
    if (confirm(deleteWarnings[el.dataset.table])) await mutate(() => db.remove(el.dataset.table, el.dataset.id), '已刪除');
  } else if (action === 'logout') {
    await db.signOut();
    state.settings = null;
    await boot();
  } else if (action === 'reload') {
    location.reload();
  }
});

boot();
