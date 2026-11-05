# Oracle 容量擴充儲存

## 最新狀態（2026-11-06）

正式 VM 的 30GB 私人儲存、HTTPS、systemd 容量／健康同步已實測；source0065 的 R2 優先、滿額 VM 與 R2 釋放後恢復優先已通過原生分配測試。B 授權已恢復，0063–0065 已在備份／獨立復原／parity 後採用；正式程式尚未部署，網站分流仍未啟用。以 [ORACLE_STORAGE_ACTIVATION.md](ORACLE_STORAGE_ACTIVATION.md) 為當前狀態；以下為原有階段紀錄。

## 使用者需求與目前狀態（2026-11-05）

這是 R2 容量不足時的第二個照片儲存節點，**不是照片或資料庫的備份副本**。新上傳在保留容量時決定節點，同一 upload session 不得在傳輸失敗或結果不明時改存別處。既有 R2 檔案不搬移；停用 VM 新分配也不能關閉已存 VM 檔案的讀取。

照片存放的 R2→VM 順序與縮圖處理服務的 Cloudflare／Oracle 優先順序是不同設定；不能因使用某個處理服務就把所有歷史檔案改讀該服務的儲存位置。

已沿用 KINO Review 既有 SSH 身分與 known-hosts 做唯讀核對，未複製或輸出其私鑰／服務 Token。共享 VM 上的 Review API、standby、failover、Caddy 都維持 active。資料碟掛載 `/srv/kino-review`，實測總位元組157396975616、可用155758743552；這是單次快照，不是 Kino Pick 獨占配額。根目錄是另一顆較小系統碟，不可誤用。證據 `.local/oracle-storage-inventory.json`。

Kino Pick 目前仍只有 R2 正式節點。不可直接把 PRIMARY_STORAGE 指向 VM：上傳預約、原圖驗證、處理、預覽、下載、到期 fence、手動清理都有 primary-only 守門。`storage_nodes` 和 assets 已有節點欄位，但不是已完成多節點支援。

本輪已新增純容量分配演算法（含VM保留空間／在途容量／新鮮度與既有session固定節點）及未接線的S3簽名入口；分別6與4項focused測試通過。兩者不會自行寫入VM或擴大workspace配額，也沒有執行多節點migration。

## 必須維持的儲存契約

- 新預約同時核對 workspace 配額、節點已用／在途容量、衍生圖空間。只有 R2 確實不足才選健康、已掛載且容量證據新鮮的 VM。來源容量不明／過期、VM 離線或保留空間不足均拒絕新上傳。
- 私人物件不可列舉；簽名 PUT 綁長度、MIME、SHA256、If-None-Match。錯 SHA 不落盤；並行同 key 只能一個成功。
- 原圖與衍生資產保留 storage_node_id；每個讀取、處理、下載及刪除都依該欄位選 adapter，不能只看「目前優先節點」。
- 到期／取消及實刪仍須永久 fence、條件寫入與舊 ETag 拒絕，不重新開放舊簽名 PUT。未知結果沿固定原命令恢復。
- 共享磁碟要有 Kino Pick 硬上限與 Review 保留空間；單純建立子目錄或邏輯配額不足以保護 Review。不可為此重掛或格式化現有資料碟。

## 隔離 S3 候選驗證

選用官方 SeaweedFS4.52 作相容性候選，尚未成為產品正式儲存服務。官方 release archive SHA256 已驗：b70a09540bf8aa2b9ea2a48b3b16abe27e162e90a0c3bf041f8d414caf52de8a。binary SHA256：81cb23a563d03fe54aa7a765e85405c95c085271654efb1f3cad200c5651b782。`tools/oracle-storage-probe.py` 只安裝至 `/opt/kino-pick-storage-probe` 並核對 help／version；未啟動服務、未新增 Caddy／DNS／正式流量。執行紀錄 `.local/oracle-s3-probe-install.log`。

`tools/oracle-s3-contract.py` 準備在**新建512MiB檔案型測試磁碟**內測正確／錯誤checksum、HEAD、Range、8並行不可覆寫、過期上傳fence、ETag CAS與匿名拒絕；測試服務所有 HTTP/gRPC 只綁loopback，以專用非登入系統帳號執行，結束後停止並卸載。只格式化新建測試檔，不觸碰實體磁碟；保留測試檔與私有receipt供核對。

使用者已於本輪回覆「允許授權」，原先自動核准拒絕的這次隔離測試已獲明確授權並執行。最終14項檢查全部通過，證據 `.local/oracle-s3-contract-accepted.json`、`.local/oracle-s3-contract-authorized-final4.log`；結束狀態 `.local/oracle-storage-after-authorized-final.json` 證明服務停止／測試磁碟卸載、Review四服務正常，專用帳號與512MiB測試image保留。沒有公開路由、DNS或正式產品流量變更。

測試服務「TCP已監聽／S3可列目錄」不等於可寫：重啟暖機曾造成500，最終以小檔寫入並讀回驗證就緒後才做競態。原生SDK舊模型不支援IfNoneMatch欄位，僅在測試透過before-sign注入同一條件標頭，實際證明簽章綁定全部五標頭與竄改拒絕；Review套件未改。先前失敗log保留，不列為通過。這是候選服務相容性，不是完整node-aware產品接線。

## 後續上線順序

1. 隔離S3契約已通過（14檢查）；保留固定版本／checksum與目前證據，不重做已通過基礎測試。
2. 完成持久化node-aware預約及所有資產路徑，並測試R2舊資料與VM新資料同時可用、跨租戶拒絕、離線／容量不足／未知結果。
3. 設定硬配額與健康／容量讀取；若採既有drive HTTPS，只新增專屬bucket path、不rewrite簽章Host/path，不接管Review路由。先保存並檢查Caddy候選，尚未修改現行設定。
4. schema變更必須另附migration、備份／獨立復原與復原說明；目前沒有套用任何VM多節點migration或擴大workspace配額。
5. 最後才經Owner設定啟用R2優先→VM容量擴充。網站/API仍在B；A、DNS、自動刪除與既有Review服務不動。

Oracle 單機儲存並非資料備份；VM離線時，存於VM的檔案不能預覽／下載，R2既有檔案不應受影響。不得將本次候選安裝描述為已接通正式空間。
