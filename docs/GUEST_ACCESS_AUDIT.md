## 2026-10-28 — M3g4 locally accepted

Genuine Owner annotation authoring and invitation-shared mixed-role reads are locally accepted with308 complete Worker/D1/R2/Chromium checks and467 unit tests. Real375px geometry/lifecycle/reload/exact replay and actual disabled-Owner403 privacy/journal preservation passed; Root inspected the actual photo/red-rectangle capture.0046 is applied LOCAL ONLY after a new verified backup/isolated restore/110-old-table hash parity:114 tables/same4 development rows/4 new empty Owner tables/FK0/no pending migrations. All gates remain OFF/hard-local and deletion OFF/dry-run; no hosted acceptance. See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) and latest HANDOFF for contracts, logs, recovery and unfinished Owner processing/history work. Earlier in-progress checkpoints below are historical and superseded.

## 2026-10-28 — Genuine Owner annotation provenance

New owner.annotation_created/updated/deleted/resolved/reopened events use actor_type=user and the real opaque Owner session_id, with guest_session_id NULL and exact UTC/request/scope/before/after witnesses. Guest annotation events retain their original author/session semantics. Shared read visibility confers no peer command authority and adds no audit/activity write merely for metadata reads. See OWNER_ANNOTATIONS.md; source/runtime acceptance remains tracked in HANDOFF.

## 2026-10-28 — Same-invitation annotation visibility confirmed and implemented

The user explicitly chose 同邀請共用（比照留言）. Shared annotation rows are visible only through the current Guest session's sealed invitation/album/photo/version scope with independent can_annotate. Different invitations and global client history remain isolated. Own recovery/history remain author-scoped; sharing does not expose full audit geometry to a history-only viewer or allow peer mutations. Immutable Guest events retain exact Guest/session/request/UTC/before-after provenance. Owner readonly reads never impersonate a Guest or append writes; future Owner authored annotation commands require genuine Owner witnesses.295 local/430 unit acceptance and0045 backup/adoption are in HANDOFF. Hosted/session/native headed acceptance remains open; all gates OFF/hard-local and deletion OFF/dry-run.

## 2026-10-28 — M3g1 annotation backend boundary

M3g1 adds genuine Guest annotation.created/updated/deleted/resolved/reopened with exact current Guest/session/request/photo/version and UTC before/after geometry/style/link internally. Owner session_id stays null. Own history exposes only annotationId/revision/state; no peer history or geometry is disclosed. Source-only0045 and default-OFF gate; genuine Owner annotations must use a separate Owner path later. See GUEST_ANNOTATIONS.md.

## 2026-10-28 — Genuine Owner reply audit path

0043 Owner events use actor_type=user and the genuine historical Owner session_id, with guest_session_id NULL; they never borrow a Guest identity/session. Immutable command/reply/change/result and shared marker witnesses bind request, invitation, photo/version, UTC and before/after values atomically. Guest own-history remains limited to its own allowlisted actions and never gains peer/Owner bodies through raw audit. Private thread reads expose readonly Owner replies within the same invitation only.260 local checks and backup/hash-preserving local adoption passed. See OWNER_COMMENTS.md for exact recovery and remaining work.

## 2026-10-27 — Invitation-shared comment audit accepted locally

Guest comments use independent can_comment and exact current invitation/version grants. Same invitation shares thread text; different invitations remain isolated and peers cannot mutate another author. Each create/edit/delete/resolve/reopen appends exact author/invitation/tenant/photo/version/before/after/UTC/request/guest_session provenance atomically. Owner session_id remains NULL for Guest events. A comment audit row requires its immutable change witness and an exact command target. Public own-history omits all body text and peer actions; only the same author/session may replay its own historical write result.243 local Worker checks passed;0042 local-only applied after backup. No Owner comment impersonation path is implemented. See GUEST_COMMENTS/HANDOFF; prior undecided notes are historical.

## Confirmed comment visibility decision — 2026-10-26

The user chose: Guests on the same invitation may read each other's comments; Guests on different invitations remain isolated. Treat invite_id as the discussion boundary in addition to workspace/project/album/photo scope. An Owner reply must target that exact invitation thread; possession of another invitation for the same project/photo grants no access to its comments. Do not merge Guest identities by nickname, email or shared photo. can_comment stays independent of can_view, selection and other permissions. This decision resolves earlier pending visibility notes; other comment lifecycle/status/retention details still need an explicit implementation contract and tests. No comments feature is implemented or enabled by this documentation update.

