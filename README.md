## 目前唯一產品介面：Cloudflare Worker + target-ui

日常開發請使用 `pnpm dev`（http://127.0.0.1:8787）；`pnpm build`建置同一正式 React/Vite 前端與 Worker，僅 dry-run、不會部署。已有 build 時可用`pnpm start` 啟動本機 Worker。既有持久本機 D1 的 schema／Owner 初始化仍須依交接紀錄處理，啟動本身不會自動遷移或初始化。

`pnpm review:local` 使用同一份正式 build，建立完全隔離的本機 D1/R2、合成 Owner 與照片，驗收真實 API 操作；不是雲端 OAuth／R2 驗收，不連接客戶資料。詳細入口見啟動輸出。暫不支援瀏覽器直接上傳至此隔離測試 R2，會明確停用上傳功能。

`experiments/gump-demo` 已轉為歷史設計參考；舊 Next/Supabase 相容程式只以 `dev:reference`／`build:reference`／`start:reference` 明確命名保留，CI 回歸用途不等同第二套產品入口。

## 產品命名

正式名稱為 **Kino Pick（奇諾選圖）**。既有內部 `@kino-pic/*`、儲存鍵、服務識別及歷史紀錄暫保留以維持相容。

## 2026-10-29 — Local resolved batch upload

The opt-in multi-file queue is integrated in the existing Owner album UI. Three focused local375px browser scenarios pass:sequential signed local R2 transfers,exact lost-response recovery,stale-policy/identity admission denial and stale-tab pointer protection. RESOLVED_BATCH_UPLOAD_ENABLED defaultsOFF/hard-local;all cleanup remainsOFF/dry-run. See [batch upload specification](docs/RESOLVED_BATCH_UPLOADS.md) and [handoff](docs/HANDOFF.md) for exact evidence. Formal OAuth,remoteCloudflare,derivative processing in this run,full delivery and remaining M1–M5 scope are not complete.

## 2026-10-29 — Current local milestone

M3i4 immutable opt-in matching rules are accepted locally:367 complete Cloudflare checks,15 focused groups and625 unit tests.0051 is adopted LOCAL ONLY after fresh backup,isolated restore/upgrade and live parity:119 old tables/4 development rows unchanged,four empty new tables,123 total,FK0,ledger51/no pending. All hosted/default gates and automatic deletion remainOFF/dry-run. See MATCHING_RULES.md and latest HANDOFF.md for exact evidence. Next M3i5a builds internal durable batch records/storage;resolved multi-file UI/controller and remaining M1–M5/hosted acceptance remain unfinished.

## Local Assisted catalog (M3i3 accepted)

[Assisted candidate catalog](docs/ASSISTED_CANDIDATE_CATALOG.md) supports explicit target selection beyond1,000 photos with signed24-row pages,current selected-head authorization and preserved exact recovery. Actual352 complete local checks and7 focused checks pass;0050 is adopted LOCAL ONLY after fresh backup/isolated restore/live parity. ASSISTED_CANDIDATE_CATALOG_ENABLED defaultsOFF/hard-local. Real hosted/OAuth/remoteR2 acceptance remains separate. See [HANDOFF](docs/HANDOFF.md);next are opt-in matching profiles and genuine per-file batch/recovery.

## Local Assisted catalog (M3i3, acceptance in progress)

[Assisted candidate catalog](docs/ASSISTED_CANDIDATE_CATALOG.md) preserves explicit target selection beyond1,000 photos through signed24-row pages and current chosen-head authorization. ASSISTED_CANDIDATE_CATALOG_ENABLED defaultsOFF/hard-local; gateOFF retains the existing selector. Source0050 is an additive seek index, not proof of persistent migration or hosted deployment. See [HANDOFF](docs/HANDOFF.md) for actual verification and unfinished acceptance; configurable matching rules and genuine per-file batch/recovery remain next work.

## Local indexed automatic matching (M3i2)

[Indexed automatic matching](docs/INDEXED_VERSION_MATCHING.md) integrates canonical source keys and complete immutable-history aggregates into the existing automatic upload workflow. `INDEXED_VERSION_MATCHING_ENABLED` defaults OFF and is local-only, with all supporting gates and project opt-in required. Assisted keeps its existing choices; its large-album pagination, configurable rules and genuine batch upload remain follow-up work. See [HANDOFF](docs/HANDOFF.md) for actual checks and persistent migration status. No hosted deployment or physical bulk-R2 E2E is implied.

