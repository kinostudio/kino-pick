# 客戶免註冊邀請、權限、跨專案歷史與完整操作紀錄

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
- `comment.created`, `comment.edited`, `comment.deleted`, `download.completed`
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
