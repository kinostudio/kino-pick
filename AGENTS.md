# Shared Agent Rules — KINO Pic（奇諾選圖）

> 本檔是 **Codex 與 Google Antigravity 共用的最高層專案指引**。不得由不同 AI 各維護一份相互矛盾的規格。

## 執行次序

1. 每次工作開始：閱讀 `docs/CODEX_ARCHITECTURE_ADDENDUM.md`、`README.md`、`docs/HANDOFF.md`、`docs/TASKS.md`、`docs/DECISIONS.md`，再閱讀本次功能對應的 docs。
2. 先檢查目前檔案、Git 狀態與未提交變更；尊重其他代理已完成的程式，不重建、不覆蓋。
3. 按 `docs/ROADMAP.md` 垂直切片實作：DB migration → API → UI → 測試 → 文件更新。每次以一個可驗證範圍為限。
4. 變更公共合約、資料表、權限、儲存政策前須先讀 `docs/STORAGE_RETENTION.md`，並同步修改 docs 和測試。不能以程式碼與規格長期不一致的狀態宣告完成。
5. 工作結束：執行可用的 lint/typecheck/test/build；更新 `docs/TASKS.md`、`docs/HANDOFF.md`，註明通過/失敗/未執行原因。不得虛構成功的測試。

## 安全與資料底線

- TypeScript strict；禁止 `any` 逃避型別。所有外部輸入以 Zod 驗證。資料庫必須開啟 RLS 或在可信伺服端實施等效租戶授權，兩者以測試證明。
- R2 Bucket 永遠保持私有。禁止將原圖公開網址、R2 主密鑰、Supabase service role key 送至瀏覽器。
- 影像上傳採臨時授權，驗證 object key、MIME magic bytes、大小、租戶配額、上傳狀態與 ownership；完成回報不得盲目信任客戶端。
- 任何照片被刪除、替換或提交挑片時要有 transaction/狀態鎖與可重試機制。所有會破壞資料的任務必須支援 dry-run。
- 客戶的每次挑選、取消、星等、收藏、標籤、標註、留言、版本核准等事件以 append-only log 紀錄；不能僅保留最後狀態。
- 無密碼分享連結是 bearer credential；不可讓擁有單一相簿連結的訪客自動看見其他專案。
- 用具唯一 object key 的新版本／衍生圖，絕不在 R2 原地覆寫舊版。版本切換須可追溯。
- 自動刪除必須 opt-in、先 dry-run、提供預估釋放量與刪除原因；依法須保留的內容不受自動清理影響。
- 不向 Git 提交 `.env`、API key、Cookie、下載連結、客戶影像。使用 `.env.example` 與專案密鑰管理。

## 技術基線

- Web：Next.js App Router、React、TypeScript、Tailwind、shadcn/ui、TanStack Query、Zod。
- 新部署目標（使用者 2026-10-23 明確授權）：Cloudflare Workers/Static Assets + Hono + D1/Drizzle + Better Auth Google/GitHub；REGISTRATION_MODE=closed、明確本機 Owner bootstrap、同一固定 users.id，禁止 Email 隱式合併。自訂 guest session 保持獨立。
- 現有可運作參考：apps/web Next + Supabase/PostgreSQL、packages/db 八個 PG migrations 與原回歸，保留直到等效遷移驗收。新 apps/worker 目前只有 migration foundation，不能當成完整產品切換。舊 Auth 沒有被假稱已改為 Owner-only。
- Frontend 不無理由重寫：既有 React/Next UI 優先重用，vinext hosting PoC 有本機證據；新 D1 業務 API/授權及 UI 接入須另驗。未核准切換前不停止既有服務。
- Storage：Cloudflare R2（private）；workers for image delivery and image processing；Queues / Cron for background tasks。
- Monorepo：pnpm workspaces；有需要時以 Turborepo 輔助，但不要為了工具化過度複雜。
- 測試：Vitest / Testing Library / Playwright；權限、事件 log 與自動刪除優先測試。
- Coding：採清晰分層和單一職責，資料存取只能走 repository/service；避免 UI 直接接觸高權限金鑰。

## 跨代理共用

