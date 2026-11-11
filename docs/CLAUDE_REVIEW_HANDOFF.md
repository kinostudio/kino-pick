# Kino Pick 後續 Claude 審查交接

目前尚未執行 Claude 審查。本檔記錄交付後應檢視的具體邊界，不能作為已審查或已發布證據。

- 正式來源位於既有發布 checkout `.local/album-tabs-release-20261109`；G2候選髒變更保留在 `.local/g2-inherited-share-0069`。以實際Git來源、CI、部署與hosted紀錄為準，不合併整包舊快照。
- 帳號綁定：檢查 `auth.ts` 的callback同session／五分鐘freshness、禁止公開註冊／隱式email合併；`account-providers.ts` 的configured來源判定及並行解綁交易。單一真Miniflare D1＋真BetterAuth handler的GitHub mock交換流程已通過，尚不能代表真Google OAuth。
- 帳號新增與審計：BetterAuth建立帳號後由after hook寫審計；它們未共用D1交易。檢視審計寫入失敗但帳號已建立時的callback與重新讀取狀態；不將正常路徑測試宣稱為故障原子性證據。
- 使用者介面：正式帳號頁、瀑布流／清單、滿版燈箱、縮圖列hover、留言／手繪／版本比較、分享及交付操作，特別檢視手機與鍵盤操作。不要用Gump記憶體原型或舊Next／Supabase fixture代替正式Worker驗收。
- Production尚需確認獨立D1、既有空的 `kino-pick-production` 私人R2、資料搬移／復原、OAuth正式origin、跨帳戶網域入口與 `pick.kinostudio.tw`。B的D1目前10/10；舊測試庫本次備份核對後退役的具名授權已提出，等待答覆。
- 自動清理維持OFF／dry-run。G2的活動覆蓋、防回滾及完整planner均未完成，不能把原型或未採用proposal用於實際刪除；R2優先／Oracle30GB與租戶／相簿／邀請隔離保持。

本次縮減CI只將舊Next/Supabase參考端和Gump原型檢查移到手動workflow；正式Cloudflare流程、原生資料與權限／發布守門仍在checks內。舊測試及斷言完整保留。