## Local filename index maintenance (M3i1)

The additive Owner-only index maintenance slice is documented in [MATCHING_FILENAME_INDEX.md](docs/MATCHING_FILENAME_INDEX.md). `MATCHING_FILENAME_INDEX_ENABLED` defaults OFF and is local-only. It introduced authorized status and explicit batches of up to24 immutable upload-session filename keys. M3i2 above now adds automatic indexed classification; Assisted pagination, configurable matching profiles and true batch upload remain follow-up work. See the latest [HANDOFF](docs/HANDOFF.md) for actual acceptance and persistent migration status; source migration0049 is not evidence that any database was upgraded.

## 2026-10-28 — 工作空間操作歷史與匯出已通過本機驗收

攝影師可依資源、邀請、操作者、操作與時間篩選歷史，分頁查看安全的前後值，並匯出同一快照的 CSV／JSON。保留過期邀請及舊 session 的事件脈絡，跨工作空間隔離；未知事件不洩漏原始 JSON。另修正分頁完成時 Lightbox 返回焦點遺失的問題。

529 項單元測試、326 項完整本機 Cloudflare／瀏覽器檢查通過，實際涵蓋74類操作。0048 僅在本機新增7個索引，備份還原及118張舊表資料一致性通過。正式開關仍 OFF/hard-local，自動刪除 OFF/dry-run；OAuth／遠端 R2／正式部署尚未驗收。見 [歷史契約](docs/OWNER_HISTORY.md) 與 [最新交接](docs/HANDOFF.md)。整體 M1–M5 尚未完成。

## 2026-10-28 — 攝影師註記處理已通過本機驗收

新增獨立「待處理／處理中／已處理」及客戶修改後的重新確認提示；保留客戶原始圈選與歷史，同邀請共享、跨邀請隔離。498 項單元測試、315 項完整本機 Cloudflare／瀏覽器檢查及 strict/lint/參考 build 通過。0047 僅在本機套用，114 張舊表內容一致，新增4張空表；備份還原及外鍵檢查通過。所有正式開關仍 OFF/hard-local，自動刪除 OFF/dry-run；真實 OAuth／遠端 R2／部署尚未驗收。見 [處理狀態契約](docs/ANNOTATION_PROCESSING.md) 與 [最新交接](docs/HANDOFF.md)。下一步為完整攝影師操作歷史與匯出，整體 M1–M5 尚未完成。

## 2026-10-28 — Owner annotation source integration

Genuine Owner version-bound annotation authoring is accepted locally (308 complete Worker/browser checks and467 unit tests). See [docs/OWNER_ANNOTATIONS.md](docs/OWNER_ANNOTATIONS.md) for APIs, strict actor/session recovery, mixed-role invitation sharing, default-OFF local-only gates and migration0046 recovery. Migration0046 is applied locally after verified backup/restore and110-old-table parity;4 new Owner tables are empty. Latest actual results are in [docs/HANDOFF.md](docs/HANDOFF.md); source availability is not hosted deployment acceptance.

## 2026-10-28 — 同邀請共享註記已通過本機驗收

已依使用者確認實作：同一邀請可互看圈選註記，不同邀請隔離；只有作者可編輯、刪除或變更註記狀態。客戶端支援實際點／矩形畫布、版本綁定、鍵盤、縮放平移及原操作恢復；攝影師有邀請／版本的唯讀檢視。完整本機驗收295項、單元測試430項及 strict typecheck/lint 通過；Guest/Owner375px截圖已檢視。這不代表已部署或已驗證真實 Google/GitHub/R2/CORS。所有旗標仍預設 OFF/hard-local，自動刪除 OFF/dry-run；本機0045採用狀態見最新 HANDOFF。完整M1-M5仍未完成。

## 2026-10-28 — 註記後端已驗收，圈選畫面仍待接上

