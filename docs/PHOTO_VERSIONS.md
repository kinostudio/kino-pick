## 2026-10-28 — M3g4 locally accepted

Genuine Owner annotation authoring and invitation-shared mixed-role reads are locally accepted with308 complete Worker/D1/R2/Chromium checks and467 unit tests. Real375px geometry/lifecycle/reload/exact replay and actual disabled-Owner403 privacy/journal preservation passed; Root inspected the actual photo/red-rectangle capture.0046 is applied LOCAL ONLY after a new verified backup/isolated restore/110-old-table hash parity:114 tables/same4 development rows/4 new empty Owner tables/FK0/no pending migrations. All gates remain OFF/hard-local and deletion OFF/dry-run; no hosted acceptance. See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) and latest HANDOFF for contracts, logs, recovery and unfinished Owner processing/history work. Earlier in-progress checkpoints below are historical and superseded.

## 2026-10-28 — Owner annotation version binding

Owner annotations have their own immutable command/change/result history and bind to the selected owned photo_version, including private draft metadata. They never move with the current visible head. Guest shared annotation visibility still requires the exact independently authorized published-ready version; authoring a private Owner note does not publish a version or grant its bytes. See OWNER_ANNOTATIONS.md for source-only migration0046 and acceptance boundaries.

## 2026-10-28 — Version-bound shared annotations accepted locally

Normal Guest Lightbox annotations bind to its immutable displayed version. In comparison mode the annotation canvas/list binds specifically to the selected After version; Before/After image modes remain functional. Same-invitation peers share only that exact version's annotations and retain author-only writes. Publishing/restoring a head never moves old geometry. Actual decoded image bounds/natural dimensions, portrait, reverse rectangle, resize/zoom/pan and captured-pointer clipping are exercised locally. Owner readonly selection includes retained private draft metadata but does not grant Guest draft access or media bytes.295 local/430 unit pass; local0045 is adopted. Diff heat maps and remaining version/Owner/hosted acceptance remain separate unfinished work.

## 2026-10-28 — M3g1 annotation backend boundary

Guest annotations bind immutable photo_id/version_id and oriented-preview normalized coordinates; new current heads never move old geometry. Guest creation/current read requires an exact published-ready version; it grants no image/compare bytes. Per-version cleanup must account for live annotation references before activation; whole-album expiry keeps its explicit protection/history policy.0045 source-only/backend local tests accepted, drawing/Owner viewer pending. See GUEST_ANNOTATIONS.md.

## 2026-10-28 — Owner replies preserve immutable version scope

Owner reply threads bind the explicitly selected invitation/logical photo/immutable version and a Guest parent. Publishing a newer head does not move comments or replies; historical published-ready versions remain independently selectable. Reply commands never switch heads, overwrite assets or alter picks/ratings.260 local checks passed;0043 adopted locally with old-table content parity. See OWNER_COMMENTS.md; Owner processing status and geometric annotations remain required.

## 2026-10-27 — Immutable version-bound Guest comments

M3f1 comments persist against their exact logical-photo/version IDs and do not move when a new current head is published. Authorized historic threads remain available through selected After comparison; unpublished ready drafts remain denied. Comment writes are independently permissioned and current UI state is re-read after immutable historical command receipts.0042 was applied locally only after backup and243 Worker checks passed. Owner replies/moderation, annotations and fullM1–M5 remain open; see GUEST_COMMENTS/HANDOFF.

## M3e Guest published-version history and comparison — 2026-10-27

Guest history/comparison is integrated as a separate read-only extension. Its gate defaults false in every environment, is hard local-only, and requires Guest exchange plus PHOTO_VERSIONS_ENABLED. History requires can_view and can_compare_versions independently of can_select. Current bytes require can_view; older published bytes also require can_compare_versions. Only ready current, baseline V1, or immutable changed:true head-publication versions are visible; ready drafts outside the current/baseline V1 exceptions and without publication history are hidden from metadata and the generic Guest byte route.

The current head is pinned outside descending 24-item history pages; cursors bind the head version and revision. The UI supports slider, side-by-side and overlay with synchronized zoom/pan and contain/letterbox; no heatmap is provided. Metadata uses the role label 攝影師 and exposes no actor IDs. No schema changed; 0041 remains the latest locally applied migration.

