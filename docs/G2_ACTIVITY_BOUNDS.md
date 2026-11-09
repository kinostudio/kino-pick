# G2 活動時間界線與附件近期讀取保護

## 三個不同來源

- `lastValidViewedAt`：原有合法人類瀏覽事件與 `album_human_activity` 投影；仍是分享期限使用的資料。
- `activityCoverageStartedAt`：可驗證連續觀測期的起點。不能從旗標ON、空事件、普通審計或一個成功請求推論。真正的持久化部署/前端觀測契約仍待完成，目前來源快照不會宣稱此欄位已驗證。
- `possibleActivityThroughAt`：已記錄的近期讀取保護上界。`D1AlbumReadProtections.observe` 可由DB時間讀出，包括已到期row；沒有row僅代表沒有這份紀錄，不代表無人使用。

Planner 必須明確接收後兩個欄位；`activityEvidenceVerified=true` 但沒有覆蓋起點會拒絕。閒置計算與排序保守取建立、發布、合法瀏覽、覆蓋起點及可能活動上界的最大值。容量與閒置模式皆排除最近15分鐘的覆蓋起點/可能活動，精確15分鐘邊界一致。這些時間不會寫回合法人類瀏覽，也不會延長分享期限。

## 既有71提案的讀取保護

沿用 `ALBUM_READ_PROTECTION_ENABLED`，三個環境仍OFF；不新增schema或Cron。原Owner/Guest縮圖與預覽已有保護，本次將同一服務加入Guest原圖/預覽下載、固定成品檔與ZIP。沿原授權、size/SHA/MIME、generated/current-ticket檢查，在開啟檔案前與回傳前保護；ZIP每個實際entry讀取亦檢查。失敗不回傳已開啟的檔案，沿既有catch取消未讀body。OFF跳過保護SQL，ZIP維持原3次ticket核對，ON才新增第4次；不改下載權限。ZIP串流中的來源失敗會中止串流，仍可能留下部分下載，不宣稱HTTP200等於完整存檔。

這仍是短期請求窗口，不是持續串流/頁籤存在證明：單一大型檔案或已解碼離線圖片可能超過15分鐘。完整活動覆蓋需要可續期的有限顯示/讀取契約與可信部署覆蓋區間，並處理舊頁籤、換session與不支援的舊前端；不能用本次補入口取代這些條件。

`observe` 僅供已授權Owner讀取實際資料來源，無新HTTP入口。wrongOwner/session/project及到期session拒絕；缺schema、矛盾row或範圍損壞拒絕而非回空。DTO不包含actor/session/IP/key。到期row仍保留上界與revision，沒有刪除/續期副作用。

## 人類事件投影核對

0053既有守門以 `(viewed_at_ms,event_id)` 決定最新事件，包括同毫秒字典序。來源reader沿用同一規則。先前僅比對最大時間的查詢會漏掉同毫秒低序事件指標損壞；本次補回完整排序。Native以隔離合成故障注入核對：只在fixture暫時停用所需guard並復原，驗canonical高序指標可讀、原guard拒絕低序更新、損壞來源被reader拒絕。這不是產品授權的人類瀏覽驗收，沒有變更產品guard或migration。

## 尚未完成與發布

本切片不提供完整Owner planner/API/UI、活動覆蓋epoch、Oracle系統物件對帳或刪除grant。沒有真實來源支援的完整正向候選，不能標G2或MVP完成。讀取保護仍依71提案及適用的備份/獨立復原/parity、完整CI、自動B及真Owner/Guest驗收後才能啟用。沒有雲端DDL/部署，A/Review/DNS/客戶資料不動，自刪OFF/dry-run、R2優先/Oracle30GB保持。