- 所有事實以 Git 檔案為準，不依賴單一 AI 的對話上下文。
- Antigravity 應讀本 `AGENTS.md`；`GEMINI.md` 僅做導引。勿把 `.agents/workflows/` 當成唯一工作流程（舊 workflows 在部分新版已有遷移變動）。
- 永遠以相對路徑寫文件，不綁 Windows `C:\` 或特定電腦路徑；命令另說明 Windows PowerShell / macOS Linux 差異。
- 若有兩個 AI 同時工作，採獨立 Git worktree/branch；不得在同一工作樹同時修改同一檔案。
- 決策需記 `docs/DECISIONS.md`，交接需記 `docs/HANDOFF.md`，改動需記 `docs/CHANGELOG.md`。

## 交付格式（每次工作完成後）

- 完成哪些功能、修改檔案、migration 影響、執行指令與結果、已知問題、下一個最小任務。
- 完成標準以 `docs/TEST_ACCEPTANCE.md` 為準，不得用 UI mock 代替 API / DB 真實功能。

## Cloudflare 遷移執行規則

- 目標與現況以 docs/ARCHITECTURE.md、AUTH_SPEC.md、STORAGE_SPEC.md、DEPLOYMENT.md、HANDOFF.md 為準；同一 repository，不建立另一套無關產品。docs/docsCODEX_ARCHITECTURE_ADDENDUM.md 為使用者原附件，保留原狀；標準整合副本為 docs/CODEX_ARCHITECTURE_ADDENDUM.md。
- D1 migrations 在 apps/worker/migrations；不得把 packages/db/migrations 的 PG SQL 直接套到 D1，也不得覆寫其 checksum。D1 無 RLS/PG RPC，trusted Worker 必須驗 Owner/Guest/tenant，狀態/audit/CAS/replay 必須重建等效不變量並實測。
- Owner 不依第一個登入者或 email 建立。Bootstrap 只接受管理員外部驗證過的 provider subject，固定內部 UUID；CLI attestation 不等於 CLI 已向外部驗證。首次交易成功後鎖住 bootstrap；未完成 fresh reauth/last-provider guard 的 link/unlink 入口維持關閉。
- 單 private R2 node 預設啟用，credential_ref 不等於明碼。跨帳號須未來明確管理員啟用並確認條款/帳單；禁止宣稱多帳號免費疊加。新 D1 node 9GB 為內部配額；舊 PG 8GB 不自動改寫。
- Cron 目前只有無刪除觀察審計，不是完整 retention preview。自動刪除 OFF/dry-run ON；完整 planner/locks/jobs/保護與重試驗證前不得開啟。不要由 Worker 中繼大圖或假設免費 Worker 可處理任意原圖/熱區。
- 每次涉及新目標必跑 pnpm test:cloudflare（實際 workerd/D1/R2＋測試 provider）；保留原 lint/type/unit/integration/build/browser checks。測試外部替身不是正式 Google/GitHub/R2 端到端驗收。
- GitHub Actions 僅 CI/CD；受控 deploy workflow 在 foundation 仍被 readiness guard 拒絕，不可為了讓 workflow 綠燈繞過 gate。正式 provider/資料搬遷/備份復原/上傳/費用驗證後另交付切換。不得推送/部署或碰客戶資料，除非該步驟已被明確授權。

- CF-02a now exposes D1 workspace create/read only (migration0003, repository, real local rollback/replay/page tests). Next UI/reference is unchanged. Before adding other D1 mutation types, extend workspace_commands to a shared actor/request/operation namespace and preserve current authorization before replay. CF-02 product/UI equivalence remains pending.

- CF-02b adds D1 projects/albums, shared `(actor,requestId)` ledger, revision/audit/protection/archive APIs (migration0004). migration test proves a live0003 workspace replay snapshot survives the upgrade. Existing Next/Supabase UI remains on its reference backend; implement same-origin UI port/browser acceptance as CF-02c before claiming CF-02 complete. New photos table is metadata-only; no upload/version API.

- D1 migration0006 rebuilds `audit_events` and preserves records to remove global `(action,request_id)` uniqueness; actor command ledger provides idempotency and `event_id` uniqueness protects each event. Before remote use, snapshot and rehearse the full table copy on a representative DB.

- Audit migrations0006/0007: remove global action/request collision by copying historical rows, then explicitly rebind all audit-writing triggers. Apply both together before traffic; large-table backup/restore rehearsal is required. The temporary legacy-name table in0007 is empty repair scaffolding, not retained audit storage.