Final run7 passed228 local Cloudflare checks, including new API and375px Chromium comparison (.local/m3e-cloudflare-seventh.log).288 unit tests/37files, generated strict types, lint, Next build and targeted formatting also passed. Run6 previously passed new comparison checks but failed later in the exchange test; sequential request/response validation retained all denial assertions and run7 passed. The underlying transport cause is unproven. Hosted OAuth, remote R2/CORS, edge and deployment remain not_checked. See GUEST_VERSION_COMPARISON.md and HANDOFF.md.

## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison was still required at this M3a checkpoint; M3e now adds the local-only comparison above. Delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

## M3a implementation checkpoint

See PHOTO_VERSION_HEADS.md. Owner/Guest galleries now read a separate current-version head; old Guest derivative reads require can_view plus can_compare_versions, while current viewing requires can_view. Real D1 tests have exercised ready-V2 switch/restore, concurrent CAS, replay, immutable history and audit rollback. Owner UI final browser verification is pending;0036 is not yet applied persistently and PHOTO_VERSIONS_ENABLED remainsOFF. Explicit version upload, filename matching and comparison UI are still required and are not provided by these switches alone.

## D1 immutable insertion defense (0033, accepted locally)

The Worker schema treats version metadata, stored asset metadata and processing output identities as immutable, including INSERT OR REPLACE conflict resolution.0033 adds BEFORE INSERT checks for version id/photo-version number, asset id/object key/version-kind, and processing output job-kind/asset ID/object key. Null version/asset IDs are rejected. Existing scope and dimension guards remain; processing job state transitions and ordinary completion inserts are unchanged.

An isolated0001–0032 workerd probe showed same-ID metadata replacement and queued output identity replacement could succeed while foreign keys remained valid. Through0033 those operations abort with unchanged snapshots. Full suite acceptance and local application status are recorded in HANDOFF. Do not infer that these guards implement the pending version upload, current-version switch or comparison UI.

Recovery: retain the guards and existing history; disable affected writes before application rollback and use a forward migration for repairs. Never drop immutable records to recover an upload or job.

# 照片版本控制、替換與 Before / After 比較規格

## 1. 版本模型

一個 `photo` = 邏輯照片（穩定 photo_id、相簿、檔名、挑片紀錄）；一個 `photo_version` = 此照片某次被上傳的不可變版本紀錄；一個 `photo_asset` = R2 具體物件（original / thumbnail / preview / final / diff_heatmap）。不可使用同個 R2 object key 直接覆寫；以 UUID / hash path 產生 immutable key。版本序號自 1 遞增、唯一 `(photo_id, version_no)`，`current_version_id` 可切換。

選片、評等、收藏預設掛在 photo_id，不因 version 更新而消失。依版本特定的留言/註記應保留 version_id（新增版本後仍可顯示「原本針對 V1 的意見」）。所有版本增加/恢復/切換都產生 audit event。

## 2. 可設定的專案層模式

`versioning_mode = off | manual | auto_filename | assisted`（建議預設 manual）：

- `off`：不提供上傳新版本操作；新上傳是獨立照片。管理員明確手動「取代目前顯示」可以改 reference，但仍須安全保存舊 asset 或採有明確覆寫刪除政策。
- `manual`：照片 Lightbox → 新增版本，指定 photo_id，附修圖說明與標籤；系統派下一版本編號。
- `auto_filename`：在相同 workspace/project/album、canonical filename 相同且匹配唯一 photo 的情況下，自動將上傳視為新版本；原檔保留。可排除常見副檔名差異和版本後綴 `-edit`,`_v2`（規則可配置，避免誤判）。
- `assisted`：疑似相同檔名時顯示「新版本／新照片／略過」批量確認面板。推薦預設為這個，最能防止錯配。

## 3. 自動同檔名判定規則

