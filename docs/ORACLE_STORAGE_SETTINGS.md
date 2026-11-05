# Oracle 儲存設定

## 最新狀態（2026-11-06）

VM 正式服務、30GB provider quota、33GB 實體預留 image、20GB floor、60秒健康同步及私人 HTTPS 已驗。來源設定保存後以單調 revision／ETag CAS 同步 VM；0065 原子新預約已 native 驗 R2 優先／滿額才 VM／R2 回收後恢復優先，舊 session 保留節點。B 授權已恢復，schema63–65已在獨立復原驗證後採用；正式程式尚未部署，網站分流未啟用。以 [ORACLE_STORAGE_ACTIVATION.md](ORACLE_STORAGE_ACTIVATION.md) 為準，以下本機設定紀錄保留供追溯。

使用者指定初始上限 **30 GB，動態可調**；另保留至少20 GB磁碟空間。GB使用十進位位元組。這是額外照片容量，不是備份或縮圖處理順序。

## 已完成來源與本機操作

後台「處理設定」新增「照片儲存空間」，可勾選「R2滿額時使用Oracle」與調整1–100 GB。設定儲存在D1，不是localStorage；有固定requestId、revision CAS、同命令重送、Owner session驗證及append-only前後值審計。降低不能少於Oracle節點已用＋在途容量。

- `GET/PUT /api/v1/storage/oracle-policy`：只供環境明確指定的 `ORACLE_STORAGE_ADMIN_USER_ID`，不是任意workspace_owner。Guest及其他Owner不可取得或更改全平台設定。
- `requestedEnabled` 是設定意向；`effectiveEnabled` 是實際能力。未開通credentials、未註冊節點、DB仍只允許primary上傳，或無有效健康／容量證據時，畫面明示「尚未生效」。儲存意向不會繞過上傳守門。
- `0064_oracle_storage_policy.sql` 只新增設定與不可變命令／審計，不註冊S3節點、不擴大workspace quota、不放寬primary-only SQL，不自動掛載VM或修改Caddy。
- 新S3 bucket adapter沿用R2儲存安全檢查，補Owner/Guest資產、下載、metadata及處理工作依原圖節點路由；既有session的完成／取消與刪除可接受節點resolver。這些是接線來源，並非Oracle端到端分流驗收。

設定是全平台共享資源設定，不代表每個workspace都各有30 GB。現有workspace業務配額與實際VM硬上限仍需在正式分流切片中處理，不可只改UI數字當成擴容。

## 驗收證據

隔離preview `http://localhost:4196/__review/login`，Synthetic Owner + 真D1/R2/Sharp，schema0001–0064。瀏覽器實際保存啟用意向及30 GB，改35再改回30、reload後保留；畫面如實顯示尚未生效。截圖 `.local/oracle-settings-30gb.jpg`。原4194不重啟、不清除其資料；4196為同一正式前端的另一份隔離資料，並非另一套prototype。

原生D1 fixture驗證0063既有workspace保留、30 GB預設、動態修改、重送只一筆審計、CAS／範圍／session／已用下限與FK；`.local/oracle-settings-focused-final.log`：3檔8tests，其中Oracle policy native1、S3 mock6、原生client activity1（11群組）。`.local/oracle-adapter-processing-final.log`另為S3/mock6與processing-node/mock2；不要與重複執行結果合計成新總數。Repo/Web strict、scopedlint、targetUI與Worker dry-run已通過；未執行全量回歸或新hosted驗收。

第一次preview因已知migration上限63停止於初始化，helper同步到64；第二次用127.0.0.2被Miniflare Origin拒絕，改用既有支援的localhost，沒有放寬正式Origin驗證。成功server log `.local/oracle-settings-review-third.log`。

## 遷移與復原

0063與0064均SOURCE ONLY，沒有套用到B或預設持久本機D1；preview使用隔離資料。B最後驗證仍schema62／source e6d4d68，未commit/push/deploy。

採用前需要新鮮備份、獨立restore、逐表資料／schema與FK比對及受控部署gate。暫停新VM分配時關閉意向／deployment admission，保留節點resolver讓已有VM檔案仍可讀；不得將「停用」實作成刪資產／節點。回復來源以forward fix或關閉功能為主，保留設定命令、審計及資產，不DROP歷史表，不拿舊備份覆蓋新寫入。

## 尚未完成

正式30 GB硬空間與可調容量同步、私有S3服務常駐／HTTPS／憑證安全保存、健康證據更新；新預約自動R2→VM與原子容量重驗；移除primary-only上傳／處理review／清理守門的相容migration；workspace quota政策、VM已授權到期fence、混合節點端到端及備份復原。以上完成前不能宣稱「R2滿後自動存VM已啟用」。A/DNS／Review服務未動，自動刪除仍OFF/dry-run。
