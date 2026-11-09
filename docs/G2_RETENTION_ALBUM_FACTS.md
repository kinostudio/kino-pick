# G2 Owner 相簿清理來源快照

`D1RetentionAlbumFacts.read(workspaceId)` 以一個 D1 SELECT/batch 讀取同一時點、同一已授權 Owner/session/workspace 的相簿來源。沒有 HTTP 入口、寫入、儲存呼叫或刪除許可；尚未直接接入 planner/UI。

回傳 DB 觀測時間、相簿與專案 ID、狀態/revision、獨立policyRevision、建立與發布時間、經事件指標核對的最後有效瀏覽時間、持久化閒置政策、資產/版本數、登記實體 bytes、有效自訂分享數/最晚到期，以及現有手動清理 blocker。只在 exact asset/job/item identity 的已回收標記下將 bytes 視為0；歷史資料與數量不消失。這不是新的 R2/Oracle 實體對帳，也不是已釋放磁碟空間證明。

最多100相簿、100000資產來源及100000版本來源；SQL先限制，超限整份拒絕，不把部分清單稱為完整。無相簿仍回合法空快照；未登入/到期Owner拒絕403、其他workspace與不存在均404。來源缺少、未驗證human frontier、矛盾時間/分享/數量、重複相簿等情況拒絕。沒有回傳 object key、IP、token、session或憑證。

目前 schema 沒有足以證實 lastStateChangedAt、projectProtected、retentionExcluded、preservationRequested 與完整流程/引用覆蓋的來源；reader不填假false，也不回傳 activityEvidenceVerified/healthy。有效瀏覽事件能證明一次被系統接受的瀏覽，空事件不能證明長期持續追蹤。後續需獨立的部署覆蓋區間與保守讀圖上界，且不得用其變動延長分享期限；此設計尚未實作，既有71短期保護也不是完整覆蓋。

驗證見 `releases/retention-album-facts-local.json`。5單元及1個真原生D1/R2整合通過；Native含真產品政策/置頂、未使用分享/撤銷、跨workspace/到期session、6資產/2版本及真正回收後0bytes/保留歷史，並驗45→46→45政策恢復原值但policyRevision仍前進、保留既有receipt回歸。timestamp tie、上限大資料Native、hosted query plan與負載未驗，不以mock或靜態SQL當原生通過。

此為G2完整快照的來源層，不能單獨宣布G2完成。接續要補活動覆蓋、缺少的流程/引用證據、Oracle系統物件對帳，再接同一planner/API/UI、正向候選與來源失效；正常備份/獨立復原/parity、完整CI、自動B及真Owner/Guest仍是發布守門。自刪OFF/dry-run，不改A/Review/DNS或客戶資料。
