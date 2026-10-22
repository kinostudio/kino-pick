# KINO Pic — AI Agent 交接紀錄

## 當前專案狀態

- Repo：本文件所在專案根目錄；產品正式命名 KINO Pic。
- Branch：`codex/kino-pic-foundation`；基礎提交見 `git log -1`，若尚無 log 則仍為待提交檔案。
- Last agent：Codex；Last updated：2026-10-23（Asia/Taipei）。
- Current phase：M0 本機基礎完成；M1 未開始。
- Worktree ownership：單一代理；無平行工作者。
- Next smallest Task：M1-01 身分／workspace provisioning／角色 RLS 垂直切片。
- Next command：`git status --short`，然後 `pnpm install --frozen-lockfile`、`pnpm test:integration`。

## 2026-10-23 — Phase 0

- 盤點：使用者指定目錄原只有 ZIP 與合併規格，沒有 Git / app / 遠端。開啟的 KINO 官網是另一個有 dirty changes 的 repo，未對它寫入。
- 按使用者指定位置展開規格於同一目錄，初始化 Git，保留原始附件（不納入活躍 source），全數活躍文件改名 KINO Pic。無遠端、無推送、無部署。
- Task IDs finished：M0-01～M0-04（僅初始 foundation 範圍，詳 TASKS）。
- Files：apps/web、apps/worker 預留說明、packages/domain/contracts/storage/db/ui、tests、tools/migrate.mjs、pnpm / lint / strict TS / formatter / Playwright / CI、env 範本與文件。
- Core interfaces：StorageAdapter、StorageQuotaService、RetentionPolicyEngine、AuditEventWriter、VersionMatcher、ImageDiffService。僅 memory storage 有本機實作，其他服務未實作。Retention interface 只提供規劃，沒有破壞性執行入口。
- DB：202610230001，profiles/workspaces/workspace_members/projects/albums/photos；read-only tenant RLS、跨租戶 composite FK、retention OFF/dry-run constraints。完整後續 schema 未建立；沒有版本、guest、審計事件資料表，勿宣稱已完成。
- Recovery：migration runner 使用 transaction/advisory lock/checksum；備份/forward fix/還原程序見 packages/db/README.md。沒有連接或變更真實 Supabase。
- API：只有 `/api/health` 存活與 env 驗證；不會探測 OAuth/DB/R2。錯誤設定回 503；非正式 readiness。
- UI：只有實際 Phase 0 狀態頁與 health link，沒有假 project/gallery 或無效功能按鈕。

## Commands actually executed

| Command                            | Result             | Evidence / scope                                                                                             |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| pnpm install                       | passed             | lockfile + explicit allowBuilds；Node 24.18.0 / pnpm 11.25.0                                                 |
| pnpm lint                          | passed             | 0 errors/warnings after config correction                                                                    |
| pnpm typecheck                     | passed             | root packages + Next.js strict TS                                                                            |
| pnpm test:unit                     | passed             | 9 tests: env safe defaults/rejections, scope isolation, immutable bytes/keys, idempotent delete              |
| pnpm test:integration              | passed             | 1 embedded PostgreSQL test: migration execution, tenant RLS, anon/write deny, FK isolation, suspended member |
| pnpm build                         | passed             | Next.js 16.4.2 optimized local build, `/` and `/api/health`                                                  |
| pnpm test:e2e                      | passed             | 1 Chromium test: real local server, status UI, health link/API/headers, 375px no horizontal overflow         |
| pnpm dev --port 3102               | passed             | server ready; GET / and /api/health returned 200; stopped after smoke test                                   |
| pnpm audit --prod --json           | passed             | 0 reported info/low/moderate/high/critical; local report .local/audit.json                                   |
| pnpm db:migrate (no DATABASE_URL)  | expected rejection | exit 1 before connection, no database changed                                                                |
| real Supabase runner / RLS         | not_checked        | no DB URL, psql or Docker in this environment                                                                |
| real Google OAuth + private R2 E2E | not_checked        | credentials not supplied; M1/M5 release gates remain                                                         |
| GitHub CI                          | not_checked        | workflow defined locally; no remote/push                                                                     |

Final format/document checks recorded in docs/VERIFICATION.md. Screenshots `.local/phase0-desktop.png` and `.local/phase0-mobile.png` are local QA outputs, ignored by Git.

## Problems / risks / next task

- Initial install rejected unapproved native builds; resolved with pnpm 11 allowBuilds for explicit dependencies only. Initial TS7/ESLint10 failed compatibility; pinned TS6 and ESLint9. Initial lint accidentally scanned generated .next; fixed global ignores. Generated next-env.d.ts excluded from formatting. No failed check is being represented as a pass.
- ESLint 9.39.5 is registry-deprecated/unsupported; upstream Next plugin compatibility needs revisiting before release. See ADR-0002.
- No credentials were created or requested. Production adapters, Auth, API mutations, workspace provisioning, event transaction/idempotency, quota/retention algorithms and full gallery remain unimplemented.
- Safe retention defaults are enforced, but actual owner opt-in preview, locks/rechecks/retries/audit need future implementation. Do not enable autodeletion.
- Embedded PostgreSQL with auth shims is not hosted Supabase validation. Before M1 acceptance, test real authenticated claims, roles, provisioning and tenant isolation in disposable local/staging Supabase.
- Next M1-01：Supabase SSR Google OAuth callback + transactional workspace creation/role writes with API authorization and real RLS negative tests. Read AGENTS, SECURITY, STORAGE_RETENTION, DATA_MODEL and TEST_ACCEPTANCE first.
