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
