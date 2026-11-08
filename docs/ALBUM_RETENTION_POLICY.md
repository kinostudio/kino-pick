# 相簿閒置清理設定（G2-01）

狀態：G2-01的D1/API/正式UI本機接線與371組整合、33組B-profile等驗證通過；詳見releases/g2-album-retention-policy-local-readiness.json。尚未有0068雲端獨立復原/adoption、完整release self-test、CI或hosted驗收，不能稱G2或完整MVP完成。以MVP_RELEASE_PLAN最新G2及HANDOFF為準。

## 使用者規則與範圍

每相簿預設90天、允許閒置清理預設OFF；天數可設定1–36500。儲存的是相簿可否列入閒置清理的偏好，不是立即刪除授權。global自刪OFF、dry-run及無Cron不變，保護／釘選、最低保留、忙碌與版本引用不能被此開關覆蓋。

G2-01只交付Owner設定持久化，沿用正式相簿設定介面。分享連結明確期限／繼承及延後清理屬G2-02；有效人類瀏覽與缺漏證據處理屬G2-03；真正候選與排除原因預覽屬G2-04。未完成者不在UI冒稱可用，設定變更不能更新有效瀏覽時間。

## API共用契約

- Owner GET `/api/v1/album-retention-policy/capabilities` → `{ enabled: boolean }`；OFF時介面不顯示新控制。
- Owner GET `/api/v1/albums/:albumId/retention-policy` → `{ albumId, revision, cleanupAllowed, inactiveDays, automaticDeletionEnabled: false, dryRun: true }`。
- Owner PUT 同一路徑，strict body `{ requestId, expectedOwnerId, expectedRevision, cleanupAllowed, inactiveDays }`，回傳同一flat DTO。UUID、boolean、整數及範圍在邊界驗證；PUT須符合Origin。
- policy獨立revision初始0，不改相簿名稱／保護共用的albums.revision。相同requestId及相同意圖必須安全重播；不同意圖與舊revision拒絕。UI不因未知回應丟失原意圖或另產生重複寫入。
- 當前enabled Owner／有效session與workspace／project／album scope為授權依據；expectedOwnerId只防止前端舊身分，不能當授權。Guest無此設定權限。保留封存內容的Owner保護能力，deleting／deleted禁止修改。

## 資料與安全

新增0068_album_retention_policy_configuration.sql，採獨立policy projection、immutable command/result與effective view；不修改舊migration、albums、既有request_commands或歷史。既有／新相簿只在新增policy表建立90/OFF/revision0預設。每次設定更新以同一交易CAS、append-only audit、精確結果見證與去重；直接偽造projection／command／audit必須拒絕。

新旗標ALBUM_RETENTION_POLICY_ENABLED預設false。B profile須在該版獨立復原／fresh-source parity、local證據、完整CI及部署守門成功後才開設定功能。此旗標不能開啟STORAGE_AUTODELETE_ENABLED、停用dry-run或加入Cron。既有相簿／workspace設定不回填改寫，未來D1 planner adapter須採各相簿已保存天數，不能把global預設強蓋個別設定。

## 必要驗證與復原

G2-02相容性盤點：既有邀請的明確到期欄位、seal及session核發在D1與多個服務共同檢查，不能只改分享表單或期限文字。後續需以新增migration及共用有效期限規則同步處理Guest交換、所有讀寫、票券及ZIP完成前驗證；舊邀請仍保留原到期語義，session仍有獨立24小時上限。禁止靠定期續期、超大日期或略過原授權來模擬無期限。nullable自訂期限／明確模式的遷移及多相簿繼承仍待下一切片定稿與獨立復原；本次0068未實作，也未改既有分享期限。

驗證既有／新相簿90/OFF、修改與重載、request replay／conflict／CAS、Owner與租戶／相簿隔離、無Cookie／Guest拒絕、Origin／範圍／terminal負例及偽造DB寫入回滾。確認資產／版本／容量／有效瀏覽／相簿revision／自刪旗標不變；窄版UI可儲存與重讀，無刪除請求。

任何live68採用之前須有適用授權的受保護fresh67備份、獨立67→68復原／升級、舊資料schema/row/sequence與FK核對、精確新增物件及預設核對、live fresh-source parity。restore-only證據不能冒充adoption／CI／hosted。

回復優先關閉新設定flag、保留policy歷史及原圖並forward fix；不以舊snapshot覆蓋新資料，不刪審計換取綠燈，不刪既有restore67測試庫。A／Review／DNS不變。