1. 字元使用 Unicode NFC normalization、移除前後空白，依 locale 定義 casefold（不要隨意改寫檔名），去除最後副檔名後得到 canonical basename。
2. scope 限定同個 workspace/project/album。絕不能跨專案依 DSC_0001.jpg 自動關聯。
3. 若匹配 0：建立新 photo；匹配 1：比較 content SHA-256、圖像尺寸/比例、必要 EXIF。相同 hash → 提示已上傳；不同 hash 且符合啟用規則 → 建新版本；若匹配 2+、尺寸比例大異或仍有歧義 → `requires_review`，不自動覆寫。
4. 處理 `.jpg` / `.jpeg` 同義與 `_edited`, `_retouched`, `-v2` 後綴可在規則中啟用。對 `DSC_0001` 常見撞名不可僅靠檔名唯一性。
5. `upsert` 必用 DB transaction 鎖 photo row；同時兩個 upload 完成不能兩個拿到相同 version number。

## 4. 手動操作與版本保留

- 相簿批次上傳時：新增照片 / 同名匹配結果／疑似版本待確認；提供覆核。
- 單張 Lightbox：`新增版本`、`設為目前版本`、`查看版本歷史`、`版本說明`、`恢復至 V1`、`比較 V1/V2`。
- 「替換當前顯示版本」只切換 `photo.current_version_id`，不刪舊檔；不等於硬碟上的原地覆寫。
- 可設定 `version_retention = keep_all | keep_last_n | keep_current_and_original`。切換保留策略會預覽哪些版本將被丟棄；刪除某舊版同樣走安全 deletion job，不可刪掉現行版/引用中的標註版本。
- 刪版本可能讓部分歷史照片不可再預覽，但文字歷程保留（除非資料保存政策要求清除）。

## 5. Before / After 使用者體驗

- 版本選擇器：Before = V1 或任一舊版；After = 目前版本或任一新版。顯示上傳時間、操作者、標籤及版號。
- `slider`：相同 canvas 上左右拖曳揭露 Before/After，支援觸控與鍵盤調整（方向鍵每 1%，Shift + 方向鍵每 10%）。
- `side_by_side`：左右雙圖同步縮放、平移；不同長寬比時等比 letterbox，不拉伸。
- `overlay/blink`：以透明度或切換交替比對；位置及縮放保持一致。
- `diff_heatmap`（P2）：後端將兩圖 EXIF orientation 校正、sRGB 正規化、必要時 ICC profile 處理，統一 canvas/pixel alignment（對齊失敗須標示），計算差分熱區圖與變更面積百分比；預設忽略可設定閾值以下的微小變動。
- 有不同尺寸、裁切、旋轉、視角變化時，提供手動對齊或標示「差異圖不可靠」，絕不可聲稱百分比是主觀修圖品質評分。
- 多個 version preview 須快取衍生圖，避免每次切換昂貴即時處理。

## 6. 精修工作流程

客戶在 V1 某範圍圈選留言 → 修圖師上傳 V2 → 版本事件 → 客戶收到通知 → 打開 V1 vs V2 → 標註狀態 `resolved` 或 `reopen` → 客戶核准某版本 → 後台進入交付。版本提交時記錄相關 `review_round_id` 與 `approved_version_id`。

## 7. API / DB 需求

- `POST /photos/:photoId/versions/init` → version upload draft + R2 presign。
- `POST /photos/:photoId/versions/complete` → finalized immutable version and queue previews。
- `GET /photos/:photoId/versions` → ordered versions metadata and authorized preview grants。
- `POST /photos/:photoId/versions/:id/set-current` → lock + authorization + event。
- `POST /uploads/resolve-duplicates` → batch assisted match resolution。
- `POST /photos/:photoId/diff` → calculate or lookup difference preview job。

## 8. 測試

- 相同檔名同相簿建立 V2；不同相簿同名不碰撞；完全相同 hash 提示重複；兩張同名匹配歧義不自動操作。
- 同時 V2/V3 upload 保證 version_no 唯一；跨 tenant 無法讀別人的 version。
- 切換目前版本不變 photo_id / selection / rating；V1 註記仍綁 V1；僅刪不可使用舊版本。
- Before/After 兩種比例、不同方向、裁切與對齊失敗；slider 鍵盤操作。

## 2026-10-29 Owner comparison

Owner comparison is a read-only Lightbox workflow over private Owner preview endpoints; the existing version head is not changed by comparing. The shared visual canvas does not share authorization: Guest comparison still requires current Guest scope and independent view/compare rights. See HANDOFF for isolated API/browser evidence and default-OFF status.
