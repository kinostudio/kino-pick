# Database Schema Contract — PostgreSQL / Supabase

此文件是資料模型合約；實際 migrations 應由 Codex 分段產生，並經資料權限測試，不應在未連上資料庫時宣稱已套用。

## 全域慣例

- Primary keys：UUID。所有租戶資源含 `workspace_id` 並依此建 composite indexes；FK cascade 必小心，因為相簿刪除需要保留 tombstone/audit。
- 時間：`timestamptz` UTC、`created_at` / `updated_at`；更動事件的時間由 server / DB 指定。
- PostgreSQL enums 或 CHECK constraints 必涵蓋明確狀態；外部輸入 Zod + DB Constraints 雙重檢查。
- 重複 API 以 `idempotency_key` / `(actor_id, request_id)` unique 制止重複 event。
- 所有表需要 RLS 或可靠的 server tenant scoping；不允許前端使用高權限 service role 直接讀寫。

## 身分與組織

| Table                    | 重要欄位                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `profiles`               | id(auth.users FK), display_name, avatar_url, locale                                                             |
| `workspaces`             | id, owner_user_id, name, quota_bytes, retention_policy_id, created_at                                           |
| `workspace_members`      | workspace_id, user_id, role, permissions_json, status                                                           |
| `clients`                | id, workspace_id, name, contact_email(nullable), created_at                                                     |
| `client_portal_grants`   | id, workspace_id, client_id, subject_identity/email_hash, grant_token_hash, auth_method, expires_at, revoked_at |
| `client_portal_projects` | portal_grant_id, project_id                                                                                     |

## 專案／分享／相簿

| Table                | 重要欄位                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`           | id, workspace_id, client_id?, name, status, versioning_mode, selection_limit?, cover_photo_id?, settings_json                                             |
| `albums`             | id, workspace_id, project_id, name, display_order, created_at, published_at, last_valid_viewed_at, state, is_pinned, legal_hold                           |
| `review_rounds`      | id, workspace_id, project_id, album_id?, number, status, selection_limit, shared_selection, submitted_at, submitted_by                                    |
| `review_submissions` | id, workspace_id, round_id, actor_id, snapshot_json, submitted_at, reopened_at?                                                                           |
| `share_links`        | id, workspace_id, project_id, scope_json, token_hash UNIQUE, password_hash?, access_mode, expires_at, revoked_at, permissions_json, max_uses?, used_count |
| `guest_identities`   | id, display_name, created_at, verified_email_hash?                                                                                                        |
| `guest_sessions`     | id, workspace_id, invite_id, guest_id, hashed_session_secret, expires_at, revoked_at, last_seen_at                                                        |

## 照片與版本

| Table             | 重要欄位                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `photos`          | id, workspace_id, project_id, album_id, canonical_name, original_filename, current_version_id(nullable), sort_index, state                                        |
| `photo_versions`  | id, workspace_id, photo_id, version_no, parent_version_id?, created_by_actor, upload_note, source_hash_sha256, width, height, status, created_at                  |
| `photo_assets`    | id, workspace_id, photo_id, version_id?, asset_kind, r2_bucket, object_key UNIQUE, byte_size, mime, checksum_sha256, state, storage_class, created_at, deleted_at |
| `upload_sessions` | id, workspace_id, album_id, photo_id?, version_target_id?, intent, object_key, status, expected_bytes, reservation_bytes, expires_at, completed_at                |
| `image_diff_jobs` | id, workspace_id, photo_id, before_version_id, after_version_id, alignment_strategy, status, heatmap_asset_id?, diff_metadata_json                                |

## 客戶狀態與歷程

| Table             | 重要欄位                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selection_items` | id, workspace_id, round_id, photo_id, actor_kind, actor_id, selected_at, UNIQUE(round_id, photo_id, actor_kind, actor_id)                                                                            |
| `photo_ratings`   | workspace_id, photo_id, actor_kind, actor_id, stars CHECK 1..5                                                                                                                                       |
| `favorites`       | workspace_id, photo_id, actor_kind, actor_id, favorited_at                                                                                                                                           |
| `tags`            | id, workspace_id, project_id, label, color?                                                                                                                                                          |
| `photo_tags`      | photo_id, tag_id, actor_kind, actor_id                                                                                                                                                               |
| `comments`        | id, workspace_id, photo_id, version_id?, parent_comment_id?, actor_kind, actor_id, text, status, created_at, edited_at?, deleted_at?                                                                 |
| `annotations`     | id, workspace_id, photo_id, version_id, comment_id?, author_actor, geometry_json, style_json, status, created_at, deleted_at?                                                                        |
| `activity_events` | id, workspace_id, project_id, album_id?, photo_id?, version_id?, round_id?, actor_kind, actor_id, guest_session_id?, invite_id?, action, before_json, after_json, occurred_at, request_id, meta_json |
| `audit_logs`      | id, workspace_id?, actor, operation, resource, before_json, after_json, timestamp, request_id, result                                                                                                |

