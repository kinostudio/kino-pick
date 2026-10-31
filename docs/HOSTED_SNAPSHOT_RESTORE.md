# Hosted 100 張測試資料：一致備份與獨立復原

2026-10-31。僅 Cloudflare B 的合成 staging 資料。這是資料復原驗收，尚非完整 MVP 或恢復站上線。

## 實際驗收

來源 D1 cdee0ac7-bf91-4852-9c17-a996c0b84f8d 的 SQL 快照 SHA256：`9b28b895d230d6cf1ebc59706e29f0b270c8319bc8ba504f45fb985548aa2d46`。

新 D1 `bcf68fb8-0079-4c8d-b2a0-745c1aa97a26`（kino-pick-restore100-20261031）實際匯入後重新匯出：136表、2782列、726triggers、7views、56migrations的schema、逐表hash、外鍵定義及sqlite_sequence一致，FK違反0。包含100照片、版本與head、300assets、608筆審計；不是只重建空schema。

將同快照引用的300個immutable物件先完整GET至受ACL保護的本機備份，再從備份檔PUT到新私人桶 `kino-pick-restore100-20261031`。100原圖＋100縮圖＋100預覽，大小／SHA讀回全部吻合，總8,913,629bytes。保持相同object keys。原DB／原桶無寫入刪除；新桶managed public access=false、custom domains=0；未改A/DNS、Worker部署、既有Secret或產品storage node。

## 真實問題與修正

直接執行原匯出，先在本機遇到 `no such table: main.project_versioning_commands`；把tables提前後又發現部分FK需要獨立unique index，出現 `foreign key mismatch`。失敗均停於本機預檢，未動staging。

復原工具使用已安裝Wrangler的官方SQL splitter，嚴格接受這份已盤點的3807句語句，排序：PRAGMA defer_foreign_keys → 全tables → 全indexes（含unique）→ 原data/sqlite_sequence → views → 全triggers → FK check，並補齊分號。SQLite用BEGIN/COMMIT驗證；D1依[官方外鍵語意](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)用defer匯入全新DB。不修改原備份、既有migration或正常app守衛。

原備份和還原匯出normalize後SHA256相同：`6642b2163fbe11ceb4ecf2bfca018681e032ef86c98ad21aeaf5e2f42d5fbdb2`。原文順序可不同；資料、schema、sequence、FK與normalized hash均核對。

## 工具與證據

- `apps/worker/tools/rehearse-hosted-d1-restore.mjs --restore-synthetic-staging-only`：固定B與新DB；拒絕非空目標；CLI stdout/stderr完整攔截在memory，只回報白名單摘要，避免輸出signed export URL。
- `apps/worker/tools/rehearse-hosted-r2-restore.mjs --backup-restore-synthetic-only`：固定B／原桶／新drill桶與單一合成scope；先驗SQL和asset manifest，以互斥鎖限制同機操作者；沒有刪除功能。既有target key不同hash會停止。
- 真正執行使用既有隔離Wrangler XDG及B account ID；沒有建立新R2憑證。
- Git忽略且ACL保護的 `apps/worker/.local/hosted-100-backup-20261031/` 保留原SQL、normalized SQL、objects/、r2-backup-manifest.json、restore-target.json、r2-restore-target.json、restore-proof-*.json、r2-restore-proof.json、consistent-restore-proof.json。SQL含auth資料，禁止輸出／提交／共享。
- 原backup-proof.json保留匯出當時的exported_not_restored/false，不手動改值；最終組合結果以consistent-restore-proof.json為準。失敗log/JSON保留，不能當通過。
- 實際exit0日誌：worker `.local/hosted-100-d1-restore.log`、`hosted-100-r2-restore-final.log`。沒有為了本次操作者工具重跑全量app測試。

## 界線與下一步

這是同帳戶、獨立DB＋私人桶的snapshot資料復原。尚未把公開app切到恢復資源，未替新桶設定S3上傳簽名憑證；不宣稱可登入恢復站繼續上傳。演練的primary binding映射為新桶；D1 storage_nodes metadata仍保留來源桶名稱以維持逐表parity。真正cutover須同步處理native binding、storage node設定、桶專用憑證、回滾及UI/API驗收，不能只換DB。

R2工具限定此次新建私人drill桶和互斥操作者；不是既有活動桶的通用覆寫恢復服務。REST Upload API未明文保證與S3 PutObject相同的If-None-Match條件寫入；不可擴張此工具去寫原桶、客戶桶或未知既有資源。部分失敗保留物件與checkpoint，先核對journal及hash，不自動刪除／清空。

CI41162510021真實失敗：Guest瀏覽器測試worker.fetch遭UND_ERR_SOCKET拒絕且未被捕捉；4.65秒即失敗，不能當作120秒timeout的證據。修正限測試route錯誤紀錄與停止／drain／關閉順序，不重送POST、不降低assertions；新CI通過前不得報green，socket根因仍待重驗。

下一步完成CI最小修正，再接Cloudflare16MiB/登入來源的能力UI，以及Google/link/session與Guest協作／版本／推薦metadata／交付的hosted驗收。production guard、自動刪除OFF/dry-run與其他未滿足readiness保留；正式預設單R2節點不變。既有Worker仍7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47，A完全未動。

## CI helper 最小修正已實作，等待新CI

`apps/worker/tests/guest-entry-ui-browser.mjs` 現追蹤所有route tasks，捕捉dispatch/route rejection，六個情境先page.unrouteAll(wait)並drain再關context，最後以AggregateError保留失敗；沒有POST retry，也沒有忽略真正transport failure。原53個assert呼叫經AST比對逐一相同。helper node syntax／scoped ESLint／Prettier通過，兩個復原工具scoped lint/format通過；未另跑全套本機smoke，新CI尚待。這處理未捕捉Promise及teardown邊界，不宣稱底層UND_ERR_SOCKET成因已完全修好。