已完成固定照片版本的點／矩形註記後端、作者自身分頁與狀態操作、獨立權限及不可變歷史；使用正規化座標支援後續縮放／平移畫面。281 項本機 Cloudflare、406 項單元、61 項參考整合、14 項參考 Chromium 及 strict/lint/build 通過。這不代表已有可用圈選 UI：作者繪製／恢復與攝影師唯讀檢視是下一步，同邀請可見範圍仍待確認。0045 尚未套用開發 DB，所有開關保持 OFF/hard-local，自動刪除 OFF/dry-run；正式服務尚未驗收。見 [註記契約](docs/GUEST_ANNOTATIONS.md) 與 [最新交接](docs/HANDOFF.md)。

## 2026-10-28 — 攝影師留言處理進度已完成本機驗收

新增獨立「待處理／處理中／已處理」，客戶改文會提示攝影師重新確認；保留客戶原文、自身解決狀態與所有歷史。同邀請客戶可唯讀查看進度，不同邀請隔離。269 項本機 Cloudflare、369 項單元、61 項參考整合與14 項參考 Chromium 檢查，以及 strict/lint/build 通過。0044 僅在本機套用，已驗證備份還原及102 張舊表內容一致；所有正式開關仍 OFF/hard-local，自動刪除 OFF/dry-run。正式 OAuth／R2／部署尚未驗收。詳見 [處理狀態契約](docs/COMMENT_PROCESSING.md) 與 [最新交接](docs/HANDOFF.md)；下一步為獨立圈選註記及其餘 M1–M5。

## M3f2a — Owner replies accepted locally

The Cloudflare Owner Lightbox now supports explicit invitation/version threads, replies and reply edit/delete with safe recovery; Guests see readonly replies only within the same invitation.260 local Worker checks,345 unit,61 integration,14 reference Chromium and types/lint/Next build passed.0043 was applied locally only after verified backup/isolated restore and97-table content parity. OWNER_COMMENTS_ENABLED remains OFF/hard-local; formal deployment is not verified. See [Owner comment workflow](docs/OWNER_COMMENTS.md) and [handoff](docs/HANDOFF.md). Owner processing status, annotations and fullM1–M5 remain unfinished.

## M3f1 — Guest version comments accepted locally

Guest Lightbox and independent batch composition now support invitation-shared version comments, author lifecycle, safe retries and current-state reconciliation.243 local Worker checks,316 unit,61 reference integration,14 reference Chromium and types/lint/build passed.0042 was applied locally after backup; feature flags remain OFF/hard-local and hosted acceptance is unfinished. See [comment authorization and recovery](docs/GUEST_COMMENTS.md) and [handoff](docs/HANDOFF.md). Next: Owner thread/reply/moderation and independent annotations; fullM1–M5 remains active.

## M3e — Guest version comparison accepted locally

Published version history and slider/side-by-side/overlay comparison are integrated in Guest Lightbox with independent view+compare permissions and unpublished-draft protection.228 local Worker checks,288 unit tests and strict types/lint/Next build passed. No new migration; flags remain OFF/hard-local and hosted acceptance is unfinished. See [comparison authorization and recovery](docs/GUEST_VERSION_COMPARISON.md) and [handoff](docs/HANDOFF.md). FullM1–M5 remains active; comments/annotations, Owner comparison, delivery and retention still require implementation.

## M3c2b2 — resolved upload accepted locally

Owner UI now connects filename Auto/Assisted preview and confirmed choices to atomic reservation, real private R2 upload, private new versions and exact recovery through reload/mode changes.220 local Worker checks,260 unit,61 reference integration,14 reference Chromium and strict/lint/build passed;0041 applied locally only after backup. The new matching flag stays OFF/hard-local and all hosted acceptance remains open. See [resolved upload contracts and recovery](docs/RESOLVED_UPLOADS.md) and [current handoff](docs/HANDOFF.md). FullM1–M5, scalable/batch matching, Guest comparison and later delivery/retention remain required.

## M2o — Guest tags accepted locally

Guest tags now have independent permissions, own-Guest state, immutable change history and Grid/Lightbox controls with safe retry/cap recovery.148 local Worker checks passed;0034 applied locally only. GUEST_TAGS_ENABLED staysOFF/hard-local. See docs/GUEST_TAGS.md and current HANDOFF for evidence and remaining full M1–M5 work; no hosted acceptance is claimed.

