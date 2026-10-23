# 技術架構與服務邊界

## 2026-10-23 明確採納的新部署基準（本節優先於下方歷史方案）

GitHub + Workers/Static Assets/Hono + D1/Drizzle + private R2 + Cron 為新目標；Better Auth 提供 Google/GitHub，同一 users.id，closed Owner-only 與獨立 Guest Session。所有原始產品功能及未來多租戶角色資料模型保留；closed 模式阻止非 Owner 管理存取，而不是刪掉商用擴充契約。原 Vercel/Node/Supabase/PG 為現存參考與遷移備案，沒有關閉或搬動正式資料。

| 邊界     | 已實作現況                                                                                 | 遷移 gate                                                               |
| -------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 現有業務 | Next＋8PG migrations，workspace/專案/相簿/保護/空內容封存                                  | D1 等效 repo/API＋UI 接入與按新 Owner policy 審核的業務測試             |
| Hosting  | 隔離 vinext/workerd PoC；新增 Worker Static Assets 真實本機入口                            | 既有完整 UI 的目標部署整合尚未完成                                      |
| Auth     | 新 Better Auth/D1：closed、bootstrap、兩 provider 同 ID、禁隱式 linking、session 審計/登出 | 真實 provider、fresh link/unlink、會話管理 UI/跨 session 撤銷           |
| Storage  | D1單節點 metadata、R2不可覆寫/scoped讀寫 adapter                                           | 直傳 signer、配額 reservations、可信 complete、asset node/版本 metadata |
| Cron     | 本機 scheduled 事件只寫 deleted=0 觀察審計                                                 | 完整資格預覽/opt-in/鎖/工作佇列/部分刪除重試                            |
| CI/CD    | 原 CI 加 Cloudflare本機驗證；手動受控 CD yaml                                              | readiness guard故意拒絕 foundation 部署，遠端未執行                     |

第一階段只建立同一產品的遷移基礎，不宣稱 target 已取代舊管理 API。D1 無 PostgreSQL RLS/互動式鎖/RPC；Owner/Guest 與 tenant scope 在可信 Worker 強制，狀態/audit/idempotency/CAS 用 D1 原子 SQL/trigger/batch 等效實作後逐案驗證。現在只完成 bootstrap/session 的原子審計，不包含全部產品寫入。Host runtime 能跑不代表 DB/auth port 已完成。

本次新增 apps/worker/migrations 0001/0002，保留 packages/db 八個 migrations 不改。新 D1 node 預設9GB內部配額，舊PG8GB不改。資料遷移需固定ID mapping、計數/FK/審計檢查、唯讀快照、備份復原與可控切換，不能以 Email 合併。部署/復原與能力邊界見 DEPLOYMENT/STORAGE_SPEC。下方原架構是歷史參考。

## Architecture decision

- TypeScript strict; pnpm Monorepo。`apps/web` Next.js App Router；`apps/worker` R2 image delivery / image jobs；`packages/db` migrations / repository；`packages/domain` business rules；`packages/contracts` zod API schemas；`packages/ui` shared UI；`packages/storage` storage abstraction。
- Supabase Postgres 與 Auth（Google / GitHub OAuth；同一 user 可綁一或兩種來源），workspace/tenant-aware RLS + API service authorization。
- Cloudflare R2 兩個私人 buckets：originals 與 derivatives；原圖／成品和 thumbnail／preview 分開設定存續政策。
- 產生縮圖與浮水印可使用支援的 Cloudflare Images/Workers pipeline；如果影像格式或運算配額不支援，另以隔離背景處理容器／job runner 處理（需記錄 ADR，不能假設 Workers 可支援任意 RAW）。
- R2 object notifications + Queue 觸發非同步處理，Cron workers 執行 quota reconcile、30 天未活動偵測、過量清理；Postgres 儲存 job lease/status/idempotency。
- Vercel/Node 供 API（或等效部署），重計算影像處理不可阻塞 API request。

