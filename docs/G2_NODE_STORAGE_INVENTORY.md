# G2 跨工作空間的儲存節點盤點

本機 registered manifest 與 primary R2 root listing 已接線，尚未發布。這不是正式清理 snapshot、健康宣告、持久化 global 收據或刪除授權。完整G2／MVP仍未完成。

## Scope 與既有行為

`reconcileStorageInventory` 保留單workspace prefix語義；新增 `reconcileNodeStorageInventory` 需要 `scope: 'node'` 的snapshot，root list不傳prefix。兩者共用相同分頁、重複／游標、key／bytes上限及前後來源核對；不能互換scope或將單workspace結果稱整個bucket完整。

20,000物件、4MiB總key、單key1024bytes及64頁是一次掃描的拒絕界線，不是效能承諾。更大庫存需持久化分頁job；不截斷後宣稱完整。未知workspace prefix、系統key或其他物件只要不在可信manifest，都會阻擋，不因不認識就忽略。零位元fence仍必須真正存在。

## 真實D1來源與工廠

`D1NodeStorageInventoryRepository` 只准 enabled bootstrap Owner及有效Owner session。跨workspace的raw keys只留內部，沒有HTTP／UI入口；一般workspace擁有者不因擁有一個workspace就可看全節點metadata。

一次D1 batch在SQL先核對20k／4MiB bounds再讀取payload，涵蓋該node所有workspace的photo_assets及upload_key_fences。沿用原workspace reader的回收算式：保留immutable metadata，只有精確匹配成功reclaimed項目才按0bytes。node實際帳本與registered asset投影必須相符，重複key、錯workspaceprefix或溢位拒絕。

proposal0070的全庫epoch納入hash，hash不含每次不同的現在時間；完成非同步hash後重新驗bootstrap Owner、session、node及相同epoch。ABA／撤銷／到期不保留存取權。此處仍須proposal70 schema，但本輪沒有新增或套用DDL。

pending只取目標node的預留、有效grant、處理／刪除及virtual derivative來源。workspace總reserved另對比全部node的pending upload加實際image_processing_jobs.reserved_bytes；虛擬16MiB derivative補充額不當成實際帳本。不能把一筆已歸屬Oracle的預留直接標成primary忙碌；無法對帳的差額仍拒絕。該Oracle歸屬分支目前僅mocked SQL與靜態審查，未完成真Oracle reservation驗收。

`reconcilePrimaryStorageNode` 將這份來源接到實際命名PRIMARY_STORAGE binding的root list。primary metadata必須binding-account／PRIMARY_STORAGE／binding ref精確匹配，disabled拒絕；物理Cloudflare account/bucket仍依部署證據確認，不能由邏輯名稱反推。切換binding須使舊對帳失效。Oracle metadata reader不代表其public S3 list已開通。

## 本機驗證

證據 `docs/releases/node-storage-inventory-local.json`。最終6檔71項：41原workspace core、11 node core、16 mocked D1 reader及3個真本機D1/R2。另有6個Python巡檢測試，strict、scoped lint/format及前端／Worker dry-run通過。

原生fixture套用全69 active migrations及proposal70（不是雲端ledger70），primary R2包含兩個workspace，Oracle metadata排除於primary集合之外。驗root listing與工廠入口、陌生prefix拒絕、讀取不改帳本、既有workspace收據，以及手動回收後metadata保留且R2零位元標記仍匹配。合法primary預留會阻擋、由原產品取消後恢復；非bootstrap workspace owner的reader及工廠請求拒絕。

曾嘗試直接建V2，原guard正確拒絕，fixture改為合法V1thumbnail；沒有放寬版本guard。Oracle預留fixture被既有0065容量guard拒絕，沒有偽造health或policy來換綠燈。真Oracle預留歸屬、populated cancellation upload_key_fences與hosted仍未驗。

## Oracle唯讀容量觀測

`tools/oracle-storage-inventory.py` 只透過既有VM localhost S3 helper列舉私人桶，不改Caddy、DNS、設定或物件。憑證及raw keys不離開VM，只輸出數量、bytes與manifest digest；不會生成健康或刪除grant。

這次觀測22物件，內容總量93,292bytes。14件具有UUID-prefix外觀（3種prefix）、2個固定系統key合計165bytes、6件未分類合計21,454bytes。UUID形式不代表B資料庫已登記；未分類也不代表垃圾或可刪。總bytes是物件內容，並非VM預配image、實體磁碟占用或可用空間。

觀測沒有和B DB比對，也不是原子snapshot。Oracle的系統控制物件、未分類物件及registered manifest仍需受控比對；不放寬公開路由來避過待答覆的共用Caddy授權。不可將這份觀測直接餵成planner的healthy metrics。

## 發布與下一步

沒有新API／UI／旗標或migration，B/schema與自刪OFF/dry-run、無Cron、R2優先／Oracle30GB維持。既有已上線頁籤source10e79694已核對為本候選祖先，沒有退回舊介面。

下一步是Oracle registered＋system＋未分類完整來源、持久化global收據、完整活動覆蓋與Owner真實preview／正向候選及失效驗收。不能以本機global match代替這些條件，也不能將未知物件任意刪除。適用的備份／獨立復原／fresh parity、完整CI、自動B及真Owner／Guest仍是正式發布守門。

本輪無正式DB變更，不需要雲端回滾。若新內部盤點故障，保留歷史及原圖、停止使用該結果並forward fix；舊來源證據保留為歷史checkpoint，新來源以本輪hash與測試為準，不覆寫舊證據冒稱新驗收。
