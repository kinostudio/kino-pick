# 真實雲端 100 張照片驗收（受限 Owner staging）

驗收時間：2026-10-31，約02:40–02:59 UTC。這不是 production 或完整線上 MVP 發佈。

## 版本與資源

- 網址：https://kino-pic-staging.kino-pick-aaron2026.workers.dev
- 部署來源：`7be9f78496103076f110a4f9e58e96788265f1da`；CI41154235653 success。
- Worker version：`1441d058-27f1-44e8-9440-4861f88d7f47`；部署bundle SHA256 `d51d0983c8869827fc0bd68257763181c50b9bf6652abaf154af69a6e4f79477`。
- B：`d3e930465c0df7e89b35de3ca65ea36a`；D1：`cdee0ac7-bf91-4852-9c17-a996c0b84f8d`，migration56。
- 私人桶：`kino-pick-staging-d3e93046`；workspace `bd927a6d-d5d3-4743-bbae-e4560cdda4c7`；project `08954949-ae90-4353-be2f-ae4a8f40b78d`；album `613487da-e6ff-4ada-9b66-949f21fcfa2c`。
- 只有合成測試圖片，無客戶照片；原圖1600×1000，90張orientation1、10張EXIF6。不能由此宣稱大型照片、手機Safari或額度壓力已驗收。

## 實際通過

1. 實際GitHub Owner登入後從產品介面建立workspace/project/album，設定Cloudflare政策revision1；五批各20張透過真正瀏覽器檔案選擇與R2簽名直傳。
2. 實際原生Cloudflare Images工作100筆全部succeeded；R2原圖100、thumbnail100、preview100。總計8,913,629 bytes，與workspace used_bytes一致；upload/processing reserved皆0。
3. 桶專用S3憑證唯讀GET全部300個物件，大小與SHA256完全對應D1；100原圖hash對應最初的100個合成fixture。200衍生JPEG全部Sharp完整解碼，限制長邊320/2048、無EXIF/ICC/IPTC/XMP/orientation、符合旋轉後縮放比例；10張直式方向通過。這是對真實provider輸出作驗證，非用Sharp產生雲端輸出的double。
4. 實際Edge產品圖庫累計24/48/72/96/100，每次已載入縮圖數等於該頁累計；最後100個唯一檔名且無更多按鈕。單張100直式燈箱1000×1600、下一張99橫式1600×1000，關閉操作通過。
5. 匿名讀取真實私人thumbnail回401；既有7項入口／匿名API／Guest隔離／封閉註冊／外站Origin／編碼別名邊界通過。未聲稱本次覆蓋所有跨租戶與配額故障。

## 證據（皆在 Git 忽略的 apps/worker/.local）

- `staging-upload-validation-deploy-proof.json`：初始closed部署及綁定、bundle；`staging-upload-validation-hosted-boundary.json`：之後受控開放與7項邊界。其realOwnerUploadTested:false是當時狀態，由以下分開的新實際驗收補充，不改寫原證據。
- `hosted-owner-login-policy-proof.json`、`hosted-upload-fixtures.json`、`hosted-upload-assets.json`。
- `hosted-upload-ledger-proof.json`：100成功、300資產、容量帳務。
- `hosted-upload-assets-proof.json`、`hosted-upload-assets-verify.log`：300 GET與解碼驗收；manifest SHA256 `10409ff85dda7151146eaeb06fc8f4c8d706171b49ae39aea3952bc70e5f74cd`。
- `hosted-gallery-browser-proof.json`：CUA實際Edge可見DOM／圖片decode、分頁、燈箱及匿名401。未保存hosted截圖檔，不把較早local截圖當hosted證據。
- `hosted-100-backup-20261031/database.sql`：預先ACL保護的私人SQL匯出；`backup-proof.json`：SHA/大小，明確restoreVerified:false／r2ObjectsBackedUp:false。含真實auth資料，不可輸出／提交／共享。

唯讀操作者工具 `apps/worker/tools/verify-hosted-upload-assets.mjs --verify-synthetic-staging-only` 固定B/桶/上述scope，要求100fixture／300資產及精確TEMP fixture目錄，才從受保護的本機設定讀取憑證。只GET、不PUT/DELETE；回報不含key、簽名URL或原始provider錯誤。已實際跑完exit0。勿在無新理由時重複300次GET。

## 保留的診斷與限制

首次檔案選擇自動化等待異常長；後續先啟動click而在setFiles完成後才await click、加明確timeout，五批最終均成功。最後批次有一次開始按鈕尚在hash準備時timeout；重新讀取UI確認20張準備完成再啟動，無重複傳輸。只適用此次工具流程，不能據此聲稱所有瀏覽器修復。

首次唯讀清單helper用JSON.parse讀JSONC，在發送雲端查詢前失敗；改用既有TypeScript JSONC parser後查詢通過。驗收工具專案ID拼字已修正為上述實際ID，再執行300物件驗收。

Wrangler D1 export曾將一小時有效的SQL下載連結回顯到工具輸出；本機日誌已移除此連結，沒有將URL/值寫入Git。下載連結預期約03:58 UTC到期，未宣稱已提前撤銷。後續所有export/import應完整攔截stdout/stderr，只回報白名單摘要；不可再tail未清理原始輸出。正式OAuth/R2金鑰未輸出。

## 下一個垂直切片

目前public staging為enabled、previewfalse、Owner-only邊界持續啟用；不開Guest、不開自動刪除、不加Cron。先讀實際狀態，保持所有版本與原資產不動。

1. 在無進行中jobs/reservations的這個snapshot，將所有300個immutable物件及manifest安全備份；把最新D1匯出restore至全新的隔離B DB，不覆寫既有DB，驗FK／全表hash／引用與R2校驗。實際物件恢復需獨立命名空間／可驗證映射，不以只讀原桶代替恢復；未做前不得標完整D1/R2復原通過。
2. 修正每相簿/政策的上傳capability，Cloudflare16MiB而非全域文案64MiB；後端現有16MiB guard仍有效。未配置Google時不得顯示無效登入CTA；保留原雙來源綁定需求。
3. 逐階段完成Google/link/unlink/session、Guest協作／版本／推薦metadata正式服務／交付通知、dry-run後台及hosted安全拒絕。
4. production `pick.kinostudio.tw`尚未接通；A DNS/部署完全未動。維持正式部署guard，滿足各驗收才review cutover。

回復策略：若restricted staging出現不預期授權行為，僅關閉B此Worker的workers.dev/preview入口並讀回；保留D1/R2、審計與fixture。不要套回舊SQL、不刪物件、不改A。此輪未改schema，0055/0056不可重寫。
