## 2026-10-29 — Deterministic pure planner foundation

`packages/domain/src/retention.ts` implements dry-run calculations with13 focused passing tests,root strict and scoped lint. DefaultOFF;independent cleanup opt-in,explicit preservation/protection/busy/references,30-day/80→65%,reservations,stable ordering,run limits and fail-closed evidence. This is not connected to D1/Cron/UI or physical deletion. Current D1 lacks authorized effective-human-view evidence;do not treat missing activity as inactivity. See RETENTION_PLANNER.md and latest HANDOFF. Full retention API/persistence/Owner confirmation/locks/jobs/retries/global quota/hosted acceptance remain required.

## 2026-10-28 — Annotation sharing does not renew retention

Own/shared/Owner annotation metadata reads append no audit/retention activity and create no R2 object; they are not evidence of有效人類瀏覽. Geometry and immutable witnesses stay bound to exact photo/version IDs across head changes, edits and tombstones. Any future version/album cleanup must account for these references and preserve required history, protection/pinning/minimum retention and explicit confirmation. Local0045 adoption/backup proof is in HANDOFF; no cleanup was enabled. Automatic deletion remains OFF and dry-run remains ON; production retention confirmation/retry/hosted acceptance is still required.

## 2026-10-28 — M3g1 annotation backend boundary

0045 annotation references must be included when implementing per-version cleanup: never prune a still-referenced live annotation version just because a newer head exists. Whole-album expiry remains governed by explicit opt-in, dry-run, protection/minimum retention/confirmation and separate immutable history/tombstones; this note does not pin all annotated albums or enable deletion. Annotation reads do not invent valid-human-view heartbeats. No R2 object write/delete is introduced. See GUEST_ANNOTATIONS.md.

## 2026-10-28 — Owner reply retention context adopted locally

0043 is now locally applied, preserving every old table and adding genuine Owner reply/change/result context plus shared markers. Future cleanup must retain immutable command/audit/tombstone and photo/version context; never cascade away replies or Guest history to free capacity. This slice does not enable cleanup: automatic deletion stays OFF/dry-run.260 local checks and backup/isolated-restore/content-parity adoption passed. Full retention planning/confirmation/retries remain required.

## 2026-10-28 — Owner reply context preservation

Pending0043 adds Owner reply/change/result context and shared thread markers with photo/version foreign keys. Future cleanup must preserve their immutable audit and tombstone context together with0042 Guest history; never cascade-delete comment history to free capacity. This migration does not implement cleanup or change the default OFF/dry-run policy. Existing retention preview/confirmation/retry and safe physical deletion work remain required; see OWNER_COMMENTS.md.

## 2026-10-27 — Comment history retention boundary

0042 version-bound comment/projection/change/result records retain FK context to photos/versions and immutable before/after history. Guest deletion is a tombstone, not physical erasure, and does not recycle its1,000-row thread capacity. Future actual album/version retention deletion must preserve comment/audit tombstones and deliberately resolve these FKs; do not cascade away history. Comment GETs/current-row reconciliation do not refresh human-browse retention activity. This slice adds no automatic deletion; STORAGE_AUTODELETE_ENABLED remains false and STORAGE_RETENTION_DRY_RUN true in all environments. See GUEST_COMMENTS Recovery and current HANDOFF.

## M3d external effects and safe reservation expiry

Cancellation/processing abandonment claim their actor/request identity before R2 writes. An attempt receipt alone cannot certify a physical result or release quota and must not become a permanent resource lock. Unknown physical/final DB outcomes preserve capacity; exact retry or existing verified expiry may safely finalize once. Expiry adopts a same-key physical certificate without rewriting its original audit and filters authorized reservations to the supplied R2 adapter's storageNodeId. Unmapped nodes remain held for a correctly configured adapter. Keep physical fences permanently protected from ordinary album cleanup, retain immutable receipts/audit, and keep automatic deletion OFF/dry-run. See OWNER_INTENT_CLAIMS.md for tested guarantees and recovery.

# R2 容量、30 天未瀏覽與容量超過 80% 自動清理：可實作詳細規格

## 1. 前提與準則