## M2m3 — project selection defaults accepted locally

Owner can set project defaults and explicitly override or restore inheritance for each private album. Source-aware Guest pages preserve independent permissions and immutable history. Local133 Worker checks,108 unit,61 integration,14 reference Chromium and strict/build checks passed;0031 applied locally only. All feature flags stay OFF/hard-local. See docs/SELECTION_POLICY.md and docs/HANDOFF.md; full SaaS and hosted acceptance remain incomplete.

## M2m2 shared reviews — accepted locally

Explicit Owner-created review subjects share picks only among selected sealed invitation memberships; private picks/ratings/favorites stay separate. See [shared selection](docs/SHARED_SELECTION.md) and [current verification](docs/VERIFICATION.md). GUEST_SHARED_SELECTION_ENABLED remains false in every environment and enabling outside local is rejected. Shared API/backend acceptance has passed in actual local workerd; Owner/Guest Chromium and the complete127-check local suite passed;0030 is applied locally only. No hosted deployment or external-provider acceptance is claimed. Full M1–M5 backlog remains required.

# Kino Pick（奇諾選圖）— 攝影挑片／修圖協作／影像交付平台

M2m1 本機切片已驗證：可調私人挑片上下限、管理端確認／安全重試、容量內批次選取與提交檢查；另以0029修復重開後沿用原選片無法提交的問題。Worker123、unit95、integration61、reference E2E14、Next build 與 strict checks 通過；詳細驗收與限制見 [挑片政策](docs/SELECTION_POLICY.md) 和 HANDOFF。共用挑片與正式雲端仍未完成；所有旗標維持 OFF。

目前進度：M2l 星等與收藏已完成本機切片，Worker117、unit91、integration61、reference E2E14 與 build/strict checks 通過。兩項權限各自授權，Grid/Lightbox 共用狀態，提交挑片不改寫既有快照。詳細契約與復原方式見 [Guest feedback](docs/GUEST_FEEDBACK.md)。所有服務旗標維持預設 OFF；本機通過不等於正式雲端驗收。

M2k（2026-10-26）：本機 Worker UI 已接通攝影師建立三模式邀請、12 項獨立權限、一次性分享資訊，以及 Guest 連結／密碼登入到相簿挑片提交。分享 bearer 僅置於 fragment 並於進入時清除；未知回應不自動另建邀請或 session。112 項本機 Cloudflare 檢查通過；這不是正式 OAuth／Cloudflare edge／R2 驗收。所有部署旗標仍預設 OFF。見 [邀請與登入流程](docs/INVITATION_FLOW.md) 及最新 HANDOFF。

M2j（2026-10-26）：local-only Guest 挑片流程含 24 張分頁圖庫、跨游標載入自己的選片、僅對目前頁面逐張依序批次選取、版本固定提交及提交後凍結；revision 過期或部分寫入失敗會重新向伺服器載入。登出重試沿用穩定 request ID。Owner 可檢視提交摘要/明細、匯出 CSV/TXT/JSON（成功生成時寫入 download.generated 審計，不記檔名/內容），並僅對最新已提交 round 以鍵盤可用的確認對話框重開下一輪。migration 0023–0026 與 API/UI 仍由 GUEST_SELECTION_ENABLED 保護，所有 Wrangler env 預設 false 且 Worker 拒絕非 local enablement。最新本機驗證：Cloudflare 109、unit 88、integration 61（修正 timeout 後）、strict typecheck、lint、Next production build、reference app Chromium E2E 14、format、30 份規格文件 handoff checker 與 diff check 均通過。Worker target UI 的瀏覽器流程由 test:cloudflare 覆蓋。星等、收藏、標籤、留言、註記、完整歷史、選片上限、Guest 權限組合邊界、Hosted OAuth/KDF/R2/D1 與部署仍未完成或驗收。M2h gallery 只供私有預覽/縮圖，不提供原圖或下載。見 [Guest selection 安全契約](docs/GUEST_SELECTION.md)、[Guest gallery 安全契約](docs/GUEST_GALLERY.md) 和最新交接。

