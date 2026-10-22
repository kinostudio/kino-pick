# API 合約（v1）

路徑 `/api/v1/...`，所有資源要以 actor session + workspace/scope 驗證，不允許只用 path id 決定授權。Response 錯誤統一 `{ "error": { "code": string, "message": string, "details"?: object }, "requestId": string }`；timestamp ISO8601 UTC。會改變狀態的 POST/PUT/PATCH 具 requestId/idempotency。Zod 驗證 request/response；API pagination 以 opaque cursor。

## Auth/Workspace

| Method | Path                             | 目的                                                                             | 權限                |
| ------ | -------------------------------- | -------------------------------------------------------------------------------- | ------------------- |
| POST   | `/guest-invites/:token/exchange` | 交換 token（含 password/OTP）取得 HttpOnly scoped session；redirect 清 URL token | invite secret       |
| POST   | `/guest-sessions/logout`         | 撤銷 guest session                                                               | guest               |
| GET    | `/me`                            | 目前 actor/角色/權限                                                             | auth                |
| GET    | `/workspaces`                    | 列出可管理的空間                                                                 | owner/team          |
| POST   | `/workspaces`                    | 建立空間                                                                         | authenticated       |
| GET    | `/client-portal/projects`        | 受驗證的跨專案清單                                                               | client portal grant |

## Project/Album/Share

| Method    | Path                          | 目的                        |
| --------- | ----------------------------- | --------------------------- |
| GET/POST  | `/projects`                   | 篩選專案、新建              |
| GET/PATCH | `/projects/:id`               | 查詢/修改                   |
| GET/POST  | `/projects/:id/albums`        | 相簿清單/新增               |
| PATCH     | `/albums/:id`                 | 改標題/排序/保護/政策       |
| POST      | `/projects/:id/invites`       | 建立 invite token/模式/權限 |
| POST      | `/invites/:id/revoke`         | 立即撤銷                    |
| POST      | `/projects/:id/review-rounds` | 建立新輪次                  |
| POST      | `/review-rounds/:id/submit`   | 交易提交快照                |
| POST      | `/review-rounds/:id/reopen`   | 限攝影師／指定管理權限      |

## Upload/Photos

| Method | Path                                          | 目的                                             |
| ------ | --------------------------------------------- | ------------------------------------------------ |
| POST   | `/uploads/init`                               | 驗證 quota + 預留容量 + R2 presign               |
| POST   | `/uploads/:id/complete`                       | HEAD / checksum / bytes 驗證，排入 thumbnail job |
| POST   | `/uploads/:id/cancel`                         | 取消 reservation / multipart cleanup             |
| GET    | `/albums/:id/photos?cursor=...`               | 分頁 photo metadata + authenticated previews     |
| GET    | `/photos/:id`                                 | photo detail current state                       |
| GET    | `/images/:assetId`                            | 私有圖片 gateway，驗權限與尺寸                   |
| POST   | `/photos/:id/versions/init`                   | 指定照片產生新版本上傳                           |
| POST   | `/photos/:id/versions/complete`               | 結束新版本                                       |
| GET    | `/photos/:id/versions`                        | 版本清單                                         |
| POST   | `/photos/:id/versions/:versionId/set-current` | 切換 current                                     |
| POST   | `/uploads/resolve-match`                      | 同檔名疑義人工批次確認                           |
| POST   | `/photos/:id/diff`                            | before/after 產生 heatmap (feature flag)         |

## Review, activity

| Method | Path                                           | 目的                                     |
| ------ | ---------------------------------------------- | ---------------------------------------- |
| PUT    | `/review-rounds/:id/photos/:photoId/selection` | selected:true/false，transaction + event |
| PUT    | `/photos/:id/rating`                           | stars 1..5 or null                       |
| PUT    | `/photos/:id/favorite`                         | favored true/false                       |
| PUT    | `/photos/:id/tags`                             | add/remove labels                        |
| POST   | `/photos/:id/comments`                         | 留言與回覆                               |
| PATCH  | `/comments/:id`                                | 編修文字和狀態                           |
| POST   | `/photos/:id/annotations`                      | 正規化 geometry                          |
| PATCH  | `/annotations/:id`                             | 修改／刪除標註                           |
| GET    | `/projects/:id/activity?cursor=...`            | owner/team 受限操作全歷史                |
| GET    | `/photos/:id/activity`                         | 按照片歷程                               |
| GET    | `/guest/me/activity?projectId=...`             | 客戶自己的歷程                           |
| GET    | `/projects/:id/selected-export`                | 選片 TXT / CSV                           |
| POST   | `/albums/:id/view-heartbeat`                   | 有效瀏覽（去重節流）                     |

## Storage and retention

