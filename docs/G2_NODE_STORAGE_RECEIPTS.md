# G2 primary全節點收據

本機已完成來源→root listing→immutable收據→重新驗證；尚未發布。它只見證容量盤點，不是活動覆蓋、跨DB／物件儲存交易或刪除grant。自刪仍OFF／dry-run。

## 共用來源與資料庫守門

未套用的0070提案新增 `storage_node_reconciliation_state` view、兩個node-ID索引及 `node_storage_reconciliation_receipts`。Node reader與receipt INSERT使用同一view，避免兩份pending／總帳公式漂移。鍵數、UTF8總bytes及最大單鍵只掃指定node、最多20,001筆；payload也維持原先SQL前置上限。沒有全node的keys GROUP BY。query-plan測試執行提案中的實際view/index SQL，驗證節點SEARCH及索引使用；這是本機SQLite證據，不是hosted D1查詢計畫。

收據是WITHOUT ROWID、不可UPDATE／DELETE／REPLACE。由SQL在同次INSERT核對bootstrap Owner／有效session、source epoch、primary provider/account/bucket/ref、active/readonly、容量及總帳、無pending、精確count／bytes及4MiB／單鍵1024bytes界線。完成時間必須DB現在時間，最長五分鐘從scan開始算；不能等很久後刷新開始時間。舊workspace收據與clock SQL逐byte保留。

## 真正writer與current

`recordPrimaryStorageReconciliation` 把server實際命名PRIMARY_STORAGE綁定交給 `D1NodeStorageReconciliationReceipts.reconcile`，root list不帶workspace prefix。新方法有寫收據副作用；舊 `reconcilePrimaryStorageNode` 仍是唯讀核對。

`current` 每次重讀最新來源、重新授權，核對同epoch、revision、count、bytes、pending與五分鐘期限。歷史收據不保留過期／撤銷session的存取權；原資料變過又變回也因單調epoch失效。回傳scope=node及必要metadata，不回傳raw keys、actor或session。未確認寫入成功時不報recorded。

`storage.reconciled` 審計與INSERT原子提交，workspace_id為NULL、after_json有scope=node，request ID為receipt UUID。與workspace收據共用event-ID namespace，拒絕跨scope ID重播。收據與審計本身不增加inventory epoch，亦不修改storage_nodes.last_reconciled_at。

## 物理範圍與限制

目前服務及SQL都只准primary R2。Oracle registered manifest尚未包含必要system控制物件及先前未分類物件，不能先發全桶收據；這不是Oracle功能已移除，仍需補齊其可信來源與真實比對。不能拿先前22物件的唯讀觀測當資料庫收據。

命名binding的實體Cloudflare account/bucket仍須由部署驗證，程式無法反查。切換binding前必須使舊證據失效，切換後重新掃描。繞過D1直接改物件不會推進epoch，因此current不保證偵測所有外部管理變更；來源由受控服務維護，實刪前仍須重驗，不能把五分鐘收據當跨儲存交易。

相簿保護／分享／版本引用與有效人類活動仍是另外的來源。容量收據不證明這些已完整，不得直接設activityEvidenceVerified或繞過planner及刪除守門。

## 驗證與發布

證據 `docs/releases/node-storage-receipts-local.json` 綁定目前來源。最終5檔35項：9個新service、18個node reader與真SQLite plan、6個舊workspace schema、2個真本機D1/R2。修正lint後的9個單元也已重跑；strict、scoped lint/format、正式前端及Worker dry-run通過。

原生fixture使用真正root R2 listing與writer/current，驗審計、無自我epoch刷新、合法預留後取消仍使舊收據失效、實際回收後新收據核對保留零位元標記與另一workspace資產，以及SQL不可覆寫、count/bytes/epoch/time/actor/session及workspace重播負例。沒有新hosted Owner／Guest、Oracle、load／CPU／記憶體或實機驗收。

0070仍在migration-proposals，未改active migration或雲端DB，也沒有新API/UI/旗標。正式啟用需把適用版本鏈、精確catalog／ledger、受保護備份、獨立復原、fresh-source parity、原生證據、完整CI、自動B及真Owner／Guest驗收一起完成；不能沿用舊0070 hash／舊0069復原證據。

目前無需雲端回滾。失敗時停止使用該收據，保留歷史、原圖及舊欄位，forward fix；不要重設epoch、覆寫舊快照或刪除審計來恢復綠燈。G2與production切換仍未完成。
