# G2 清理預覽的證據缺口

目前只有 deterministic planner 及部分資料來源，尚未交付可判定「可清理」的正式 snapshot。不得把以下未知欄位填成 `true`，也不得把空結果解讀成沒有保護。自動刪除維持 OFF／dry-run，不新增 Cron。

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
