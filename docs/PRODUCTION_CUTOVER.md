# Kino Pick 正式切換與復原

正式網址 `https://pick.kinostudio.tw`。A 只新增 `kino-pick-gateway` 與 pick 專用網域；網站、API、D1 和私人 R2 都在 B。入口使用簽名轉送，B 的 workers.dev 不接受未簽名請求。OAuth、R2 與簽名憑證只存受保護本機設定及對應 Worker Secrets，禁止貼入文件或 Git。

## 本次切換

1. 沿用 schema67 與既有正式 UI，沒有重新初始化產品。原始 SQL、物件備份與完整比對資料保存在 Git 忽略的 `.local/production-cutover-20261112`，ACL 限 Aaron／SYSTEM。
2. 初次複製後，先證明關閉的 production 資料庫仍與初始副本完全一致；停用 staging workers.dev、預覽入口與 Cron，核對有效上傳授權、執行中處理及刪除工作均為零，再匯出最後來源。
3. 最後來源獨立復原，核對 schema、資料、migration ledger、sequence、統計與外鍵。匯入經核對零產品物件的 `kino-pick-production-live`，再重新匯出完整比對；原關閉副本 `kino-pick-production` 保留。先前完整刷新被雲端外鍵拒絕，已獨立證明完整回滾；單筆歷史瀏覽補寫又被既有時間守門拒絕，因此放棄刷新與補寫，沒有改掉任何守門。被放棄的工具只保留在忽略的本機候選，不進入發佈。
4. 322 個 R2 資產已用不可覆寫 PUT 搬入 `kino-pick-production`，並逐件讀回 SHA；9 個 Oracle 資產已真實讀回核對。最後資產／fence 清單必須與該次證據相同，否則只補搬新增物件。原 staging 桶與資料庫保留。
5. 精確來源 CI 成功後，自動選擇 production workflow。發佈前核對來源停寫、資源、憑證名稱與版本；發佈後核對精確來源版本、旗標、Cron 及未簽名 B 請求 404。然後才接 A 的 pick 專用網域與真實 Owner／Guest 驗收。部署收據不是產品流程驗收。

## 復原邊界

- 公開前若匯入失敗，production 入口保持關閉；原 `kino-pick-production` 關閉副本與 SQL 備份均保留。需要恢復 staging 時先確保 production 入口與 Cron 都關閉，再套用 protected `staging-before-cutover.json` 的原值。
- 公開後 production 可能已有新資料，不得直接用切換前 SQL 覆蓋。先停用 production 入口／Cron 並備份當前資料，再回復 Worker 的已知版本；資料復原須另訂保留新寫入的方案。
- staging 與 production 共用既有 Oracle 桶，只允許其中一邊作 writer。不得為了預覽而重開 staging Cron 或發佈舊 staging workflow。自動部署目標由 `apps/worker/deployment-target.json` 決定。
- A 既有 Worker／DNS、Review 路由及客戶資料不在本次變更範圍。自動刪除 OFF／dry-run；Oracle 是容量溢出節點，不是備份；R2 優先、Oracle 30GB 可調。

## 尚未等同完成的項目

最終狀態以 `docs/HANDOFF.md` 與 `docs/releases/production-cutover-20261112.json` 為準。真實 production OAuth、上傳、分享與 Guest 回饋／交付仍須從正式網址驗收；staging 曾出現的 Guest 初載 503 沒有因資料複製而被宣稱修復。Google production OAuth 與 G2 進階自動回收不在這次切換中啟用。

Kino Review 可沿用 Pick 的分享／Session、獨立權限、同邀請留言、固定版本核准、簽名下載與這份切換流程；帳戶、密鑰、DB／儲存及照片座標／影片時間碼應分別配置，不直接共用憑證或繞過各產品授權。
