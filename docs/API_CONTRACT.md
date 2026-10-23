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

## M1-02 implemented locally — create/read/rename subset

- GET `/api/v1/projects?workspaceId=uuid&cursor=...` → `{workspace,projects,nextCursor}`.
- POST `/api/v1/projects`: strict `{workspaceId,name,requestId}` → 201 `{project}`.
- GET `/api/v1/projects/:projectId` → `{workspace,project}`.
- PATCH `/api/v1/projects/:projectId`: strict `{name,expectedRevision,requestId}` → `{project}`.
- GET `/api/v1/projects/:projectId/albums?cursor=...` → `{workspace,project,albums,nextCursor}`.
- POST `/api/v1/projects/:projectId/albums`: strict `{name,requestId}` → 201 `{album}`.
- PATCH `/api/v1/albums/:albumId`: strict `{name,expectedRevision,requestId}` → `{album}`.

Project: `{id,workspaceId,name,status,versioningMode,revision,createdAt}`. Album: `{id,workspaceId,projectId,name,state,isPinned,legalHold,revision,createdAt}`. Creation starts at revision 1 and draft/manual defaults. Names trim to 1–160 characters. List pages contain at most 24 rows in descending `(created_at,id)` with validated opaque cursor preserving timestamp microseconds.

Owner/editor/photographer may create and rename; retoucher reads only. Missing/cross-tenant/suspended resources uniformly return NOT_FOUND (404), including a replay after revocation; an active read-only retoucher mutation returns FORBIDDEN_SCOPE (403). Inputs cannot override parent IDs, status, protection flags or actor. Name and revision changes, before/after audit, and request ledger commit atomically. A different request with a stale revision returns CONCURRENT_MODIFICATION (409); same request/body replays the original result without another revision/event. Changed body/operation under the same actor/requestId returns REQUEST_ID_CONFLICT (409). New rename requests, including unchanged names, advance revision.

UI routes: `/dashboard/workspaces/:workspaceId` lists projects; `/dashboard/projects/:projectId` lists albums. Conflict reload keeps the draft and requires review before saving against the refreshed revision. No destructive DELETE/archive/publication/protection mutation endpoint is exposed yet; complete M1-02 CRUD/state transitions remain open. Upload and photo grid are still pending M1-03/M1-04.

## OAuth 多來源與主動綁定（2026-10-23）

- POST `/auth/google` / `/auth/github`：同源 native form，僅限 AUTH_PROVIDERS 啟用來源；來源停用 503。Google/GitHub 登入共用既有固定 `/auth/callback`，用 stable user ID 建 profile。
- POST `/auth/link/:provider`：已登入 + 同源 + app manual linking 開關 + allowlisted provider，建立私有短效 intent，SDK PKCE 前往 provider；已綁定 409，pending 過多 429。token 不在 URL、body、回應 JSON 或 audit 中。
- GET `/auth/link/callback`：單一 code + HttpOnly intent + 當前 verified actor；先讀 actor-scoped hash intent，再交換code，驗同 user ID/intended provider、寫 completion。固定 redirect 到 `/dashboard/account?notice=linked` 或 generic error，不接受 next/actor 參數控制目的地。
- `/dashboard/account`：顯示 server-verified bound providers，可新增另一來源；來源停用/未設定 manual linking 時沒有無效按鈕。沒有 unlink/merge API。
- GET `/api/v1/me` actor.provider 擴充為 google|github，為優先 Google 的其中一個合資格已綁 identity，**不是當前 OAuth session 登入來源**。授權仍以 actor.id、session 及 workspace role；不依 provider 取得跨租戶權限。

Private DB begin/read/complete link RPC 僅支援相同 actor，未驗證 provider identity 不可 complete。新錯誤碼 OAUTH_IDENTITY_REQUIRED=403、LINK_INTENT_INVALID=400、LINK_NOT_VERIFIED=403、IDENTITY_ALREADY_LINKED=409、LINK_LIMIT_REACHED=429。應用錯誤訊息不洩漏 provider URL/code/token/其他帳號資料。

## M1-02 album protection increment (2026-10-23)

PATCH `/api/v1/albums/:albumId/protection`: strict JSON `{isPinned:boolean,legalHold:boolean,confirmUnprotect:boolean,expectedRevision:positiveInt,requestId:uuid}` → `{album}`. Requires current workspace owner, canonical Origin, verified session and the existing streamed body limit; scope/actor/state overrides rejected. Ordinary album PATCH remains name-only. Active non-owner members get403; missing/cross-tenant/suspended gets404. Supports flags on draft/active/archived without changing state. Deleting/deleted → RESOURCE_NOT_EDITABLE409. Clearing either currently true flag without explicit confirmation → PROTECTION_CONFIRMATION_REQUIRED409. Stale revision shares CONCURRENT_MODIFICATION409 with rename. Replays and changed payload follow the existing global request ledger rules, after current authorization.

UI: owner sees album protection settings in project album list; unprotect requires acknowledgement; network retries retain identical body/request ID. Conflict retains choices, requires reload and comparison against current flags, then confirmation again if removing current protection. Other members see saved labels only. These controls do not enable cleanup, implement archive/restore or prove legal compliance.

## Empty-content archive/restore increment (2026-10-23)

