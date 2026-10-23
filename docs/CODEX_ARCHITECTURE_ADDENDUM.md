# KINO Pic（奇諾選圖）— Codex 架構補充實作提示詞 v1.2

> 用途：把此文件直接交給 Codex，在**既有 KINO Pic repository** 中繼續開發。這是增量規範（addendum），不是另起一個新專案。

你現在是 KINO Pic 的資深系統架構師、全端工程師、安全工程師與 QA 負責人。請先完整閱讀現有程式碼、`README.md`、`AGENTS.md`、`GEMINI.md`、`docs/`、資料庫 migration、測試及工作交接文件。以現有可用功能為基礎增量實作，不要重建 repository，不要刪除既有產品需求、資料或正在運作的功能；保持與 Google Antigravity 可無痛交接。

## A. 本次補充規範的優先級與目標

1. 本次**部署基準**更新為「個人自用、免費額度優先、未來可商用擴充」。此部分優先於過往預設的 `Vercel Pro + Supabase Pro + PostgreSQL` 正式部署方案；舊方案保留在架構決策紀錄中作為遷移備案，不要無理由硬刪既有相容程式。
2. 優先選擇 **GitHub 私有 Repository + GitHub Actions（僅 CI/CD）+ Cloudflare Workers（靜態網站和 API）+ D1 + R2 + Cron Triggers**。必要的輕量佇列先評估 Cloudflare Queues 免費用量與當前可用性；保留抽象介面。GitHub Actions **禁止用作常駐 VPS、網站 API、持續背景運算或圖片 CDN**。
3. 建議前端 `React + Vite + TypeScript`，後端 `Hono + Cloudflare Workers`，資料庫 `Cloudflare D1 (SQLite) + Drizzle ORM`。如果既有 repo 是 Next.js / PostgreSQL：**先盤點相容性和資料遷移成本，建立階段性遷移方案，優先保留現有業務功能；不可無聲地直接覆蓋專案**。如能不重寫而部署在 Cloudflare Workers，必須提供明確相容性驗證。
4. 必須保留原規範中所有核心功能：專案／相簿、批次上傳、客戶邀請、Grid 多選、星等、標籤、收藏、留言、圖片註記、正式提交、下載、完整操作歷史、照片多版本及 Before/After、R2 自動清理。
5. 目標是單一開發資料夾、同一個 Git repository，Codex 和 Antigravity 以 `AGENTS.md`、`GEMINI.md`、`docs/HANDOFF.md`、`docs/DECISIONS.md` 及 Git commit 接續開發；禁止建立兩套互不相容的 KINO Pic。

## B. 部署、環境與免費額度邊界

1. 使用 Cloudflare Workers Static Assets 提供前端，Hono Worker 提供 API，D1 存放關聯資料，R2 放圖片二進位資料，Cloudflare Cron 負責定期巡檢。首版允許使用 `*.workers.dev` 免費網域，不強制購買網域。
2. 環境拆分 `local` / `staging` / `production`。最少正式和測試必須有獨立 D1 與 R2 Bucket。提供 `wrangler` 設定（含 `dev`、migration、部署腳本），`.dev.vars.example` 與 `.env.example`（只有 placeholder），以及 `docs/DEPLOYMENT.md`。
3. GitHub Actions 只做 lint、typecheck、unit/integration/E2E（可行的測試）、build、deploy；使用 GitHub OIDC 或最小權限部署 Token，避免把密鑰寫入 repo 或日誌；正式部署需明確受控。
4. **不要假設免費方案沒有風險或永久不變**。將 Workers、D1、R2、Queues 的免費額度、配額和超額行為寫成可配置及可監控的參數；在部署文件要求以 Cloudflare 官方最新計價和服務條款核對。
5. Workers Free CPU / 記憶體受限。大量上傳須盡量由客戶瀏覽器取得短效簽署上傳網址後**直傳 R2**，不要由 Worker 中繼大圖；大規模圖片解碼、縮圖、差異熱區不得假設能在 Free Worker 內穩定完成。縮圖先採瀏覽器／本地產生，後續保留獨立處理服務 Adapter。
6. 單一 Cloudflare R2 帳號與一個 D1 是**預設正式啟用**架構；多節點僅先提供擴充能力，除非使用者確認服務條款與帳單策略才啟用跨帳號免費額度分流。

