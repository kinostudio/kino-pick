# Worker OAuth 登入來源能力

2026-10-31。這是現有 Cloudflare React/Vite 前端與 Better Auth 的能力宣告，不是新的登入系統，也不代表雙來源綁定已完成 hosted 驗收。

- `GET /api/oauth/providers` 僅回傳 `{ "providers": ["github"] }` 這類來源名稱清單；不回傳 Client ID、Secret、帳號 Email 或 Owner 身分。完整且非空白的 ID＋Secret 才列入，兩者缺一則不提供。
- `createAuth` 與 endpoint 使用同一判定函式，避免 UI 宣稱啟用但登入服務未註冊。Google／GitHub 原有 stable subject、Owner 授權、禁止隱式合併及封閉註冊維持。
- 回應 `private, no-store`；不接受 query。staging Owner-only wrapper 只新增此路徑的讀取，POST 及其他 Guest／註冊路徑仍拒絕。
- 實際 Worker 登入畫面先查能力。載入、查詢失敗、回應格式錯誤時無可點擊的來源按鈕；空清單顯示尚未設定。只有列出的來源顯示按鈕，送出前再核對清單。
- 能力宣告只表示伺服器已配置該來源，不保證 OAuth 上游可用、帳號已獲授權或 callback 完成。不得以此結果替代真實登入／綁定驗收。

## 驗證與回復

聚焦 unit 覆蓋完整／部分／空白 credential pair 和回應不含憑證；native staging runner 保留原14項邊界，新增來源清單、query／write 拒絕與 Chromium 的載入／單一來源／查詢失敗畫面。Native Images 在此仍為 presence double，沒有遠端 provider、資料寫入或 OAuth 登入。實際執行結果見最新 HANDOFF，不能把本機 Chromium 當成 hosted 驗收。

本次無 migration，無既有資料改寫；回復採已驗收的 Worker source/config 重新部署，不修改 OAuth Secret 或 session。新的 product/UI source 須通過對應 CI 並更新 bundle／source proof 後才能部署 B；舊 CI 不可替新來源背書。A／DNS 不變，自動刪除 OFF／dry-run、單 R2 節點維持。