| Method    | Path                                   | 目的                                              |
| --------- | -------------------------------------- | ------------------------------------------------- |
| GET       | `/storage/usage`                       | ledger、reserved、reconciled、bucket distribution |
| GET/PATCH | `/storage/policy`                      | 設定 retention、quota、閾值（owner only）         |
| POST      | `/storage/retention/preview`           | 不破壞資料的 dry-run plan                         |
| GET       | `/storage/retention/plans/:id`         | 查看候選、排除原因、預估 bytes                    |
| POST      | `/storage/retention/plans/:id/execute` | owner explicit confirmation; policy eligible only |
| POST      | `/storage/retention/jobs/:id/cancel`   | 刪除尚未開始部分                                  |
| GET       | `/storage/retention/jobs`              | job history                                       |
| POST      | `/storage/retention/jobs/:id/retry`    | 僅 retry failed; idempotent                       |

## Delivery

| Method | Path                       | 目的                               |
| ------ | -------------------------- | ---------------------------------- |
| POST   | `/projects/:id/deliveries` | 建立交付                           |
| GET    | `/deliveries/:id`          | 授權的交付清單                     |
| POST   | `/deliveries/:id/download` | 授權分辨版本與解析度下載、事件 log |
| POST   | `/deliveries/:id/zip`      | 產生有期限 ZIP 的背景作業          |

## 常見錯誤代碼

`AUTH_REQUIRED`, `INVITE_EXPIRED`, `INVITE_REVOKED`, `PASSWORD_INVALID`, `FORBIDDEN_SCOPE`, `TENANT_MISMATCH`, `REVIEW_LOCKED`, `SELECTION_LIMIT_REACHED`, `VERSION_MATCH_AMBIGUOUS`, `DUPLICATE_CONTENT`, `QUOTA_EXCEEDED`, `UPLOAD_NOT_VERIFIED`, `ASSET_DELETING`, `RETENTION_POLICY_NOT_ENABLED`, `REQUIRES_DRY_RUN_REVIEW`, `CONCURRENT_MODIFICATION`, `RATE_LIMITED`, `NOT_FOUND`。

## API 規約例子

`PUT /review-rounds/123/photos/abc/selection` body `{"selected":true,"requestId":"uuid"}` → `{ "selected": true, "selectedCount": 12, "limit": 30, "eventId": "uuid", "occurredAt": "...Z" }`。
`POST /storage/retention/preview` → `{ "planId": "...", "dryRun": true, "currentBytes": 6400000000, "targetBytes": 5200000000, "candidates": [...], "excluded": [...] }`。
`GET /photos/:id/versions` → `[{"versionNo":1,"assetReady":true,"comment":"original"},{"versionNo":2,"assetReady":true,"comment":"retouch"}]`。

所有正式 endpoint 應產出 OpenAPI 文件（可從 Zod 或定義同步產生），並附錯誤碼與授權範例；不可只產生 API URL 表但沒有實作。

## M1-01 implemented locally (2026-10-23)

Only these endpoints are implemented at this stage; tables above remain the full roadmap.

- POST `/auth/google`: same-origin native form; Supabase Google OAuth/PKCE redirect. Configured callback only.
- GET `/auth/callback`: one-use provider code exchange, verified Google identity, ensure profile, fixed dashboard redirect. Untrusted next/Host ignored.
- POST `/auth/logout`: same-origin, local-session sign out, fixed login redirect.
- GET `/api/v1/me`: `{actor:{id,provider:'google'}}` from verified getUser, never cookie data alone.
- GET `/api/v1/workspaces?cursor=...`: `{workspaces:[{id,name,ownerUserId,role,createdAt,quotaBytes}],nextCursor:string|null}`. 24 items per page, descending `(created_at,id)`, opaque validated cursor preserves microseconds. No other tenant data returned.
- POST `/api/v1/workspaces`: JSON `{name,requestId:uuid}` (no actor/owner fields accepted) → 201 `{workspace}`. Same actor/requestId/body returns same result; changed payload → 409 REQUEST_ID_CONFLICT. 100 owned workspace application limit. Auth caller can independently create a workspace even if a member of another workspace.
- PUT `/api/v1/workspaces/:workspaceId/members`: owner-only JSON `{userId,role:'workspace_editor'|'photographer'|'retoucher',status:'active'|'suspended',requestId}` → `{member:{workspaceId,userId,role,status}}`. Existing platform profiles only. Owner transfer/removal, team invitations and management UI are not implemented; no UI pretends otherwise.

Mutations enforce canonical Origin/Fetch Metadata and a 16KiB streamed JSON limit, unknown fields rejected. Errors use the standard envelope and generic safe messages; no DB/token details. Auth-disabled requests return AUTH_UNAVAILABLE (503), invalid session AUTH_REQUIRED (401), non-Google identity 403, cross-tenant/owner-only writes FORBIDDEN_SCOPE (403), owner role mutation 409. All protected responses are private/no-store. Empty workspace arrays are real RLS results, not synthetic demo data. Real Google/Supabase/PostgREST verification is still outstanding; tests use a separate loopback fixture.
