# Guest hosted promotion：相容性盤點與驗收邊界

2026-10-31。這份盤點不代表 Guest 已開放；目前線上仍是 Owner-only staging。

## 第一個受控切片

先完成 Owner 邀請 → Guest exchange → 私人圖庫 → 選取／提交 → Owner 匯出；沿用現有 D1 交易、session、權限與 append-only 事件。只允許既有合成驗收 workspace `bd927a6d-d5d3-4743-bbae-e4560cdda4c7`、project `08954949-ae90-4353-be2f-ae4a8f40b78d`、album `613487da-e6ff-4ada-9b66-949f21fcfa2c`。不可假設 staging 永遠沒有其他資料。

## 實際衝突

- `config.ts` 在非 local 拒絕 exchange／selection。`invite-issuance.ts`、`guest-exchange.ts` 各自也限制 local；兩個 capabilities endpoint 另外限制 local。只改旗標或 UI 無法開通。
- Guest selection、Owner selection-policy／submission／export／reopen 主要檢查 selection flag；Guest access／gallery／assets 依 session 與邀請授權，沒有合成資料 allowlist。新入口必須限制讀寫路徑與相簿，不能只限制邀請建立的畫面。
- 邀請建立目前只檢查 Owner 的有效專案／相簿。exchange 必須用 token hash 查出的實際 sealed invite 核對 workspace、project 和完整 album 範圍，不能相信請求自行帶入的 scope。
- 現有相簿為 draft；未通過前不得為測試方便改其他專案。啟用時只操作上述合成相簿，保存狀態前後證據。
- exchange route 拒絕 `CF-Worker`，僅使用 Cloudflare 提供的 `CF-Connecting-IP`；保留 canonical IP、HMAC 假名與 D1 admission。不可改讀 X-Forwarded-For 或自行補可信 IP。
- 密碼模式使用 D1-wide KDF permit；本機 scrypt 通過不代表 hosted CPU 限制通過。三種密碼模式仍是 MVP 要求，分別保存真正遠端結果；link-only 首次驗收不算密碼驗收。
- staging 必須保留真實 signing secret、Secure/HttpOnly/SameSite Cookie、Origin 檢查及封閉 Owner 註冊，不能將 APP_ENV 改 local。

## 實作／啟用順序

1. 新增預設關閉的精確 B staging validation context；配置錯誤、production、錯誤 host/account/bucket 一律拒絕。只為這個 context 逐項允許三個 capability，其他 local-only 閘不動。
2. service 先保證 invite issuance 與 exchange 的精確合成 scope，再新增獨立 Guest validation wrapper，限制 Guest album 路徑及 Owner selection/export 範圍。原 Owner-only wrapper 留作回復入口。
3. 以 native workerd/D1/R2 執行真正 staging 配置的正反案例：合成 scope 可用、其他 scope 拒絕、失效／撤銷／到期／權限／Origin／重播與 admission 不放寬；沿用既有交易及事件驗證，不新增一套假 API。
4. 真實 CI 成功、精確來源／bundle／配置核對、既有獨立 D1＋R2 snapshot restore 證據齊備後，才可受控部署 B。以獨立 Owner／Guest 瀏覽器真正驗收，保留版本、網址與證據。
5. 任一意外 scope 或授權結果立即關閉新入口，回復已驗收 Owner-only 配置；不刪除原圖、版本、歷史或測試紀錄。

本輪未新增 Guest 開關、未修改 schema／遠端資料，也未宣稱上述 promotion 已實裝。正式部署閘、所有原產品需求、自動刪除 OFF／dry-run、單 R2 節點不變；A／DNS 不動。