Cloudflare R2 免費額度為月計費的 10 GB-month（Standard）；它不是固定上限，也不是 Cloudflare 在 10 GB 自動封頂。產品中設定獨立 `soft_quota_bytes`（預設 8,000,000,000 bytes，比免費月額度保守），並顯示它是「應用程式軟上限」，不保證帳單零元，還需監控 operations、其他帳號 bucket、帳單與平均日儲存量。實際容量包括 Originals、Versions、Finals、Derivatives、尚未清完的檔案與 upload reservations。已刪資料依 Cloudflare 實際刪除/計費週期確認。

提供 **每工作空間個別配額** 和 **部署者全域配額**；整個應用若共用同一 Cloudflare R2 帳號，所有 workspace 用量仍要聚合，避免每個 workspace 都以為自己有 10 GB 免費額度。

## 2. 使用量來源

1. 每次上傳 init 建立 bytes reservation。成功 complete 後調整已確認 `photo_assets.byte_size`；上傳取消/過期才釋放 reservation。
2. 刪除完成收到 R2 成功回應（或驗證 object 不存在）後才扣除 ledger，不可於 DB 標記 deletion 時先視為空間已釋放。
3. 日常監測按 ledger + pending_upload_bytes / quota_bytes 算占用比。
4. 定時用 R2 bucket storage metrics/Cloudflare GraphQL 跨 bucket 校正（官方 metrics 非即時，因此不可只依它允許上傳或精確觸發）。記 `observed_at`、對帳差異、健康狀態。
5. 若差異大於可設定容忍值（如 5%）或來源超過 24h 未更新，儲存管理後台警示，**暫停自動破壞性清理**；高風險情況可限制新上傳，但不得誤刪。
6. 每日清理過期 multipart / orphan objects：先從 DB/queue 建證據與 dry-run，不可隨意刪掉持續中的上傳。

## 3. 活動定義：30 天無人「有效瀏覽」

- `last_valid_viewed_at` 是相簿維度的最後合法人類瀏覽事件（UTC），與 `last_uploaded_at` / `updated_at` / `last_modified_at` 分開。
- 有效事件：已獲授權的人類 visitor 打開相簿且至少一張照片進入可視區域（如 IntersectionObserver ≥ 1 秒）；前端呼叫 rate-limited `POST /gallery/:id/view-heartbeat`，後端驗 session、album scope、CSRF/來源、同一 session 5 分鐘內去重。此演算法只是合理判定，不可宣稱能完全識別機器人。
- 不計入：預載、API healthcheck、cron、後台列表預覽、爬蟲、純 thumbnail CDN request、失敗 request、已撤銷連結。
- Owner 直接進入相簿是否重置計時為可選設定；預設真正開相簿照片者計入，僅開管理列表不計入。
- 未曾被瀏覽的相簿：`effective_last_viewed_at = max(album.published_at ?? album.created_at, last_valid_viewed_at ?? baseline)`；不因 metadata 更新與版本上傳自行延長（除非 owner 啟用按上傳重置）。
- 到期條件：`now_utc - effective_last_viewed_at >= inactive_days * 24h` 且 `album.age >= minimum_album_age_days`。
- 開啟刪除政策前要提示：「30 天未有人**真正打開相簿看照片**將刪除，留言與挑片檔案可能不再可查看」。新使用者預設 `enabled=false` / `dry_run=true`。

## 4. 容量壓力：80% 清理最舊相簿

可設定：`warn=70%`、`cleanup_trigger=80%`、`target=65%`、`upload_block=95%`、`min_album_age_days=7`。

- 觸發條件：`(confirmed_bytes + pending_upload_reservations) / soft_quota_bytes >= 0.80`。
- 候選排序預設 **相簿 `created_at` 最早者優先**（「最舊相簿」的明確定義）；可選 `last_valid_viewed_at` 最早者優先，次序以 UUID 穩定排序。
- 只處理**該 policy 可刪除的相簿**，而非不顧權限砍最舊資料；跨工作空間不得任意占別人的額度清理。
- 每次清理到占用 ≤ 65%，或候選耗盡／達 `max_delete_bytes_per_run`／batch 限額／工作逾時即停。隨批次完成重新讀取 ledger，不用估算總量冒充實際釋放量。
- 若沒有可刪相簿，保留現有照片並停止接收新上傳（或要求調整額度／人工解除保護），發出通知，不可擅自突破保護機制。
- 清理選擇可以是：`none | notify_only | auto_oldest_album | auto_least_recently_viewed | manual_review`；可讓業主選 `retention_only | pressure_only | both`。