## C. 登入、身分綁定與「只有我可註冊」

1. 支援 **Google OAuth + GitHub OAuth**。先評估適用於 Cloudflare Workers + D1 的 `Better Auth` 版本；如現有 repo 已使用其他成熟方案，提出最小修改方案，勿建立不安全的自製 OAuth 流程。
2. 內部使用固定 `users.id`。資料表 `oauth_accounts` 以 `(provider, provider_subject)` 唯一辨識外部身分；同一內部使用者可綁 Google 和 GitHub。帳號連結必須由**已登入且重新驗證身分**的使用者主動發起，通過另一個供應商 OAuth 後完成，並具備 CSRF / state / nonce / PKCE（適用時）等保護。**禁止只因 Email 相同就自動合併帳號**。
3. 預設 `REGISTRATION_MODE=closed`；公開註冊完全關閉，無授權的 Google/GitHub 使用者即使 OAuth 成功也**不得建立正式後台帳號或存取任何管理 API**。所有 API 後端強制 `owner` 授權，不只前端隱藏按鈕。
4. 初始 Owner 必須由本地安全的 CLI / 管理流程使用已驗證的 Google `sub` 或 GitHub 穩定 ID 建立；**不可讓第一個登入者自動成為 Owner**。初始化完成後關閉 bootstrap，要求登入事件留痕。提供 OAuth 身分綁定、解除綁定（至少保留一種可登入方式）、目前登入紀錄、Session 撤銷功能。
5. 匿名客戶維持獨立 `guest_sessions`，不建立後台 `users`：分享 Token 可設定不加密、系統自動密碼、攝影師手動密碼、期限及撤銷；細分權限至少 `view`、`select`、`rate`、`favorite`、`tag`、`annotate`、`comment`、`download`。密碼使用安全雜湊，分享 Token 只儲存雜湊；Cookie 採 `Secure / HttpOnly / SameSite` 適當設定，API 每次驗證權限。禁止無登入訪客藉一個專案 Token 枚舉其他專案。
6. 訪客可在**同一受授權邀請**下查看自己的操作歷史；如要跨裝置或跨專案統一識別客戶，必須額外透過 Email OTP 或獨立客戶憑證驗證，**不能僅憑訪客名稱或瀏覽器 Cookie 就列出所有歷史專案**。

## D. Cloudflare R2 多儲存節點架構（預留，預設單節點）

1. 建立 `StorageAdapter` 介面及 `R2StorageAdapter`，預留跨帳號的 S3-compatible Adapter。主 Worker 使用同帳號 R2 binding；跨帳號可透過各自的 R2 S3 Endpoint + Access Key / Secret Key 存取，但**所有憑證只能放 Cloudflare Secret / 安全憑證管理系統**，D1 僅保存 `credential_ref`，永不存明碼。
2. D1 `storage_nodes` 包含 `id, provider, account_id, bucket_name, endpoint, credential_ref, status, priority, quota_bytes, used_bytes, reserved_bytes, last_reconciled_at`。`photo_assets` 每筆都存 `storage_node_id`、物件 key、實際 bytes、checksum、狀態、版本 ID。
3. 上傳由 Storage Router 選節點，優先同相簿既有節點，再依容量及優先級選擇。使用 D1 交易或**原子條件更新**預留容量，約束 `used_bytes + reserved_bytes + incoming_bytes <= quota_bytes`，防止併發超用；逾時或失敗釋放預留，定期 reconciliation 對帳。
4. 新增節點僅表示技術上支援，不得宣稱多 Cloudflare 帳號疊加 R2 免費額度一定受到官方允許。將「跨帳號自由分流」以 feature flag 預設關閉，並在部署文件清楚提示先確認條款與帳單歸屬。不要自動建立額外 Cloudflare 帳號，也不要實作規避平台限制的流程。
5. 同一 Cloudflare 帳號的多 Bucket **不能視為額外 10 GB-month 免費儲存額度**。帳號及 Bucket 成本獨立檢視；**10 GB-month 是月均／時間累計的計費額度，不是 10 GB 硬容量上限，也不能用瞬間容量限制保證帳單為零**。
6. 支援節點停用、唯讀、健康檢查、文件化的搬移流程；跨節點搬移必須 copy → checksum/大小驗證 → 交易式切換資產位置 → 延後清理來源，失敗可重試且不遺失資料。

