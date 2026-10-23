# KINO Pic（奇諾選圖）— 攝影挑片／修圖協作／影像交付平台

## 新部署目標與本輪已實作

本輪使用者已明確採納 Cloudflare Workers＋D1＋R2＋Cron、closed Owner-only 與 GitHub CI/CD。`apps/worker` 現有可實際執行的 Hono/Better Auth/D1 基礎：明確 Owner bootstrap、Google/GitHub共用固定ID、拒絕 Email 隱式合併、Owner API、私有不可覆寫 R2 adapter、本機排程無刪除審計。完整產品尚未切換；原 Next/Supabase/PG 功能保留。下方舊啟動指令仍供既有功能參考。

```powershell
pnpm --filter @kino-pic/worker db:migrate:local
pnpm dev:cloudflare
pnpm test:cloudflare
```

本機 localhost:8787；未配置 provider/secret 時拒絕登入，測試會在隔離 workerd/D1/R2 中模擬外部 OAuth。沒有 production mock 或實際雲端部署。標準補充 docs/CODEX_ARCHITECTURE_ADDENDUM.md；設定、Owner bootstrap、部署 gate 及復原見 docs/DEPLOYMENT.md，儲存邊界見 docs/STORAGE_SPEC.md。CD故意拒絕尚未完成的遷移，不能把 foundation 當成已支援全部產品功能。

> Codex × Google Antigravity 可交接規範包｜規格版本 1.0｜2026-10-23

目前已建立 Phase 0 本機基礎與 M1 身分／workspace／專案相簿本機整合。完整產品需求仍是待逐階段實作的規格，不能視為功能清單已完成。

## 本機啟動

需求：Node.js 24、pnpm 11.25.0、Python 3（文件檢查）。於專案根目錄執行：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Windows PowerShell 若阻擋 `.ps1`，使用 `pnpm.cmd`。macOS/Linux 使用相同 pnpm 指令。開啟 http://localhost:3000 。不需要任何雲端金鑰即可看狀態頁與未設定登入頁，開發伺服器僅綁定本機介面。停止請按 Ctrl+C。

```powershell
python tools/check_handoff.py
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm build` / `pnpm start` 可預覽最佳化本機 build；不代表已支援正式服務。健康檢查 `/api/health` 僅驗證應用設定與存活，不檢查 DB、OAuth 或 R2。錯誤設定回 503。

`.env.example` 可複製為 `apps/web/.env.local`；本機可不建立 env 檔（登入服務預設停用）。Supabase 測試登入設定見 `docs/LOCAL_AUTH.md`。`APP_ENV=local`、自動刪除 OFF、dry-run ON；`APP_ENV=production` 會讓健康檢查拒絕就緒，直到正式 adapters 完成。Next.js 的 NODE_ENV=production 僅表示最佳化執行，不等於 APP_ENV。mock storage 是無持久性的記憶體 adapter，不提供假的可用上傳 URL。不要放客戶照片或真實憑證。

資料庫啟動與復原：見 `packages/db/README.md`。`DATABASE_URL` 必須由 shell 注入；`pnpm db:migrate` 使用 PostgreSQL transaction / advisory lock / checksum。SQL 包含初始六張表、append-only 管理審計與 workspace/profile/member 受控 RPC。表格仍拒絕一般角色直接寫入；RPC 使用實際登入 actor、角色與 requestId。測試使用 PGlite + auth shim，尚未驗證真實 Supabase。

## 工作區

- `apps/web`：Next.js App Router、繁中狀態頁及 health API。
- `apps/worker`：後續 R2/Queues/Cron 的預留邊界，沒有可部署的 worker。
- `packages/domain`：六個核心 service interfaces，保留租戶/交易/審計邊界。
- `packages/contracts`：Zod 環境與 health 合約。
- `packages/storage`：immutable、scope-isolated memory adapter。
- `packages/db`：初始 SQL / RLS、復原說明。
- `packages/ui`：依 shadcn source-owned 慣例的按鈕 primitive；尚無完整元件庫。
- `tests`：Vitest unit、嵌入式 PostgreSQL integration、Playwright 本機瀏覽器測試。

