# Google Antigravity 專案入口

本專案與 Codex 共用 `AGENTS.md`（唯一規則來源），請先閱讀它，再讀 `README.md`、`docs/HANDOFF.md`、`docs/TASKS.md` 及本次任務的規格。禁止另造與 `AGENTS.md` 相矛盾的架構。

接手既有進度時使用 `prompts/ANTIGRAVITY_HANDOFF_PROMPT.md`。完成後將變更、測試與下一步寫回 `docs/HANDOFF.md`，更新 `docs/TASKS.md`；所有成果應留在此 Git repository 中。

## 本輪部署目標與接手順序

使用者已明確採納 Cloudflare free-first 補充；先讀標準 docs/CODEX_ARCHITECTURE_ADDENDUM.md，再讀 ARCHITECTURE/AUTH_SPEC/STORAGE_SPEC/DEPLOYMENT、最新 HANDOFF/TASKS/DECISIONS。AGENTS.md 仍是共用指引，禁止另維護相反 stack。

目前 apps/worker 是 Hono/Better Auth/Drizzle/D1/R2 的實際本機 foundation；apps/web + PG 是保留的可運作參考。不要把兩者當成兩套可上線產品，也不要刪掉舊功能以通過遷移。所有原始照片/guest/版本/交付/清理需求保留，下一步是 D1 業務 repository 與既有 UI 接入及新 Owner policy 的等效驗收。

接手先 pnpm install --frozen-lockfile、pnpm typecheck、pnpm test:cloudflare；D1 migrations 只用 apps/worker/migrations，PG migrations 保持原狀。Owner 初始身分必須由外部驗證 subject 的管理流程建立，不能用 email/第一個訪客；無 fresh reauth 的 link/unlink 保持關閉。Canonical addendum 是本輪整合副本，原使用者 docs/docsCODEX_ARCHITECTURE_ADDENDUM.md 不改寫。

不要啟用正式 CD、跨帳號儲存或自動刪除；現在 readiness guard 故意拒絕部署。所有 mock/provider fixture 與 private R2 adapter 測試範圍見 VERIFICATION，沒有真實 provider/雲端部署證據。

CF-02a handoff: apps/worker now has workspace create/read repository/API and additive D1 migration0003 with current Owner/session SQL guards, atomic state/command/audit and keyset paging. This is a backend increment only: existing Next UI is not switched. Continue CF-02b shared request namespace + project/album/CAS/protection/archive and existing React UI adapter; see latest HANDOFF/TASKS/DEPLOYMENT recovery notes.