## E. 空間控管、保護與自動刪除

1. 容量政策皆可在 Owner 後台調整，預設單節點內部配額 `9,000,000,000 bytes`；70% 通知、80% 進入清理候選、清理至 65% 以下、95% 阻止新的上傳預留；這些是**內部軟／硬策略**，不是 Cloudflare R2 官方免費上限。顯示節點容量、已用、已預留、待刪、最後對帳時間。
2. 支援 `30 天無有效人類瀏覽` 清理：`last_meaningful_human_view_at` 由經授權的相簿頁面互動或 heartbeat（限頻率）更新，不得把縮圖資源請求、爬蟲、Cron、Worker 定期檢查當成有人瀏覽。提供可調整天數。
3. 容量超過 80% 時可依「最舊、已封存、最近未使用」選擇相簿／版本候選；不清理正在上傳、挑片、精修、驗收、交付、受法律保全、明確釘選、尚在最低保留期（預設 7 天）或仍有進行中任務的內容。
4. 自動刪除**預設 `enabled=false` 且 `dry_run=true`**，先可預覽候選清單、預估釋放容量、原因、影響檔案與版本；正式執行前以 Owner 明確啟用並設定確認或延遲保護窗，對重要專案可永久保護。執行前重新檢查資格與鎖定，不可僅憑舊排程快照刪除。
5. 刪除工作以狀態機 `candidate -> quarantined/locked -> deleting -> deleted/failed` 管理；Queue/Cron 任務需冪等、重試、安全取消、限速、部分失敗續跑。先停止分享／下載、再刪除相關 R2 Object，最後核銷容量與更新資產狀態；刪除紀錄須保留，但客戶照片內容依法與保存政策刪除。不可讓刪除誤傷不同 Workspace、照片版本或受保護資產。
6. 區分「主動刪除」「容量清理」「過期清理」「版本整理」；建立警示、刪除預演、恢復機制與可選獨立備份。R2 本身不是備份；如果沒有真正的隔離備份，不要宣稱可無條件恢復已刪檔案。
7. 提供針對月度 `GB-month` 的用量估算及外部帳單警示指引；因用量延遲、其他操作、版本數、API 次數等，不能在 UI 保證「一定零費用」。

## F. 照片版本、同名判定與 Before/After

1. `photos` 是固定邏輯照片；`photo_versions` / `photo_assets` 是不可變的實體檔案。新版本使用新 Object Key，**不能直接覆蓋舊 R2 Object**，並保留版本建立者、時間、hash、尺寸、EXIF 和變更註記。
2. 上傳時依相簿範圍、正規化原始檔名及可選 hash 偵測可能同名；提供 `新增為新照片`、`新增為既有照片版本`、`取消` 三選一。不可僅憑同檔名自動覆寫；另有手動「上傳此照片的新版本」按鈕。允許重新指定目前展示版本，所有舊版仍可回溯。
3. Before/After 至少支援滑桿、左右並排、透明疊合、版本選擇、縮放與平移同步，使用瀏覽器載入兩張已授權的預覽圖即可；將進階差異熱區列為後續功能，可用 browser Web Worker 處理且注意照片尺寸、方向及色彩空間對齊。
4. 留言與標註應綁定固定 `photo_id` 及可選特定 `version_id`；新版本不得清空客戶歷史選片或先前版本的註記，避免誤以為 V2 是另一張新照片。