## M2p own-history projection — pending acceptance

See GUEST_HISTORY.md. The independent can_view_own_history right authorizes only the cookie-derived Guest's allowlisted activity within the current sealed invitation. Historical sessions may have expired; current authorization may not. Shared-selection events show only the caller's actions. The reader performs no audit/activity/retention writes. Public before/after projections omit raw internal fields and other identities; cursor claims contain a scope digest rather than internal invitation IDs. Generic missing-photo/version markers are implemented; retained safe filename tombstones remain unfinished. Full local browser/runtime acceptance is pending and the feature stays OFF.

## Guest tag contract clarification (M2o, accepted locally)

See GUEST_TAGS.md. Tags use independent can_tag and per-invite/Guest memberships, with no Guest project-catalog enumeration. Like M2l ratings/favorites, tags may change after selection submission without modifying the frozen snapshot; this overrides older generic submitted-round edit restrictions for tags only. Stable expectedGuestId protects uncertain retries from cookie identity changes. Routes and Grid/Lightbox controls passed the148-check local suite; GUEST_TAGS_ENABLED remainsfalse with hard-local gating, and hosted acceptance is not claimed.

## M2m2 shared review events (local integration)

Private history remains unchanged. New explicitly sealed shared subjects append shared_review.created/shared_review.reopened and shared_selection.added/shared_selection.removed/shared_selection.version_changed/shared_selection.submitted. Each meaningful selection event records the cookie-derived Guest, exact authorized session/request, project/album/photo/version, UTC and before/after values. No-op stores an immutable command result without a fake change event. expectedGuestId prevents an uncertain request from becoming another Guest's operation after a cookie switch. Owner download.requested/download.generated share one server request ID; only a successfully completed stream gets generated evidence, and this never proves client receipt. No filename/object key/content appears in export audit. Shared read APIs do not expose other Guest identities or refresh retention. See SHARED_SELECTION.md; final full browser acceptance is pending, hosted flags OFF.

M2k current invitation UI: Owner creation/share now preserves exact request intent and one-time secrets; Guest fragment entry bypasses Owner login and only uses scoped Guest cookies. No token appears in path/query/storage/logs, and unknown exchange results never automatically consume another session. See INVITATION_FLOW.md; full action history and hosted acceptance remain unfinished.

## M2m1 policy and reopen history

Meaningful Owner policy changes append selection.policy_changed with tenant/project/album, session/request, UTC and before/after min/max/revision. Exact replay/no-op does not duplicate a change event.0029 appends system selection.round_initialized only for legacy open reopened revision0 rows, retaining their Guest/invite/round before/after identity. Historical selection.reopened metadata and sealed submission snapshots are not rewritten; new reopen audit after_json includes selectionRevision1. Bounds denial rolls the attempted selection/submission and audit back. Shared picking remains an explicit future opt-in subject, never inferred from a shared invitation URL. See SELECTION_POLICY.md.

## M2l rating/favorite audit

Meaningful changes append rating.set, rating.cleared, favorite.added or favorite.removed with Guest/session/request, tenant/project/album/photo/version, UTC and before/after. Clearing retains witnessed null/false state. No-op/exact replay retain immutable command/results without duplicate change events. Audit insertion failure rolls state/result/command back for an exact same-ID retry. A selection submit freezes only its snapshot, so later independently authorized feedback adds events without altering submitted items. Own-kind batch reads and capability reads append no event or valid-human-view activity. See GUEST_FEEDBACK.md; complete Guest/Owner history UI is still required.

M2i historical: a local-only/default-OFF Guest selection write backend now enforces the independent `can_select` bit and rechecks current hash session, exact sealed album, active Owner/parents, exact photo/version, deadlines and revocations in the same D1 transaction as selection state and immutable audit. It exposes only a single known-photo mutation; no selection read, submission/round, Owner export or Guest UI. See GUEST_SELECTION.md. M2h gallery remains read-only; history and cross-project access are not made globally visible by a single-project capability.

# 客戶免註冊邀請、權限、跨專案歷史與完整操作紀錄

M2j current: Guest selection can now be read as a private paginated list for the current invite/session with can_select bit 8; only own photo/version/time fields are exposed. Submission is a separate can_submit bit 512 capability. The server snapshots current selected photo/version rows, writes immutable submission result and selection.submitted audit atomically, then blocks Guest changes to that round. Both GET and POST recheck current session, sealed album, Owner/parent state, expiry and revocations; no cross-project history is granted. The routes remain default-OFF and hard local-only. Owner submission review/detail/export/reopen UI and APIs are implemented locally. Successful Owner export GETs now append download.generated before returning the attachment; metadata includes only submission ID, format and selected count, and the event cannot prove the client saved all response bytes. Other action history remains incomplete. See GUEST_SELECTION.md.

