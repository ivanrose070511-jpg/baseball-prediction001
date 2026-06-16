# 每日盤口預測網站

這是一個零依賴的靜態網站，可直接開啟 `index.html`。網站目前定位為亞洲職棒盤口預測看板，目標聯盟是 KBO 韓國職棒、NPB 日本職棒、CPBL 中華職棒。網站會讀取 `data/predictions.js`，分成今日賽程與預測、過去賽程與預測、未來賽程三個視圖。

## 檔案

- `index.html`：網站入口
- `styles.css`：版面與視覺樣式
- `app.js`：三個視圖、篩選、統計與渲染邏輯
- `data/predictions.js`：每日預測資料
- `data/team-pool.json`：KBO、NPB、CPBL 的示範隊伍池
- `data/odds.json`：外部盤口資料匯入位置
- `scripts/fetch-schedules.mjs`：抓取 KBO、NPB、CPBL 官方賽程
- `scripts/fetch-odds.mjs`：讀取外部盤口資料
- `scripts/update-predictions.mjs`：離線產生每日預測資料

## 手動更新

如果想手動刷新資料，可以執行：

```powershell
node .\scripts\update-predictions.mjs
```

如果系統找不到 `node`，在 Codex 桌面環境可改用：

```powershell
& "C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\scripts\update-predictions.mjs
```

之後重新整理 `index.html` 即可看到新資料。

更新流程會先抓官方賽程，並輸出三組資料：

- `views.today`：今日賽程與今日預測
- `views.past`：過去賽程與過去預測
- `views.future`：未來賽程

今日與過去預測包含大小分、讓分過盤與盤口來源，不顯示預測比數。大小分與受讓分只會使用外部盤口資料；若尚未接入公開合法盤口來源，網站會顯示 `未取得`，不會自行編造盤口。

盤口來源可用三種方式接入：

- 預設抓取玩運彩公開預測賽事頁，包含 NPB、CPBL、KBO
- 在 `data/odds.json` 放入盤口資料
- 設定 `ODDS_FEED_URL`，必要時加上 `ODDS_API_KEY`

盤口資料格式：

```json
{
  "odds": [
    {
      "date": "2026-06-16",
      "league": "CPBL 中華職棒",
      "awayTeam": "中信兄弟",
      "homeTeam": "台鋼雄鷹",
      "source": "Bet365",
      "totalLine": 8.5,
      "spreadTeam": "台鋼雄鷹",
      "spreadLine": 2.5
    }
  ]
}
```

官方來源：

- KBO：KBO 官方賽程 AJAX
- NPB：NPB.jp 官方月賽程
- CPBL：中華職棒官方賽程 AJAX

如果三個來源都抓取失敗，才會退回 `data/team-pool.json` 的示範隊伍池，避免網站空白。

## 自動更新

我已把網站設計成讓每日自動任務覆寫 `data/predictions.js` 即可更新首頁。下一步若要改成真實賽程，資料來源只需要鎖定 KBO、NPB、CPBL，並輸出同一個資料格式即可。

## 永久網站部署與每日更新

這個網站是純靜態網站，可以部署到 Cloudflare Workers Static Assets、Cloudflare Pages 或 Netlify。

- Cloudflare Workers Static Assets：目前 `wrangler.toml` 已設定為 `dawn-hill-de60`，可部署到 `workers.dev` 網址。
- Cloudflare Pages：使用 Direct Upload，上傳整個部署資料夾或 zip，網站會取得 `pages.dev` 永久網址。
- Netlify：可用 Drag and drop，上傳部署資料夾，網站會取得 `netlify.app` 永久網址。

目前本機每日自動任務會更新 `data/predictions.js`。若要讓永久網址也每天自動更新，需要設定 Cloudflare 憑證，讓自動任務更新資料後同時重新部署公開網站。

Cloudflare Workers 部署流程：

```powershell
npm install
$env:CLOUDFLARE_API_TOKEN="你的 Cloudflare API Token"
$env:CLOUDFLARE_ACCOUNT_ID="你的 Cloudflare Account ID"
npm run deploy
```

`npm run deploy` 會依序執行：

1. 抓取最新賽程、盤口與賽果，更新 `data/predictions.js`
2. 建立 `dist/` 靜態部署資料夾
3. 用 Wrangler 部署到 Cloudflare Worker

### 電腦關機也自動更新

若要在本機關機時仍自動更新，請把專案放到 GitHub，並在 GitHub repository 的 `Settings > Secrets and variables > Actions` 新增：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `OPENAI_API_KEY`

`.github/workflows/update-and-deploy.yml` 已設定雲端排程：

- 台灣時間平日 14:00：更新今日 AI 預測、盤口分析並部署
- 台灣時間假日 11:00：更新今日 AI 預測、盤口分析並部署
- 台灣時間每天 22:30：更新比賽結果並部署

GitHub Actions 的 `schedule` 使用 UTC，因此 workflow 內已換算成 UTC 時間。

若要指定 OpenAI 模型，可在 `Settings > Secrets and variables > Actions > Variables` 新增 `OPENAI_MODEL`，預設使用 `gpt-4o-mini`。