## G. 完整操作歷史與一致性

1. 建立 append-only `audit_events`：至少紀錄 `event_id, actor_type, actor_id/guest_session_id, workspace_id, project_id, album_id, photo_id, version_id, action, before_json, after_json, request_id, occurred_at_utc`。
2. 必須涵蓋選取、取消選取、再次選取、星等新增／修改／清除、收藏新增／取消、標籤操作、留言新增／編輯／刪除（保留編修痕跡）、註記及版本操作、正式提交與重開。
3. 目前狀態用獨立快速查詢表；事件表保留完整時序，修改狀態與記錄事件應在同一次資料庫交易中完成。加入冪等鍵／重送處理，避免雙擊造成重複事件。所有時間 UTC 儲存、前端顯示台北時間。
4. 訪客僅能查看自己已驗證 Session／身分所屬事件；Owner 可按客戶、照片、專案、事件類別、時間查詢及匯出 CSV。

## H. 安全、測試與驗收

1. 後端全面驗證 Owner / Guest 權限，不依賴前端；R2 原檔維持私有，檢視與下載權限分離；短效授權 URL 可被使用直到過期，需縮短期限並在發行授權前再次驗證。
2. 建立以下測試：未授權 Google/GitHub OAuth 拒絕註冊；合法 Owner 雙帳號綁定／解除；匿名連結無密碼／自動密碼／自訂密碼及各權限組合；訪客無法跨相簿讀取；同名照片追加版本；Before/After 版本切換；選片→取消→再次選片歷史；併發上傳配額保留；30 天無瀏覽清理、80% 清理、保護相簿跳過、dry-run 不刪任何檔案；跨節點存取及搬移失敗補償。
3. 若外部 Cloudflare／Google／GitHub 憑證不可用，仍應完成 mock / local D1 / local R2-compatible 測試、可執行範例及部署說明；不能聲稱已在正式環境驗證。
4. 保留自用版功能精簡，但所有 API、資料模型和儲存 Adapter 須支援未來由單一 Owner 擴充為多租戶／商用版本，避免全程硬編碼私人 Email。

## I. 你（Codex）現在應該執行的工作順序

1. **盤點**：閱讀 repo，列出現況、與本補充規範衝突之處、功能缺口及風險，特別確認目前是否使用 Next.js / Vercel / Supabase。
2. **文件更新**：建立 `docs/ADR-Cloudflare-Free-First.md`、更新 `docs/ARCHITECTURE.md`、`docs/AUTH_SPEC.md`、`docs/STORAGE_SPEC.md`、`docs/DEPLOYMENT.md`、`docs/HANDOFF.md`；標註本規範是部署架構補充，不是取消原始功能清單。
3. **實作最小可運行垂直切片**：Cloudflare Workers 網站與 API、D1 migration、單一 R2 上傳／授權讀取、Owner-only 雙 OAuth 的安全骨架；再逐步實作訪客、版本、歷史、容量與自動清理。
4. **小批量提交**：每完成一個可驗證工作單位，就執行 typecheck / tests / build，更新 `docs/HANDOFF.md`、`docs/DECISIONS.md`，列明修改檔案、未完成項、風險、如何測試、下一步，並建立有意義的 Git commit（若環境允許）。
5. **交付報告**：清楚分別列出「已實作並測試」「僅有架構或規格」「尚需使用者提供的外部金鑰／權限」「仍待驗證的服務條款與費用」。不得憑空宣稱已部署、已啟用 OAuth、已建立多 Cloudflare 帳號或已符合免費計費條件。
6. 除非缺少的資訊會立即造成不可逆資安或資料損失，否則使用安全預設與 mock 推進；**禁止因缺少雲端憑證而停止撰寫本地可執行的程式與測試**。

**開始執行：先盤點現有 KINO Pic repository，產生相容性報告與優先工作清單，然後直接完成可落地的第一個實作階段。**
