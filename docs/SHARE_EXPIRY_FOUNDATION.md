# 分享期限繼承：本機基礎

本分支從 `3950c24` 分出，保留已驗證的0068候選，不修改其發布分支。這是G2-02的計算與遷移機制基礎，尚未新增0069正式migration、切換Guest授權、開旗標或部署。

## 計算與授權分離

`calculateShareExpiry` 區分 `custom` 與 `inherit_album`。自訂期限維持原時間；已確認關閉閒置清理時，繼承連結沒有閒置到期時間，不能因人類瀏覽追蹤尚未啟用而額外拒絕。開啟清理時才需要已驗證、合法且不在未來的活動資料，基準取建立、發布、最後有效人類瀏覽的最大值。非法mode／政策／時鐘仍拒絕計算。

`calculateGuestSessionExpiry` 保留獨立24小時上限，與有效分享截止取較早者；過期連結不得因建立session或寫入瀏覽事件而復活。`deadline` 不是存取授權；後續D1與API仍須核對Owner、租戶、專案、相簿、seal、邀請與session撤銷、獨立權限以及當前有效期限。

自訂連結仍有效時，是否只延後清理，或也延長其他繼承連結的存取，目前已提出一次產品選項問題、待答覆。基礎計算不擅自讓其他連結恢復存取。

## 真實本機D1機制測試

`apps/worker/tests/invite-expiry-rebuild-probe.mjs` 先套既有0016、透過當時合法流程建立合成邀請與session，再升至0068。測試於單一D1 batch使用延期外鍵檢查、暫存舊列、以原表名重建nullable期限／明確mode、複製舊欄位並還原原index／trigger。不重新命名原表，避免SQLite將其他表／view的參照改向暫存名稱。

全體既有產品表的舊欄位資料、其他schema、session及外鍵須不變；另外於DDL後注入可識別的執行期NOT NULL失敗，驗證資料與schema整批回滾。內部 `_cf_*` metadata 不讀取，首次探測誤納此內部表而被D1拒絕的log保留。僅當全部入站刪除行為為NO ACTION時接受此路徑；CASCADE／RESTRICT／SET NULL等需另行設計，不能只因可延期外鍵就套用。

這不是正式0069或雲端復原證據。後續需從實際0068 schema產出完整migration，保留舊邀請的自訂期限語義、原row值、所有歷史與sequence；統一替換全部期限讀寫守門，並在獨立復原、fresh-source parity、CI與真Owner／Guest驗收通過後才啟用。不可用超大日期、偷偷續期或略過expiry來替代。

官方依據：[Cloudflare D1外鍵與交易](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[SQLite DROP TABLE的外鍵動作](https://www.sqlite.org/lang_droptable.html)。機制是否適用仍以本地D1實跑及下一版獨立復原為準。

## 下一個正式切片

新增0069時以當前有效schema為準，不能修改0016等舊migration。舊列mode預設`custom`並保留原期限，新`inherit_album`才允許NULL。共用有效期限view可集中計算；所有服務與現有trigger/view須一起改用該規則，不能只替換UI文字。view不得因缺scope／壞policy而產生合法NULL，也不能要求seal已存在才計算期限，否則核發seal會循環依賴。Owner核發的NEW row守門、seal、Guest交換、session核發及串流完成前檢查要分別驗證。

Guest session的無期限分支只能取`now+24h`，不能使用`min(NULL, now+24h)`或超大日期。已過期的繼承連結不得先寫瀏覽時間再通過期限檢查。正式回應要區分mode與nullable截止；Owner的邀請資格篩選及Guest期限文字均需一起改。獨立復原要精確核對唯一允許的表／guard變更及全部舊欄位資料、FK、sequence，不得把舊schema比對整體放寬。

本機重跑：`pnpm exec vitest run tests/unit/share-expiry.test.ts`；`node apps/worker/tests/invite-expiry-rebuild-probe.mjs`。後者僅使用合成資料及0016→0068基線，不是已可部署的0069。
