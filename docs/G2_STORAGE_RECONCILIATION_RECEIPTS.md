# G2 儲存對帳收據

## 啟用邊界

0070 SQL 放在 `apps/worker/migration-proposals/0070_storage_reconciliation.sql`；不是目前自動套用的 migrations。內部服務 `D1StorageReconciliationReceipts` 只供 server 使用，沒有 HTTP、UI、排程或刪除 grant。現有 0069 發布鏈及 B schema67 不變。

不得將 proposal 移入正式 migrations 後直接部署。啟用前須把對應備份、獨立復原、fresh-source parity、完整 catalog/ledger 核對及 release checker 擴充到實際新版本，重新產生來源一致的 native 證據，通過完整 CI 與真實 Owner 驗收；不能借用 0069 收據冒稱 0070 已復原。

## 收據的意義

收據只見證指定 workspace 在指定 storage node 的完整 prefix 盤點；不是整桶或帳戶總占用，也不保證人類活動追蹤完整。物件 key 留在 server 記憶體，收據與審計只留數量、bytes、來源指紋及時間。

1. 先讀 DB 時鐘與全庫單調 epoch，透過既有 Owner/session/workspace/node reader 取得庫存，再讀 epoch。
2. 用既有平面分頁對帳核心列舉物件，核對所有 key/size，再讀相同來源。指紋包含 epoch；資料改過又改回也會失效。
3. 寫入時由 SQL 同時核對 epoch、現行 Owner/session、工作區、節點、pending writes、數量與 bytes；從掃描開始起最多五分鐘，不能在長時間掃描後改寫開始時間來刷新證據。
4. 讀收據時重新授權、重算庫存指紋，核對 epoch、pending 與開始時間。舊 session 被撤銷後，歷史收據保留，但不保留存取權。

`listPage` 必須由可信 server 綁到該節點配置的實體 provider/account/bucket，不能從 HTTP 接受任意 bucket、prefix 或客戶端宣稱的盤點結果。錯桶剛好為空也可能產生相同清單；內部 callback 本身不證明實體路由正確。Oracle 完整 XML 分頁列舉與實際路由尚需獨立接線驗收。

直接使用原始 D1 binding，不把唯讀 replica session 當作最新 CAS 見證。Cloudflare 說明未使用 Sessions API 的查詢仍走 primary；batch 失敗會回滾整批。[D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。

## 失效來源與限制

全庫版本保守涵蓋十六張來源表的 insert/update/delete：owners、owner_sessions、workspaces、storage_nodes、workspace_storage_usage、photo_assets、photos、manual_album_deletion_jobs/items、upload_sessions、upload_key_fences、upload_authorizations、image_processing_jobs、storage_reservations、upload_completions、upload_version_completions。收據與審計本身不增加 epoch。

這會增加寫入量，且其他工作區的相關變更也會使收據失效；目前優先保證完整失效。未來改為分區版本前，必須保留 node 全域帳本及跨節點 workspace 帳本的相依性。時鐘到安全整數上限時阻止新寫入，不能重設版本掩蓋溢位。

Session 與 upload authorization 的自然到期不會觸發 epoch，所以每次使用仍須查 DB 現在時間及權限。繞過 D1 流程直接變動 R2/VM 物件不會增加 epoch；收據不是跨 DB/物件儲存交易，也不能取代實際刪除前的重驗。

這個 epoch 只見證庫存來源，沒有涵蓋分享連結、相簿保護、核准交付及活動覆蓋的全部變更。清理 planner 仍須另讀這些真實來源並在使用時重驗；不能把庫存收據當成整份清理 snapshot 的授權或完整性證明。

## 復原方式

本地驗證使用隔離、可丟棄資料庫。正式尚未採用；現階段不需要對 B 執行回滾 SQL。

未來啟用後發現問題，先停用收據 caller/清理預覽消費者並保持自動刪除 OFF，保留所有收據、審計、原圖及當前 clock，採 forward migration 修正。不可降低 epoch、刪除舊收據或將舊 snapshot 覆蓋有新資料的 live DB。若有寫入被 clock/新 guard 阻擋，先保全失敗及目前資料，再以已獨立復原核對的修正遷移恢復；不得移除守門來換取綠燈。
