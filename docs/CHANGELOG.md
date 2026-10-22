# KINO Pic Changelog

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
