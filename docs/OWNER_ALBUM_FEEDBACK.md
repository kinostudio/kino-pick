# 相簿共用攝影師意見

## 可見範圍

攝影師可在照片燈箱直接發表留言或手繪，不必先建立邀請。這些意見每筆只保存一次，綁定相簿、照片與不可變版本。每份有效、未撤銷、包含該相簿且可查看照片的分享都能讀取。客戶的留言、回覆與註記仍留在原邀請範圍，沒有改成互通。客戶是否能留言或繪圖仍由原有獨立權限控制，攝影師共用意見對客戶為唯讀。

新建意見要求目前版本；歷史版本上的既有意見可由 Owner 讀取與依修訂號管理。Guest 查看舊版本仍要求既有版本比較權限。

## 接線

- `0071_owner_album_feedback.sql` 新增共用意見、命令、變更與結果資料表，沒有改寫既有客戶內容。
- Owner GET `/api/v1/albums/:albumId/photos/:photoId/versions/:versionId/owner-feedback`。
- Owner POST `/api/v1/albums/:albumId/owner-feedback/commands`，沿用登入、同源檢查及預期操作者標頭，支援建立、編輯與刪除。相同請求重播回同一結果，不重複寫審計。
- Guest GET `/api/guest/albums/:albumId/photos/:photoId/versions/:versionId/owner-feedback`，沿用私人照片／版本授權，沒有 Guest 寫入共用意見端點。
- 攝影師留言與註記位於原燈箱工具；原客戶意見收在次級區塊。原分享權限設定仍在分享頁。
- 介面恢復紀錄綁定操作者、相簿、照片、版本與原請求。未送草稿可以取消，結果不確定的請求保留原 ID 重試，禁止跨範圍重播。

## 遷移與復原

0070 已在 B 完成，本次不重新套用。0071 先在本機完整舊 schema 上驗證，再以受保護的 live70 備份獨立還原並只升級至71。核對原有表逐表雜湊與數量、原 schema 不變、外鍵與完整性，再記錄本次 live 遷移前 Time Travel bookmark 與採用證據。沿既有 CI 與 B 自動部署，不直接跳過發布守門。

應用回復優先採向前修正或回復功能程式並保留已採用的71 schema、immutable歷史和發布證據。不可直接刪除新表以當回滾，因可能已有正式意見。完整資料庫回復需使用本次備份或 Time Travel，先核對遷移後新增的客戶資料，避免覆蓋新的操作。A、DNS、R2物件與自動清理設定無需變更。

## 驗證狀態

實際命令與結果以 `docs/HANDOFF.md` 最新條目為準。新 native runner 是本機 Miniflare D1/R2 與 Chromium 驗證，不代替正式 OAuth／Owner／Guest 驗收。使用者已明確授權本次備份與獨立復原，並已完成：156舊表／8330筆資料不變、schema70 roundtrip完全一致、獨立0071與本機重播一致、integrity ok／FK0。證據見 `docs/releases/owner-feedback-0071-independent-restore.json`。live仍70；手機手繪UI驗收尚未通過，未套live71或部署。
