## 2026-10-29 — Local resolved batch upload

The opt-in multi-file queue is integrated in the existing Owner album UI. Three focused local375px browser scenarios pass:sequential signed local R2 transfers,exact lost-response recovery,stale-policy/identity admission denial and stale-tab pointer protection. RESOLVED_BATCH_UPLOAD_ENABLED defaultsOFF/hard-local;all cleanup remainsOFF/dry-run. See RESOLVED_BATCH_UPLOADS.md and latest HANDOFF for exact evidence. Formal OAuth,remoteCloudflare,derivative processing in this run,full delivery and remaining M1–M5 scope are not complete.

## 2026-10-29 — Current local milestone

M3i4 immutable opt-in matching rules are accepted locally:367 complete Cloudflare checks,15 focused groups and625 unit tests.0051 is adopted LOCAL ONLY after fresh backup,isolated restore/upgrade and live parity:119 old tables/4 development rows unchanged,four empty new tables,123 total,FK0,ledger51/no pending. All hosted/default gates and automatic deletion remainOFF/dry-run. See MATCHING_RULES.md and latest HANDOFF.md for exact evidence. Next M3i5a builds internal durable batch records/storage;resolved multi-file UI/controller and remaining M1–M5/hosted acceptance remain unfinished.

## 2026-10-28 — Current local milestone

M3i3 Assisted catalog is accepted locally:352 complete standard checks plus7 focused groups;0050 local adoption preserves119 old tables/same4 development rows and adds one seek index.All default/hosted gates and automatic deletion remainOFF.FullM1–M5 remains active.Next deliver distinct immutable opt-in matching profiles and genuine per-file batch/captured-identity recovery;comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness remain.See ASSISTED_CANDIDATE_CATALOG.md and latest HANDOFF for evidence and external boundaries.

# 建置 Roadmap — 以可測量垂直切片交付

## Phase 0 — 專案初始化（M0）

- pnpm monorepo、Next.js + TypeScript strict + Tailwind/shadcn、eslint/prettier、Vitest、Playwright、GitHub CI。
- 建立 domain interfaces；`.env.example`、本地 mock storage、database migration runner、開發文件、healthcheck。
- DoD：本機啟動、lint/typecheck/test/build 可重現，AGENTS/HANDOFF 記錄實際命令；沒有任何 API key 入庫。

## Phase 1 — 身分、Workspace、專案與初版 Grid（M1）

- Google/GitHub Auth 與同身分綁定、workspace/RLS、專案、相簿、private R2 init/complete、thumb pipeline、grid lazy load、基礎 owner UI。
- DoD：授權攝影師新建專案，成功上傳 100 張測試圖、縮圖可顯示、另一工作空間不可讀。

## Phase 2 — Guest Share & Pick & Append-only Activity（M2）

- 三種 invite 模式、細分權限、guest scoped session、1–5 星、收藏、標籤、selection limit/submit、不可變事件 timeline、client portal 安全設計。
- DoD：免帳號使用單專案連結完成選片，事件不遺失；跨 project IDOR 與限額競態測試過關。

## Phase 3 — Photo Version & Before/After（M3）

- upload mode、same-name scoped matching、版本列表、manual/current switch、linked comments/annotations、slider/side-by-side/overlay；P2 heatmap 可延後。
- DoD：新上傳 V2，不覆蓋 V1 / pick / ratings；可比較並查看版本/註記歷史。

## Phase 4 — R2 Quota & Retention（M4）

- per-workspace ledger + reserves、R2 metrics reconcile、warn/80%/65%/95% config、30-day valid human views、dry-run plan、oldest eligible album cleanup、locks/queue/deletion retry、tombstones、管理後台。
- DoD：所有 S01–S10 測試過關；測試環境能安全實際回收 R2 物件，prod 預設仍 disabled。

## Phase 5 — Annotation, Full Delivery, Harden & Release（M5）

- 區域圈選留言、版本核准、成品 ZIP、通知、安全/存取審計、無障礙、staging 端到端、運維手冊和保留政策 UI 說明。
- DoD：客戶可完成挑片→修圖留言→版本比對→核准→下載。完整隱私與資安檢測，使用者測試通過。

## 下一階段（非第一版）

SaaS 訂閱／付款、團隊多層審核、AI 相似/模糊分組、Lightroom 或 Capture One 整合、RAW 專用處理、熱區像素差異量化優化。

## 跨階段注意

每個 phase 最後必更新 TASKS、HANDOFF、DECISIONS（如有重大選型）、測試報告與 CHANGELOG。不得未完成 API/DB 卻勾選「前端完成」等同產品完成。

## Cloudflare architecture integration sequence (explicit 2026-10-23 request)

CF-01 local Worker/D1 closed Owner/R2 adapter/CI foundation, preserving existing app → CF-02 D1 workspace/project/album/protection/archive repositories and existing UI ports, Owner policy equivalence → CF-03 fresh link/unlink/session UI plus upload reservation/direct R2 signer/verified completion → CF-04 guest permissions/gallery/activity/version/delivery → CF-05 retention preview/locks/jobs/retries → CF-06 real provider/resources/backup/terms/billing/controlled rollout. Original M1–M5 acceptance remains required; these steps rearrange implementation for the new target, not remove features.
