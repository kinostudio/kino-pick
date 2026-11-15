# 2026-11-16 發布阻塞交接

## 從這裡接手

正式工作樹：`C:\Users\Aaron\Documents\Codex\KINO Pic\.local\album-tabs-release-20261109`。
分支：`codex/lightbox-ux-20261116`；GitHub：`kinostudio/kino-pick`。
遠端 main 最後 source：`0f976b5e45f71b6efc650efd37075ee7f33456ad`。

使用者要求三次阻塞提醒後由 Claude 接手。本輪三次 main CI 失敗，已停止新的推送與部署；本機追加的測試流程修正只保全，不當作已通過或已上線。先讀本檔、實際 Git 狀態及 docs/HANDOFF.md，不重做初始化、0070 遷移或已通過的備份復原。

## 已完成，不要重做

- B 正式 D1 `65d2286e-f2ac-4ad2-90e2-4b31e2f24251` 已採用 0070：產品 schema SHA `0c7ae219902d95f9868facc9cfb513679c825a173063a7bd74395bfef3110f95`、1221 objects、ledger70、FK0，原1217 schema objects逐項不變。0070側表尚為0 rows。
- 已備份實際 live69，真雲端獨立復原至 `kino-pick-restore70-20261116` (`fae5ec29-66de-4424-aa12-3a2a3ea24de9`)，升70後重新匯出：155張舊表／8288 rows逐表count/hash一致、integrity ok、FK0。不是live流量期間的逐表hash量測。
- 真實採用證據：`docs/releases/invite-labels-0070-adoption.json` 與既有 `production-schema-adoptions.json`。SQL、原始雲端輸出、逐表proof及即時復原書籤只在受ACL保護的 `apps/worker/.local/invite-labels-0070-20261116`，禁止貼聊天／提交Git。
- 本批分享別稱、免填客戶名、無密碼不顯示密碼欄、新連結不限使用次數、日期toggle、QR、相簿共用挑片張數、深色圖示燈箱、獨立下載多選／畫質、25張循序上傳已提交在main祖先。
- 真本機25張序列上傳與原入口／ZIP focused證據已保留，不重跑全量。後續 `album-tabs-focused.mjs` 完整exit0，含Owner建立、卡片、375px、頁籤URL/back/reload、保護／封存與容量設定；`version-approvals-browser.mjs` 完整exit0，含真D1/R2／Owner／Guest、固定版本ZIP實際解壓bytes一致、通知、撤回、非收件人隔離與OFF隱藏。
- 手機工具單次點擊曾失效：header標題隨focus由display:block變none，使工具位置重排。改visibility保留高度後，同一單次click與核准交付focused流程通過。ASTRA僅做限縮唯讀諮詢，沒有修改雲端。
- 瀑布流已移除Guest隱藏回饋原本多占的52px normal-flow高度，桌面間距12px／手機10px；觸控仍可操作。正式站幾何／hover與新UI仍未驗收，不稱已完成。

## 三次 CI 與當前阻塞

1. [43759906762](https://github.com/kinostudio/kino-pick/actions/runs/43759906762)，source `0894395`：Guest手繪測試直接點收合工具內筆刷。已補使用者展開步驟，保留鍵盤繪圖／取消／Escape；後輪已通過。
2. [43760644341](https://github.com/kinostudio/kino-pick/actions/runs/43760644341)，source `7c5a367`：Worker UI建立專案後找不到heading。已保留專案卡片連結內h3；相簿設定測試改點summary而非sr-only span。後輪已通過該建立流程。
3. [43762529732](https://github.com/kinostudio/kino-pick/actions/runs/43762529732)，source `0f976b5`：`apps/worker/tests/processing.mjs:963`，`dialog.getByRole('button',{name:'下一張',exact:true}).toBeDisabled()`找不到元素。新版停用箭頭為visibility:hidden，需先核對實際DOM／可及性契約，再決定適當的負例斷言；不可取消測試、強制click或移除版本／隔離守門。

原始失敗log在 `apps/worker/.local/ci-<runId>-failed.log`。除已列修正外，仍有舊browser helper假定「相片詳情」h2／檔名h3及所有工具直接展開。子代理正保全各helper對齊新版唯一filename h2、dialog accessible name、summary操作的候選；只過scoped lint／format／node check，不能算runtime通過。請連同 `processing.mjs` 與 `local-smoke.mjs` 的所有UI caller集中審查，避免再逐個main CI才發現同類定位失效。

暫停時已保全9個browser helper候選：`annotation-processing`、`owner-annotation-authoring`、`owner-annotations`、`owner-comments`、`owner-comparison`、`photo-version-heads`、`version-uploads`、`guest-feedback`、`guest-tags`。皆僅過scoped靜態檢查、未跑對應runtime。尚未改的明確差異為 `guest-annotations-browser.mjs` 的 `openGuestPhoto` 未展開「繪圖與註記」；Guest comments保留原版本比較路徑，Guest versions未發現版本確認面板入口，沒有擴張改寫。

## 雲端真實狀態與尚未驗收

- 正式站：`https://pick.kinostudio.tw`。B Worker仍為source `5e9540ed18382105c3ed3dfaa65995768ff9d5a8`，version `402414c8-a55e-4f30-8a1c-69117d6eb9f8`，deployment `bd454f91-77cb-4420-8dbb-9e8af7337676`（已再次唯讀核對）。本批沒有部署。
- B隔離Wrangler登入目前有效，不重問登入、不印憑證。A／FILM／DNS／Review未變；自刪OFF／dry-run、R2優先及Oracle30GB不變。獨立復原庫保留，未刪任何庫。
- 真Owner已登入IAB，僅在既有合成專案建立空白測試相簿：project `dcdde59e-2caf-4fad-beae-802618c0b01d`，album `5d812705-b704-43d2-8b1e-2bdd7eee00fe`，名稱「合成驗收・25張佇列與瀑布流・20261116」。25張五種比例的小型JPEG在工作樹 `.local/hosted-upload-20261116`，尚未上傳正式站。
- 沒有建立新Guest憑證；舊短期分享已到期。部署成功後先完成Owner驗收，再於真UI準備只限合成相簿的短期分享，按瀏覽器規則取得當下具體授權。連結／密碼只放記憶體或受保護本機檔，不進聊天或Git。
- 後續只走main精確SHA CI成功→既有auto-deploy B→postdeploy receipt→真Owner／Guest驗收，不能直接Wrangler deploy繞過。CI／部署進行時不要另推docs-only commit改變main head。
- 尚未驗：本批hosted分享、QR、Owner／Guest畫質ZIP、25張直傳與不同比例瀑布流hover／觸控幾何。既有Owner preview/original讀取缺對等下載審計的產品缺口仍保留，未在本批擴張修復。

## 給 Claude 的可貼指令

請從上述正式工作樹接手。0070備份、獨立復原、live adoption已通過，禁止重做或回退。先檢視Git本機checkpoint與三次CI，集中修正新版圖示／收合工具／隱藏停用箭頭和舊browser測試契約的差異，保留權限、版本、資料與負例斷言；必要時修真UI問題，不以削弱斷言通關。先跑受影響最小流程，再推一個完整main source讓既有CI與B自動部署接續。部署後以真Owner／Guest驗收分享、燈箱、下載畫質與25張上傳／五種比例瀑布流，保存版本和真實證據。不可更動A／Review／客戶資料，不印憑證，不重跑已通過項目。
