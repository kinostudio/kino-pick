# G2 儲存節點列舉接線

## 目前狀態

本機接線已完成；VM 的 Caddy 2.6.2 已驗證路由候選，但尚未 apply 或 reload。現行 bucket root 仍回 403，不能視為正式 Oracle 列舉已開通。沒有新增 HTTP API、UI、排程、刪除授權或功能旗標。0070 仍在 migration-proposals；B 維持已發布的 schema67。

證據：`docs/releases/storage-node-listing-local.json`。31 項 Vitest、10 項 Python、strict、scoped lint 與前端／Worker dry-run 已通過。Workerd parser 與本機 D1/R2 收據使用真正 runtime；Oracle 兩頁測試是 method mock，不是 VM S3 驗收。

## 呼叫與信任邊界

`reconcileWorkspaceStorage` 接收既有 Owner、session、workspace 及節點身分，透過收據服務在第一份受 epoch 保護的庫存讀取後才解析實體節點。每頁檢查 workspace prefix；同一 scan 重用配置與 signer，完成時仍重驗庫存、epoch、授權及收據 CAS。錯綁、撤銷或中途變更拒絕，不回退到另一個 bucket。

primary 僅接受現有 `PRIMARY_STORAGE` 命名 binding 的指定 metadata。程式無法從 binding 反查真正 Cloudflare 帳戶／bucket，這部分依部署證據建立信任；切換 binding 必須使舊對帳時鐘失效並重新掃描。Oracle 固定 endpoint、bucket 與 credential ref，account_id 只是資訊標籤。

`S3StorageBucket.list` 使用既有 AwsClient，固定 slash bucket root、SigV4 GET、no-store、manual redirect，只有 HTTP200 可解析。15 秒期限涵蓋 header 與 body；上限 4MiB，錯誤不記錄 URL、token、body 或憑證。

XML 用固定版 fast-xml-parser5.12.0 驗證，不自製結構解析器。拒絕 DTD、CDATA、未宣告 entity、非法 XML 字元、重複欄位、未知結構及資料夾列舉。核對 namespace、bucket、prefix、頁面大小、物件數量、key/size、游標與分頁結束條件。key/prefix URL decode 一次，opaque token 不做 URL decode。限制 depth8、markup/entity 各65536；整次 scan 延用既有 20,000 物件／4MiB keys／64 頁界線，超過需改持久化分頁工作，不能截斷後聲稱完整。

## VM 候選與啟用

`tools/oracle-storage-listing.py` 預設只 prepare，產生0600候選並呼叫 VM 原生 caddy validate。只替換 Kino Pick 專用片段，不改 Review 其他設定。候選僅接受指定 bucket root、GET、SigV4 header 形狀及 canonical ListObjectsV2 query；真正認證仍由上游 S3 負責，Caddy 不判斷 workspace 所有權。D1 server 才能決定允許哪個 prefix。

已驗候選 SHA：`fe53c00348a613fad8bec9461a241d2606bacc28e4fa7756ce966a72fc3247a8`。
現行未變 SHA：`deefdfbd62b8327d57eb03a7953bb6499855d911647e269ceec5d43954020f85`。

正式啟用前先確認現行設定及 Review／既有物件健康基線，再使用工具明確 `--apply`：驗證、SHA CAS、0600備份、原子替換、reload；成功後再核對設定。失敗僅在現行仍是本次候選時回復備份，遇到他人修改保留現況並停止。

啟用後必須實測簽名分頁列舉、匿名與管理 query 拒絕、原 GET/HEAD/PUT、Review 健康；不能以語法驗證代替實際 S3 權限及資料驗收。保留候選與備份，不刪其他服務檔案。

## 尚未完成

這只核對一個 workspace prefix，不代表整桶／節點全域使用量，亦不涵蓋系統 prefix 或人類活動紀錄完整性。仍需 global-node 盤點、可信活動覆蓋及 Owner 真實 snapshot／候選與失效負例。正式啟用0070需適用備份、獨立復原、fresh-source parity、完整 release self-test／CI 與 hosted 驗收；不能借用0069證據。自刪OFF／dry-run、無Cron、R2優先／Oracle30GB保持。

## 協定來源

- [AWS ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html)
- [SeaweedFS4.52 List handler](https://github.com/seaweedfs/seaweedfs/blob/4.52/weed/s3api/s3api_object_handlers_list.go)
- [Caddy expression matchers](https://caddyserver.com/docs/caddyfile/matchers#expression)
- [R2 Workers binding](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
