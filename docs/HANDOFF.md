# KINO Pic — AI Agent 交接紀錄

## 當前專案狀態

- Repo：本文件所在專案根目錄；產品正式命名 KINO Pic。
- Branch：`codex/kino-pic-foundation`；基礎提交見 `git log -1`，若尚無 log 則仍為待提交檔案。
- Last agent：Codex；Last updated：2026-10-23（Asia/Taipei）。
- Current phase：M0 完成；M1-01 與 M1-02 建立/讀取/改名本機整合完成；真實雲端與完整 M1 待驗證。
- Worktree ownership：兩個子代理於 .local/worktrees/projects-backend、projects-web 獨立分支完成，已整合；子 worktree 保留，未寫入官網 repo。
- Next smallest Task：M1-02 受控狀態/保護流程：transition/活動寫入互斥/審計，再接 API/UI。
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

## Portability follow-up

- `next typegen` precedes web typecheck; next-env.d.ts is generated/ignored. Migration checksum normalizes CRLF to LF for cross-platform replay. Clean checkout verification is recorded in VERIFICATION.

## 2026-10-23 — M1-01 本機身分與 workspace

- 實作 Supabase SSR Google PKCE、getUser 驗證、Google identity、HttpOnly/Lax cookie、固定 callback、canonical Origin/Fetch Metadata CSRF 防護。AUTH_DRIVER 預設 disabled；fixture 只在 tests。
- Workspace 建立、24 筆 cursor 分頁、owner 成員角色 API；migration 202610230002 建立管理 audit_logs 與私有重送 ledger。RPC 在同交易寫入資料/審計/去重；audit 拒絕修改/刪除，角色停用即失去 RLS 可見性。
- API 限制真實串流 body 16KiB、嚴格 Zod、generic errors、private/no-store。登入/工作台為真實 API，沒有假專案/照片功能。
- 已執行通過：typecheck、lint、17 unit、6 integration、build、4 Playwright、format:check、check_handoff.py（24 files）、production dependency audit（0）。完整結果見 VERIFICATION。
- 修正測試中發現的 native form Origin:null（僅可信 same-origin Fetch Metadata 允許）、route announcer locator、fixture 第二個 actor 切換及微秒 cursor。桌面/375px 截圖已檢視，存放 .local/m1-dashboard-*.png。
- 真實 Google/Supabase/PostgREST、PG 多連線鎖競態、R2 仍 not_checked。PGlite/auth fixture 不是雲端 E2E，沒有部署或推送。
- Schema recovery：見 packages/db/README.md；撤銷 RPC EXECUTE 以停止 mutation、備份後 forward fix，保留 audit/ledger，禁止直接刪表回滾。
- 未完成：team 管理 UI、專案/相簿、R2 上傳、完整 photo/guest activity_events、quota/retention 執行。自動刪除持續 OFF/dry-run。
- 使用者要求優先高難度：下一切片先建立 DB 授權與交易不變量、重送一致性、樂觀鎖及負面測試，再交付可操作 API/UI。完整功能清單不省略。

## 2026-10-23 — M1-02 子集合與高難度修正（最新）

- 使用者要求優先處理高難度問題、授權子智慧體平行工作。DB 與 Web 各自在獨立 worktree 提交，再由主代理 cherry-pick 整合。功能提交 e68dfa8 / 69cdf6b / 875ea0b / 2e35302；整合回歸提交見 git log -1。
- 可實際操作：登入後工作空間 → 專案建立/分頁/改名 → 相簿建立/分頁/改名，重新載入保留資料。retoucher 僅讀，owner/editor/photographer 管理內容。沒有照片或上傳假按鈕。
- 高難度保障：固定 request→workspace→resource 鎖順序；角色檢查先於重送；tenant/parent 不可變；expectedRevision 防止遺失更新；資料/審計/ledger 同交易。撤權後同一成功請求重送也拒絕。
- Migration 0003：審計 TRUNCATE 防誤清、首次 provisioning NO KEY UPDATE；0004：revision/parent guards、四項內容 RPC；0005：workspace Unicode trim/code-point 長度與 API 一致。皆為 additive/forward fix，沒有刪資料；復原及撤銷寫入權限指引見 packages/db/README.md。歷史異常名稱沒有自動改寫。
- 新測試涵蓋：撤權兩次讀取快照、audit failure rollback、歷史重送不還原新狀態、跨租戶/唯讀/停權、stale revision、不可變父項、Unicode 邊界、cursor 微秒與 24+2 分頁。瀏覽器驗證同時改名、409 草稿保留/重載、編輯中撤權、提交後遺失回應再重試無重複/額外 revision。
- Session fixture 改為 session_id/token family 關聯；過期多段 cookie refresh、兩個同時請求、HttpOnly 寫回、登出舊/新 cookie 重放皆通過。十秒 refresh reuse 僅測試子集合，不是完整 GoTrue。
- 已實際執行並通過：pnpm lint、typecheck、27 unit、21 integration、build、7 Playwright。production audit 0；報告 .local/m1-projects-audit.json。桌面/375px 相簿畫面已檢視，.local/m1-project-desktop.png 與 m1-project-mobile.png。
- 真實 Google/Supabase/PostgREST、實際 PG 多連線鎖等待/死鎖壓測、R2、CI/部署仍 not_checked。瀏覽器同時 HTTP 請求進入序列化 PGlite，只驗證 API/CAS 結果，不證明真實 PostgreSQL contention。
- 未完成：封存/狀態/保護控制、team UI、照片/上傳/版本/guest/完整 activity_events/配額/retention job。自動刪除仍 OFF、dry-run ON；完整 M1-02/M1–M5 不勾完成。ESLint9 上游支援風險保留。
- 下一個最小任務：先設計專案/相簿狀態轉換與保護的 transactional invariants，再 API/UI/負面測試；之後 M1-03 預留配額與 private immutable upload。工作皆本機提交，未推送或部署。

- 收尾檢查：frozen install 通過；首次 format:check 指出 sessions.spec.ts 格式差異，已格式化後重跑。最終結果見下列命令輸出及 VERIFICATION。

- 最終收尾通過：pnpm install --frozen-lockfile、pnpm format:check、python tools/check_handoff.py（24 files）、git diff --check。
