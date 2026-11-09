# G2 清理預覽的證據缺口

目前有 deterministic planner、部分資料來源及已本機驗證的唯讀物件對帳核心，尚未交付可判定「可清理」的正式 snapshot。不得把以下未知欄位填成 `true`，也不得把空結果解讀成沒有保護。自動刪除維持 OFF／dry-run，不新增 Cron。

| 證據                   | 現有來源                                                                  | 已確認的限制                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 相簿政策               | `effective_album_retention_policy`                                        | 每相簿90天／預設OFF及revision可讀，不等於開啟真正刪除。                                                                          |
| 有效自訂分享           | `D1AlbumRetentionPolicyRepository.shareProtection`                        | 0069只計custom期限；不要求曾登入或session仍有效。有效連結只延後清理，不恢復過期inherit。                                         |
| 最近有效人類瀏覽       | `human_photo_views`、`album_human_activity`                               | 有合法事件及受守門投影，但沒有完整追蹤期間／中斷見證，不能證明歷史期間持續追蹤。                                                 |
| 儲存占用               | `storage_nodes`、`workspace_storage_usage`、有效reservation／待處理衍生圖 | `storage_nodes.last_reconciled_at`尚無正式writer；Oracle健康檢查代表掛載／可用空間，不等於R2與DB資產全面對帳。                   |
| 保護、釘選、作業及引用 | `manual_album_deletion_blockers`、既有手動刪除preview／jobs               | 可重用實際阻擋及inventory，但不能直接把它當完整自動清理snapshot。還需逐欄確認planner要求的完整性與時間基準。                     |
| 已發布交付             | 發布guard與不可刪改的`version_approval_requests`                          | 現有`DELETE_SHARED_REFERENCE`會保守阻擋任何核准請求所屬相簿，包含已發布、未發布及撤銷交付；沒有需要增加重複blocker的已證實漏洞。 |

`planRetention`仍要求完整inventory、健康且新鮮的metrics、已核對的活動／分享／引用證據，再套用最低保留、最近15分鐘活動、80%啟動／65%目標與執行限制。其估算釋放量不能冒稱實際已釋放空間。

下一個產品切片須把這些來源接成Owner唯讀預覽，顯示具體阻擋原因，並補上容量對帳與活動覆蓋的持久化來源。只有資料真正滿足條件時，才讓同一planner列入候選；不能用永久全blocked的畫面冒稱G2完成。預覽不持有刪除grant；實刪仍沿既有明確確認、重驗、重試及審計流程。

0069完整發布檢查仍需更新手動清理native、B profile、Human focused及sidecar至同一schema／來源，並驗真67→69復原／adoption。單獨的0069 manifest/schema validators或本機fixture通過，不是完整release self-test、CI或hosted驗收。

## 2026-11-09 對帳核心已驗證，持久化證據仍待接線

`reconcileStorageInventory`已完成指定workspace/node的完整平面prefix列舉與前後inventory核對；41單元＋真本機R2/D1 fixture通過，沒有產品reader、receipt writer、Oracle list、API或UI。其matched不是healthy、不是完整帳戶占用、不是刪除grant；20,000物件／4MiB key／64頁之外需持久化分頁job，不提高上限掩蓋資源風險。

G2完成仍須原生DB守門receipt＋版本CAS、讀取時重驗來源／時間／scope；R2與Oracle任一範圍未完成都不可宣稱全面對帳。活動覆蓋不能僅從空白事件或「功能已啟用」推論，亦不能用普通audit JSON冒充來源見證。Owner預覽應顯示真實庫存及阻擋原因，最終驗收需由真正writer產生的證據讓同一planner選出候選，再證明來源變動／失效時拒絕；不能以永久全blocked畫面交差。

0069完整release程式已接線，仍缺真正compound67→69 cloud adoption及完整self-test／CI／hosted；上文舊的「程式需更新」紀錄以最新HANDOFF為準。所有cloud與刪除守門保持。

## 2026-11-09 真實product inventory reader已驗證

`D1StorageInventoryRepository`已以Owner/session/workspace/node範圍同batch讀真實schema69來源，再接既有對帳核心。reclaimed immutable assets按匹配parent job與原asset identity投影0bytes；upload fences透過原session節點投影0bytes，必須實際存在。來源所有keys合併保留重複以拒絕矛盾；SQL先限制合計筆數／UTF8 bytes，非回傳完整payload後才限制。

