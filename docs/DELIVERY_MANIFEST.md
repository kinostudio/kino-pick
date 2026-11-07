## 2026-11-07 代表核准＋固定版本成品交付：本機完成，B 復原名額待確認

沿用既有0054核准與原介面；一位明確授權客戶代表確認即可，Owner再明確發布給核准名單中的收件邀請。新0066僅增2 views／3 indexes／3 triggers，固定原圖版本、檔名、節點、大小、mime、SHA與核准收據，不隨目前head切換。發布／撤銷／下載沿用append-only audit；查看與原圖下載獨立，租戶／相簿／邀請／session／期限／撤銷逐次驗證。Guest只顯示自己的安全下載歷史，不回傳原始IP。單一照片一份交付，可多次發布；ZIP／通知仍待完成，非完整MVP。

實跑：18 config/boundary＋17 Guest-history單元；26本機原生B-profile組（schema66、2影像fixture）；13攝影師回歸組；5 Chromium核准／交付組，實際存檔size／SHA一致。25份交付為同一原圖的metadata測試，不是25張上傳。strict、product/profile build與scoped lint通過。負面注入GET503與publish409後恢復正常，無草稿燈箱可關閉；精確journal重試、撤銷與request-ID衝突保留。證據docs/releases/approved-deliveries-local-acceptance.json。保留先前失敗紀錄，未把失敗／mock負面回應當正式驗收。

雲端阻塞：B實際回覆D1數量已滿，新的獨立0066復原庫未建立，未套用live0066、未部署本次功能。已完整匯出舊獨立測試庫kino-pick-restore65-20261106（04966465-e0f7-4cd8-9c32-7065034406cd），本機獨立還原65／FK0；2979263 bytes、152表／3039列、SHA e4e44ce7f81cc6b6ecd9feefcc2970c43c1f2cc6b069cb85209007246d539aff，符合原0065 proof。已提出一次刪除此舊測試資源的確認，尚未答覆；不可擅刪、不可繞過復原gate。備份在release clone的apps/worker/.local/approved-deliveries-0066-20261107/preserved-prior-restore65.sql（受ACL保護）。

下一步：收到明確允許後只退役上述舊復原庫；以固定B工具node tools/rehearse-approved-deliveries.mjs --restore產生fresh65備份並遠端獨立復原/升級，成功後--adopt做live parity再只套0066。真正manifest出現後跑release self-test→正常CI→自動B部署→真Owner／獨立Guest核准及固定V3下載、head切換驗收。工具使用隔離Wrangler config；失敗停止不覆寫live。復原優先forward fix；不要將舊snapshot覆蓋新資料，任何回滾先關新flags並保留審計與資產，不能刪歷史換綠燈。

B目前仍是source55af3ca／CI42353228572／deploy42354807451／version616e7a23-cd3f-4738-bc55-82da5c226ad9，schema65。正式候選在.local/oracle-release-20261106；根不同產品變更保全，A／DNS／Review／客戶資料未改，自刪OFF/dry-run、R2優先／Oracle30GB保持。尚未驗新CI／hosted／ZIP通知／負載／實機觸控。

# 固定版本交付 — 實作邊界（進行中）

目標是攝影師明確發布一份固定的成品清單，讓獲授權客戶下載當時指定的檔案；之後切換照片目前版本不改變既有清單。既有 current-version download 不是此交付功能。

## 本階段設計

- 清單由同一 workspace、project、album 的一至多張照片構成，逐項固定 photo、version、實際 private asset 及檔案完整性資訊。服務端解析並確認來源，客戶輸入不能指定儲存 key、儲存節點或繞過 scope。
- 攝影師明確指定已封存的邀請範圍，記錄建立、發布及後續可見事件；若採用已確認版本，引用與該照片及版本一致的不可變確認紀錄。一位獲授權客戶代表確認即可；不能把查看或挑片權視為確認權。
- Guest 必須在每次讀取、下載時持有有效 session、收件邀請及對應的獨立下載權限。確認權不自動授予下載權。對外不得暴露物件 key、簽名網址、雜湊以外的內部儲存資訊或其他邀請的客戶身分。
- 資產必須仍屬私人狀態並符合固定大小、類型及完整性資訊；下載稽核與資料存取失敗時關閉。保留既有 immutable 版本和 append-only 稽核；延後或失敗的串流不得被說成客戶成功收到檔案。
- 發布記錄、清單項目、邀請範圍及其歷史需防止 UPDATE、DELETE、REPLACE 與跨租戶／跨照片嫁接，使用可恢復的固定 request ID，當前權限檢查先於重試回傳。最終清理器須將仍有效交付與進行中的授權下載納入保護及鎖定範圍；不得以這份設計啟用自動刪除。
- 先用隔離 D1/R2 與合成資料測試，預設功能 OFF。0053/0054 仍未套用到持久 D1；新 migration 應以 0055 之後新增，並在任何持久升級前做新備份、隔離還原／升級與資料一致性驗證。停用功能並保留所有歷史，修復優先採向前 migration。

## 尚未完成

此文件是實作邊界，並非已上線功能或完整產品驗收。多檔批量交付、ZIP、通知、撤銷／期限 UX、保留政策整合、真實 R2/OAuth 與正式部署均須按實際實作分別驗證。下一步是完整契約與 schema/service/API/UI/tests，而非以現有目前版本下載替代交付。

## 合約審查待落實

Guest manifest 的成功回應必須具有查看或下載能力至少其中之一；只下載權限仍可列出為下載所需的清單。這只是 DTO 的拒絕條件，服務端仍須逐次驗證當前 session、收件邀請與實際資產的既有獨立權限。既有邀請存的是 can_download_preview／can_download_original，尚無獨立的 delivery bit；對原始檔交付應依既有 can_download_original 授權，不能因版本核准或持有清單而推定可下載。專用 delivery-kind 權限、asset 驗證來源及稽核方式尚待實作與定義，不可假稱現已具備。現有下載路徑依 current head，不能用來保證固定交付。未來發佈 API 必須在解析 JSON 前強制實際 byte-size 上限，並定義可見的建立／發布事件與稽核。
