# 瀏覽器優先產生縮圖與預覽

## 使用流程

在工作空間的處理設定選擇「瀏覽器優先」。上傳仍使用原有佇列與私人原圖直傳；原始檔內容不修改，優先儲存 R2，既有容量與 Oracle 備援規則保留。

每張原圖確認完成後，瀏覽器使用原生 ImageBitmap／Canvas 依序產生 320px 縮圖與 2048px 預覽，不放大、保持顯示方向與比例，透明區域補白，JPEG 品質 0.82。不要求使用者安裝 Node、Sharp 或桌面工具。

新處理配方 `browser-first-jpeg-82-v1` 明確包含 Cloudflare 備援；舊配方與既有工作不改寫。此配方每張來源最多 16 MiB，與現有 Cloudflare 備援上限一致。舊本機 Sharp 配方仍保留 64 MiB 上限。

## 信任邊界

- 原圖沿用既有簽名直傳、完成確認與不可覆寫資產，不經新增派生圖 API 轉送。
- 新 `POST /api/v1/uploads/:uploadSessionId/browser-derivatives` 僅限登入的 Owner，核對同源、預期操作者與 session；從已完成的上傳取得唯一照片／版本／儲存節點，客戶端不能指定 key 或 asset ID。
- multipart 只有 `sourceSha256`、`thumbnail`、`preview`；核對原圖雜湊、單檔／總量上限、JPEG 解碼、尺寸／比例與方向，移除派生圖隱私 metadata。Cloudflare Images `.info()` 僅用於檢查，不執行正常路徑的縮圖轉換。
- 使用既有 durable job lease、容量預留、不可覆寫儲存、寫後讀回雜湊與 D1 完成交易；完成前不把派生圖列為可用。
- Guest 沒有此寫入入口，租戶、相簿與邀請讀取授權保持原樣。

## 備援與限制

瀏覽器不支援、解碼失敗或派生圖遭拒時，由同一配方使用既有 Cloudflare 處理器。若網路中斷或頁籤關閉，原圖保留，既有每十分鐘巡檢會接續佇列；這不是關閉頁籤後仍執行的瀏覽器背景程式。已取得處理 lease 的中斷工作須待 lease 到期才能重試。仍保留三次暫時錯誤上限及需人工確認狀態，不無限重試、不覆寫部分完成的 immutable 輸出。

Cloudflare binding 仍是伺服器解碼驗證與備援所需。官方說明 `.info()` 不計轉換費；其他 Worker、D1、R2 與備援轉換用量依實際服務計算，不宣稱整條流程免費：[Cloudflare Images binding](https://developers.cloudflare.com/images/optimization/binding/)。

## 遷移與復原

0072 由完整 0071 schema 產生，新增配方 CHECK 與對應大小／重試規則；重建必要相依表並保留歷史列、舊配方及 default。正式套用前必須在 B 的獨立復原庫驗證 populated parity、schema 與外鍵。0071 已完成的備份復原證據保留，不重新初始化或重做 0070。

優先採修補前進；暫停新瀏覽器配方 admission 或以產品設定切回 Cloudflare，保留可處理 browser-first 舊工作的新版執行器。不直接降版資料庫、不刪新資產或歷史。需要 Time Travel／完整還原時先盤點遷移後的新寫入，避免覆蓋客戶資料。A、DNS、Review 不在本次變更範圍。

實際執行結果與尚未驗收項目記於 `HANDOFF.md` 及 `docs/releases/`；本文件描述設計，不作為已部署證據。