3檔12項focused通過，含全69 native D1／真R2、真正manual reclaim後的0bytes marker及保留歷史驗證。仍不提供durable receipt、monotonic CAS、activity coverage、Oracle實體列舉或Owner API／UI；目前指紋不能當成完成G2或刪除grant。正常profile及完整CI仍待真正cloud復原／adoption，B未部署本次候選。

## 2026-11-09 原生對帳收據提案已驗證

proposal0070與內部writer已完成全庫庫存來源epoch、原子CAS、不可覆寫收據及安全審計；3檔8項與strict/lint/format通過。實際六個R2合成payload的收據與manual reclaim後六個0bytes marker收據均通過，舊收據失效。只在隔離測試套用proposal；active migrations仍69，B沿已驗schema67，沒有API/UI或刪除grant。

這只補上指定workspace/node的持久化來源見證，不證明實體節點路由、Oracle/global-node盤點、活動覆蓋、分享／保護／引用完整性或真正planner候選。完整啟用／復原守門見G2_STORAGE_RECONCILIATION_RECEIPTS.md；原先「尚無receipt/CAS」改以本提案狀態理解，正式產品仍未啟用。正常備份／獨立復原／parity、完整CI與hosted驗收未完成，不能將提案移入migrations後直接部署。

## 2026-11-09 可信節點列舉入口與受限路由候選

已接入 server 解析的命名R2 binding／固定Oracle S3目標，解析位於首次epoch讀取後。31項Vitest與10項Python、Worker dry-run及VM Caddy候選驗證通過，沒有套用閘道或真Oracle List。此處只提供workspace prefix，不是整桶／帳戶或完整global-node盤點。下一步仍須真實閘道／簽名／舊物件驗收、global-node來源、活動覆蓋與Owner完整預覽；不能以目前局部收據稱G2完成。詳細守門與候選證據見G2_STORAGE_NODE_LISTING.md及releases/storage-node-listing-local.json。

## 2026-11-09 近期私人讀圖阻擋已接線，仍不是活動覆蓋

proposal0071及Owner/Guest真正asset GET的共用server helper已本機驗證，35項檢查及原生D1空相簿預覽／拒絕／到期刪除通過。旗標OFF且未套用雲端。它只證明最近授權讀圖請求，沒有覆蓋metadata/original/ZIP或持續瀏覽；串流可超過保護時窗。不得由空row、到期row或功能ON推論activityEvidenceVerified。完整性、global inventory與正向planner候選仍未交付，詳見G2_ALBUM_READ_PROTECTION.md與releases/album-read-protections-local.json。

## 2026-11-09 全節點registered manifest與唯讀實體觀測

已新增bootstrap Owner限定的全node D1 reader與primary root listing內部入口，71項本機檢查及6個Python測試通過。Oracle VM只做loopback唯讀觀測，22件中6件未分類；沒有與B資料庫核對，不稱孤兒或安全刪除候選。Node與workspace scope不能互換，未知物件不忽略，global matched仍不是持久化receipt或完整活動/清理證據。Owner API/UI snapshot、global receipt、完整活動覆蓋及正向planner仍未完成，詳見G2_NODE_STORAGE_INVENTORY.md與releases/node-storage-inventory-local.json。

## 2026-11-09 primary持久global收據已本機接線

同源SQL狀態view與immutable global收據已加入未套用0070提案，真writer/current/ABA/回收失效及審計通過，35項focused驗證。Oracle收據仍被明確拒絕，current也不是活動或刪除grant；不能以本次補上primary持久證據就宣稱完整snapshot／G2完成。詳見G2_NODE_STORAGE_RECEIPTS.md及releases/node-storage-receipts-local.json；雲端未變更。

## 2026-11-09 Owner來源事實已讀取，完整planner仍待整合

D1RetentionAlbumFacts已以真schema69單一查詢取得Owner範圍的政策、獨立policyRevision、受核對human frontier、資產/版本與回收0bytes、自訂分享及既有blocker；最終6項含真D1/R2、政策ABA與分享撤銷通過。它不回傳缺少的證據布林、不提供API/UI或刪除grant，也不將目前blocker當完整workflow/reference覆蓋。下一步仍須可信活動覆蓋與缺少來源、Oracle系統物件對帳，再接同一planner的正向/失效驗證與發布；詳見G2_RETENTION_ALBUM_FACTS.md。
