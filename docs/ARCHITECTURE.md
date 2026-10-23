# 技術架構與服務邊界

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