歷史 M2d：三模式邀請建立後端已本機驗證；旗標預設關閉且新建僅允許 local。首次提交可回傳新憑證，同請求重送／查詢只回傳 metadata。Guest exchange 後端已於 M2g 加入；建立分享畫面與完整客戶流程仍未提供。見 [邀請發行與安全恢復](docs/INVITE_ISSUANCE.md)。

歷史 M2c：已實作 Guest 自助登出後端（僅撤銷自己的 Cookie session，審計同交易、安全重試）與固定參數 scrypt 憑證基礎。新建邀請、節流與密碼交換在當時尚未開放；M2g 後端已加入，但客戶畫面仍未完成。本機 KDF 測試不代表正式 CPU／記憶體驗收。見 [Guest 憑證與登出邊界](docs/GUEST_CREDENTIALS.md)。

歷史 M2b：Worker 專案頁新增客戶邀請清單與明確確認撤銷，既有訪客 session 會在撤銷交易提交後失去授權。支援分頁、重新整理及未知結果安全重試；當時邀請建立與密碼交換仍待完成，後續已分別實作本機後端；客戶挑片仍未完成。見 [Owner 邀請管理](docs/OWNER_INVITATIONS.md)。

歷史 M2a：D1 migration0016 與 Guest 唯讀授權基礎，包含明確封存相簿範圍、12項獨立權限、session／邀請撤銷與到期核對。公開邀請建立與交換在當時尚未開放；後端交換已於 M2g 實作，客戶照片畫面及挑片仍待完成。見 [Guest 基礎邊界](docs/GUEST_ACCESS_FOUNDATION.md)。

## 新部署目標與本輪已實作

本輪使用者已明確採納 Cloudflare Workers＋D1＋R2＋Cron、closed Owner-only 與 GitHub CI/CD。`apps/worker` 現有可實際執行的 Hono/Better Auth/D1 基礎：明確 Owner bootstrap、Google/GitHub共用固定ID、拒絕 Email 隱式合併、Owner API、私有不可覆寫 R2 adapter、本機排程無刪除審計。完整產品尚未切換；原 Next/Supabase/PG 功能保留。Worker 入口用 Vite 建置同源 React UI，重用既有工作空間與內容表單；目標 UI 目前涵蓋工作空間/專案/相簿清單與基本新增、改名、相簿保護及空內容封存。照片原檔上傳與不可變版本 metadata 已有本機切片；Guest exchange 與只讀圖庫/私有衍生圖後端已有隔離本機驗證，挑片動作/UI、版本切換與交付仍待完成。下方啟動指令供本機 Worker 功能參考。

```powershell
pnpm --filter @kino-pic/worker db:migrate:local
pnpm dev:cloudflare
pnpm test:cloudflare
```

本機 localhost:8787；未配置 provider/secret 時拒絕登入，測試會在隔離 workerd/D1/R2 中模擬外部 OAuth。沒有 production mock 或實際雲端部署。標準補充 docs/CODEX_ARCHITECTURE_ADDENDUM.md；設定、Owner bootstrap、部署 gate 及復原見 docs/DEPLOYMENT.md，儲存邊界見 docs/STORAGE_SPEC.md。CD故意拒絕尚未完成的遷移，不能把 foundation 當成已支援全部產品功能。

> Codex × Google Antigravity 可交接規範包｜規格版本 1.0｜2026-10-23

目前已有 Phase 0 本機基礎、M1 workspace/project/album D1 操作，以及 CF-02c 第一版 Worker React 入口。完整產品需求仍是待逐階段實作的規格，不能視為功能清單已完成。

## 本機啟動