PATCH `/api/v1/projects/:projectId/archive` or `/api/v1/albums/:albumId/archive`, strict JSON `{archived:boolean,expectedRevision:positiveInt,requestId:uuid}` → `{project}` / `{album}`. Verified current workspace owner only; canonical Origin, streamed JSON limit, standard private/no-store errors. Active non-owner403; missing/cross-tenant/suspended404. INVALID_STATE_TRANSITION409 for unsupported/same target state or legacy archive with unknown origin; CONTENT_NOT_EMPTY_OR_IDLE409 for photos/busy content; RESOURCE_NOT_EDITABLE409 for album transition under archived parent. CAS409 and idempotency follow existing rules; current authorization precedes historical replay.

Initial project archive supports draft/delivered with zero photos and children only draft/archived; album supports draft with zero photos under draft/delivered parent. Restore exact stored origin, with parent restored first. Children are not cascaded. UI owner controls include confirmation, conflict reload/review/reconfirmation and same-body network retry. Archived project cannot rename/create albums, archived/deleting/deleted albums cannot rename. Ordinary PATCH cannot change state. Protection stays independent/owner-editable; flags and human-view times unchanged. Full photo/review/upload/delivery lifecycle and deletion remain pending.

## Cloudflare foundation API boundary

New apps/worker routes are not a full replacement for the above Next business API yet. GET /api/health reports migration-foundation/not_checked, GET /api/v1/me and /api/v1/storage/nodes require a valid Better Auth session plus current enabled Owner. Unknown subject/session denied, node response excludes credential_ref/account/endpoint. POST /api/auth/sign-in/social and GET provider callbacks/get-session plus POST sign-out are mature SDK handlers with exact canonical Origin, 16KiB real body limit, HttpOnly/Lax and HTTPS Secure cookies. Other Auth operations remain404 until fresh-link/unlink/session-management protections exist. Closed target has no public signup/first-login owner route or production mock mode. No real photo upload API is mounted; test R2 harness is outside production main. Legacy endpoints remain a separate reference until D1 ports/Owner acceptance; do not route production users to the foundation.

## CF-02a D1 workspace API (local backend slice)

Worker GET /api/v1/workspaces and POST /api/v1/workspaces now use D1, retaining the reference JSON envelopes, strict createWorkspaceSchema, 24-row keyset pages, name normalization, request UUID and 100-owned-workspace cap. Owner-only target policy replaces reference multi-member access for this slice; no team management endpoint is exposed. Both require current Better Auth session and enabled Owner; POST additionally requires exact canonical Origin, application/json and a real 16KiB body bound. Unknown fields/invalid cursor/JSON return INVALID_INPUT400, conflicting request409 REQUEST_ID_CONFLICT, cap409 WORKSPACE_LIMIT_REACHED. Successful retries return original workspace/201, including after reaching the cap. API errors contain no raw SQL. Responses remain private/no-store.

D1 timestamps use canonical UTC milliseconds; shared opaque cursor envelope is retained, not a cross-database cursor migration guarantee. D1 workspace quota is9GB internal configuration, not extra allocatable physical capacity per workspace; aggregate node reservation is not implemented. No UI adapter cutover/project/album APIs are claimed. Existing Next routes continue to use their original repository.

## CF-02b Worker D1 content API (backend, no UI cutover)

All target routes require a Better Auth session and current enabled Owner. Mutations require exact canonical Origin, application/json and <=16KiB streamed body. Inputs share strict packages/contracts schemas and return private/no-store.

- GET `/api/v1/projects?workspaceId=<uuid>&cursor=...` → `{workspace,projects,nextCursor}`; 24 rows/page, descending `(created_at,id)`, D1 cursor. GET `/api/v1/projects/:projectId` → `{workspace,project}`. POST `/api/v1/projects` strict `{workspaceId,name,requestId}` → 201 `{project}`. PATCH `/api/v1/projects/:projectId` strict `{name,expectedRevision,requestId}` → `{project}`.
- GET `/api/v1/projects/:projectId/albums?cursor=...` → `{workspace,project,albums,nextCursor}`. POST same route strict `{name,requestId}` →201 `{album}`. PATCH `/api/v1/albums/:albumId` strict `{name,expectedRevision,requestId}` → `{album}`.
- PATCH `/api/v1/albums/:albumId/protection` strict `{isPinned,legalHold,confirmUnprotect,expectedRevision,requestId}`. Clearing saved protection requires confirmUnprotect=true.
- PATCH `/api/v1/projects/:projectId/archive` and `/api/v1/albums/:albumId/archive` strict `{archived,expectedRevision,requestId}`; owner-only, reversible origin saved. Projects only draft/delivered with no albums/photos; albums only draft with no photos under draft/delivered parent. No cascade and no object deletion.

All operations now share `(actor_id,request_id)` in `request_commands`; operation plus canonical validated payload must match or returns REQUEST_ID_CONFLICT409. Current Owner/session and resource tenant are checked before replay; create/rename/state/audit/result are one D1 transaction. Renames use revision CAS, replay yields the original response, audit stores before/after. Errors include INVALID_INPUT400, AUTH_REQUIRED401 from middleware, OWNER_REQUIRED403, NOT_FOUND404, REQUEST_ID_CONFLICT/CONCURRENT_MODIFICATION/RESOURCE_NOT_EDITABLE/PROTECTION_CONFIRMATION_REQUIRED/INVALID_STATE_TRANSITION/CONTENT_NOT_EMPTY_OR_IDLE409. Owner-only policy applies to this target; legacy member roles remain in the still-running Next reference. UI calls are not switched to these routes yet.

Migration0005 makes D1 parent IDs immutable and rejects a photo-catalog insert unless project/album/workspace all match. There is still no public photo creation endpoint; this table exists for scope and archive integrity only.

Audit `requestId` is scoped to the actor/guest-session command ledger. Equal request IDs from separate actors are allowed; `eventId` identifies a single append-only history row.
