# KINO Pic Changelog

## 2026-10-23 — CF-01 architecture integration / closed Owner foundation

- Explicitly adopt Cloudflare target while preserving existing Next/PG functionality and all product requirements; canonical addendum/shared agent/runbook docs integrated.
- Add real Worker/Static Assets/Hono/Better Auth/D1 bootstrap/session-audit migrations and private immutable R2 adapter; no first-login Owner, public signup or Email merge. Strengthen Google token signature verification through SDK helper.
- Twelve actual local workerd/D1/R2/provider-fixture checks pass; original34unit/49integration/14browser/build preserved. Local Cron records deleted0 only.
- CI adds Cloudflare verification; controlled CD remains blocked pending reviewed cutover. No real OAuth/resource deployment, direct upload, D1 business port, full linking/session UI or retention planner completed.

## 2026-10-23 — Reversible empty-content archive

- Migration0008 records archive origins; owner-only project/album archive/restore with revision CAS, transactional audit/idempotency and confirmation UI.
- Block photos/busy states; freeze names/new children under archive, preserve child state/protection/human-view clocks, reject unknown legacy restore origins. No deletion or retention enablement.
- SQL/browser regressions cover rollback, roles/revocation, original-state restore, conflict/reconfirm and lost-response retry. Full verification/remaining gates in HANDOFF.

## 2026-10-23 — Owner album protection

- Add migration0007 and owner-only album pin/hold API and UI, explicit unprotect confirmation, shared revision conflicts and atomic before/after audit/idempotency.
- Current authorization precedes replay; deleting/deleted reject new changes. No state transition/deletion/retention enablement or activity-clock reset.
- Add SQL rollback/permission/CAS/replay and browser conflict/network-retry/confirmation tests; verification and remaining gates in HANDOFF/VERIFICATION.

## 2026-10-23 — Isolated Worker runtime proof

- Preserve a pinned vinext/Cloudflare Vite/Wrangler hosting PoC in a separate branch; production build and browser flows executed on local workerd. Default Next/Supabase/PG unchanged.
- Add expired chunked-cookie direct-dashboard regression; verify proxy rotation, HttpOnly/Lax and private/no-store before writable API calls. Record Next versus workerd Vary differences.
- No schema migration, remote deployment or live provider validation. Reproduction, failures and remaining cloud/security gates documented in HANDOFF/VERIFICATION.

## 2026-10-23 — Compatibility assessment and SQLite transaction probe

- Add staged Cloudflare/Next/Auth/D1 assessment with current official sources, runtime/data migration gates and rollback boundaries.
- Pinned vinext static scan of isolated apps/web reports15/15; no adapter adoption or deployment.
- Add eight isolated SQLite tests for CAS/audit failure semantics, replay, tenant scope and revocation. Full32unit/35integration/lint/typecheck/build pass. Application runtime/schema/dependencies remain unchanged.

## 2026-10-23 — Google / GitHub 共用身分

- 支援單來源登入或主動綁定兩來源，共用同一平台 user ID/workspace；新增帳號頁與來源設定開關。
- migration0006：GitHub OAuth guard、私有短效 hashed link intent、前後 actor 驗證、append audit/安全重送，既有資料不搬移。
- 32 unit / 27 integration / 11 browser、lint/typecheck/build 通過；真實 OAuth/設定尚未驗證，manual linking 預設關閉。Auth automatic-email linking、closed/Owner-only、新部署補充的差異清楚記錄，沒有宣稱部署完成。

## 2026-10-23 — M1-02 subset / security hardening

- 專案與相簿可建立、分頁、改名；角色控制、revision 衝突與草稿保留、安全重試。
- migration 0003–0005：audit TRUNCATE 防誤清、首次建帳鎖順序、不可變父項、transactional audit/idempotency、Unicode 名稱一致性；復原文件齊備。
- 新增撤權競態、失敗回滾、斷線重送與 cookie refresh/重放測試；27 unit / 21 integration / 7 browser、lint/typecheck/build 通過，production audit 0。
- 封存/刪除/保護、照片/R2、真實 OAuth/Supabase 與多連線 PG 驗收仍待完成；自動刪除 OFF/dry-run。

## 2026-10-23 — Phase 0

- 正式名稱改為 KINO Pic；指定目錄盤點、規格展開與 Git 初始化，保留原始附件。
- pnpm monorepo、Next.js App Router、React、strict TypeScript、Tailwind、shadcn 設定/共用 primitive、TanStack Query、Zod。
- 核心 interfaces、記憶體 immutable scope storage、本機狀態頁與健康 API。
- 六張初始表與 read-only RLS、migration runner / checksum / lock、復原指引。
- Vitest、PGlite SQL/RLS、Playwright 桌機/手機、本機 CI workflow；尚未遠端 CI 或部署。
- 自動刪除保持 OFF、dry-run ON；Google OAuth、真實 R2、完整 workspace/project/gallery 功能未完成。
- 驗證與限制：見 HANDOFF、VERIFICATION、ADR-0002。下一步 M1-01。

## 2026-10-23 — M1-01 local identity/workspace

- Add server-only Google/Supabase SSR PKCE and verified sessions, workspace dashboard/cursor pagination, owner member API.
- Add migration 202610230002: transactional provisioning/member writes, append-only management audit and private idempotency ledger; recovery documented.
- Add strict API validation/CSRF/body limits and test-only auth HTTP fixture. Local 17 unit / 6 integration / 4 browser tests passed; real OAuth/Supabase remains unverified.

## 2026-10-23 — CF-02a workspace D1 backend

Added migration0003 workspace/command tables, transactional current-Owner/session guards, immutable original responses and workspace.created audit. New Worker create/read workspace endpoints reuse existing contracts/cursor, strict input/Origin/body bounds,24-row keyset paging and100-workspace cap. Added five real local D1/workerd check groups for concurrent retries, input/CSRF, audit rollback, current authorization and tied timestamp pagination/cap. Reference frontend/Auth unchanged; project/album/UI migration remains pending. Recovery guidance in DEPLOYMENT.md.

## 2026-10-23 — CF-02b D1 content operations

Added D1 migration0004 with projects, albums, photo catalog guard and actor-wide request ledger; upgraded historical workspace command snapshots without removing old audit/rows. Added target Worker repository/API for project and album list/create/rename, album protection, and reversible empty-content archive. Added SQL tenant/parent/current-session/CAS/state guards, immutable results and before/after append-only audit. Twenty-four local Cloudflare check groups now include 0003→0004 data migration, concurrent create retry, cross-operation conflict, tenant IDOR, audit rollback, CAS/replay, protections and archive guards. No target UI or cloud resources changed.

### CF-02b migration0005 parent integrity

Added D1 parent immutability and photo catalog triple-scope guards; applied locally and tested. Documentation distinguishes the metadata catalog from actual image upload/version delivery.

### CF-02b migration0006 audit keys

Preserved audit entries while removing global request-ID collisions across actors; immutable event IDs and append-only triggers remain. Upgrade test verifies history copy and equal action/request IDs from separate actors.

### CF-02b migrations0006-0007 audit repair

Audit rebuild now preserves historical fields/event IDs, removes cross-actor request collisions, then recreates bootstrap/session/workspace/content audit writers. Local upgrade evidence covers both row preservation and successful new events after the table swap.