## 儲存保留與作業

| Table                  | 重要欄位                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage_policies`     | id, workspace_id?, enabled, dry_run, soft_quota_bytes, warn_ratio, cleanup_ratio, target_ratio, block_ratio, inactivity_days, pressure_mode, protect_config_json, updated_at |
| `storage_ledgers`      | id, workspace_id, bucket, confirmed_bytes, reservation_bytes, last_reconciled_at, observed_cloud_bytes?, metric_freshness_state                                              |
| `storage_reservations` | id, workspace_id, upload_session_id, reserved_bytes, expires_at, status                                                                                                      |
| `retention_plans`      | id, workspace_id, reason, policy_snapshot_json, status, candidate_bytes, created_at, approved_at?                                                                            |
| `retention_plan_items` | id, plan_id, album_id, estimated_bytes, eligibility_snapshot_json, exclusion_reason?                                                                                         |
| `deletion_jobs`        | id, workspace_id, plan_id, album_id, state, reason, byte_estimate, bytes_reclaimed, attempt_count, lock_owner?, started_at, finished_at                                      |
| `deletion_items`       | id, job_id, photo_asset_id, r2_bucket, object_key, bytes, state, attempts, last_error?                                                                                       |
| `jobs`                 | id, workspace_id?, job_type, payload_json, status, attempts, next_run_at, dedupe_key UNIQUE                                                                                  |
| `notifications`        | id, recipient, kind, payload_json, state, sent_at?                                                                                                                           |
| `deliveries`           | id, workspace_id, project_id, status, expires_at, created_by, approved_review_round_id?                                                                                      |
| `delivery_assets`      | id, delivery_id, photo_id, photo_version_id, file_asset_id                                                                                                                   |

## 強制唯一鍵 / 索引（最低）

- `photo_versions UNIQUE(photo_id, version_no)`。
- `photo_assets UNIQUE(r2_bucket, object_key)`；state+workspace_id 索引。
- `photos (workspace_id, project_id, album_id, canonical_name)` 非唯一（同名可能需要人工比對）。
- `selection_items UNIQUE(round_id, photo_id, actor_kind, actor_id)`；另建 (workspace_id, round_id) index。
- `activity_events (workspace_id, project_id, occurred_at DESC, id DESC)` + `(photo_id, occurred_at DESC)` + `(actor_kind, actor_id, occurred_at DESC)`。
- `albums (workspace_id, created_at ASC)`、`(workspace_id, last_valid_viewed_at)` for cleanup。
- `deletion_items UNIQUE(job_id, r2_bucket, object_key)`；禁止同 key 再刪雙重扣帳。
- `share_links (token_hash)` unique and expiration indexes。

## Database security

- 所有管理修改先 check workspace role；guest 讀取不能直接以 Supabase anon role 查所有表，必須走 server scoped session + 經檢查的 API / RPC。
- `activity_events` 一般服務帳號只可 INSERT / SELECT scoped rows；UPDATE/DELETE 僅可由特定資料保留管理程序執行並記額外 audit。
- DB migration 規定：expand/migrate/contract，提供 rollback 或 restore strategy；不允許大量 cascade 直接刪 activity_events。

## 重要交易範例（偽碼）

```
BEGIN;
  lock review_round FOR UPDATE;
  assert session can_select AND round.status='selecting';
  assert selection_count < limit (unless deselect);
  INSERT/DELETE selection_item;
  INSERT activity_event {action, before, after, request_id};
COMMIT;
```

刪除相簿應採多步狀態機與 job，不能使用 `DELETE FROM albums` 讓 FK cascade 偷偷丟失歷史。

## 已實作子集合：M1-01 / migration 202610230002

新增 `audit_logs`：workspace_id nullable、actor_id、operation、resource_id、before_json、after_json、occurred_at (DB UTC)、request_id；一般角色只有 owner/自身無 workspace 的 profile event 可讀，不可直接寫入或修改/刪除。此表是管理變更審計，尚不是完整照片/guest 操作的 `activity_events`。後者仍在 M2，必須包含 session/invite/photo/version 前後值。

`kino_private.workspace_requests` 是不公開的交易重送 ledger，actor_id/request_id unique，記 operation、payload、result。表開 RLS 且不授權一般角色/schema access；只由可信 security-definer RPC 讀寫。已實作三項 RPC：ensure_photographer_profile、create_workspace、set_workspace_member；具角色/身份檢查、鎖與同交易 audit。資料表其餘欄位/完整模型仍待相應 phase migration，不能把本規範表格視為已建置。
