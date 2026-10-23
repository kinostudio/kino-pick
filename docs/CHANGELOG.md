# KINO Pic Changelog

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
