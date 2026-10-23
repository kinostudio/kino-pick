# Task Board — 由 AI 每次結束前更新

> 狀態：`[ ]` 未完成；`[x]` 完成且驗證；`[~]` 正在處理（請改為列於「當前執行」段，避免 Markdown checkbox 混用）。M0 基礎已驗證；M1–M5 尚未完成，完整需求均保留。

## 當前執行

- Owner: Codex
- Branch/worktree: codex/kino-pic-foundation / 專案根目錄
- Task ID: CF-01 Cloudflare/D1/Owner foundation；下一步 CF-02 D1業務/既有UI port
- External gates: 真實 Google OAuth / Supabase / R2 憑證未設定；不阻礙本機實作與測試

## M0 基礎

- [x] M0-01 初始化 pnpm monorepo + web + worker + shared packages
- [x] M0-02 設定 TypeScript strict, lint, format, unit/e2e runners, CI
- [x] M0-03 開發環境變數/schema 驗證與 mock adapters
- [x] M0-04 將本規範對應到可執行資料庫 migrations / local dev 啟動指令

## M1 專案與相簿

- [ ] M1-01 Google/GitHub OAuth + 同身分綁定 / workspace / role & tenant RLS（本機完成；真實 Google/GitHub/Supabase 驗收未完成）
  - [x] SSR PKCE、verified getUser、workspace/member RPC、RLS、交易審計與重送去重
  - [x] 單一或雙來源同一身分、帳號頁與主動綁定、短效 hashed intent、actor/衝突/來源停用負面測試
  - [ ] 真實 provider/manual linking、automatic-email policy、fresh reauth/安全 unlink 與新增架構補充相容性驗證
  - [x] 本機整合與安全回歸通過（最新數量見 VERIFICATION）；fixture 不代表雲端 E2E
- [ ] M1-02 Project/album CRUD + dashboard（建立/讀取/改名子集合完成）
  - [x] Schema/repository/API/UI：專案/相簿建立、24 筆 cursor 分頁、改名、重新載入持久化
  - [x] tenant/parent immutable、角色/撤權、expectedRevision、audit + idempotency 原子交易
  - [x] 409 保留草稿、未知提交結果安全重試、過期 cookie refresh/重放負面測試
  - [ ] 受控狀態/封存、保護/保留政策 UI/API；相簿刪除須走後續 job，禁止直接 DELETE
  - Evidence: e68dfa8 / 69cdf6b / 875ea0b / 2e35302；完整整合提交見 git log -1
- [ ] M1-03 R2 direct upload/resume/finalize + image thumbnail worker
- [ ] M1-04 Grid photos query/pagination/lightbox

## M2 客戶挑片 + 詳細歷史

- [ ] M2-01 link_only/generated_password/custom_password + guest session
- [ ] M2-02 share permissions and cross-project deny tests
- [ ] M2-03 selection, rating, favorite, tags, selection limit/submission
- [ ] M2-04 append-only events for all actions + per-photo/project/guest history
- [ ] M2-05 client portal secure grant for authorized previous projects

## M3 照片版本

- [ ] M3-01 versions/assets immutable DB and paths
- [ ] M3-02 manual new version and current version switching
- [ ] M3-03 same-file-name auto/assisted matcher and duplicate checks
- [ ] M3-04 Before/After slider, side-by-side, overlay with ratio support
- [ ] M3-05 version-specific comments/annotations linkage and tests

## M4 儲存清理

- [ ] M4-01 storage ledger, upload reservations, dashboard
- [ ] M4-02 R2 usage reconcile + stale-metric alarms
- [ ] M4-03 30-day valid view heartbeat; inactivity eligibility engine
- [ ] M4-04 >80% cleanup oldest eligible album to <=65%, block uploads >=95%
- [ ] M4-05 dry-run plan UI, opt-in, exclusions, locks, queue, idempotent delete
- [ ] M4-06 deletion audit events, retries, tombstones, pressure tests

## M5 完善

