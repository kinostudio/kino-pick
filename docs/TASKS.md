# Task Board — 由 AI 每次結束前更新

> 狀態：`[ ]` 未完成；`[x]` 完成且驗證；`[~]` 正在處理（請改為列於「當前執行」段，避免 Markdown checkbox 混用）。M0 基礎已驗證；M1–M5 尚未完成，完整需求均保留。

## 當前執行

- Owner: Codex
- Branch/worktree: codex/kino-pic-foundation / 專案根目錄
- Task ID: M1-02 專案/相簿切片；M1-01 真實雲端驗收待設定
- External gates: 真實 Google OAuth / Supabase / R2 憑證未設定；不阻礙本機實作與測試

## M0 基礎

- [x] M0-01 初始化 pnpm monorepo + web + worker + shared packages
- [x] M0-02 設定 TypeScript strict, lint, format, unit/e2e runners, CI
- [x] M0-03 開發環境變數/schema 驗證與 mock adapters
- [x] M0-04 將本規範對應到可執行資料庫 migrations / local dev 啟動指令

## M1 專案與相簿

- [ ] M1-01 Google OAuth / workspace / role & tenant RLS（本機完成；真實 Google/Supabase 驗收未完成）
  - [x] SSR PKCE、verified getUser、workspace/member RPC、RLS、交易審計與重送去重
  - [x] 本機 17 unit / 6 integration / 4 browser tests；fixture 不代表雲端 E2E
- [ ] M1-02 Project/album CRUD + dashboard
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
