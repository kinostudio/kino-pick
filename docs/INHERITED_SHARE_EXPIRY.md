# 繼承相簿期限：0069 候選

這份文件描述本機候選，不代表 B 已遷移或啟用。目前 B 保持 schema67；0068／0069 的雲端復原、parity、CI 與 hosted 驗收仍需完成。`INHERITED_SHARE_ISSUANCE_ENABLED` 預設 OFF，自動刪除也保持 OFF／dry-run。

## 對使用者的規則

- **自訂分享期限：** 每份連結照自己的截止時間到期。尚未到期的自訂連結只保護相簿免於清理，不延長其他連結。
- **依相簿設定：** 相簿未開啟閒置清理時，沒有閒置到期日；開啟後，以建立、發布及已驗證有效人類瀏覽中的最新時間，加上相簿天數（預設90天）。
- **已到期的舊連結不恢復：** 後來的新瀏覽、延長天數或關閉清理，只能供仍有效的連結或重新發行的新連結使用。
- 同一份邀請可包含最多24本相簿，逐本決定能否存取。A到期不影響仍有效的B，也不能從B繞回A。
- Guest session 有獨立24小時上限。多本相簿取仍有效範圍的最晚截止；任一本有效相簿無閒置期限時，上限仍是24小時。每次操作重新驗目標相簿。

## 資料與守門

`guest_invites` 保留原欄位與舊自訂期限，新增 `expiry_mode`。舊列預設 `custom`；只有明確 `inherit_album` 可讓原始截止為 NULL。`guest_invite_albums.inherit_generation` 記錄封存時的相簿存取世代，封存後不能修改。

`album_inherited_share_transitions` 是 append-only 的衍生狀態歷史，連到實際 human／policy／activation／issuance 原因；`album_inherited_share_states` 是受該歷史守門的投影。世代只增不減，達2147483647後再需輪替時進入永久 `exhausted`，不得環繞或重設來恢復舊 bearer。

仍有效時的正常活動可在原世代延長截止。舊有限期限已到、或政策使它立即關閉／不可判定時，輪替世代；舊邀請仍綁舊世代。狀態的輸入指紋比對目前權威資料，不綁在邀請上，避免一次正常瀏覽就使現有邀請失效。OFF不依賴瀏覽追蹤資料，但仍須有有效的相簿政策。

狀態更新附在原 human、policy、activation trigger 主體末端，與來源寫入同一交易，不依靠多個 AFTER trigger 的執行順序。首次核發也會先調和狀態，再確認所有選取相簿均有效，最後綁定世代及 seal；任一本失敗會整批拒絕，不偷偷省略。沒有狀態變更時不多寫衍生歷史，原始操作審計照常保留。

`effective_guest_invite_album_expiry` 只回答某邀請、租戶、專案、相簿的期限是否有效。它刻意不要求 seal，因為 seal 的寫入本身要查它；它也不能取代各服務原有的 Owner、session、撤銷、生命週期、獨立權限及 IO 後再授權檢查。交換／KDF只取有效且使用中的相簿；資源讀寫和歷史每列仍逐相簿檢查。

建立時間作為權威基準後，0069拒絕修改 `albums.created_at`，也拒絕用 REPLACE 換掉既有相簿。有效瀏覽的正式寫入原本就使用同一SQL的資料庫時間；0069另拒絕直接插入未來的瀏覽時間，避免把原本有效世代誤關閉。缺政策、壞投影或未知證據都不能當作合法的無期限。

正確的授權期限不等於可以刪資料。這些正向時間戳並未證明持續追蹤覆蓋、容量對帳、沒有進行中作業或版本引用；清理 planner 仍須取得各自完整證據。分享保護摘要只計算有效 custom 截止，不把繼承截止再餵回自己造成循環延期。

## Migration 與復原

0069從實際schema68重建 `guest_invites` 的nullable欄位，明列舊欄位複製、還原原index／未變trigger，舊資料不重新發行 token、密碼或session。所有入站FK須維持NO ACTION並在同批延後核對。測試須比較全部舊表的舊欄位、schema、sequence、FK與原session，並在DDL後注入實際NOT NULL故障來證明整批回滾；不能只證明語法解析失敗。

部署順序是該版受保護備份、獨立復原／升級、fresh-source parity、正式遷移、完整release self-test／CI，再自動B與真Owner／Guest。不能拿0067或機制probe冒充0069證據，也不能把舊備份覆寫有新寫入的live。尚待答覆的具名0068授權不自動涵蓋新增0069敏感備份或刪庫。

復原先關閉新邀請發行旗標，保留所有世代、歷史、原圖與版本，再forward fix。該旗標只停止發行，不是既有Guest的撤銷機制；若需停止特定既有存取，使用原本的邀請／session撤銷。不要刪欄、重設世代或把NULL改成超大日期。全域自動刪除保持OFF。

## 驗證邊界

- `inherited-share-state-sql.test.ts` 使用實際migration SQL的隔離模型，包含世代耗盡等無法自然執行數十億次的歷史狀態；不是產品API或hosted證據。
- `inherited-share-expiry-focused.mjs` 使用全新本機D1與合成歷史資料驗證實際migration、回滾與舊列保留；真Worker API案例另行明列結果。
- `inherited-share-core.test.ts`、`inherited-share-contract.test.ts`、`inherited-share-config.test.ts` 不能取代真實D1、OAuth或Hosted驗收。
- 相簿期限查詢必須按指定scope索引查找；查詢計畫不應因每次Guest讀取而掃描所有相簿。這不等於hosted負載／CPU或實機效能已通過。