- [ ] M5-01 region annotations and review statuses
- [ ] M5-02 version approvals/delivery/ZIP/download audit
- [ ] M5-03 notifications, security hardening, a11y and mobile testing
- [ ] M5-04 staging real OAuth + R2 E2E, release runbook

## 更新方式

每次完成一個 item：① 勾選（有測試證據）② 記錄 commit hash/branch ③ HANDOFF 記錄測試命令及結果 ④ 下一個 item 明確指派 ⑤ 記錄仍未實現的行為，不隱瞞。

## M0 完成範圍與限制

- M0-01：web 與 shared packages 可執行；worker 為明確的預留邊界，尚無 R2 handler。
- M0-02：lint/typecheck/unit/integration/build/Playwright 本機通過；GitHub CI 僅已配置，未上傳執行。
- M0-03：六個 service interfaces、Zod env/health、immutable memory storage。介面不是正式 service 實作。
- M0-04：六張初始表、read-only RLS、migration runner 與復原指引；PGlite SQL/RLS 通過。真實 Supabase migration runner、OAuth、R2 尚未驗證。
- Next：M1-02，先實作專案/相簿資料完整性、授權、版本衝突、交易審計，再接 API/UI。

## 本輪交付與高難度優先順序

- 2026-10-23：主代理與兩個獨立 worktree 子代理完成上述 M1-02 子集合及安全修正；27 unit / 21 integration / 7 browser，全套 lint/typecheck/build 通過。
- 下一個最小任務：M1-02 狀態/保護流程。先定義允許的 transition、活動寫入/封存互斥鎖與審計，再做 API/UI；不實作無工作佇列保護的刪除。
- 再接 M1-03：配額 reservations、immutable object identity、上傳完成驗證的交易不變量，再連接 private R2/thumbnail pipeline。
- 真實 Google/Supabase/PostgREST 與多連線 PG 壓力驗證、R2 為獨立外部 gate，尚未通過；全部 M1–M5 未完成需求持續保留。

## OAuth 來源補充交付

- 依使用者明確確認完成 Google / GitHub 可只綁一個或同時綁兩者，共用一個 user ID/原 workspace；本機 32 unit / 27 integration / 11 browser + lint/typecheck/build 通過。Web 整合提交 1847e0d；DB/測試/文件提交見 git log -1。
- 真實 provider 尚未設定，manual linking app 預設關閉；解除綁定、closed registration、Owner bootstrap 與新增部署方案尚未實作，見 AUTH_SPEC/LOCAL_AUTH。無聲轉換 stack 不是本回合範圍。

## 相容性工作（部署與切換尚未完成）

- [x] COMPAT-01 既有程式/補充規範差異、Auth/SQL/hosting 邊界、官方來源與 registry metadata 盤點：ADR-Cloudflare-Free-First.md
- [x] COMPAT-02 獨立 worktree vinext 1.3.0 static check（apps/web 15/15）；主應用依賴不變
- [x] COMPAT-03 八項記憶體 SQLite 試驗：零列 UPDATE 陷阱、tenant/current authorization、CAS、重送及 audit/write failure rollback
- [x] COMPAT-04 本機隔離 hosting build/workerd preview：沿用 Supabase/PostgreSQL，既有 browser cases 加直接頁面 proxy refresh 回歸通過；僅 local runtime，不宣稱已部署。實驗保留於 codex/kino-pic-cloudflare-runtime；重現/限制見該分支 experiments/cloudflare-runtime/README.md 與 VERIFICATION。
- [ ] COMPAT-05 Auth/repository ports、Owner/closed/implicit-linking 政策、實際 D1 binding 及完整 roles/concurrency/restore rehearsal

本輪通過 lint/typecheck、32 unit、35 integration、build、format/docs；browser runtime 未變，沿用 9533171 的 11 tests 歷史證據，本輪未重跑。SQLite 不是 local/remote D1；原始 M1–M5 功能與外部 gates 保留。

- 主分支新增直接頁面過期 session 回歸；Next12browser通過。Next Vary 覆寫差異及 private/no-store 安全斷言見 VERIFICATION。下一產品切片維持 M1-02 狀態/保護；雲端 hosting gates 與 COMPAT-05 仍未完成。