## 穩定性介面

- `StorageAdapter`: presignUpload, stat, deleteObject, read, copy?（禁覆寫 immutable key）。
- `AssetRepository`: create pending, finalize, reserveBytes, releaseBytes, markDeleted, reconcile。
- `RetentionPolicyEngine`: evaluateEligibility(album, config, now), previewPlan(), lockAndExecute(), rollbackMetadataWhenPossible()。
- `GalleryAccessService`: check permission for owner/editor/guest; restrict photos and activities to scope。
- `AuditWriter`: appendInTransaction(event, actor, idempotencyKey)。
- `VersionMatcher`: match by project/album/canonicalFilename/contentHash, handle ambiguity。
- `ImageDiffService`: normalize, align, compare, visualizations; asynchronous heatmap jobs optional。

## 對外資料流程

- OAuth：Browser → Supabase Auth → server session → workspace membership → API RLS。
- Guest：Invite URL secret → validate invite (scope/password/rate-limit) → issue HttpOnly scoped session → APIs → metadata; raw image via authenticated image gateway。
- Upload：瀏覽器請求 init（驗 auth/quota & reserve bytes）→ 短效 R2 multipart URL → browser direct to R2 → complete API HEAD 校驗 & materialize record → queue thumbnail generation → mark ready。
- Read：列表 API 返回 authorized photo metadata + 短期 image grant 或 same-origin gateway path；image gateway 再檢查有效會話、相簿權限、有效版本與 R2 key。不可把長期公開 R2 URL 存於 HTML。
- Delete：Cron → policy plan → lock candidates → recheck activity/protection/legal_hold → mark deleting & revoke sharing → enqueue object keys → batch delete idempotently → write tombstone & quota delta → reconcile。

## 環境/部署

Local：`pnpm dev`（Codex 建置時補上）；可用 Localstack/MinIO S3 mock 或 repository fake；Supabase local CLI 視環境可用性啟用；worker 支援 wrangler dev。
Staging：獨立 DB、R2 buckets、OAuth redirect URI、域名、keys、虛擬測試圖；禁止使用客戶真實照片。
Production：db migration before API deployment；healthcheck; R2 CORS scoped to known origins; Sentry error alerts; backup snapshots; time sync UTC。

## 事件與重試

使用 outbox 或 DB job row + worker dispatch，避免 API commit 與 queue publish 脫鉤。event handler 必須 idempotent；job attempts/backoff/dead-letter；多 Worker 執行同批刪除時 transaction lock；不應因 job 重試重複扣除 quota。

## 取捨

- MVP 不一定要真正微服務，優先模組化 monorepo；worker 僅處理重運算/圖片私有 gateway/cron。
- 不必為照片 metadata 使用即時 WebSocket；optimistic UI + polling/mutations 足夠，多人同編再加 realtime。
- 選片提交、限額與狀態鎖必須在 DB transaction，不接受前端 localStorage 為事實來源。

## Cloudflare free-first compatibility assessment (2026-10-23)

Current runtime/Auth/DB remain Next.js + Supabase/PostgreSQL. ADR-Cloudflare-Free-First.md separates hosting adaptation from Auth/D1 migration, with a staged plan and data/rollback gates. Pinned vinext 1.3.0 static scan passed 15/15 in isolated apps/web; this is not a workerd build/runtime/deployment result. Eight isolated SQLite tests demonstrate CAS/audit/replay/rollback requirements before porting PostgreSQL RPCs. No D1 adapter/migration, Auth replacement or new production config has been enabled.

CF-02a status (2026-10-23): Worker workspace create/read now has D1 repository, transactional command/audit migration0003, Owner/session SQL guards and bounded keyset pages. It is a backend subset; project/album/CAS/protection/archive, shared operation ledger and existing UI port remain pending. No deployment or reference replacement. See latest HANDOFF and API_CONTRACT.
