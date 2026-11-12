# Kino Pick 奇諾選圖｜Claude 接手入口

正式工作樹在 C:\Users\Aaron\Documents\Codex\KINO Pic\.local\album-tabs-release-20261109。正式站 https://pick.kinostudio.tw 。這份文件是接手起點，逐次紀錄在 docs/HANDOFF.md，復原程序在 docs/PRODUCTION_CUTOVER.md。

## 優先接手 Guest 首次載入 503

1. 使用有效、限合成測試相簿的 Guest 分享，從全新瀏覽器環境首次進入正式網址。舊 staging 分享已到期。若缺有效測試分享，請 Owner 提供安全存取方式或授權建立一份；不要將分享網址、密碼或 Cookie 貼到 Git 或聊天。
2. 開啟開發工具的 Network（網路請求），保留首次請求與既有一次自動重試。只記 UTC 時間、API 類別、狀態、回應類型、去識別錯誤碼與 request ID。同步比對 B Worker tail（即時執行紀錄），不要匯出含憑證的整份 HAR。
3. staging 曾在 access、ratings、favorites、deliveries 首載收到 503，手動重試可恢復。舊 tail 缺可分類的 D1 例外；當時 staging 沒經 A。正式 Owner 成功不能證明 Guest 成功。兩次 HTTP 都成功而 UI 報錯時，查解析與前端狀態；若真的 503，先定位是哪一層產生回應。
4. 驗收使用有效 Guest 首次開頁，相簿、已授權的回饋與交付能直接讀取，不需手動重新整理；無交付時可正常顯示空清單。另一相簿仍拒絕存取。用同一條失敗路徑做修前／修後最小比對；單次無法重現只記「本次未重現」。再卡住時交回證據，勿增加盲目重試或放寬權限。

## 系統與目錄

攝影師建立專案、上傳私人照片並分享相簿。客戶免註冊挑片、評星、收藏、留言及手繪；可比較修圖版本，由一位授權代表核准，交付固定版本的照片與 ZIP，並有站內通知與操作紀錄。

- apps/web/target-ui 是正式 React 介面；apps/web/app 包含 Next.js 參考入口及共用功能。experiments 是原型，正式修正應進入實際使用的元件。
- apps/gateway 是 A 的 pick 專用簽名入口；apps/worker 是 B 的網站、API、身分驗證、D1 資料庫與私人 R2 儲存接線。Oracle 提供溢出容量，目前設定 30 GB，R2 優先。
- packages/contracts 定義輸入輸出，domain 定義產品規則，db 管資料庫，storage 管儲存，image-processing 處理圖片，ui 是共用元件。
- tests 放測試，tools 放開發與發布工具，config 放設定，docs/releases 放驗收與部署證據，.github/workflows 放 GitHub Actions 自動流程。prompts 與 .agents 提供協作材料。

## 樣式與本機命令

正式 app.tsx 載入 target-ui/style.css，再引入 app/globals.css、Tailwind CSS 與共用照片樣式。頁籤、圖庫、照片詳情等各有功能 CSS。沿用原生 CSS 自訂屬性（例如 --guest-compare-split-offset）、功能前綴及既有 BEM 式名稱（如 studio-pages__main）。沒有 Sass 入口、partial、Sass 變數、mixin 或獨立 Sass 編譯命令。

Node 24.x、pnpm 11.25.0。於本工作樹執行：

~~~powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd dev
pnpm.cmd --filter @kino-pic/web run build:target-ui
pnpm.cmd build
~~~

dev 提供本機 8787 預覽；build:target-ui 使用 Vite、PostCSS、Tailwind 打包樣式。build 另執行 Worker dry-run（產生可部署套件）。生成的 apps/worker/.static/assets/*.css 已忽略，由 CI 重建即可。

## 發布與驗收邊界

正式來源 6906b7b，完整 CI 43126212204，自動部署 43128460416，部署收據在 docs/releases/production-prior-deployment.json。正式推送依既有 main CI、deployment-target 與 production workflow 發布 B。交接分支僅供 Claude 使用。

CI 使用 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN。B runtime secrets 為 BETTER_AUTH_SECRET、GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、KINO_GATEWAY_SECRET、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、ORACLE_STORAGE_ACCESS_KEY_ID、ORACLE_STORAGE_SECRET_ACCESS_KEY。A 入口使用 KINO_GATEWAY_SECRET。非機密旗標與 binding（服務綁定）見 apps/worker/wrangler.jsonc、apps/gateway/wrangler.jsonc。

正式 GitHub Owner 登入、相簿讀取已驗收。切換時 schema67 完整比對、外鍵零錯誤，322 個 R2 與 9 個 Oracle 資產已讀回核對。staging 已驗收回饋、代表核准、固定 ZIP 與版本比較。先處理 Guest 初載，再補正式新上傳／縮圖與真 Guest 交付驗收。維持單一寫入端、關閉自動刪除、清理預設 dry-run。Google 正式登入及進階清理未啟用。保留歷史備份與舊工作樹。

## 本次乾淨建置實錄（2026-11-12）

於忽略目錄 .local/claude-clean-20261112 的獨立 clone 執行，起始 git status --porcelain 無輸出。Node v24.18.0，pnpm 11.25.0。pnpm.cmd install --frozen-lockfile 成功，9 個 workspace、464 個套件。pnpm.cmd build 成功（exit 0），內含 build:target-ui 與 Wrangler dry-run。273 個模組，產生 index-Citdmtqw.css（123.06 kB，gzip 23.59 kB）。Vite 提示 JS chunk 超過 500 kB，Wrangler 提示有多個環境，這次使用預設本機設定乾跑。沒有部署、操作客戶資料或重跑既有 CI。此 checkout 沒有 Sass 編譯步驟。