M2h historical: read-only Guest gallery listing and private thumbnail/preview reads repeat current session, sealed album, can_view, Owner, state, expiry and revocation checks in D1. These reads expose no originals or download/action grants, append no event and do not update valid-human-view retention state. Never treat a single-project capability as global identity. See GUEST_GALLERY.md.

M2d historical: local/default-OFF Owner issuer creates all3 modes with exact scope/seal/client-request audit and secret-free replay/recovery; see INVITE_ISSUANCE.md. M2g adds the local-only exchange backend. Hosted KDF/throttle acceptance, client share URL/UI and picking remain incomplete.

M2c historical: adds self-logout with cookie proof and atomic Guest/session/request audit, plus fixed scrypt/token primitives and strict new verifier guard. M2g later adds local-only exchange. Guest UI remains pending. See GUEST_CREDENTIALS.md; prior no-logout notes below describe historical phase boundaries.

M2b historical: adds real Owner invitation inspection and explicitly confirmed revocation,0017 immutable request commands/atomic audit, replay/auth/namespace guards and current Guest denial. See OWNER_INVITATIONS.md. Later milestones add gated issuance/exchange backends; Guest picking and the detailed product matrix below remain required.

M2a historical D1 backend baseline:0016 scopes/seals/identities/hashed sessions/revocations and read-only access API are locally implemented; full12-right matrix retained. At M2a, invitation issuance/password KDF/exchange/logout/Guest photos/actions/portal were still planned. Later milestones add gated issuance/exchange/logout; Guest photos/actions/portal remain planned. Sealing stores exact album scope before first session; future atomic state/event writes must repeat ACL. Full boundary/recovery in GUEST_ACCESS_FOUNDATION.md; Owner-only reference descriptions below remain product requirements, not proof of a completed Guest flow.

## 1. 兩條入口（後續可補帳號式）

**Owner/team**：Google OAuth；綁定 Supabase auth.user.id，workspace membership 決定存取權。
**Guest invite**：攝影師建立每個 project/album 專屬 capability link，guest 直接打開、按 policy 輸入密碼或不輸入，再由 server 建立 scoped HttpOnly session；不要求 Google 登入。

## 2. 分享邀請設定

- `access_mode`: `link_only` / `generated_password` / `custom_password`；預設建議 `generated_password`，但三模式皆支援。
- `scope`: project_id，選擇可見 album_id 集合。權限採逐項 boolean：`can_view`, `can_download_preview`, `can_download_original`, `can_select`, `can_rate`, `can_favorite`, `can_tag`, `can_annotate`, `can_comment`, `can_submit`, `can_view_own_history`, `can_compare_versions`。
- 另可設定 `expires_at`, `max_uses`, `revoked_at`, `allowed_email_domain`（需 OTP 才可驗）、是否允許匿名暱稱、限制下載解析度、水印及期限。
- 密碼儲存為安全單向密碼雜湊 Argon2id（若 runtime/套件適合）或穩健的現代 KDF；絕不保存 plaintext。系統產生密碼只在建立時顯示一次，由 owner 明確分享。
- 分享 token 至少 256-bit 隨機，DB 存 hash；URL secret 在交換 scoped session 後透過 redirect 移除查詢參數，禁止送到 analytics/referrer、log。配置 `Referrer-Policy: no-referrer`、Cache-Control: no-store。
- Guests 可按配置不加密，但仍是**持有連結者即被授權**，可讀同一專案的內容；重要/未公開拍攝建議設定密碼或 OTP。

## 3. 匿名身份與歷史紀錄

- `guest_identity`: 隨訪客新建隨機 guest_id + 顯示暱稱（暱稱不能用來驗證身分）；`guest_sessions` 持有 server 端 hash 及過期，cookie HttpOnly Secure SameSite=Lax（或更嚴格）+ CSRF defense。
- 權限以 invite_id + session scope 有效性檢查，不可只看 session 的 photo_id 任意跨專案。
- 同一設備回訪：僅恢復尚有效的同 project session；可看自己的事件／選片歷史。不同設備需重走分享授權；不承諾憑同名暱稱自動整合。
- **跨專案歷史專頁**：使用 `client_portal_grants` 聚合被攝影師授予的專案。可用 Email OTP 驗證或另一組高強度的獨立 portfolio link/token 授權，同時提供撤銷與到期設定。未經此額外認證，不得僅憑「A 專案免密碼連結」看到 B 專案。
- 若同一匿名連結多人共用，應區分獨立 guest_id；「所有人共用挑片」必須以 review_round 配置 `shared_selection=true`，且管理員明知不同人可互相影響；預設個人私有資料。

