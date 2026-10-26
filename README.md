# 零用錢管家

一個能告訴你「還完所有帳單之後，現在還能花多少錢」的記帳網站。手機和電腦都能用，有帳號登入，資料存在雲端。

- **前端**：純 HTML / CSS / JavaScript，不需要安裝任何套件
- **登入 + 資料庫**：[Supabase](https://supabase.com)（免費方案）
- **網站架設**：GitHub Pages、Netlify、Cloudflare Pages 都可以（免費）

---

## 怎麼算「可以安心花多少」

1. 目前手上的錢 = 起始金額 + 所有收入 − 一般支出 − 已還的款
2. 把未來會發生的事情依日期排好：
   - ➕ 每月 5 號、20 號的零用錢
   - ➖ 每一張還沒繳清的帳單（信用卡、先享後付、分期的每一期）
   - ➖ 還沒付的固定支出（手機費、訂閱…）
3. 從今天開始一天一天往下算餘額，找出**最低的那一天**
4. **可以安心花 = 最低點的餘額 − 安全墊**

現在多花 1 塊，未來每一天都會少 1 塊，所以只要不超過這個數字，就不會有哪一天付不出帳單。

**帳單歸期**：每個付款方式要設定「結帳日」和「繳款日」。結帳日當天（含）以前的消費算進這期帳單；繳款日比結帳日大，就是當月繳，否則是隔月繳。分期的話，第 2 期起每個月往後推一期。

**自己填繳款日**：記先用後付時勾「自己填繳款日」，就能直接指定繳款日（例如兩個月後才繳）；分期的話填第一期，之後每月同一天。付款方式也可以設成「沒有固定結帳日」，這種付款方式每筆都要自己填繳款日。

> 2026/10 之前就建好資料庫的話，要先到 Supabase SQL Editor 跑一次 [`supabase/migrations/002_manual_due_date.sql`](supabase/migrations/002_manual_due_date.sql)。

---

## 一、先在自己電腦試用（示範模式）

`config.js` 裡的兩個值是空的時候，網站會進入**示範模式**：不用登入，資料只存在這台電腦的瀏覽器。

```bash
cd budget-app
python3 -m http.server 8765
```

打開瀏覽器到 <http://localhost:8765>。

> 不能直接雙擊打開 `index.html`，因為瀏覽器會擋掉 JavaScript 模組，一定要透過上面的指令開。

---

## 二、設定 Supabase（登入 + 雲端資料庫）

1. 到 <https://supabase.com> 註冊，按 **New project**
   - 名稱隨便取，例如 `budget`
   - Region 選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，離台灣比較近
   - 資料庫密碼記下來（這個網站用不到，但之後管理會用到）
2. 專案建好後，左邊選 **SQL Editor** → **New query**，把 [`supabase/schema.sql`](supabase/schema.sql) 整份貼上，按 **Run**
3. 左邊選 **Project Settings → API**，複製兩個值貼到 `config.js`：
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';   // 「anon public」那一個
   ```
   > anon key 本來就是公開的，放在網頁裡沒關係。資料庫已經設定「每個人只能讀寫自己的資料」（Row Level Security），別人拿到這個 key 也看不到你的帳。
   > **絕對不要**貼 `service_role` 那個 key。
4. （選擇性）註冊時預設要去信箱點確認信。如果只有自己用、想省這一步：
   **Authentication → Sign In / Providers → Email** → 關掉 **Confirm email**

重新整理網頁，就會看到登入畫面了。

---

## 三、把網站放上網路（免費）

### 方法 A：Netlify Drop（最簡單，3 分鐘）

1. 到 <https://app.netlify.com/drop>（要先註冊 Netlify 帳號）
2. 把整個 `budget-app` 資料夾拖進去
3. 完成！會給你一個 `https://xxx.netlify.app` 的網址

之後改了程式，再拖一次就會更新。

### 方法 B：GitHub Pages（適合常常改程式）

1. 在 GitHub 建一個新的 repository，把 `budget-app` 裡的檔案推上去
2. Repository → **Settings → Pages** → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`
3. 等一兩分鐘，網址會是 `https://你的帳號.github.io/repository名稱/`

之後每次 `git push` 就會自動更新。

### 網站上線之後

回到 Supabase → **Authentication → URL Configuration**，把 **Site URL** 改成你的網站網址。不然確認信裡的連結會導到 `localhost`。

### 加到手機主畫面

用手機打開網址 → Safari 按「分享」→「加入主畫面」（Android Chrome：選單 →「加到主畫面」），用起來就像一個 App。

---

## 使用方式

| 分頁 | 做什麼 |
|---|---|
| 🏠 首頁 | 可以安心花多少、目前餘額、待還款、到下次零用錢前每天可花多少、未來兩個月的現金流 |
| ➕ 記一筆 | **一般支出**（當下就扣錢的）、**先用後付**（信用卡、先享後付，可分期；記之前會試算刷下去還能花多少）、**額外收入** |
| 🧾 帳單 | 每張未繳帳單、裡面有哪些消費；按「還款」記錄還了多少（可以只還一部分） |
| 📒 明細 | 每個月的花費分類統計和每一筆紀錄，可以刪除 |
| ⚙️ 設定 | 零用錢金額、安全墊、校正餘額、付款方式、固定支出 |

- 5 號、20 號的零用錢會**自動入帳**（打開網站時補記）。如果某次沒拿到，到「明細」刪掉那筆就好，不會再自動長回來。
- 系統算的餘額跟手上的錢對不起來時，用「設定 → 校正餘額」。
- 統計花費時，先用後付以**消費當天**算，還款不會重複算進花費。

---

## 繳款提醒通知

帳單和固定支出到期前 3、2、1 天，每天早上 9 點推播到手機。

- **怎麼運作**：GitHub Actions（[`.github/workflows/reminders.yml`](.github/workflows/reminders.yml)）每天台灣時間 9:00 執行 [`scripts/send-reminders.mjs`](scripts/send-reminders.mjs)，算出 3 天內要繳的款項，用 Web Push 送到開了通知的裝置。順便讓 Supabase 每天都有使用，不會被暫停。
- **iPhone**：要 iOS 16.4 以上，先「加入主畫面」，從主畫面打開 → 設定 → 繳款提醒通知 → 開啟通知。
- **需要的 GitHub Secrets**（repo → Settings → Secrets and variables → Actions）：
  - `SUPABASE_SECRET_KEY`：Supabase → Project Settings → API Keys → Secret keys
  - `VAPID_PRIVATE_KEY`：推播私鑰（對應 `config.js` 裡的 `VAPID_PUBLIC_KEY`）
- **資料庫**：先跑 [`supabase/migrations/003_push_subscriptions.sql`](supabase/migrations/003_push_subscriptions.sql)
- **手動測試**：GitHub repo → Actions → 繳款提醒 → Run workflow，勾「送一則測試通知」
- GitHub 規定：repo 連續 60 天沒有任何 commit，排程會被自動停用，到 Actions 頁面按一下重新啟用即可。

## 檔案結構

```
budget-app/
├── index.html          網頁骨架
├── style.css           樣式（自動支援深色模式）
├── config.js           Supabase 設定
├── js/
│   ├── app.js          畫面和操作
│   ├── calc.js         計算核心（帳單歸期、現金流、可花金額）
│   ├── db.js           資料存取（Supabase 或示範模式的 localStorage）
│   └── i18n.js         中英文字串（右上角「中／EN」切換）
└── supabase/
    └── schema.sql      資料庫結構
```
