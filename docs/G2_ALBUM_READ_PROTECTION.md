# G2 私人相片的近期讀取保護

這是清理所需的保守阻擋來源，不是人類瀏覽事件、持續在線 lease 或完整活動覆蓋。功能尚未發布；B維持schema67、自刪OFF/dry-run、R2優先／Oracle30GB。

## 正式呼叫路徑

Owner及Guest的 `GET .../photos/:photoId/versions/:versionId/assets/:kind` 共用 `openGalleryAsset`。沿用原 `D1GalleryRepository.asset`／`D1GuestGalleryRepository.asset`，保留原租戶、相簿、邀請、session、期限、版本及處理輸出核對，不把資料庫讀取快照當成可重用的下載grant。

啟用後順序是：原授權、只投影server已解析的workspace/project/album寫入保護、開啟儲存物件、原size/SHA/MIME檢查、再次原授權及資產identity核對、再次保護，才交回未讀串流。後段拒絕會取消body。保護本身不授予照片權限；撤銷或儲存失敗仍可能留下保守阻擋，待時窗自然結束。

`ALBUM_READ_PROTECTION_ENABLED` 預設false，三個Wrangler環境及.dev.vars範例皆OFF。OFF不讀新table、不追加保護陳述或第二次授權，並保留Owner與Guest原本不同的儲存錯誤對應。ON時缺schema或寫入／最後核對失敗回503，不忽略錯誤繼續回圖。

## 資料庫行為

`migration-proposals/0071_album_read_protections.sql` 尚非active migration，新增每相簿一列的WITHOUT ROWID表。只存scope、DB更新時間、保護期限及單調revision，不存actor、session、token或IP。scope不可改、不可刪或REPLACE覆寫；每相簿一列不隨照片請求數增加。既有瀏覽、審計與閒置時間不變。

DB時鐘設定15分鐘期限，剩餘不超過14分鐘且距前次更新至少60秒才續期，至多每分鐘一次實體列變更。每張啟用的讀圖仍執行兩個各含三陳述的D1 batch；合併的是實體更新，不是減少SQL陳述數或證明效能。最後讀取至少剩839秒，低於門檻即拒絕；1秒只是容許時間差，不保證D1延遲。

批次先UPDATE、再INSERT SELECT WHERE NOT EXISTS、最後核對scope與DB時鐘；不使用會與防覆寫guard衝突的UPSERT。三份結果都必須成功。D1 batch的錯誤回滾語義見[官方說明](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。

原0069 `manual_album_deletion_blockers` 保留所有分支，僅讓既有 `DELETE_ACTIVE_REVIEW` 也包含近期讀取保護。原Owner刪除預覽與UI因此顯示「相簿最近有人讀取，或客戶仍在使用；請稍後再試」。SQL同時阻止有保護的相簿／工作進入deleting，以及已開始刪除的相簿取得或續期保護；不能只先讀preview再盲刪。

## 已驗範圍

`docs/releases/album-read-protections-local.json` 綁定目前來源。4檔35項通過：9個service邊界、12個helper／真正Worker路由但mock授權repository、13個原Human契約，以及1個真Miniflare D1測試。root strict、scoped lint/format、正式前端與Worker dry-run通過，沒有新套件。

Native套用全69 active migrations及獨立proposal71，使用5個空相簿，零照片／R2payload。驗租戶scope、時鐘／revision／REPLACE守門、重複合併、不改human/audit/retention；實際Owner preview先阻擋，測試fixture模擬到期後清除原因，原手動流程可完成空相簿刪除。老化fixture只暫時移除／恢復新update trigger，不修改產品guard。

尚未驗含photo的既有deleting job取得保護及新proposal下的照片payload回收。路由mock測試不能冒稱真Owner／Guest的雲端權限驗收；同樣沒有負載、CPU／記憶體或實機觸控驗收。

## 完整性與發布限制

回傳串流及使用者停留在已解碼照片上，都可能超過保護時窗。不存在或到期的row不能證明閒置。capture metadata、原圖下載、成品及ZIP是其他讀取路徑，目前沒有接入本來源；它們原有授權與刪除blockers保留。歷史漏報、tracking停用／故障、global-node盤點及真正Owner cleanup snapshot仍需完成；不能把activityEvidenceVerified設true或稱G2已完成。

正式啟用前，須完成實際版本鏈的受保護備份、獨立復原、fresh-source parity、精確catalog/ledger、新來源native proof、完整CI、自動B及真Owner／Guest驗收。proposal70/71不能直接移入migrations便沿用0069復原證據，也不能拿近期保護代替全量活動覆蓋。既有雲端與共用Caddy授權仍待答覆，未重試或繞過。

恢復先關閉新旗標，保留表、revision、歷史及原圖；既有保護自然到期前仍保守阻擋。使用forward fix，不覆寫新資料為舊快照，也不為了立即刪除而移除guard。現階段沒有對B執行任何新DDL，純本機測試庫可丟棄。