## 4. 權限矩陣與安全

- 每個 API 都使用 server 的 ACL/resolver；`can_view` 不代表可下載原圖；`can_rate` 不代表可提交。
- `can_download_preview` / `can_download_original` 分離；同一個 R2 object grant 必須按授權版本及解析度發行。
- 注記/評分等操作若 phase 為 `submitted`，除非 owner reopens review round，拒絕寫入（403/409）。
- 密碼錯誤節流、IP + invite rate limit；分享 token 不可枚舉；guest 只可查看自己建立的 activity，owner/team 可查看範圍內所有。

## 5. 事件日志 event sourcing（append-only）

**任何變更動作至少包含**
`id, workspace_id, project_id, album_id?, photo_id?, version_id?, review_round_id?, actor_kind('user'|'guest'|'system'), actor_id, guest_session_id?, invite_id?, action, before_json, after_json, occurred_at_utc, request_id, ip_hash?, user_agent_redacted?, metadata_json, created_at_utc`。

`action` 例：

- `selection.added`, `selection.removed`, `selection.submitted`, `selection.reopened`
- `rating.set`, `rating.cleared`, `favorite.added`, `favorite.removed`
- `tag.added`, `tag.removed`, `annotation.created`, `annotation.updated`, `annotation.deleted`
- `comment.created`, `comment.edited`, `comment.deleted`, `download.generated`
- `album.valid_viewed`, `version.created`, `version.current_changed`, `version.approved`
- `share.created`, `share.revoked`, `album.delete_planned`, `album.deleted`

### 範例真實操作序列

09:10:00.000 `selection.added` photo A (false→true)
09:11:05.200 `selection.removed` photo A (true→false)
09:12:22.002 `favorite.added` photo A (false→true)
09:13:40.120 `rating.set` photo A (0→4)
09:15:13.015 `selection.added` photo A (false→true)
=> UI 目前顯示「已選中」並且可以展開 **5 筆事件**；取消標記那筆不能被覆寫。

## 6. 一致性與不可竄改

- 畫面讀當前狀態從 `selection_items`, `rating_state`, `favorite_state` 等快取表取得；歷史從 `activity_events` append-only 取得。更新狀態 + 新增 event 必須在同一 DB transaction / idempotency key 下執行，否則不得回報成功。
- `request_id` 可由前端送 UUID，但後端驗 session / actor 並做唯一約束 `(actor_identity, request_id)` 防重送。事件排序依 `occurred_at_utc, id`，不要只靠顯示精度排序。
- 僅具 DB 保管權限可進行經明確授權的隱私刪除/匿名化；一般 app 角色不得 DELETE/UPDATE event rows，需 RLS policies/tests。對事件保留期制定獨立政策，刪檔不自動刪事件。
- 可匯出 CSV，欄位包含時間 (ISO 8601 UTC)、actor、來源、動作、檔名、版本、前/後值。隱私欄位要脫敏。
- 存取 view 記錄與所有 UI 操作事件分開節流：避免 thumbnail 每個讀取都打 DB；下載與重要修改不節流。

## 7. 面板畫面

- Photo timeline：「10:40 小雅加入收藏」「10:43 取消收藏」「10:50 選取」「11:02 留言」「11:30 確認提交」。
- Project activity：「全部／挑片／留言／修圖／下載」，依客戶、相簿、照片篩選。
- Client history：「我可以存取的專案」與「每個專案的操作歷程」，已過期照片顯示 tombstone，符合權限與資料保留政策。

## 8. 測試

- 無密碼/自動密碼/自訂密碼、撤銷、過期、最大使用次數、防暴力猜測。
- 僅查看不能選取；可選但不可留言；只允許 preview download 不可 original download。
- 持 A 專案邀請無法讀 B 專案歷史；用別人的 guest_id 不能讀其活動。
- 同一 API request 重送只產生一筆變更事件；多步加入移除事件完整保留，按時序可重播。
- 過期相簿歷史顯示 tombstone，不能偷偷透露圖片原始網址。
