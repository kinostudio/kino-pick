# 手動清理照片儲存空間

本功能是 Owner 明確確認後的立即清理（grace=0），與自動保留政策分開。自動刪除保持 OFF、dry-run ON、無 Cron、單私人 R2 節點。正式 production profile 仍不開放此功能。

## 操作與資料範圍

沿用正式相簿卡片的「刪除相簿與照片」：先載入照片、版本、原圖／縮圖／預覽／交付資產數及預計位元組；輸入完整相簿名稱並勾選永久刪除確認，才送出固定 request ID 的要求。啟動前 SQL 交易重新核對 Owner、session、租戶、相簿 revision、清單數量、位元組及阻擋條件。

相簿進入 deleting，停止新讀取、上傳及新版本／資產寫入；刪除工作保存全部 immutable assets 的精確 key、節點、checksum、bytes，不用 R2 prefix list 猜測刪除範圍。每次 API 最多處理四項，前端依已確認工作逐批續跑；關頁或失敗後可重新開啟並繼續原工作。新專案／相簿只接受固定 workspace 內成功且不可變的 Owner 建立紀錄作為 managed scope；其他租戶、無管理見證的資源、原固定測試相簿的破壞性要求均拒絕。新建相簿的 Guest 分享仍待另一次受控範圍提升；不擴大既有邀請。

R2 會以目前 ETag 為條件，將已確認 checksum／bytes 的照片內容替換成零位元組永久 fence，然後再 HEAD 核實 job／asset 標記。這會清除實際照片 payload，同時保住 key，阻止舊的 If-None-Match:* 簽名上傳重建照片；不刪除既有上傳 fence，也不刪整個 bucket。物件數量不一定下降，不能以物件數或 metadata 的歷史 bytes 當成尚存照片容量，也不能宣稱零費用。

核實後，item 狀態、workspace／node 用量扣減、工作進度及 append-only 審計在同一 D1 交易完成。若 R2 已清除而 SQL／審計失敗，item 保持 pending；重試辨識同一 fence，完成一次扣減，不會重複計費帳減少。介面分開顯示預計容量與實際已釋放容量。

所有相簿清理完畢後，才允許刪除專案。專案從列表移除並保留永久 tombstone，禁止還原或新增子相簿。照片／版本／留言／註記／提交與審計 IDs 不會被 cascade 刪除。此切片不提供刪除整個 Owner 工作空間。

## 安全阻擋與目前限制

- 相簿 legal hold／保護釘選，或任何照片 pin，均拒絕。
- 上傳 reservation、未到期簽名授權、非 succeeded 的影像處理工作、正在挑片／編修／審核中的專案，均拒絕。
- 有效 Guest session 或十五分鐘內的有效瀏覽紀錄，拒絕；介面顯示原因，稍後重新檢查。
- 跨相簿版本父項參照，以及任何既存版本核准請求，暫時拒絕。現有核准資料缺少安全關閉流程，不以猜測視為已失效。
- queued／unsupported／needs_review 的安全取消與未知輸出對帳尚未完成，這些內容不會冒險清除。無可核對 SHA256 的舊 R2 物件也會停止並保留重試紀錄。

## API

- `GET /api/v1/albums/:id/deletion`：唯讀預覽／工作進度。
- `DELETE /api/v1/albums/:id`：strict body 為 requestId、expectedRevision、confirmationName、inventoryCount、bytesBefore、confirmPermanent:true。
- `POST /api/v1/albums/:id/deletion/retry`：strict body `{jobId}`，只續跑已確認工作。
- `DELETE /api/v1/projects/:id`：所有相簿已清理／沒有存留資產時，以完整名稱及 revision 確認移除專案。

寫入均驗證 Origin、即時 Owner session 與 scope；每項不可逆物件操作前再次查驗授權。重放須保留相同 UUID／意圖；未知結果不能當成失敗重新建立不同工作。完成後清理審計以中文顯示於既有活動歷史，明細不暴露儲存 key 或 fence metadata。

## 遷移與復原

0061 為加法 migration：兩個工作表、blockers view、索引與防護 triggers，保留 schema60 的144個舊資料表及所有舊資料。B 的新備份已獨立復原、升級比對後才採用；非機密證據見 `releases/manual-album-deletion-0061-restore.json`。SQL 與 session 資料只在 ACL 保護且 Git 忽略的目錄。

**刪除照片是不可逆操作。** SQL 備份只可復原 metadata，不能復原已清除的 R2 payload。工作執行後保留 ledger／fence，優先修正並續跑；不可把舊 SQL 備份覆蓋到已有清理結果的資料庫。若未執行清理而需要退版，保留0061表與觸發器，回退 Worker 即可；不要移除審計或重開已消耗的 key。未來容量 reconciliation 必須排除已 reclaimed 的 immutable asset metadata。

## 驗證邊界

已執行 native Miniflare D1／R2：歷史 V1／V2 六個實際物件，共11,276bytes→0；所有原圖與衍生物、固定 key 防復活、外來 Owner 拒絕、清單變更拒絕、審計失敗後恢復、配額一次扣減、保留其他物件／舊 fence、專案 tombstone 及 FK0。處理結果 metadata 是明示的合成 fixture，非再次驗證真實解碼／100張上傳。

另有 schema60 populated upgrade／session／保護／late write／完成審計回滾測試，以及 managed scope／歷史投影測試。瀏覽器已經實際建立專案與相簿，查看27個物件／9版本清理預覽和阻擋 UI。本機 session 為隔離驗收身分，不是真實 OAuth。CI、自動部署與 hosted 實際清理的最終狀態以 HANDOFF 最新節為準。