CF-03c3 已接入實際本機 D1/R2 處理流程與 Owner 私有 Grid/Lightbox。先套用 local migrations，再明確執行 `pnpm image:process:pending:local --run 5` 處理待辦；使用本機 bindings，不連接正式服務。完整租約、配額、不可變輸出與復原界線見 [PROCESSING_PIPELINE.md](docs/PROCESSING_PIPELINE.md)。獨立檔案處理指令 `pnpm image:process:local <metadata.json> <source-file> <output-root> <job-uuid>` 仍可用，格式見 [LOCAL_IMAGE_PROCESSING.md](docs/LOCAL_IMAGE_PROCESSING.md)。正式處理服務與外部驗收尚未完成，正式直傳等啟用 gate 維持關閉。

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
- apps/worker：Hono/Better Auth、D1 repositories/API、私有 R2 adapter、Cron dry-run 觀察與 Worker React 靜態入口；只在本機及隔離測試驗證，尚未部署。
- `packages/domain`：儲存、保留、審計、版本與影像處理 service interfaces，保留租戶/交易邊界。
- `packages/contracts`：Zod 環境與 health 合約。
- `packages/storage`：immutable、scope-isolated memory adapter。
- `packages/image-processing`：Node-only trusted decoder、local output command 與 durable D1/R2 processing coordinator；正式處理服務未設定。
- `packages/db`：初始 SQL / RLS、復原說明。
- `packages/ui`：依 shadcn source-owned 慣例的按鈕 primitive；尚無完整元件庫。
- `tests`：Vitest unit、嵌入式 PostgreSQL integration、Playwright 本機瀏覽器測試。

Google/GitHub OAuth/SSR、單一或雙來源綁定同一身分、workspace 建立與分頁、owner 成員角色 API 已完成本機測試；真實 Google/GitHub/Supabase 尚未驗證。專案／相簿可建立、分頁讀取及改名，具 revision 衝突處理；owner 可設定相簿釘選／保留保護，解除需確認；無照片且閒置的專案／相簿可封存並還原原狀態。Cloudflare Worker 有 same-origin 工作空間／專案／相簿 UI 子集，並在本機實作 CF-03b 單段 private R2 簽名授權、完成驗證、photo/version/asset 建立、quota 轉換及安全 key fence；direct upload 在所有 Wrangler 環境預設關閉。CF-03c1 已新增 feature-gated 批次直傳 UI、瀏覽器解碼/本機預覽與伺服端尺寸檢查（最多20張、64MiB/張）。CF-03c1 瀏覽器預覽保持暫存；CF-03c3 已接入本機可信解碼、private R2 縮圖與 Owner Grid/Lightbox，正式處理服務與真實 R2/CORS E2E 仍待完成；M1-02 完整生命週期、guest、挑片、版本、交付與 retention 仍保留待辦。登入設定和本機測試界線見 `docs/LOCAL_AUTH.md`、`docs/HANDOFF.md`；全部 M1–M5 規格不得因初始化完成而略去。

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

## Cloudflare 目標 UI 範圍

Worker 靜態 React 入口在 localhost:8787 使用 Better Auth Owner session 與同源 D1 API。pnpm dev:cloudflare 會建置 apps/web/target-ui 到忽略追蹤的 apps/worker/.static；pnpm test:cloudflare 會做 production dry-build、隔離 workerd/D1/R2/API 測試與 Chromium 瀏覽器操作。瀏覽器測試使用合成 OAuth provider fixture，不代表真實登入或雲端端到端驗收。完整界線、失敗修正與待辦見 docs/HANDOFF.md、docs/VERIFICATION.md 及 docs/TASKS.md。

Owner 圖庫的需審查照片可按「檢視處理問題」讀取真實 Dry Run；檢查本身保留原圖與16MiB預留；Owner 可另行明確確認永久停止本次處理，經雙輸出 fencing 後原子釋放預留，保留原圖。安全界線與下一個 migration 見 [PROCESSING_REVIEW.md](docs/PROCESSING_REVIEW.md)。

CF-03c5 已提供重新載入後恢復上傳工作：保存有界中繼資料與操作 ID，回來先查伺服器狀態，需要傳送照片才重新選擇並驗證原檔。原上傳授權不會自動續期；不支援逐位元組／multipart 斷點續傳。瀏覽器需求、儲存失敗與恢復界線見 [UPLOAD_RECOVERY.md](docs/UPLOAD_RECOVERY.md)。

## 線上 MVP 接續與發佈

目前以 [docs/MVP_RELEASE_PLAN.md](docs/MVP_RELEASE_PLAN.md) 為執行與驗收清單。`pnpm release:inventory` 可唯讀盤點來源設定；`pnpm release:inventory --check` 對未完成條件返回1，不代表測試故障，也不授權部署。原有本機／prototype 驗證不等同網站已上線。