- [x] M1-02 protection 子集合：owner-only 相簿釘選/保留保護、解除確認、CAS/audit/replay、實際 API/UI；migration0007。完整狀態/封存/專案保護與刪除仍未完成，驗證見 HANDOFF/VERIFICATION。

- [x] M1-02 archive 子集合：owner-only 空專案/相簿可逆封存、原狀態保存、編輯凍結、CAS/audit/replay/API/UI，migration0008；完整照片/review/upload 狀態流程與刪除仍未實作。
- 下一最小任務：M1-03 配額 reservation 與上傳 session 的 DB/交易不變量，先驗 tenant、重送、過期、封存互斥及配額耗盡拒絕，之後再接 private R2。不得將空內容封存視為完整 M1-02 CRUD 完成。

## 明確採納 Cloudflare 補充後的工作順序

- [x] CF-01 真正本機 Worker/static/API、D1 migrations、固定Owner bootstrap、成熟 Google/GitHub OAuth閉鎖骨架、R2 adapter、Cron無刪除觀察與CI/CD gate；不等同全產品cutover。測試見VERIFICATION。
- [ ] CF-02 D1 workspace/project/album/protection/archive repo與既有UI port；Owner policy等效案例／tenant/audit/CAS/replay及資料ID mapping rehearsal。
- [ ] CF-03 fresh link/unlink、會話管理、quota reservation/expiry/verified complete、R2直傳signer、photo_assets節點/不可變版本模型。
- [ ] CF-04 原guest/gallery/selection/ratings/favorites/tags/comments/annotation/audit/version/BeforeAfter/delivery全部待辦繼續保留。
- [ ] CF-05 完整 retention dry-run preview/opt-in/locks/queues/retry/reconcile，現有Cron observation不能算完成。
- [ ] CF-06 真實provider/HTTPS、D1/R2資源、完整目標驗收、backup/restore、費用條款、正式受控CD。

舊Next/Supabase開放建帳差異保留為參考現況，沒有直接停用；目標Worker以Owner gate拒絕非Owner。完整功能與資料遷移未完成前不得切換。原附件保留不改寫。

- [x] CF-02a D1 workspace backend: additive0003, repository, Owner-only create/read API, atomic replay/audit, same-time keyset pagination and cap tests on real local workerd/D1.
- [ ] CF-02b Extend durable commands to a shared operation namespace; port project/album create/read/rename CAS, protection/archive, then connect existing React UI through a target repository adapter. Preserve reference until browser-equivalent target acceptance. CF-02 remains unchecked; this backend increment has no new target UI/E2E flow.

- [x] CF-02b D1 target backend subset: shared actor/request ledger with 0003 request snapshot migration; project/album create/read/rename, album protections, empty-content reversible archive; tenant/parent checks, CAS, before/after UTC audit, replay, rollback and local D1 tests (migrations0004/0005).
- [ ] CF-02c connect existing workspace/project/album React UI to target Worker with same-origin Owner session and browser acceptance; preserve reference app until this passes. Then map all archive/protection/empty-content semantics and evaluate real ID import rehearsal. CF-02 overall remains open.

- [x] CF-02b D1 content backend and empty-content policy subset: projects/albums APIs, global command ledger, historical workspace retry upgrade, album protection/archive, immutable parent + photo catalog scope guards. Twenty-five local check groups pass.
- [ ] CF-02c target UI: establish same-origin Worker/React session hosting/API bridge, port current screens, run browser acceptance against D1. Full CF-02 and SaaS rollout remain open.

- [x] CF-02b audit collision correction: migration0006 preserves event rows and removes cross-actor `(action,request_id)` uniqueness; isolated upgrade/data preservation and duplicate IDs across actors verified. Remote backup/restore and large-table rehearsal are still CF-06 gates.

- [x] Audit rebuild repair: D1 migration0006 now removes the legacy global request/action uniqueness; migration0007 rebinds all append-only event writers. Historical row equality and post-migration session audit are verified in isolated D1. Full-size staging snapshot/recovery still gates remote use.