## 5. 刪除安全規則（必須）

- 不可自動刪：`pinned=true`、`legal_hold=true`、正在挑片/編修/處理中、進行中的交付、已提出保留需求、未達最小年齡、被 workspace policy 排除的專案/相簿。
- 最近 15 分鐘內又有人開相簿或狀態變更時必須重新評估；進入刪除執行前 DB transaction `SELECT ... FOR UPDATE` + eligibility recheck，以免 race。
- 在刪除 plan → execution 之間允許取消，若已進入 `deleting`，立即停止新的下載 grants 與寫入；保留刪除進度與錯誤列表。
- `dry_run` 必列出每個候選：相簿、建立日、最近有效瀏覽、版本/衍生物數量、位元組、排除原因、政策、釋放估算與下次執行時間。
- 具選項的 grace (0/24/72hr)。如要真正立即騰出 R2 空間，grace=0；如需要可復原的 trash，trash 本身仍占空間，不得在 UI 假裝已釋放。
- 先撤銷 invite / 新的讀取授權，逐筆刪除 R2 keys（包含 original/versions/derivatives/finals，如果它們屬於欲刪相簿且不被其他相簿引用）。個別刪除成功才在 ledger 中扣減。
- 寫入 `deletion_jobs` 和 `deletion_items`，包含 `reason`, `policy_snapshot`, `bytes_before`, `bytes_reclaimed`, `started_at`, `finished_at`, `attempts`, `failed_keys`。具 retry/backoff，重入 idempotent。
- 刪除後 DB 保留最小化 tombstone + audit（例如「照片已依政策刪除」），不可繼續展示已刪不存在的照片；個資刪除請求得縮短歷史資料存續。

## 6. 執行程序（至少每小時或每天依負載）

1. Cloudflare scheduled Worker (UTC) 發起 job（至少每日；容量快滿時每小時檢查）。
2. Acquire per-workspace advisory/job lock，整理 occupancy snapshot，確保 metrics 健康。
3. `RetentionPolicyEngine.previewPlan`: 滿 30 天未瀏覽 + 超 80% 候選，依 `deletion_priority` 排序。若兩政策同時成立，去重相簿 ID，保留兩個 reason。
4. Dry-run 只存計畫與通知；正式模式在每個相簿刪除前重驗活動、protect、scope、檔案參照/版本。
5. revoke shares; mark deleting; enqueue children keys; 刪除後對帳 bytes；persist tombstones/events。
6. 重新量測是否到 65%；結束時留下 job report，失敗時可續跑。

## 7. 管理 UI

`設定 > 儲存與保留`：用量（已確認/上傳預留/全域/各專案）、到期相簿、政策開關、天數、警示／清理／停止比例、候選排序、保護標記、維持份數、警告通知、dry-run；按「預覽將刪除」產生可審核表，再二次明確確認「啟用自動刪除」。釘選照片或專案數量與容量需顯示，避免用戶以為資料能無限永久保留。

## 8. 不可省略的測試

- 30 天未瀏覽、29 天、第一次建立未瀏覽、guest/owner view、機器人假 view、同時重新瀏覽與刪除競態。
- 79.9% 不清、80% 清到 65%、最舊被保護則跳過、無候選則封鎖上傳、超過 batch limit 下一輪接續。
- 同時建立版本與 upload reservation；pending upload 造成佔額；刪除部分 R2 object 失敗重試，不能重複扣位元組。
- 兩個 buckets 計算、metrics 偏差/離線、與各 workspace 配額隔離。
- dry-run 絕不可產生 delete 呼叫；回收明細與事件歷史必須查得到。

## 9. 為何不能只用 Cloudflare R2 Lifecycle

R2 lifecycle 依 object age，與相簿實際瀏覽活動無關；它也無法根據全平台 quota 80% 直接選「最舊的完整相簿」。可以僅用於清理過期暫存前綴/中止 multipart uploads，不能替代本規格的 album-level policy engine。