Google/GitHub OAuth/SSR、單一或雙來源綁定同一身分、workspace 建立與分頁、owner 成員角色 API 已完成本機測試；真實 Google/GitHub/Supabase 尚未驗證。專案／相簿可建立、分頁讀取及改名，具 revision 衝突處理；owner 可設定相簿釘選／保留保護，解除需確認；無照片且閒置的專案／相簿可封存並還原原狀態；完整 review／刪除流程、專案保護、上傳、照片 Grid 與挑片尚未完成。登入設定與測試界線見 `docs/LOCAL_AUTH.md`。下一個獨立實作任務為 M1-03 配額預留／上傳 session 的交易核心，接續私有上傳；M1-02 完整生命週期仍保留；全部 M1–M5 規格保留，不能因初始化完成而略去。

## 規格入口

| 文件                         | 用途                                              |
| ---------------------------- | ------------------------------------------------- |
| `AGENTS.md`                  | Codex 與 Antigravity 共用的強制開發規則           |
| `docs/PRD.md`                | 產品需求、角色、流程、優先級                      |
| `docs/ARCHITECTURE.md`       | 系統架構與儲存／非同步工作                        |
| `docs/STORAGE_RETENTION.md`  | R2 80% 閾值、30 天未瀏覽、最舊相簿刪除、保護政策  |
| `docs/PHOTO_VERSIONS.md`     | 自動／手動新增版本、替換、Before/After 與差異分析 |
| `docs/GUEST_ACCESS_AUDIT.md` | 匿名邀請、密碼模式、權限、客戶全操作歷程          |
| `docs/DATA_MODEL.md`         | 資料表、欄位、索引、資料一致性                    |
| `docs/API_CONTRACT.md`       | API 端點與典型錯誤                                |
| `docs/UX_UI.md`              | 主要畫面、Grid、Lightbox、客戶／管理員動線        |
| `docs/SECURITY.md`           | 租戶隔離、私有圖片、防濫用、金鑰管理              |
| `docs/TEST_ACCEPTANCE.md`    | 可測量驗收案例、失敗注入                          |
| `docs/ROADMAP.md`            | 里程碑和階段交付                                  |
| `docs/TASKS.md`              | 工作細項、完成狀態                                |
| `docs/HANDOFF.md`            | 每次 AI 切換必須更新的交接紀錄                    |
| `docs/DECISIONS.md`          | 已確認與仍需使用者決策的事項                      |

## 不可誤解的四件事

- **R2 免費 10 GB-month ≠ 固定只能放 10 GB。** 它是按使用量計費的每月免費額度。平台實施自行設定的 `soft_quota_bytes` 並儀表板告知「估算值」，不能保證帳單為零。
- **R2 Lifecycle 無法判斷 30 天無人瀏覽。** 使用 DB 的有效人類瀏覽紀錄 + 定期掃描 + 受保護刪除佇列。
- **公開無密碼連結不能證明是同一客戶。** 訪客只能看到該連結授權專案與該訪客身分的紀錄；跨專案歷史需經受驗證的客戶檔案入口（登入／Email OTP）或一組獨立高強度的歷史入口授權。
- **完整客戶歷史是事件紀錄，不能由目前狀態倒推。** 標記→取消標記→再標記必須保留三筆歷史及時間。

## 工具協作約定

`AGENTS.md` 是共用單一事實來源；`GEMINI.md` 不另訂不同的產品規格。不要使用 AI 專用的私有記憶當作唯一進度來源。把決策、執行指令、變更檔案與測試結果寫入 Git 追蹤的 Markdown 文件。開工前檢查 Git status；同時操作需不同 branch / worktree，合併前完成測試。

## 參考來源（請實作前重查最新版本）

- Codex AGENTS.md: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Google Antigravity Rules: https://www.antigravity.google/docs/rules-workflows
- R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- R2 Storage Metrics: https://developers.cloudflare.com/r2/platform/metrics-analytics/
- R2 Lifecycle: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Cloudflare Scheduled Workers: https://developers.cloudflare.com/workers/configuration/cron-triggers/

所有費率、服務限制與 SDK API 請於實作當下確認，不應只根據此文件推定。