參考：https://developers.cloudflare.com/r2/pricing/ ; https://developers.cloudflare.com/r2/platform/metrics-analytics/ ; https://developers.cloudflare.com/r2/buckets/object-lifecycles/ ; https://developers.cloudflare.com/workers/configuration/cron-triggers/

## 已實作保護設定的邊界（2026-10-23）

相簿既有 is_pinned/legal_hold 可由當前 workspace owner 設定；其他角色只讀。解除任一既有保護須明確確認；與改名共用 revision，保護/審計/去重同交易。deleting/deleted 禁止新修改，draft/active/archived 可設定。此操作不更新有效瀏覽時間、不啟用清理或執行物件刪除。未來清理器必須取得同一 workspace/album 鎖並重驗這兩旗標，不能把本次 RPC 當成已完成保留政策執行。專案保護、照片釘選、清理預覽/opt-in/工作佇列仍待實作；自動刪除 OFF、dry-run ON。

## 封存與保留政策的界線（2026-10-23）

目前僅支援無照片且閒置的專案／相簿封存、回到所存原狀態的還原。封存不代表刪檔、釋放容量、釘選或永久保留；不改 is_pinned/legal_hold、published_at/last_valid_viewed_at。封存父專案暫停名稱與新增相簿寫入，但 owner 可繼續管理相簿保護。清理尚未啟用；未來執行器仍須依原 eligibility/保護/最小保留天數/opt-in 重驗，不可只看 archived 就刪。新增 upload reservations/reviews/jobs 時須先納入同一 workspace/resource 鎖與 idle guard，才能擴充封存範圍。

## 新 Cloudflare target 配額與目前範圍

CF-03c3 adds processing reservations to the same D1 workspace/node reserved counters:16MiB per claimed recipe until both derivatives are verified and actual bytes committed. Queued work reserves0; expired leases, unknown writes and review keep the full budget. Reconciliation/pressure planners must count upload plus processing reservations, not only `storage_reservations`. New job slots reuse immutable keys; do not clear job counters or release on a missing HEAD/TTL. No review remediation/delete operation exists yet; future release requires durable fencing or separately verified safe handling of every potential output key. Processing busy states also block archive and must exclude retention candidates. Autodelete remains OFF/dry-run ON. See PROCESSING_PIPELINE.md.

本輪明確採納補充後，新 D1 storage_nodes 預設 quota_bytes=9,000,000,000；此為內部新節點策略，舊 PG 8,000,000,000 及已存設定不改寫。不是 Cloudflare 免費容量或零帳單保證。新 Worker Cron 目前僅觀察審計 deleted=0，沒有資格判定／刪除預覽／清理執行；storage_settings 與 config 強制 autodelete=false/dry_run=true。多帳號路由 OFF，尚無管理員啟用 UI。其餘30天、80→65%、保護/最低年齡/重試等規範完整保留。

CF-03c4b manually abandons only needs_review derivative processing after explicit Owner confirmation and both permanent empty fences; originals are retained.0015 atomically releases16MiB workspace/node reservation with audit. Occupied/unknown/readonly keep all capacity; no object deletion occurs. Retention must preserve fences forever; do not use job age/lease expiry to clear counters. This is not automatic retention cleanup.

## 2026-10-29 — Authorized photo-view heartbeat local slice

Owner/Guest POST album view-heartbeats now validates current viewing authority and ready private photo/version,then atomically appends a rolling-five-minute-deduped gallery.viewed witness and monotonic last-valid-view projection. Loaded,intersecting,visible/focused photos must qualify for1s in the Gallery;metadata/download-only/Cron fetches do not count. This is a browser heuristic,not proof of humanity or complete occlusion detection. Three native API groups and two375px controlled browser flows pass;see HUMAN_PHOTO_VIEWS.md and latest appended HANDOFF entry.

0053 remains SOURCE ONLY and default persistent D1 remains0052;tracking and deletion defaultOFF/dry-run. Continuous activity evidence for legacy/disabled/outage periods is not established by an absent timestamp:the pure planner now rejects activityEvidenceVerified=false. Actual D1 snapshot/plan persistence/policy/Owner confirmation/deletion locks/jobs/retry/reconciliation/global quota/hosted acceptance remain required. The user's one-person representative approval rule is confirmed;version confirmation implementation is next.
