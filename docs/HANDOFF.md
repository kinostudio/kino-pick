## 2026-11-14 Claude：負載測試耗盡 D1 免費每日讀取額度，正式站暫停到 UTC 00:00

我在正式站跑的 3 分鐘 Owner 唯讀負載（6 併發，4,863 次，全部 200）使 D1 當日 rows read 達約 9,656 萬（免費方案每日上限 500 萬），之後所有讀資料列的查詢回 D1_ERROR，API 503 SERVICE_NOT_READY；`SELECT 1` 仍可用，資料未受損。D1 查詢統計顯示主因是保留期限試算的相簿查詢：每次約 7.7 萬列（每本相簿各跑三次 photo_assets 子查詢，並對每本相簿重新展開全域 manual_album_deletion_blockers 檢視）。

修正：`retentionPreview` 改為單一 CTE，每個工作區只計算一次大小、刪除阻擋（檢視只算本工作區相簿、MATERIALIZED）、有效自訂連結與最後瀏覽；本機 68 份 migration 的 SQLite 兩工作區合成資料比對新舊查詢結果相同（僅阻擋原因串接順序不同，程式以集合判斷）。無 schema 變更。

狀態：額度在 UTC 00:00（台灣 08:00）重置；升級 Workers Paid 可立即恢復，需使用者操作。重置前預檢會讀 D1 而失敗，不會部署。重置後要做：確認新版部署、量測試算 API 的 rows read、查看並撤銷 Guest 負載測試時可能殘留的測試邀請（建立時正逢故障，回應未取得 inviteId）。教訓：免費方案下任何正式站負載測試都要先估算 rows read。

## 2026-11-14 Claude：發布守門恢復；Google 部署流程已併入，憑證尚未設定

經使用者同意，正式站先切回已有收據且程式碼相同的 3da46424（deployment 3d222fbf），解除 RELEASE_PRIOR_BASELINE。之後 main ee0cef1（併入 codex/google-production-20261114 的 a2e60d8：部署時以 --secrets-file 一併安裝 Google 憑證）CI、自動部署、部署後檢查與收據寫回全部成功，Worker 26b4f5c6。

正式 Worker 的密鑰仍是原本 8 個，沒有 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET，表示 GitHub Actions Secrets 尚未設定（代理不允許我讀寫 Actions Secrets）。待使用者在 Google Cloud Console 建立 Web OAuth 用戶端（已授權來源 https://pick.kinostudio.tw，重新導向 URI https://pick.kinostudio.tw/api/auth/callback/google），並在 GitHub 倉庫 Settings → Secrets and variables → Actions 新增這兩個 Secret 後，重跑 main 的部署，再由 Owner 帳號頁明確綁定 Google 並驗收登入。d8829a4 的 CI 失敗是 Guest 註記燈箱縮圖列 hover 透明度時序（0.62≠1），同一套件在前後提交皆通過，視為偶發，未改測試。

## 2026-11-14 Claude：0213da9 部署後檢查撞上讀取延遲；下一次部署被守門擋下（待使用者決定）

0213da9 已上傳並 100% 部署（Worker 62f06f3e，程式碼與已有收據的 3da46424／6891190 相同，期間只改文件與發布工具）。部署後檢查在上傳 0.5 秒後讀版本，Cloudflare 回 404，因此沒寫收據；事後同一組 API 全部可讀。重跑時預檢正確擋下（RELEASE_PRIOR_BASELINE：線上版本沒有收據）。正式站功能不受影響。

本次修正：`readWorker` 讀部署清單與版本時，只對 404 最多重試 5 次、每次間隔 3 秒，其他守門不變。

恢復方式（兩者擇一，需要使用者同意）：(1) 把正式站切回已有收據的 3da46424（程式碼相同），之後正常 CI→自動部署；(2) 依已核對的線上狀態補寫 62f06f3e 的收據。自動模式拒絕我直接做 (1)，未改動。

## 2026-11-14 Claude：發布守門接受「只新增 Google 密鑰」的 Worker 版本

安裝 Google OAuth 密鑰會產生一個程式碼相同的新 Worker 版本，原守門要求線上版本等於上次收據，會擋下之後的部署。`secretOnlyChild` 只在 Cloudflare 標記為 secret 觸發、script etag／runtime／所有非密鑰綁定與上次收據版本完全相同、沒有移除任何密鑰、新增的只有 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET` 時，才把該版本視為上次基準。新增 tools/secret-only-child.test.mjs 並納入 CI。Google 登入本身仍待使用者在 Google Cloud Console 建立憑證。

## 2026-11-14 Claude：G3 正式站補驗與 0068 守門上線

- 82e4e4a 已部署：預檢／部署後檢查依 production-schema-adoptions.json 接受線上 68 份帳本與 schema 95d7…。staging 發布檢查器的歷史 67 收據改只比對前 67 份帳本，協作檢查名稱跟著採用數。
- G2-01／02 正式站驗證：設定頁儲存相簿保留設定（30 天、清理意向）、舊修訂 409、天數 400、他人相簿 404、稽核寫入；繼承期限邀請不保留相簿，自訂期限邀請產生「保留請求」，撤銷後消失；模式不可改 409。
- G3 正式站補驗：A03 自訂密碼與節流（錯 5 次後正確密碼也被拒）、A08 上限 1 與三路併發只成功 1、A10 活動紀錄前後值、A11 同 requestId 只寫一筆、A12 重開輪次保留快照、V07 三種比較模式、SEC02 匿名 401、SEC03 bundle 無密鑰；邀請 B／C／D 均已撤銷。證據 docs/releases/g3-hosted-acceptance-20261114.json。
- Owner 歷史補上新動作的標籤與前後值投影。未涵蓋：Google 登入、OTP 入口、正式站 1000+ 張、壓力清理、實機與負載。

## 2026-11-14 Claude：G2-01～G2-04 完成；正式 D1 採用 0068

- G2-03：有效人類瀏覽在正式站開啟（`HUMAN_VIEW_TRACKING_ENABLED` 納入正式執行期組合與發布必備功能；staging 仍限本機）。28381da 已部署，正式站實測心跳 `recorded:true`、5 分鐘內重送去重、試算預覽「最後有效瀏覽」有值。
- G2-01：每本相簿的閒置天數（預設 90，7–3650）與清理意向（預設 OFF）；`GET/PUT /api/v1/albums/:albumId/retention-settings`，修訂號 CAS、同 requestId 重播、修訂稽核 `album.retention_settings_changed`、不可刪除。設定頁「各相簿保留設定」可編輯；全站自動清理仍 OFF。
- G2-02：邀請期限模式 `custom`／`inherit`；表單「期限跟隨相簿保留設定」把到期設為 364 天並在建立後記錄 inherit（`POST /api/v1/invites/:inviteId/expiry-mode`，寫入後不可改）。未記錄或舊邀請一律視為自訂；有效的自訂期限連結讓相簿以「保留請求」排除，繼承連結不阻擋。
- G2-04：保護／最低保留／忙碌／引用／有效自訂連結的排除原因皆在 dry-run 預覽列出；預覽預設依各相簿天數分組規劃，可暫時統一天數覆寫。
- 0068（只新增 2 表＋4 觸發器）經使用者明確同意，於 2026-11-14T00:08:55Z 套用到正式 D1：套用前 schema 等於切換基準 236e…，套用後 95d7a0e0…（1209 物件）與本機演練一致，帳本 68、FK 0。套用前還原點 Time Travel 00000236-00000002-00005123-58ed37c0…（00:08:00Z）。工具在套用後重算逐表資料雜湊時逾時，該實測結果遺失，未宣稱；資料不變以 DDL 結構論證。紀錄見 docs/releases/production-schema-adoptions.json。
- 發布守門：`tools/production-schema-adoptions.mjs` 讓 67 份切換基準之後的 migration 必須有採用紀錄（檔案雜湊、前後 schema 雜湊鏈、還原點、FK 0、帳本），預期線上 schema 取最後一筆的套用後雜湊；staging 發布檢查器的 67 改為「67＋已採用數」。

## 2026-11-14 Claude：G5 最終全流程簽核通過（同一正式版本）

正式站 pick.kinostudio.tw，來源 1bf0b2f／Worker 44a406ea（部署後基準 00cf20e 由工作流程自動寫回）。合成資料完整跑過 Owner 上傳 4 張（27 秒、無重試）→系統密碼邀請 INV-B50FB599（12 項權限、送出前守門核對到期）→Guest 錯誤密碼不能進入、正確可進入→挑片／評分／收藏／標籤／留言／點註記→提交鎖定→Owner 匯出三種格式、讀留言與註記並標已處理→P1 V2 上傳並切為目前版本（V1 註記不出現在 V2）→固定版本確認→只交付給該邀請→雙方通知→單檔與 ZIP 的 SHA 皆等於 V2 原檔→撤銷後原 Guest 工作階段立即 401。跨相簿讀取皆 401。證據：docs/releases/g5-final-hosted-acceptance-20261114.json。連結與密碼只在瀏覽器記憶體使用，用後清除。

未涵蓋：Google 登入（未設定）、實機手機、負載；G2-01～04 持久化需 0068 與正式 D1 備份／復原／parity，依使用者「進階清理延後」指示未做。自動刪除 OFF／dry-run。

## 2026-11-14 Claude：Cron 改每 10 分鐘；當日觀察紀錄一天只寫一次（待 CI／部署）

使用者決定保留 production Cron 並降頻。`apps/worker/wrangler.jsonc` staging／production 的 crons 由 `*/5` 改為 `*/10`，`tools/check-production-bootstrap.mjs`、`check-production-release.mjs` 與其測試的預期排程同步改為 `*/10 * * * *`（predeploy 對已有發布版本不檢查舊排程，故不會卡部署）。`scheduled()` 的 `retention.dry_run_observed`：先以 per-DB（WeakMap）記住當日已觀察，再 `SELECT … LIMIT 1` 讀取，只有當日尚無事件時才 INSERT；Cron 其餘工作（過期預留清掃、Guest bucket 清理、縮圖處理）不變，自動刪除仍 OFF。本機缺 typescript，無法跑單元測試，交由 CI 驗證。

## G2 保留期限試算（dry-run）API

- 新增 `GET /api/v1/workspaces/:workspaceId/retention-preview?idleDays=`（僅 Owner、僅唯讀；idleDays 7–3650，預設 90）。
- 回傳 dryRun 計畫與候選相簿清單，autoCleanup 恆為 off；不刪除、不排程、不寫入、無 migration。
- 邊界白名單僅允許 GET 與 `idleDays` 查詢參數；已補單元測試。
- 76d1b5a 已部署（version b627e871）。正式站實測：預設 90 天 7 本相簿 0 候選、7 天 1 候選、idleDays=3 回 400、他人工作區與 POST 回 404。部署途中推送新提交導致基準寫回被守門擋下，經使用者明確允許，從 run 43522402227 日誌的已驗收據按原格式補寫 production-prior-deployment.json（e1acf5a）。
- 修正：已用量改讀 workspace_storage_usage 帳本（手動刪除會扣減），相簿位元組排除已 reclaimed 的資產；帳本偏差改回 503；路由拒絕 idleDays 以外參數。Owner 設定頁新增「保留期限試算」面板（只試算、自動清理關閉）。
- 待續：G2-01~04（需 migration 0068 與備份／復原／parity）。

## 2026-11-14 Claude：部署後 20 小時核對（R2 回落、無路由錯誤）與 MVP 缺口盤點

證據（B，唯讀）：

- R2 `kino-pick-production` 指標 2026-11-13T21:10Z：payload 9,952,356 bytes／646 物件，刪除 100 張相簿（回收 3,725,359 bytes）前為 13,677,715，與預期約 9.95 MB 相符。
- B Workers Logs 部署後約 20 小時：無任何 `KINO_UNHANDLED_ROUTE_ERROR`（含 D1／UNCLASSIFIED），故 `CAUSE_D1_ERROR` 分類尚無實例可看；回應狀態 200×276、401×1、404×7，無 5xx。Guest 初載 503（HANDOFF 先前 TASKS 第 9／19 行）歷次證據指向 1102 CPU 超限與 D1 十秒限流，兩者的修正均已部署，但仍屬「近 20 小時低流量」證據，未做負載重測。
- 觀察：production 實際有 `*/5 * * * *` Cron（wrangler.jsonc production.triggers），近 20 小時 242 次；每次做完整 `expireDueReservations`（UPDATE upload_sessions，平均約 350ms）、Guest bucket 清理、縮圖處理與當日 `retention.dry_run_observed` 寫入（INSERT…WHERE NOT EXISTS，平均約 370ms、讀 2 列）。只觀察不刪除；MVP 計畫的「無 Cron」基線敘述與實際部署不符，需使用者確認是否保留。若要降 D1 負載，可讓當日觀察事件只在 UTC 日期變更後第一次寫入。

MVP 缺口（TASKS.md 未勾選）：G2-01 相簿閒置天數可調（預設 90、清理 OFF）、G2-02 分享期限繼承／自訂、G2-03 有效人類瀏覽、G2-04 保護／最低保留／dry-run 候選預覽；G3 TEST_ACCEPTANCE 剩餘；G4 production 獨立資源／資料搬移與復原／pick.kinostudio.tw 切換；G5 同版本 Owner→Guest 全流程簽核。G2 需要新 migration，必須依規則先做備份、獨立復原與 parity；Google 正式 OAuth 未設定（GitHub 已滿足任一來源）。MVP 未完成，不宣告。

## 2026-11-13 Claude：D1 減載修正已部署（main c0d776c）；100 張測試相簿已由 Owner 正式流程刪除

倉庫改為公開後 GitHub Actions 不再受分鐘額度阻擋：main c0d776c CI 43331840791 success、自動部署 43335825121 success（含 939f3ad D1 減載、租約過期重試、上傳佇列暫停）。部署後正式站瀏覽器連續 10 次 `/api/v1/me` 全為 200。

善後：082 處理工作已非 running，刪除預覽 blockers 為空；INV-BBD6A1F6 先前已撤銷（revokedAt 2026-11-12T17:39Z）。使用者明確同意後，以 Owner 手動刪除（DELETE /api/v1/albums/:id，confirmPermanent）＋ `/deletion/retry` 推進：300 資產／100 照片，3,725,359 bytes 全數回收，failed 0。重試途中遇 1 次 503（D1 十秒窗口），退避後續跑成功；刪除可續跑不重複。R2 用量指標為 5～10 分鐘快照（23:10Z＝13.68 MB，刪除前），預期刪後約 9.95 MB，待下次指標核對。自動刪除仍 OFF／dry-run；A 未動。

未完成：以 B Workers Logs 確認 `CAUSE_D1_ERROR` 分類出現；邀請到期行為檢查；最終證據文件。倉庫目前為公開（歷史含 film.kinostudio@gmail.com 等，使用者已知並接受）；部署完成後使用者可自行改回私人，之後 Actions 額度會再受限。

## 2026-11-13 Claude：降低 D1 限流的請求路徑負載（待 CI／部署）

B D1 查詢統計（11/12 13:00–18:00Z）：上傳各步驟呼叫的過期預留清掃 371 次、合計 139 秒，約佔資料庫時間四分之三；已完成的上傳仍為 status='reserved'，所以每次都重掃全部歷史。攝影師推薦的觸發器存在檢查 180 次、讀 26.6 萬列，因服務每請求重建、原本的 schemaProbe 從未跨請求重用。`/me` 的 47 次 UNCLASSIFIED 與 RESOURCE_LIMIT 同秒出現，耗時 4–5ms；判斷為 BetterAuth 透過 drizzle 包住的 D1 限流錯誤（已由 28889e4 診斷 cause 改善，部署後以日誌確認）。

本次修改：

- `schema-readiness.ts`：攝影師推薦、照片釘選、相簿啟用的 schema／觸發器檢查，每個 D1 binding 只記住成功結果；缺少物件時不快取，套用新遷移後仍會被偵測到。
- `expireRecentReservations`：上傳請求路徑只清最近 1 小時內到期的預留，每個執行副本每 10 分鐘（或時鐘倒退時）仍做一次完整清掃；Cron 路徑維持原本的完整 `expireDueReservations`（含 R2 fence）。代價：更早漏掉的過期預留在下次完整清掃才釋放額度。
- 上傳佇列：某張以「等待重試」結束且後面仍有待上傳照片時，暫停 10 秒（涵蓋 D1 十秒窗口）；連續 3 張暫時失敗即停止，其餘保留為待上傳，可再按開始上傳。最後一張不暫停，不佔用重試操作鎖。
- `/me` 重試在 5cc833a 已改為 2s＋9s，未再變動。

本機只以 Node 實跑抽出的快取與清掃時間窗邏輯；完整型別、單元與瀏覽器測試待 GitHub Actions 額度恢復後由 CI 驗證，CI 未過不部署。

## 2026-11-13 Claude：B Workers Logs 證實 1102 為 exceededCpu 且已消失；/me 剩餘 503 非 D1

使用者已將 A 登入加為 B（Kinoaaron2026，d3e930465c0df7e89b35de3ca65ea36a）成員並重連 Cloudflare API 連接器；本次只做唯讀查詢。B Worker：kino-pick-production、kino-pic-staging，usage model standard（方案 API 403 無法讀）。

B 遙測 13:00–17:55Z（1,848 事件）：部署 f912444 前 `exceededCpu` 73 次、部署後 0 次；全體 CPU p50／p90 由 8／30ms 降為 5／22ms。各路由 CPU（全時段）：complete p50 46／p90 87ms（未見超限）、init 15／33、authorize 17／41、/me 5／10。

剩餘 503 分類：init 6、authorize 5、/me 1 為 `D1_ERROR/RESOURCE_LIMIT`（D1 十秒窗口限流），耗時 0.6–2s；/me 47 次為 `UNCLASSIFIED`（部署後仍 14 次），每次僅 4–5ms wall／2ms CPU，未完成任何 D1 往返，故不是 D1 限流，而是查詢前就丟出的程式錯誤。原診斷只記第一行分類，無法再細分。

本 commit 補診斷：記錄錯誤類別名稱 `errorClass`（僅接受英數識別字，否則 Unknown）與 `causeClass`，並沿 `cause` 最多 3 層辨識被函式庫包住的 D1 錯誤（`CAUSE_D1_ERROR/...`）；錯誤訊息內容仍一律不記錄。下次部署後以同查詢讀 B 日誌，即可定位 /me 錯誤來源。前端 /me 退避重試（81a693d）可先降低使用者可見影響。

部署仍因 GitHub Actions 帳單／額度阻擋；main 最新 commit 帳單恢復後會跑 CI 並一次部署 3f6e941 之後所有修正。

## 2026-11-13 Claude：B Workers Logs 證實 1102＝CPU 超限且已消失；剩餘 503＝D1 10 秒窗口限流

使用者以 A 登入加入 B 帳號成員（使用者確認接受完整角色），Cloudflare API 連接器重新授權後可同時讀 A／B。僅唯讀查詢。B Worker：kino-pick-production（最後部署 2026-11-12T16:03Z＝f912444）與 kino-pic-staging；usage_model standard。

B Observability（kino-pick-production）：部署前 3 小時 1,453 請求中 `exceededCpu` 73 次（即 1102，不是記憶體）；部署後 0 次。CPU 中位數／p90：init 14／28ms→8／10ms，authorize 17／43ms→8／10ms，/me 5／10ms→3／5ms，complete 34／94ms→10／54ms（含 waitUntil 背景處理，仍偶有超過 10ms，未觸發 exceededCpu）。

部署後剩餘 app 層 503：`KINO_UNHANDLED_ROUTE_ERROR` 中 init／authorize 為 `D1_ERROR/RESOURCE_LIMIT`（Too many resources consumed within a 10 second window），/me 為 `UNCLASSIFIED` 14 次；14 次全部與 D1 限流同秒（16:06:31–36Z，第 5 批 UI 預設速度開始時），推定為 BetterAuth 包裝後的同一 D1 限流。查證非全表掃描：邊界 `audit_events` project.deleted 檢查使用 `audit_owner_history_action_time`，rows_read 5；audit_events 1,704、request_commands 13、upload_requests 221。故 /me 退避重試改為 2s／9s（共 11 秒，跨過 10 秒窗口）。

082 處理工作已 succeeded（attempt 2），刪除阻擋 `DELETE_CONTENT_BUSY` 解除；僅剩有效邀請 INV-BBD6A1F6。

## 2026-11-13 Claude：1102 修正已部署並實測消失；100 張完成；兩項修正因 GitHub Actions 帳單無法部署

使用者授權觸發部署後，main f912444（含 1836848 設定／BetterAuth 每 isolate 重用、a0476c2 手機側欄、4ba92a4 縮圖重載）CI 43249778259 success、自動部署 43254412306 success。部署後同一相簿實測：部署前 `init` 以 30 秒單筆節奏 17/17 皆 1102；部署後 UI 預設速度一批 20 張共 121 個請求 **0 次 1102**，init 3/3、20/20 成功。剩餘失敗改為 app 層 503 `SERVICE_NOT_READY` 18/121（/me 14、init 2、authorize 2），多為 D1 暫時錯誤（分類需 B Workers Logs）。前端每張上傳約 5 次 /me（20 張 104 次）。

100 張批次完成：Owner API 分頁 24／24／24／24／4＝100，檔名 100 唯一，99 張縮圖 succeeded。077 原預留逾時，authorize 正確回 409 INVALID_STATE_TRANSITION，取消後逾期，重新上傳成功。082 縮圖卡在 running（背景處理中斷、租約過期）。手機 375 正式站：studio 側欄收合 80px、main 141px（原 453px），「切換工作台選單」展開 6 連結、收合正常、無水平溢出。

G2 手動刪除唯讀預覽（GET /api/v1/albums/02591aa3…/deletion）：100 照片／100 版本／298 資產／3,708,553 bytes，blockers `DELETE_CONTENT_BUSY`（082 running）與 `DELETE_ACTIVE_REVIEW`（INV-BBD6A1F6 有效），保護正確；尚未刪除。

已通過 CI 但**未部署**（3f6e941，CI 43258333489 success）：

- 81a693d：上傳身分讀取 /me 遇 502/503/504 或網路錯誤時退避重試最多 3 次（600ms／1800ms），非暫時錯誤與已中止請求不重試；處理上述 14/18 失敗。
- 540062e：租約過期的 running 處理工作，Owner 圖庫顯示為 retryable，「重試縮圖」可重新領取；原 claim CAS 以 D1 時間再驗租約，3 次上限、節點、recipe、封存守門不變。沒有 Cron 時，被中斷的處理原本會永遠卡住並阻擋相簿刪除。
- 3f6e941：測試 fixture 補 role、還原 repo prettier 3.9.10 的聯集型別排版（本機 3.8.1 會改寫）。

自動部署 43263049330 未啟動：GitHub 回覆 account payments failed／spending limit。需使用者處理 kinostudio 的 Billing & plans 後重跑該 run（或 deploy-production 以 source_sha 3f6e941）。部署後依序：082 重試縮圖 → 撤銷 INV-BBD6A1F6 → 以正式 UI 刪除 100 張相簿 → 核對 R2 已存回到約 9.95 MB（上傳前）。自刪 OFF／dry-run，A 未動。

## 2026-11-12 Claude：正式站 Cloudflare 1102（Worker 資源超限）定位＋設定／BetterAuth 每 isolate 重用（待合併部署）

批次上傳 100 張合成圖（相簿「合成相簿・100張批次 2026-11-12」02591aa3…）到 76 張後無法繼續：`POST /api/v1/uploads/init` 以 30 秒單筆節奏連續 17 次失敗，回應本體為 Cloudflare **error 1102（Worker exceeded resource limits）**，不是 B app 的 `SERVICE_NOT_READY`，也不是 D1 錯誤。同時段 `/api/v1/me` 23/23 成功。cf-ray 例：init a5962dbf9af270ae、整段全站 503（含 health）14:13:46–14:15:19Z a596240a2ec72f44／a59624ceef192f44。A gateway 遙測 13:07–14:20Z：/me 490 次 503=54、init 96 次 503=20、authorize 87 次 503=12、complete 150 次 503=0。邀請建立 POST 也出現 1102，其中一次在 D1 寫入後才中斷：一次性連結遺失、同 requestId 重試正確回傳既有 INV-34FD249F 而未重複建立（已撤銷，登入 0 次）。

推定根因（未取得 B Workers Logs 的 cpuTime／outcome，尚未證實）：B 為 Workers Free（D1 名額 10 = Free 上限，每請求 10ms CPU）。每個 `/api/v1/*` 請求都重建 BetterAuth 實例，且 `configuration(env)` 每次呼叫都重建約 60 欄 Zod schema；上傳請求的 `uploads(c)` 經 capability 鏈呼叫 `configuration` 十幾到二十次（/me 僅一兩次），與 init 失敗率差異一致。complete 同樣使用此工廠卻 0 失敗，這點仍未解釋。

修正 1836848（fix/upload-thumb-resilience，CI 43237689600 success）：`memoizeByEnv` 以 env 物件為鍵、指紋含所有字串設定與 binding 身分，任一變動即重算，驗證失敗不快取；套用於 `configuration` 與 `createAuth`。新增 tests/unit/env-memoization.test.ts。行為與權限檢查不變。同分支另含 a0476c2（手機 760px 以下 studio 側欄收合；原本展開 nav 把主內容推到 453px）。

部署後要驗：同一相簿以原 UI 續傳剩餘 4＋20 張，統計 1102 次數；若仍出現，向 B Workers Logs 以上述 cf-ray 查 outcome（exceededCpu／exceededMemory）與 cpuTimeMs。若仍超限，最直接的處置是 B 升級 Workers Paid（使用者決定，涉費用）。075／076 兩張縮圖卡在處理中（R2 待處理預留 33.57 MB＝2×16MiB），部署後以 Owner「重試縮圖」處理。

本輪其他實測：

- Guest 手機 375×812（INV-BBD6A1F6，無密碼，僅查看＋挑片，2026-11-13T14:35Z 到期，保留供部署後重測）：fragment token 進入後清除、無水平溢出、分頁 24／24／24／4＝76、最後一頁下一頁停用、燈箱 362×799 上下張／關閉可用、燈箱內只有挑片控制、挑片 PUT 200 並同步格狀勾選。縮圖伺服器回 200 image/jpeg（約 4KB）；畫面未顯示是視窗被遮住時 lazy 圖不觸發，非產品問題。
- 草稿相簿分享按鈕正確停用；啟用後才可分享。
- 容量面板：R2 已存 12.77 MB／9 GB（上傳前 9.95 MB），Oracle 0.07 MB／30 GB，自刪 OFF／dry-run 未動。
- Google 登入：正式站 `configured:false`；GitHub 已設定且綁定。規格第 1 項為「任一或雙來源」，GitHub 已滿足；Google 綁定／解綁未驗。

未完成：100 張（目前 76）、G2 手動刪除與釋放容量核對（等 1102 修正後再做，避免中途中斷）、邀請到期行為、hosted 負載。

## 2026-11-12 Claude：正式站 MVP 協作流程首次完整驗收（合成資料）＋前端暫時性失敗修正

正式站 pick.kinostudio.tw（B version 14d4ee50，source f664b52）以合成專案「合成照片・MVP 協作驗收 2026-11-12」（96ae0b00…）／相簿 06346b36… 跑完一輪真實協作，Owner 為既有 GitHub 帳號。6 張合成 JPEG 經正式上傳介面完成（4 張首次失敗後手動重試成功，見下），Owner 私人圖庫 6 張 320×213 縮圖正常。無密碼邀請 A INV-D359C7A5（12 項權限）：Guest 選 P1/P2、P1 5 星＋收藏、P2 4 星，P1 V1 留言與點標記，送出挑片後 Owner 看到第 1 輪鎖定快照並可匯出 CSV／Lightroom／JSON。Owner 為 P1 上傳 V2（第一次 complete 409 為既有設計的預先檢查，非錯誤）、切為目前版本、對邀請 A 建固定確認請求；Guest 開指定 V2 預覽後確認；Owner 只交付給邀請 A。Guest 收到「有新的成品已發布」通知；ZIP 僅含 001-v2-a9880e47-KINO_MVP_20261112_P1.jpg，54,695 bytes、CRC 正確、SHA-256 2b1d71b46cec77b86ee42e2215d61d02416c6d04914ccd90157ba2dad37c2b8b，與上傳的 V2 原檔一致；單張「下載成品」同 SHA。ZIP 只在頁面記憶體解析，未寫入使用者電腦。Owner 端可依邀請／版本讀到客戶 A 的 V1 留言與點註記，並把留言標為已處理。

隔離與撤銷：Guest A 讀其他相簿 613487da 的 access／photos／deliveries 皆 401 GUEST_ACCESS_REQUIRED；無 Cookie 時 Guest API 與 Owner API 皆 401。邀請 C INV-9703B554（只查看＋留言）讀 P1 V1／V2 留言皆 0 筆，未洩漏 A 的留言；評星、下載原圖、送出挑片皆 401；重放 A 的交付下載與 ZIP 連結皆 401；介面無下載連結、無送出挑片、交付清單為空。撤銷 C 後其既有 session 立即 401。已撤銷：INV-9703B554、無法取回連結的 INV-5751FE6C，以及曾出現在聊天／工具紀錄的 INV-141B557A、INV-F50FA317。INV-D359C7A5 保留至 2026-11-14T06:30Z 自然到期。舊專案 Private R2 + Images acceptance 內仍有 INV-40C9BFFB、INV-3061D3CE 等先前驗收邀請未撤銷，交使用者決定。

仍存在的問題：Owner 上傳時 06:35:02Z 重現暫時性 503 SERVICE_NOT_READY（P3 authorize cf-ray a59383a44fb8c743、/api/v1/me a59383ae5ef7c743 等 3 筆，wall 8ms），重試即成功，與 Guest 縮圖同類，非 Guest 專屬；使用者本機 v2 tail 未收到這些事件，也漏收一筆 B 產生的 409，故尚無 KINO_UNHANDLED_ROUTE_ERROR 分類，需從 B Workers Logs 依 cf-ray 查。內建瀏覽器視窗被遮蔽時頁面為 hidden，Owner 留言／註記面板依設計暫停載入，非產品錯誤。

本次程式修正（fix/upload-thumb-resilience）：TrackedPhotoImage（Guest／Owner 圖庫共用）首次載入失敗時 1.2 秒後以相同私人網址重新掛載一次，第二次失敗才走原錯誤處理，不加 query string、不改授權；Owner 版本面板在有 queued／running 版本且無切換／上傳／確認進行中時，每 3 秒靜默重讀第一頁，每張照片最多 40 次。伺服器行為與重試上限不變，503 根因仍待分類。

未涵蓋：Google 登入、100 張批次上傳、手機實機、G2 清理政策、hosted 負載。自刪 OFF／dry-run，A 既有服務未動。

## 2026-11-12 Claude：正式站 Guest 首載 503 定位到 B 縮圖授權查詢（診斷候選，未修復）

以有效合成相簿 Guest 分享於正式站 pick.kinostudio.tw 重現兩次。第一次 02:30 UTC：access／ratings／favorites／deliveries 首次即 200，零筆交付正常顯示空清單；但 24 張縮圖中 9 張回 503 `SERVICE_NOT_READY`，畫面破圖且縮圖不在前端重試範圍內。第一筆失敗 02:30:29.559Z，cf-ray `a5921d71cc8b4a68`，其餘 8 筆在 02:30:29.56–30.35Z；A 入口紀錄同時刻 status 503、wall 30–200ms、outcome ok。02:32:23Z 同 Session 逐張重抓兩張失敗縮圖皆 200 `image/jpeg`（cf-ray `a592203aecc480a3`、`a592203d590e1836`），屬暫時性，與照片或儲存節點無關。第二次 03:20 UTC 新邀請 INV-141B557A：首批 14 張及捲動觸發的 10 張延遲載入縮圖全部 200，記為「本次未重現」。

分層：A 自產 503 只有空 body（缺簽名密鑰或 IP），本次 body 為 B JSON，A 為原樣轉送。B 縮圖路由把儲存讀取與大小／SHA 不符都轉為 `ASSET_UNAVAILABLE`；能變成 `SERVICE_NOT_READY` 的只剩 `D1GuestGalleryRepository.asset()` 授權查詢拋錯，經 `contentError` 再拋到 `app.onError`。B 原本對此不寫 log，tail 只會看到 503／ok，這也解釋 staging 時查不到 D1 例外。時序為首波約 15 張縮圖與 6 次 access 各耗 2.5–2.7 秒成功，約 6 秒後第二波快速失敗；「並發湧入時 D1 快速回錯」是推論，實際錯誤訊息尚未取得。

候選修正 95e381c：僅在 `app.onError` 與交付／下載的通用 503 catch-all 寫一行 `KINO_UNHANDLED_ROUTE_ERROR`，內容為 scope、method＋遮罩 ID 的路徑、錯誤型別與遮罩後首行訊息（上限 160 字）；不記 Cookie、header、query、body、SQL 參數、原始 ID、email 或 IP。回應內容、權限檢查與重試上限不變。新增 tests/unit/diagnostic-log.test.ts；本環境無套件，僅以 Node 直接驗證遮罩邏輯，型別與單元測試交 CI。先前 handoff CI 43140119338／43146721735 皆只因根 HANDOFF.md 未過 format:check 失敗，已一併格式化。

下一步：CI 通過後經使用者確認併入 main 部署 B，以同一邀請、同一首載＋捲動路徑做修後重現，從 B tail 讀 `KINO_UNHANDLED_ROUTE_ERROR` 的錯誤名稱與訊息後，才決定真正修正（例如降低縮圖並發或處理 D1 暫時性錯誤）。取得錯誤前不加縮圖盲目重試。使用者本機 B tail 紀錄目前只有 time／status／outcome／requestId（requestId 皆空），且同時段只收到 19 筆而 A 有 42 筆，需加上 `logs` 欄位並確認未漏收。範圍外相簿拒絕尚未驗證，需完整相簿 ID。分享網址曾貼於聊天，測後建議撤銷。自刪 OFF／dry-run，A 既有服務、staging 寫入與客戶資料未動。

## 2026-11-12 正式登入與 Guest 503 交接

正式來源 6906b7bd，CI 43126212204、自動部署 43128460416 通過，收據見 production-prior-deployment.json。正式 GitHub Owner 登入與相簿讀取通過，Guest 首次載入仍待獨立驗收。ASTRA 審查未能以現存 staging 紀錄定位 503；A 入口未參與該請求。Claude 接手時先對單次失敗以回應狀態、回應類型、request ID 與 Worker 同時間例外配對，區分入口、授權及 D1 讀取；禁止記錄分享連結、密碼、Cookie 或原始 IP。保留現有重試上限、ACL 與停寫中的 staging。正式回退步驟見 PRODUCTION_CUTOVER.md。

## 2026-11-12 CI型別fixture修正，正式公開仍待新CI

83ff3c6已推私人main，CI43125681979在typecheck失敗，未部署。production產生ORACLE_STORAGE_ADMIN_USER_ID literal後，既有capacity負例直接寫invalid不符型別；改用原fixture的unknown輸入入口建立invalid env，並明確驗證該fixture未讀DB。沒有改產品types/授權或減少負例。pnpm typecheck/root+web與單檔16項通過；格式檢查指出一處排版，已格式化。下一步新精確CI→auto production→A僅pick域名→真Owner/Guest，來源仍停寫、自刪OFF。

## 2026-11-12 最終資料parity通過，production公開候選待CI

335c79b精確CI43116845142、auto staging43119336460與closed bootstrap43119430123均成功。B正式8secret安全安裝，secret-only版本e3883311，script/非secret綁定及關閉入口/Cron不變。A新kino-pick-gateway已關閉部署並只裝簽名secret，版本c6f4c08a；既有4Worker metadata不變、DNS未改。首次日期10021因本機日期超過provider UTC而拒絕且未建Worker，改用既有B日期2026-10-23成功，候選已同步日期。原生workerd驗簽200、cf/IP/body保留。

原f9ce production副本經新匯出完整證明沒有獨立寫入；staging workers.dev/previews/Cron已關閉，有效upload grants/running processing/deleting皆0。最後source多一筆client_browse_events。完整刷新本機成功但雲端FK拒絕，重新匯出獨立證明完全回滾；單筆本機補寫被CLIENT_ACTIVITY_TIMESTAMP_INVALID拒絕，未改trigger/時間/授權。ASTRA建議的窄差異路徑因真守門停止，改用既有已成功的空庫匯入方式；廢棄刷新工具僅存忽略.local，不發佈。新B kino-pick-production-live/65d2286e-f2ac-4ad2-90e2-4b31e2f24251先驗空庫，匯入並重新匯出：151表3645筆/schema67/FK0，完整schema/data/full ledger/sequence/stat parity通過。原f9ce、staging及restore67保留，D1現4/10。

最後全資產/fence與初搬清單逐row相同：322 R2/9,212,057bytes、9 Oracle/71,673bytes沿用真讀回SHA證據，沒有重搬/覆寫/刪照。Source SHA847a5a5a...、schema236e4c4d...、data6a850a84...。完整SQL與原圖在ACL目錄；聚合證據見production-cutover-20261112.json及production-closed-deployment-20261112.json。

本候選把production沿用已驗staging協作旗標，human/G2實驗仍OFF、registration closed、自刪OFF/dry-run；簽名上游workers.dev開啟後未簽名仍須404。新auto dispatcher依target檔選production，只有404才fallback staging；release gate驗精確CI、B/schema/FK/private R2、凍結source、8secret名稱、首次關閉舊DB父版本→新DB綁定、post每旗標/版本/Cron/unsigned404與收據。尚未推此候選/CI/公開DNS/production真登入。下一步一次CI→自動production→只部署A pick custom domain→真Owner/Guest；既有Guest初載503根因仍未證明，禁止稱MVP完成。復原與Review參考見PRODUCTION_CUTOVER.md。

## 2026-11-12 正式R2初步搬移完成，仍未public cutover

真實執行不可覆寫搬移：322 assets/9,212,057bytes，來源GET/DB SHA→If-None-Match PUT（SHA metadata）→目的GET/SHA/完整bytes皆一致，覆寫0/刪除0；原staging桶保留，原圖備份/manifest/checkpoint在ACL目錄。Source中唯一upload fence不屬primary，因此本次primary fence0，未錯搬VM標記。Oracle既有9 assets/71,673bytes真私有GET/SHA全符，不寫VM、不動Review。完整prod API schema metadata1203物件hash236e4c4d...與Node復原proof相同。原生API短效B OAuth10000經同scope Wrangler whoami自動refresh後恢復，不需使用者重登。

本次是初步copy checkpoint；source仍有111 reserved upload sessions（live authorizations0）、112 reservations與1 queued processing，未當垃圾刪除。尚未freeze staging/單writer、未最終fresh parity、未正式OAuth登入。closed bootstrap workflow正接入精確CI與B資源讀取驗證；不得將此候選或六個布林旗標當正式開通。Guest初載503仍待修復。證據production-r2-copy-20261112.json與production-oracle-read-20261112.json。

## 2026-11-12 私人R2簽名與入口原生編譯

正式桶專用憑證真實簽名ListObjectsV2回200/KeyCount0。A隔離工具whoami為film.kinostudio@gmail.com/6a11ba729af12c1322bfd77bb66cc90e；保全4個既有Worker metadata基線，沒有pick Worker。DNS API因未授予DNS read為403，未擴權，既有Edge DNS UI可正常讀，未改DNS。入口5項（含真正export Worker unsigned production404且DB零觸碰）、root strict/scoped lint、gateway與production dry-run通過。初次gateway sandbox dry-run因相鄰檔與log EPERM失敗，原生重跑成功；production dry-run仍PRODUCTION_RELEASE_ENABLED=false。獨立tail唯讀診斷取得日誌但無可識別D1錯誤標記，cmd子程序超時管線未結束已精確停止本次tail nodes，無原始日誌留檔/輸出。真Guest初載仍503，不稱修復。

## 2026-11-12 production67 匯入與完整來源比對通過

新production f9ce8433已先唯讀核對零產品物件，再匯入獨立Node復原確認的schema67。remote ledger67/FK0，重新匯出後151產品表/3644筆、精確schema/資料/full ledger/sqlite_sequence/sqlite_stat1均與來源一致。來源及目標SQL只保存在ACL目錄，不入Git；聚合證據見releases/production-bootstrap-20261112.json。這是copy checkpoint，staging未凍結，尚非最終切換parity。首次import子程序cp950解碼執行緒錯誤但exit0，後續remote核對與重新匯出精確比對證實完成；後續改捕捉bytes。Luna新增最小復用restore工具及1項selfcheck通過。

使用者已允許正式R2桶專用RW永久憑證，已建立並僅存Git忽略ACL設定，未裝入prod Worker。使用者允許A只新增pick入口；已核對A帳戶6a11ba729af12c1322bfd77bb66cc90e，獨立Wrangler登入完成，不覆寫B/預設登入。入口程式候選由Luna製作，未部署、未改DNS。其餘7舊D1經備份/獨立復原/SHA核對/無Worker綁定後退役，目前3/10，保留production/staging/最新restore67。私人物件搬移、最終writer切換、production登入及完整hosted仍待完成。自刪OFF/dry-run，A既有部署與Review不動。

## 2026-11-12 production OAuth／D1／R2 接線進度

GitHub正式OAuth已建立，Client Secret於本人MFA後保存release/.local/production-oauth-secrets.json，ACL限Aaron/SYSTEM，隔離寫入程序暫權已撤回，Git忽略已核對；尚未裝入prod Worker。B Wrangler以原最小範圍重新登入成功。使用者授權檢查並清理所有無用舊庫，最舊ef13經完整SQL備份、Node獨立還原integrityOK/FK0、SHA符合歷史且無Worker使用後已刪，建立production f9ce8433-ba99-4d3e-9029-28a2098e7fc4，目前空庫，production config已接ID。其餘7舊庫由Luna先備份核對，保留staging與restore67。新staging67原始備份已在ACL目錄；獨立還原及parity工具正在製作，尚未寫prod資料。私人R2production CORS只允許pick/PUT GET HEAD，真預檢204、未授權origin403；原先native編輯未生效曾保存預設localhost，已改正且讀回/預檢確認。R2正式物件RW專用token與A僅pick入口的兩項確認已提出，待答覆。A既有服務、原DNS及Review未操作。匯出首輪CLI曾輸出1小時下載URL，後續已捕捉並過濾stdout，勿轉貼舊輸出。詳見releases/production-bootstrap-20261112.json。

## 2026-11-12 B診斷候選與production OAuth待建立

97ee749完整CI43049058787與自動B43052232656成功，Worker dd986365-fb86-452d-9395-57ce3bfee51f/schema67/FK0。真Guest新tab仍重現初載錯誤，console將Object參數摺疊而無法讀狀態；已改固定family/status的JSON文字，27項隱私與原重試回歸通過。這是診斷輸出修正，根因未確認。GitHub kinostudio正式應用表單已填Kino Pick與pick callback，尚未建立；新Client Secret建立保存需求已提出一次，待答覆。

## 2026-11-11 新v2／Guest比較與固定交付通過

Owner新增合成v2原圖25911bytes，處理960x640，明確確認切換後revision1/current218a3d28-c158-4fb7-8043-39a046ca9697。Guest顯示Beforev1/Afterv2，slider50→70及並排皆已驗畫面。切current到v2後同邀請成品仍固定v1，下載原圖SHA423fb4629eb5922640f6b771a79aa2dea47cfc103fbe335f4668188410e39920符合G1/v1。截圖.local/owner-v2-version-20261111.jpg、guest-v1-v2-slider-20261111.jpg、guest-v1-v2-side-20261111.jpg。首次兩次檔案chooser未選中因主代理使用了不存在的根.local路徑，核對release/.local實檔後成功；不誤報產品上傳故障。初載仍間歇失敗，不能以比較通過冒稱已修復。

## 2026-11-11 Claude接手提醒：Guest間歇初載仍未定位

已依使用者要求提醒。重現為真Guest第一次開相簿時ratings/favorites/downloads/deliveries顯示通用載入失敗，逐一手動重試成功；後續一次reload所有panel又正常，故為間歇現象。三條排查：(1)真12項權限/capability均正常且同session直接API成功；(2)current strict DTO含inviteExpiresAt，未找到差異；(3)初載fan-out及24photoId上限檢視，未證明並發根因、未做擴大native fixture。B去識別tail一次exit1無結果。已推4e91434增加最終GET失敗的固定family/status或network訊息；候選未部署前沒有這些log。不要以重試成功稱已修復。相關apps/web/target-ui/guest-metadata-read.ts、guest-feedback.tsx、guest-downloads.tsx、approved-deliveries.tsx；Worker授權未修改。既有測試27項與完整typecheck過。下一步部署後重現讀console，若HTTP成功但無log再看parse/state。新的真Guest負例對另個合成album866f59c0 access回NOT_FOUND。

## 2026-11-11 Guest固定交付ZIP與通知通過

Owner向本次a5571ccd邀請交付固定v1成功；Guest看到該成品並真實下載ZIP，CRC無錯，唯一001-v1-cc8f333f-KINO_G1_EXIF_20261108.jpg為32220bytes/SHA423fb4629eb5922640f6b771a79aa2dea47cfc103fbe335f4668188410e39920，與既有G1原圖證據相同。通知截圖實際可見近期通知(1)/有新的成品已發布；AX樹不完整，不應誤報空面板。proof為releases/guest-collaboration-20261111-hosted.json，截圖.local/guest-delivery-notification-20261111.jpg及guest-fixed-zip-20261111.jpg。本機補ZIP圖示18px，尚未發布。CI43043104337 attempt1因security.ubuntu.com DNS安裝故障失敗，已按原source重跑一次，目前原生Guest步驟。

## 2026-11-11 Owner讀回與Guest代表確認

真Owner讀到本次Guest1張提交快照及KINO_G1版本v1。只選本次a5571ccd邀請建立固定v1確認請求；Guest開啟指定預覽、實際顯示圖片、勾已查看後確認，UI顯示已有受邀訪客完成確認。證據.local/owner-guest-submission-20261111.jpg及guest-version-approval-20261111.jpg。僅驗固定v1代表確認，未驗此次新增修圖v2流程。固定交付、ZIP與通知仍待本邀請驗收。

## 2026-11-11 真Guest手繪與挑片提交通過

同一短期合成邀請、第一張KINO_G1照片在自由筆畫模式拖曳並儲存，UI以目前授權清單確認完成且顯示同邀請自由筆畫。選取1張後經確認送出，UI顯示第1輪已送出凍結及快照永久封存。證據.local/guest-freehand-save-20261111.jpg、guest-submit-save-20261111.jpg。未改其他邀請或客戶資料。待Owner讀回、版本代表確認與固定ZIP交付，初載診斷候選CI仍監看43043104337。

## 2026-11-11 發布候選4e91434與Guest留言

最新CI43043104337已通過format/lint/typecheck，單元執行中；f6faa98的43042754260因MVP_RELEASE_PLAN格式失敗，已修正，不當成功。B尚待本次auto部署。真Guest同一第一張合成照片新增版本留言，UI顯示留言操作已確認完成，截圖.local/guest-comment-save-20261111.jpg；這份證據對應先前live，非新候選初載修復。手繪、提交、代表確認及ZIP仍待此邀請驗收。

## 2026-11-11 真 Guest 重試與寫入證據

新邀請所有12權限及feedback capability均真實開啟。初載失敗後，網頁下載重試成功、交付重載顯示目前邀請無成品；第一張合成照片重載評分與收藏後，實際寫入4星與收藏成功（UI radio/checkbox Value1）。截圖.local/guest-feedback-save-20261111.jpg。初載與批次失敗根因仍待查，不稱完成。B去識別tail一次exit1且無有效診斷，不重複認證嘗試。production僅補R2_ACCOUNT_ID本機設定。

## 2026-11-11 阻塞交接規則

依使用者指示，同一阻塞連續三次無法排除時立即通知，整理重現步驟、錯誤證據、已試方法與相關檔案供 Claude 接手。以有新證據的實際嘗試計數，不將相同狀態重述或等待算作修復嘗試。獨立可執行工作繼續。

## 2026-11-11 MVP 最短路徑交接

最新順序見 MVP_RELEASE_PLAN.md 首節。合成 Guest 已透過附五位數密碼連結登入，相簿重載後回饋、下載、交付仍顯示錯誤。同一 Guest 直接讀取 access、downloads（24 筆）、deliveries 成功；前端失敗原因待查。先修使用者流程，同時準備 production。G2 自動清理保持關閉。具名舊 D1 操作仍待授權。另保留 Pick 分享、權限與版本協作經驗供 Review 移植。

## 2026-11-11 新相簿metadata已自動B部署與真Owner驗收

使用者已明確允許本次短期合成相簿Guest分享，已按原設定建立（五位數系統密碼、最多5次登入、2026-11-12 12:30台灣時間到期、原12項權限）。連結與密碼僅留瀏覽器記憶體/tab12，未貼聊天或寫檔/Git；真Guest流程尚待驗收。GOAL已由使用者恢復active。本次同意僅涵蓋Guest分享，具名kino-pick-restore-6b279dee備份核對/條件刪除/production建庫仍待答覆，不延伸授權、不重問。保留自刪OFF/dry-run、R2優先/Oracle30GB、A/Review不變。

Source0e9bf86／CI42960459521／自動B42963361551成功；Worker97242eae-b7fc-40e8-9abc-4208643e42ad、schema67/FK0，baseline77a463f。真Owner在新專案/草稿相簿的同一photo02da466f-eb3c-4aa0-a552-861eeead1c70、version7d2a2669-bc9e-4a88-a59c-72a767370bb8，修正前NOT_FOUND→部署後手動重讀一次成功為4星/紅色，reload後保留，未重傳。證據docs/releases/managed-album-metadata-hosted-acceptance.json；尚未驗發布後新上傳的自動wake-up，不冒充Guest或production完成。

Guest短期分享已獲本次確認並建立，tab12為一次性結果；Owner驗收頁tab15為deliverable。具名舊restore備份核對/退役及production建庫仍待答覆，不重問、不刪庫、不拿舊授權套新scope。等待期間不擴充測試或新切片；收到適用確認後接續真Guest及production。自刪OFF/dry-run、R2優先/Oracle30GB、A/Review不動，GOAL未完成。這批純驗收文件先留本機，下一實際功能/切換提交併入，不為文件另跑完整CI。

## 2026-11-11 新相簿 metadata 接線（本機待整合）

修正photographer-metadata-import.ts仍只接受舊驗收相簿ID：改用既有stagingGuestAlbumScopeAllowed及collaboration flag，requireActive=false允許合法Owner draft上傳；保留原Owner/session與final import guard，未新增權限。單檔3項接線回歸、root strict、scoped lint/format通過；D1結果/repository/metadata/storage是stub，不是真D1或hosted驗收。未重跑全量。

00e17de的CI42956351834與auto B42959508669已成功；Worker ec334465-896c-468a-95ca-8055c6701132、schema67、FK0。真Owner帳號頁於新分頁載入成功；Guest新短期合成相簿分享已填妥，等待本次建立確認，未建立。收據baseline已快進至4a6f013，metadata修正現在併入下一功能release；不是舊B已含本修正。證據docs/releases/production-runtime-hosted-acceptance.json。production具名授權仍待答覆；A/Review不變，自刪OFF/dry-run。

## 2026-11-11 Guest直接載入修正，待新CI

8ba6041的CI42953411813通過Cloudflare整合後，在Guest staging native因Node ERR_MODULE_NOT_FOUND失敗，未部署。staging-guest-scope新增的production helper import改明確.ts；真Node載入及只重跑失敗的Guest原生19項/schema67通過，無真OAuth/遠端/hosted。CI同一Guest短檢查前移至product build後，原斷言與其他檢查保留，避免等18分鐘整合才發現Node載入錯誤；未取消或重啟舊run。scoped格式已修正。沒有schema/雲端變更；production具名建庫授權仍待答覆，自刪OFF/dry-run、A/Review不動。接續新精確source CI→自動B→最小hosted驗收。

## 2026-11-11 production候選CI型別修正

129468a已推私人main，CI42952240762在typecheck失敗，未部署。新增production明確ORACLE_STORAGE_ENABLED=false後，Wrangler生成Env將既有optional string交集窄化為false，導致storage-capacity.ts檢查true出現TS2367；現依既有WorkerEnv模式在Omit列ORACLE_STORAGE_ENABLED，沿用原string型別及zod解析，不改容量邏輯或開旗標。真正pnpm typecheck（含生成型別與reference型別）已退出0通過；Wrangler沙箱log寫入EPERM另行保留，未影響型別產生/檢查結果。不新增測試案例或重跑本機全量。

## 2026-11-11 正式流程唯讀核對與 production 縮圖接線

真 Owner 沿 B 正式專案→既有合成相簿→24 張分頁照片→EXIF 燈箱操作；方向鍵由第1張切至第2張且 photoId 網址更新，未出現操作待確認。相機/鏡頭/f2.8/0.008秒/ISO200、既有代表確認及固定交付成功載入；分享表單預選正確相簿，capability 載入後下載權限可選。只讀與未提交表單操作，未建立新邀請或改資料；不是新 Guest／上傳／交付寫入驗收。證據 docs/releases/owner-flow-hosted-acceptance.json，對應已部署43c594f，不套用到未部署production候選。

Production候選補缺少的IMAGES binding及明確OFF旗標；exact opt-in入口已串已hosted協作，原ACL/各功能flag不變。新版Worker production dry-run通過，最初沙箱EPERM/目錄存取失敗後以授權本機dry-run完成；不是雲端部署或資源核對。未新增schema、重跑全量或觸發CI。具名舊restore備份/刪除及production建庫授權仍待答覆，不重問、不換庫規避。未hosted shared-selection/自動版本配對保持local-only。自刪OFF/dry-run，R2優先/Oracle30GB，A/Review不變。

## 2026-11-11 上線優先、最小驗證

依使用者最新指示：優先把既有正式流程、UI/UX 與 production 切換接通；不繼續擴充 G2 防誤刪研究或反覆全量測試。每次僅跑改動直接相關的檢查，保留租戶/邀請隔離、資料保全和實際部署驗收。Claude 審查留到完整可操作版本後，尚未執行，不視為已審。

本機 production runtime 已接既有 configuration、Owner collaboration capability、Guest entry/invite 與手動刪除入口；必須精確 B 帳戶、pick.kinostudio.tw、production 私人桶、closed registration、自刪 OFF/dry-run 及明確 opt-in，才能沿用已 hosted 的協作能力。現有各功能旗標與服務 ACL 仍各自生效；未 hosted 的本機實驗仍不開放。旗標 PRODUCTION_RELEASE_ENABLED 預設 false，production DB 仍 placeholder；沒有雲端啟用、遷移、修改 A 或宣稱 production 可用。

最小驗證：production/runtime 與既有版本核准設定共 2 檔 10 項通過，scoped lint、root strict 與 diff whitespace 通過；首輪測試 fixture 的 generated Env literal 型別不相容已修正，未改產品型別或放寬 strict。沒有為本機準備稿另推送或觸發全量 CI。接續為既有具名授權答覆後處理 production DB、OAuth/網域與正式流程 hosted 驗收；先前問題不重問。

## 2026-11-11 帳號流程已自動部署 B，真 GitHub 重新驗證通過

Source43c594f、CI42946329500 success、自動B42949472015 success；Worker d2a6a320-9abb-4cb9-a2f4-0f0fa9434313、schema67、FK0。新CI已通過原Owner撤權後零私人照片斷言，未放寬測試。真Owner頁讀GitHub已連結、stale提示；點重新驗證經真GitHub回到相同Owner工作空間，session期限06:14→11:02（11/12，本機時區）且fresh提示消失；唯一可用來源沒有解綁按鈕。bootstrap.invalid占位email已隱藏。Google尚未設定，不冒稱真Google綁定或真實解綁已驗。

證據docs/releases/account-provider-hosted-acceptance.json；截圖.local/account-provider-hosted.jpg。版本依成功部署收據，瀏覽器未獨立測Worker版本。發佈checkout已快進到自動寫回部署收據的main c101e0c，舊失敗42944524362保留。舊Next/Supabase與Gump原型測試已移手動，正式Cloudflare與發布門檻仍執行。Claude尚未審查。

Production設定草稿已匹配B、pick.kinostudio.tw及已存在空kino-pick-production桶，本機production dry-run通過；DB仍placeholder、功能旗標仍OFF，沒有部署或假稱可用。D1名額10/10，舊restore-6b279dee本次備份核對/具名刪除/建立production的問題等待答覆，不重問，不刪庫。G2髒候選保全、自刪OFF/dry-run、R2優先/Oracle30GB、A/FILM/Review維持。

這批hosted交接與production草稿先保留本機，下一項實際production變更再提交；不為純文件另外跑整套CI。完整MVP仍未達成，GOAL active。

## 2026-11-11 CI失敗修正與發布測試縮減（待新CI）

帳號來源af45cb8的CI42944524362已確實失敗，未部署B。Root lint/types、unit（含真正BetterAuth mock-provider整合）、integration、build及前段browser步驟通過；test:cloudflare在Owner註記撤權情境失敗：Owner disabled後dialog已消失，但全頁仍有一張私人照片，原0張斷言保留。

已在既有onOwnerAnnotationUnauthorized的scope/generation守門後，除清空gallery外派送既有kino-pic:refresh，令外層Owner /me與metadata重新授權，涵蓋獨立相簿封面；不刪journal或放寬服務權限。這是由程式碼確認的局部失效路徑，尚待新CI重驗原失敗case，不冒稱本機原生通過。另隱藏真Owner頁看見的bootstrap.invalid內部占位email，預設Owner顯示管理員。

依使用者指示，舊Next/Supabase參考端build/e2e與Gump原型browser移到legacy-reference.yml手動workflow，舊測試/斷言保留；正式Cloudflare所有現有產品、資料/租戶隔離與release gate仍在checks。正式前端build、scoped lint/format及diff whitespace通過；未重跑整套本機測試。

B唯讀盤點：production R2 kino-pick-production已存在且0物件；D1共10/10，總60.46MB/5GB，尚無production DB。舊restore-6b279dee本機SQL SHA仍匹配原134表/FK0復原證據，但本次fresh備份/核對/具名刪庫與production建立授權已問一次，等待答覆，不刪庫。B瀏覽器已恢復既有登入；未改A/Review/雲端資源。後續Claude待審清單見CLAUDE_REVIEW_HANDOFF.md，審查尚未執行。

下一步：新source CI→自動B→保留的真Owner帳號頁驗收；不要重試已終止的42944524362或把它算成功。先前B仍沿source28d5098/version54b55454/schema67。自刪OFF/dry-run，G2髒候選完整保留。

## 2026-11-11 Owner 登入來源正式接線（候選，待 CI／B）

正式帳號頁已讀真實綁定狀態，支援Google／GitHub明確綁定、安全解綁及OAuth重新驗證。保留公開註冊關閉、隱式email合併關閉；綁定開始和callback均需同一近期Owner session。允許Owner明確選擇不同email來源為同一身分。解綁以同一D1 batch審計與條件刪除，必須留下另一個已設定且已綁定的登入來源。沒有schema／新服務／憑證變更。

必要本機驗證：單一account-providers-native整合測試通過（3.88秒），真Miniflare D1＋真BetterAuth authorize/callback，GitHub交換為mock；涵蓋Owner scope錯配／錯origin／過期freshness、並行解綁保留一來源、審計、DTO不輸出subject/token、Owner／Guest路由隔離。初輪root找不到hono，改以Worker已安裝依賴的createRequire，沒有加依賴。Root strict、scoped lint／format、正式前端build通過；Worker dry-run亦通過（在共用freshness helper抽出前），完整CI將重建最終來源。Astra窄審查找到hook模板路徑格式，已修為/callback/:id並由實際callback測試覆蓋。

本機release self-test因缺舊photo-pins-upgrade-proof.json停止；保留守門，交CI既有步驟生成證據，未為此重跑整套本機native。僅為self-test增加失敗stack診斷，雲端pre/postdeploy仍隱藏細節。已合併main88ea8c1的真B部署基線，其他髒G2候選保留。

下一步：精確本次source完整CI→既有自動B→真Owner帳號頁／已設定來源的OAuth驗收，再繼續production必要接線與全流程；目前不稱已部署或真Google OAuth已驗。Claude審查未執行。自刪OFF／dry-run、R2優先／Oracle30GB、A／FILM／Review維持。

## 2026-11-11 使用者調整：流程、UI／UX 與上線優先

先沿已發布正式前端接通使用者流程與 UI／UX，再完成 production 切換。這項最新使用者指示取代舊 G2→G3→G4→G5 的強制先後順序；全部產品需求保留，進階自動清理見證延後，不宣稱完成。

發佈主線採現有 `.local/album-tabs-release-20261109` checkout（本次起點89aeb57）；G2 checkout 的髒變更完整保留，只在具體流程需要時審查並擷取相依完整的切片，不能整包覆蓋新版 UI。停止擴充 D1／R2／Durable Object 見證原型。

優先順序：

1. 正式 Owner／Guest 逐頁接通：工作台→專案→相簿→燈箱／協作→分享→代表確認→固定版本／ZIP交付→通知／歷史／容量。以一次有界的流程檢視找真缺口，已驗相同來源不重做。
2. 補帳號頁已確認的登入來源綁定／安全解綁缺口，保護最後一個登入來源；再處理流程檢視找到的實際錯誤。租戶、相簿、邀請與私人檔案授權不放寬。
3. 沿用既有CI／自動B部署；production資源、OAuth origin、pick.kinostudio.tw與必要資料搬移以適用備份／復原守門切換，再以同一發布版跑一次Owner／Guest完整流程驗收。
4. 已知問題及未驗項目整理給Claude後續審查；尚未執行Claude審查，不以待審查替代發布前的資料與權限保護。

驗證縮減：UI／文案不新增單元測試；功能修改只跑受影響的最小檢查或一條實際流程；無新變更或具體失敗不重跑全量本機測試。保留現有必需CI、建置、敏感授權負例，以及schema變更必要的備份／復原／parity。不移除既有斷言、偽造通過或繞過部署守門；本機不再先重複跑整套CI。純文件本次只做diff whitespace檢查。

自動刪除OFF／dry-run；R2優先、Oracle30GB與A／FILM／Review隔離維持。未通過的G2清理資格不得顯示為可安全清理。GOAL的active／paused狀態由使用者控制，本次調整不自行恢復暫停目標。

## 2026-11-09 容量面板與卡片比例：完整本機 Worker 驗證通過，等待 CI

CI42616065714（source b172b15）在 `pnpm test:cloudflare` 的 Guest 375px 燈箱縮圖 hover 斷言失敗，未部署。原因已由本機重現：測試將游標放在折疊縮圖列空白處／裁切區，Chromium 命中燈箱本體；改測可見縮圖上緣後完整本機 `pnpm test:cloudflare` 370 項通過。只改測試游標定位，產品 CSS 與容量功能不變。

這不代表 CI 或 hosted 驗收通過。提交測試與交接更新後，等待完整 CI 及既有 B 自動部署，再由真 Owner 唯讀核對容量數值和專案／相簿卡片比例。面板顯示本服務登記用量及 Oracle 健康磁碟空間，不是 Cloudflare 全帳戶或 VM 全域對帳；本機合成值不是 live 值。A／Review／DNS／客戶資料不動，無 live DB 或儲存路由變更；自動刪除 OFF／dry-run，R2 優先／Oracle 30GB。完整 MVP 仍依 G2→G3→G4→G5。

## 2026-11-09 容量更新與儲存競態補強

Ponytail只讀審查發現刷新GET與儲存PUT可重疊，使較舊readiness回應覆蓋剛儲存的狀態文案；修為refreshing時save handler拒絕且fieldset disabled。既有真D1/Chromium focused驗收補held GET，明確驗儲存按鈕/容量欄停用、放行後資料更新並保留42草稿；完整focused再次過，scoped lint/format與Web strict過。沒有更動權限、SQL/schema或VM政策。更新同一local proof，保留前source a6bb16a及CI42594772236紀錄；新source需完整CI成功後再由既有流程自動部署B，不將舊source成功借給新source。

## 2026-11-09 R2／Oracle容量面板與卡片調整：本機通過，待CI／B

沿既有照片儲存空間與GET/PUT oracle-policy接容量快照，沒有新API/DDL/flag。僅指定storage admin且DB enabled Owner/session有效可讀；同一次DB查primary/oracle-vm帳本及pending預留、VM health。回傳安全數值/時間，不含bucket/endpoint/憑證/客戶資料；其他未顯示node不當成全域盤點。已存/額度剩餘/配置上限與VM實際free分開，health缺席不填0、stale/future標待更新，policy/health正在同步時仍可觀測，不改admission守門。更新用量只GET、不重載、不清除未儲存quota。

16單元、正常repo型別生成後root/web strict、scoped lint/format與前端/Worker dry-run過。真本機schema67/D1/Chromium驗R2 9GB/Oracle30GB與合成free155.8GB、刷新保留quota42草稿、375/1280無overflow；這些數字不是live觀測。卡片改為依可用寬度增加欄數，最大352px、封面4:3，375/913/1280/1920共8組通過；單相簿照片工作區滿寬保持。證據docs/releases/storage-capacity-local-acceptance.json，截圖apps/worker/.local/storage-capacity-{375,1280}.png。

前卡片CI42590536963/b40dcb4在既有Guest縮圖列resize/hover opacity斷言失敗，未部署。保留該失敗，僅補測試已知pointer/folded geometry前置，再從列內hover；expanded/不重疊/鍵盤斷言不變，不改產品燈箱CSS或延長timeout。新前置待完整CI實跑，不能稱已驗根因或hosted。取消同來源重複分支CI遭自動核准審查拒絕（未有該次取消明確授權），未繞過，保留執行。一次本機build後驗證路徑誤植已改正確既有runner並通過；不重build假冒成功。

本次仍無cloud DB/儲存路由變更、無新schema，不受G2的68–71待授權遷移牽連；G2獨立候選bd59184與根髒檔保全。接續完整CI→既有自動B→真Owner容量/卡片唯讀驗收，A/DNS/Review不動，自刪OFF/dry-run、R2優先/Oracle30GB保持。完整MVP仍依G2→G3→G4→G5，未冒稱production。

## 2026-11-09 專案與相簿卡片比例修正：本機通過，待CI／B

從已發布main隔離，只改卡片列表class及共用nav CSS：自適應欄數、卡片最大352px、375px下339px，封面4:3；相簿內照片工作區不受卡片欄寬限制，原操作/API/權限/頁籤不變。真本機D1/Chromium建立工作空間→專案→相簿，375/1280/1920兩種卡片共6組寬度/比例/無水平overflow通過，既有頁籤/URL/back/reload/保護/封存流程亦過。Web strict、scoped lint/format、前端及Worker dry-run通過。證據docs/releases/card-width-local-acceptance.json；預覽在apps/worker/.local/card-width-{project,album}-{375,1280}.png，全部合成資料。

此切片不含G2的68–71或stream WIP，不需新schema；沒有DB/儲存/flag/憑證變更。接續正常完整CI→既有自動B部署→真Owner卡片唯讀驗收；尚未驗hosted或實機觸控。G2候選643ca3f及根髒檔保留，自刪OFF/dry-run、R2優先/Oracle30GB、A/DNS/Review不動。

## 2026-11-09 相簿滑動頁籤已自動部署 B 並真 Owner 驗收

正式source10e79694f5ba8cda385c5ac00986d932e04d5196，完整CI42527545445成功，自動dispatch42529468700／部署42529477580成功；Worker c53c7359-c39e-4c54-8884-813484b52069，baseline bot e1dd678，schema67不變。從main隔離發布，只改AlbumTabs／nav CSS／原navigateAlbum呼叫與相關驗證；沒有API、migration、profile或憑證修改。保留墨綠／米白，選取底色平移伸縮、方向鍵／Home／End、減少動態；深連結／容器縮窄會把選中項水平捲入可見範圍。

真Owner在既有08954949…專案／613487da…合成相簿：點頁籤更新albumId及標題、返回回到全部相簿、forward與reload保留選中，24張私人R2縮圖全部載入，1684px下pill與button對齊、顏色RGB66/111/105。無Cookie專案GET仍401 AUTH_REQUIRED且無私人project資料。未建立／刪除相簿、分享或客戶內容。Hosted尚未驗窄viewport／實機觸控；375px移焦後縮放與長名稱的真正本機D1/R2/Chromium檢查已通過並納CI，不能冒稱hosted mobile。Guest介面未改，未新增Guest session；原生隔離回歸由完整CI保留。

首輪格式失敗42525745970、舊來源取消42525906737，以及移焦後縮窄選中項不可見的真失敗均保留。修正共用measure／scroller observer後同測試通過，Luna max唯讀Ponytail複查無其他具體發現。監看曾一次連線失敗，唯讀回查恢復，未重跑CI；首次hosted wait誤用照片名稱未當驗收，後用fresh AX正確label與DOM 24張載入核對。證據docs/releases/album-tabs-{local,hosted}-acceptance.json；截圖發布工作樹.local/album-tabs-hosted.png，不含憑證。

發布工作樹.local/album-tabs-release-20261109。0068 canonical3950c24、continuation490b175與69期限WIP保全，沒有混入發布；後續G2須沿更新main整合，不能倒退頁籤。具名0068雲端備份／restore67退役授權仍待答覆，不重問不執行。自刪OFF/dry-run、無Cron、R2優先／Oracle30GB維持；A／DNS／Review未改。此為正式前端在B staging的切片，不是production cutover或完整MVP，GOAL active，接續G2→G3→G4→G5。

## 2026-11-09 頁籤縮放邊界已重現並修正

追加真正 native UI 檢查：選最後一本長名稱相簿、點h1移焦，再縮窄375px，不再點頁籤。原版本確實失敗（selected超出可見範圍）；已將水平可見性調整移入共用measure，並觀察scroller本身，原測試重新通過。只修同一頁籤元件，沿用URL、權限與原配色，不強制垂直捲動。產品重新build、scoped lint/format及focused原生流程通過。CI42525906737因來源已被修正取代而主動取消，不當作CI成功／功能失敗或部署證據，接續新來源完整CI。

## 2026-11-09 頁籤 CI 格式修正

首輪 CI42525745970 停在 ui-browser.mjs 單一 chained locator 的格式。移除未使用變數後需再格式化一次；已修正，產品邏輯未改，不重跑無關本機套件，接續正常 CI／自動 B。失敗保留於 local acceptance evidence。

## 2026-11-09 已確認相簿滑動頁籤整合，待 CI／自動 B

使用者確認 AIMRAN uv-rd-slide 互動原型後，從 origin/main 395b37b 建立獨立發布工作樹 .local/album-tabs-release-20261109／codex/album-tabs-release-20261109。只移植已確認 AlbumTabs、原頁籤 CSS 與 app.tsx 導覽呼叫；沿原 navigateAlbum 更新網址／popstate，沒有 API、schema、flag 或憑證修改。不混入 0068／0069 期限 WIP；原 canonical3950c24、continuation490b175與69 WIP均保全。選取 pill 依文字寬度滑動，墨綠／米白保留；初始深連結及改選時只水平捲動至可見，支援方向鍵／Home／End、375px與 reduced-motion。

沿既有 ui-browser.mjs 加入真正 Owner 工作台→專案→兩本相簿切換、albumId／返回／reload、不同寬標籤對齊、375px可見／不溢出、鍵盤與減少動畫檢查；新增 focused runner 重用該 helper，不複製介面或假 API。全新本機 D1 schema67／R2＋Chromium實跑成功；原建立、釘選、封存及重載檢查亦保留並通過。Web strict、scoped lint/format、產品 frontend＋Worker dry-run build通過。離線套件初次因沙箱快取缺檔失敗，改用既有 Aaron 快取成功；未下載、未換版本。非真實 OAuth 或 hosted 驗收，未宣稱已部署。

接續正常完整 CI→既有自動 B gate→真 Owner 相簿頁籤驗收；schema維持67，不需新migration或復原，不能因此繞過 G2 0068 所需的適用授權／備份守門。A／DNS／Review／客戶資料不動，自刪OFF/dry-run、R2優先／Oracle30GB不變。GOAL保持active；此切片不是完整MVP。

## 2026-11-09 目前執行目標更新為G2

G1正式發布與真Owner／Guest ZIP／通知／EXIF驗收已完成，依docs/releases/g1-0067-hosted-acceptance.json保留基線與失敗證據。當前目標依docs/MVP_RELEASE_PLAN.md最新G2：先相簿90天可調且預設OFF設定，再分享期限繼承、有效人類瀏覽背景紀錄、dry-run候選預覽；逐個Schema→Service→API→UI→Tests→Docs，必要復原／CI／自動B／hosted後才標完成。G3補驗、G4production切換、G5最終全流程保留。A／Review／客戶資料不動，自刪OFF/dry-run、R2優先／Oracle30GB維持；正式來源.local/oracle-release-20261106。內建舊GOAL仍paused且無overwrite/resume API，未假標完整MVP完成。本次僅更新目標，沒有G2程式、migration或雲端變更。

## 2026-11-08 G1正式驗收完成：live67／CI／B／真Owner與Guest

已驗來源58f1bee4a155448143dbd99becfa91d7c30e40da，完整CI42491537881／自動B42493102853成功；Worker79ef16c4-7e58-41bc-8edd-85378aac650a、schema67。Fresh-source parity→live0067採用9步exit0、獨立restore67、完整release self-test保留；不重做復原／遷移、不刪測試庫。原始failed export與ZIP截斷及D1十秒resource throttle全部保留，不把重試或local當hosted。最終兩輪query減量及B PRAGMA optimize後，以下有限真實驗收通過，不能拆分宣稱單一措施已證明根因或保證負載穩定。

使用者已明確允許建立一天／單一Synthetic photos相簿的驗收分享。Agent送出前未擋下日期回復預設，誤建INV-E5B0F1DB七天連結；未分享、未使用（雲端session0），已於15:34:54.145Z撤銷。之後以原生鍵盤＋重繪＋送出前精確guard建立正確INV-671869C8（671869c8-0ab0-42d4-820d-178e61048e3f），僅view／original-download／compare，2053，2026-11-09T15:10Z到期。UI及D1雙重核對。原邀請不變，token只在瀏覽器記憶體、隱藏一次性結果／清除fragment／清空變數，無chat/Git/log落值。這個自動化日期fill現象不等於一般人鍵盤輸入有產品bug。

真Guest正常入口登入，24張私人圖可讀且無Owner身分（/api/v1/me=AUTH_REQUIRED）；新邀請發布前成品0，發布後僅本邀請兩份。V1及V3各實看固定預覽並代表確認，Owner各只交付新邀請；D1核對2 requests各1invite／1receipt、2 deliveries各1recipient。Guest EXIF機型／鏡頭／f2.8／1/125秒／ISO200正常，Guest通知2則且不混入舊交付，Owner通知10則含新確認／發布。

最終3張不同新票券「首次」ZIP皆完整54145bytes、CRC零錯誤、可解壓，V1原圖32220bytes/SHA423fb462…、V3原圖21527bytes/SHAb26b590c…完全一致。三ZIP本身SHA均ce5b06276bc8422ee11c50bcc03bfbe4d938e194380669fac4fa2016dfc82711。Safe tail三GET均200/ok、無resource/D1 signals；雲端3 created／3 requested／3 generated，IP只核對text不讀值。沒有實檔自動重試或重複寫入；V3 locator等待逾時後fresh UI確認原操作完成，不冒稱低延遲。截圖root.local/g1-{new-guest-confirmed-exif,final-guest-zip,final-guest-notifications,final-owner-notifications}.png；完整安全證據docs/releases/g1-0067-hosted-acceptance.json。

本次G1發布切片完成，完整production MVP及G2-G5仍未完成：下一優先相簿90天預設OFF、連結期限繼承／有效人類瀏覽及dry-run候選的清理政策垂直切片，後續production獨立資源／網域及全流程。A／DNS／Review／客戶資料未改，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。未做hosted負載／實機觸控或保證首次零錯，較早metadata失敗保留。文件GOAL已按實際完成更新；內建舊paused GOAL無overwrite/resume API，不得假標其完整MVP objective完成。

## 2026-11-08 最終58f1bee已CI／自動B；Owner通過，Guest新分享待確認

本次fresh-source parity→live0067採用9步exit0、完整release self-test已成功。第二修正版58f1bee4a155448143dbd99becfa91d7c30e40da，完整CI42491537881及既有自動B42493102853成功；Worker79ef16c4-7e58-41bc-8edd-85378aac650a、baseline5c86a3c、schema67。只改ZIP重複預檢，不改新GET前／完成前的完整ticket與審計／ETag守門，沒有自動重試寫入。B另已完成PRAGMA optimize內部統計維護、FK0，產品資料列不變。

真Owner在最終版本讀到1200×800私人預覽、相機／鏡頭／f2.8／1/125／ISO200，確認／交付通知正常；root.local有g1-owner-{exif,notifications}-final-hosted.png。較早真Owner／Guest已實際2邀請1代表確認、單一邀請固定V1交付與通知；原V3與新V1兩原圖完整ZIP的size/SHA曾實測一致，但前兩版ZIP有截斷，全部失敗保留；捕捉D1_ERROR十秒resource throttle，不能宣稱最終ZIP已驗收。完整安全證據docs/releases/g1-0067-hosted-acceptance.json。

原Guest session已過15:02UTC，使用者回覆未保留原INV-3061D3CE分享連結；hash無法還原，不可偽造／延長session。已在原Owner頁填妥新分享但尚未建立：僅Synthetic photos相簿、link_only、查看／下載原圖／比較版本、2026-11-09T15:10Z到期。已提出一次新持續存取憑證的瀏覽器action-time確認，尚待答覆；不要重問、不要擅按建立或放寬原邀請。表單截圖root.local/g1-new-guest-invite-review.png；Owner原tab1650470566保留表單，新增Owner驗收tab1650470568、IAB Guest2可接續。新token只能在瀏覽器記憶體使用，不進chat/Git/log。

下一步收到允許後才建立新測試分享，以正常Guest入口登入，對新邀請明確指定合成固定版本確認／交付，再驗新票券首次ZIP（完整解壓／CRC／原圖SHA）、Guest通知與EXIF；若再失敗保留D1安全訊號，不能標GOAL完成。A／DNS／Review／客戶資料未改，自刪OFF/dry-run、R2優先／Oracle30GB不變。不要重做0067backup/restore/adopt或刪獨立庫；完整MVP／production切換仍未完成。文件GOAL已覆寫，內建舊GOAL仍paused且無overwrite/resume API，未假標完成。

## 2026-11-08 B查詢統計維護／Guest重登入待答覆

第二候選58f1bee，正常CI42491537881中。B live已執行官方PRAGMA optimize＋FK check，exit0，內部統計changed_db true、changes0／rows_written0、FK0；先在本機備份驗證所有產品row/schema/sequence完全一致。沒有新migration、客戶資料列或A變更，尚不能以此主張hosted ZIP修復。

現有真Guest session將於2026-11-08T15:02:00.123Z到期；CI／部署預期超過此時間。已一次要求使用者在訪客瀏覽器以原INV-3061D3CE分享連結重新進入，不要求貼token／密碼／Cookie，尚待答覆。可繼續CI、部署及Owner驗收；不可偽造／延長DB session、放寬授權或未確認新建分享憑證。若Guest尚未重新登入，不得宣稱最終候選真Guest驗收完成。請勿重問同一需求。

## 2026-11-08 ZIP 第二輪減量候選：首次失敗仍保留

bedc21b已完整CI42488303312／自動B42490385780成功，Worker dd05058f-0d18-4b96-ab85-549494832cd5，schema67。真Guest兩張新票券首次ZIP均完整54145bytes、CRC與兩原圖SHA一致；第三張首次53935bytes截斷。safe tail明確回覆D1_ERROR＋「Too many resources consumed within a 10 second window」，是D1 resource throttle，非已證實Worker CPU上限。初載access503亦保留；不能稱全部驗收通過。

第二最小候選只在預檢使用本次初讀授權的immutable manifest、精確asset PK與R2 HEAD；移除N次預檢完整view與重複postHEAD查詢，每張真正R2 GET仍fresh完整ticket＋conditional ETag，完成前ticket／generated audit及trigger不變。不加寫入／實檔重試、不改schema或權限。若HEAD期間撤銷，可能先回attachment HTTP200後零ZIP bytes串流失敗；不會輸出私人檔名／內容，不宣稱此競態統一401。Native26／focused13／11單元／strict／scopedlint／release self-test及顧問唯讀審查通過；待CI→自動B→真Guest首下載，不把local當hosted。

A／DNS／Review／客戶資料未改，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB維持。live67／獨立restore67勿重做或刪除；GOAL文件依使用者指示、內建舊GOAL仍paused無覆寫API。完整MVP／production cutover未完成。

## 2026-11-08 live0067 已採用並自動部署；ZIP overload 修正候選

Fresh-source parity與live67採用9步exit0，152舊表／3414列保持、FK0；完整release self-test、CI42482772015與B自動部署42485107607成功。Source92e7507，Worker ac580772-86d2-45b6-b74e-7263cc91c83e。不得重做0067復原／遷移或刪獨立測試庫。

真Owner／Guest讀到新合成照片的機型／鏡頭／f2.8／1/125秒／ISO200；2份邀請僅1位代表核准，Owner交付僅指定1份邀請，雙方站內通知顯示正確。ZIP首輪／新票券首次下載出現截斷；成功的兩次原圖SHA完全一致，但不能稱ZIP驗收完成。安全tail實際捕捉D1_ERROR＋overloaded，未證實其子類或Worker CPU上限。保留失敗檔，不重試寫入或放寬授權。

最小候選減少重複live delivery view：每檔及完成前完整ticket重驗不變，fresh manifest逐項核對後查immutable asset PK，R2仍HEAD及conditional ETag。Native26／focused13／11 ZIP單元、strict／scopedlint／release self-test通過；待正常CI→自動B→真Guest新票券首次ZIP雜湊驗收。A／DNS／Review／客戶資料未動，自刪OFF/dry-run、R2優先／Oracle30GB維持。完整MVP及production cutover未完成。內建舊GOAL仍paused且API不能覆寫，文件GOAL依本次明確要求執行。

## 2026-11-08 B live0067 已採用，release self-test 通過，待正常CI與部署

使用者明確授權fresh-source parity→live0067→CI／自動B→真Owner／Guest驗收。固定B工具完成9步exit0，fresh source與既有66備份一致才套唯一0067；live與獨立drill精確一致、FK0，未覆寫舊資料。證據docs/releases/approved-deliveries-0067-restore.json。首次parity export失敗保留，後續唯讀metadata與同工具成功，未擴憑證；不宣稱已確定根因。

完整release self-test已實跑成功。保留失敗：舊photographer proof的bundle hash失配，重跑13組原生photographer後更新；新增prior flags比較未排序與67 self-test ledger fixture用了[id,name]而實際receipt用name陣列，已精確修正並保留負面守門。predeploy DB必須67，舊Worker仍按66 receipt核對；不放寬物件／SQL／hash／scope或安全flags。

當前GOAL覆寫為完成此0067發布與真實ZIP／通知／EXIF驗收；MVP_RELEASE_PLAN為執行依據。內建GOAL仍paused、API不支援覆寫未完成目標，未假標完成。下一步正常CI→既有自動B部署→真Owner／獨立Guest驗收，不重做已通過restore/adopt。Worker目前尚未更新；A／DNS／Review／客戶資料不動，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。

## 2026-11-08 B 的0067獨立備份／復原已通過，live仍66

使用者已明確授權本次live66受ACL保護完整備份與B獨立測試庫。已完成6個CLI步驟，全部exit0；新獨立庫7eabf9e7-babb-48f5-81ec-a25ee870f309，復原66後升67。備份3218715bytes／SHA c39aeb29960b1be3322137f06c916e782db1ae5b572d643a5224e82b8d35ff1a；152舊表／3414列的hash、schema、sequence保留，FK0。實際獨立庫匯出再次驗SHA／67 ledger及精確1view／1index／2triggers；多餘物件拒絕守門保留。restore-only proof仍被adoption gate正確拒絕，不能當live遷移／完整self-test／CI成功。

證據docs/releases/approved-deliveries-0067-independent-restore.json及independent-validation.json。備份位於release apps/worker/.local/approved-deliveries-0067-f95d54f2-1483-4a79-99de-9062ea971c13，ACL僅Aaron／SYSTEM／Administrators；SQL及原始IP未提交。首次CLI export失敗保留，根因未證實；唯讀metadata與後續匯出成功，未擴大憑證。首輪sandbox讀proof EPERM反映ACL限制，後用授權context只輸出安全metadata。

本次沒有修改live DB、沒有adopt或部署，A／DNS／Review／客戶資料不動，自刪OFF／dry-run及R2優先／Oracle30GB不變。下一步為fresh-source parity後才可live0067 adoption→完整release self-test→正常CI／自動B→真Owner／Guest ZIP、通知、EXIF驗收；source變動則重新rehearse，不能拿舊快照覆寫新資料。恢復方式為關閉新flag、保留歷史與原圖並forward fix。不要重做已成功的獨立復原或擅刪此測試庫。

## 2026-11-08 G1 本機整合通過，0067 雲端授權待答覆

Candidate Branch: codex/g1-zip-notifications-exif-0067。取得本次明確備份／新庫授權後，在 apps/worker 使用隔離 B config 執行 node tools/rehearse-approved-deliveries.mjs --restore --schema=67；獨立復原及 fresh parity 通過後才可 --adopt --schema=67。缺任一真實證據不跑正式部署；不可沿用 default66 重做舊切片。

新版 GOAL 的 G1 已實際接線 ZIP／站內通知／相機資訊並補原生權限驗證；26 組 native D1/R2、schema67、3 份 image fixtures 通過。相機資訊增加 IO 後再次授權核對；12 metadata、19 ZIP/history、20 config/boundary、5 notification 單元通過；原生手動清理 1 項、固定版本 ZIP 真下載／解壓雜湊與通知 browser、root/web strict、前端與 B-profile dry-run build、scoped lint/format 通過。證據 docs/releases/g1-0067-local-readiness.json；不把 local 當 hosted。

保留失敗：清理首輪 config 未命中測試、沙箱編譯拒絕、EXIF helper transport Origin403、未發布 V2 正確被 Guest 拒絕；分別沿既有 config/request wrapper/正常 CAS set-current 修正，未放寬產品授權。

自動核准審查在命令執行前拒絕 fresh live66 export／新 restore67：理由為舊授權僅限舊 restore66 備份。已提出一次本次完整備份＋B 獨立復原的明確授權問題，尚待答覆；未備份 live、未建 restore67、未套 live67、未部署。不可重試或繞 gate。0067 checker 已完成精確 schema／hash／receipt／負面守門補強，normal self-test 仍待真實復原證據；接續正常備份→獨立復原→parity／adopt→CI→自動 B→真 Owner/Guest 驗收。A／DNS／Review／客戶資料不動，自刪 OFF/dry-run、R2 優先／Oracle30GB 維持。

## 2026-11-08 重新安排GOAL，接續G1→G5並行開發

依使用者明確指示，以docs/MVP_RELEASE_PLAN.md最新「新版研發GOAL」為執行依據，主要終點是可實際操作的production線上MVP。內建GOAL仍paused且create_goal拒絕覆寫未完成objective；工具無修改／resume能力，未假標舊目標完成，人工開發繼續。

G1先完成ZIP／站內通知／相機資訊及0067安全發布；G2清理政策；G3剩餘必需驗收；G4production獨立資源與網域cutover；G5真Owner／Guest全流程與交接。主代理負責規劃／複雜問題／資安／整合及雲端變更；三個gpt-6-luna／max分別處理0067 release gate、EXIF原生ACL測試、通知原生隔離測試，分檔案並行、不覆蓋他人WIP。0067先獨立復原及parity，未具備完整證據不套live或部署。

起始f455d00／B schema66基線與已驗切片保留；WIP已另保全patch及21個untracked來源，未碰ignored憑證。A／FILM／Review／客戶資料不動，自刪OFF／dry-run、無Cron、R2優先／Oracle30GB維持。各階段以必要最小驗證→CI→自動B→真實驗收→交接完成，不把文件計畫或local測試當成已上線。

## 2026-11-08 Guest回饋／下載／交付清單恢復補強已部署B並真實驗收

Source f455d0018b16c61bd7e6cdfd95718c2d346f5373，完整CI42410930478成功，自動部署42412803984成功；Worker cac5baee-757a-4504-b98f-bb9b8ecc2f07，baseline bot5668f61，schema66不變。只加列舉Guest metadata GET的一次有限重試／no-store；401／403／404／429、契約／scope、取消、Owner／寫入／實際下載不重試，不共用授權快照；原前後session／邀請／期限核對保留。所有未發布ZIP／通知／EXIF／0067 WIP與根髒檔保全，未改schema／儲存路由或A／DNS／Review／客戶資料。

同一真Guest／既有INV-3061D3CE連續三次重載，相簿24張照片清單、首張私人縮圖、正常下載清單及固定V3成品皆可讀，三項錯誤文字均無。未授權rate／favorite控制保持0，未增加權限，也未冒充已驗該Guest的評等寫入。清單實際展開、燈箱無feedback誤報且可關閉。透過可見「下載成品」連結取得固定V3原圖21527bytes，SHA b26b590c55c31f7d092f2e65d400134cfb252dae3eea81c70dbbef5c2880a6c7，與既有發布manifest完全一致。無Cookie對access／downloads／deliveries三端點均401 GUEST_ACCESS_REQUIRED且無私人payload。租戶／相簿／邀請等拒絕仍由完整原生CI回歸，未新增真第二租戶。

原始首次瞬時失敗HTTP未捕捉、根因未定；不能宣稱已證實冷啟動／配額或所有首次載入零錯誤。Hosted未故意造成503，本機乾淨來源及CI已注入三路首次503、各精確2次後成功。驗收工具曾有兩次locator wait未匹配，後續fresh native AX／DOM確認已就緒，失敗保留，不當作快速載入證據。未做hosted負載／CPU／記憶體或實機觸控。證據docs/releases/guest-read-resilience-{local,hosted}-acceptance.json；截圖root .local/guest-read-{downloads,delivery}-hosted.png，下載檔由瀏覽器存於使用者Downloads，未印Cookie、token、原始IP或憑證。

GOAL tool現查仍是舊KINO Pic／M1→M5、paused；實際已到B schema66與R5部分完成，不能從M1重做，也不能宣稱完整MVP。已將差異寫入MVP_RELEASE_PLAN的最新盤點。下一優先為已保全ZIP／站內通知／EXIF WIP的0067獨立復原與安全發布，並補齊retention確認、production獨立資源／網域cutover及其餘真實驗收；不重做0066、密碼、固定交付、Oracle或縮圖。自刪OFF/dry-run、無Cron、R2優先9GB／Oracle30GB保持，舊restore66備份保留、勿重刪。

## 2026-11-08 Guest唯讀清單有限重試：乾淨來源本機通過，待CI／B

真Guest同一session的access與downloads直接讀取正常，手動重試／重載後三面板恢復；安全tail觀察access／downloads／deliveries200、無exception，selection401符合未授權。原首次失敗HTTP狀態未捕捉，根因未定，不宣稱ACL或資料庫已壞。未更動任何權限／schema／儲存／B資料；A／DNS／Review不動。

最小前端修正只對列舉的Guest metadata GET，遇TypeError或502／503／504重試一次、no-store、不共用授權快照。401／403／404／429、契約／scope／取消、Owner、寫入及實際下載不重送；原前後session／邀請／期限檢查完整保留，持續失敗仍顯示原錯誤。不加入延時選項、背景輪詢或新套件。

乾淨tracked-source快照（獨立offline lockfile安裝，無ZIP／通知／EXIF WIP）26unit、root／Web strict、scoped lint／format、正式product build及原生D1/R2 browser5組通過；新增三清單首次503→實際200各精確2次，無手動重載，原固定版本下載與OFF檢查保留。初次root tsc缺generated Worker types，按標準前置補產後通過；第二次安全tail子行程在本機退出3221226505，不當成雲端成功證據。證據docs/releases/guest-read-resilience-local-acceptance.json。正常CI→自動B→同一真Guest重載及原圖下載待後續最終節。

此為短暫讀取的恢復改善，不宣稱原事件根因已證實或完整MVP完成。GOAL紀錄仍是早期M1–M5／paused，實際進度依MVP_RELEASE_PLAN及發佈證據；既有新指示正在人工接續。正式來源.local/oracle-release-20261106，其餘WIP及根髒檔保全，不從根stage-all、不做0067／新restore。自刪OFF/dry-run、R2優先／Oracle30GB保持。

## 2026-11-08 自適應縮圖列已自動部署B並線上驗收

最終source c685c887b87885ff9f0fe0660437b8b803937cae，完整CI42400059486成功，自動部署42401987313成功；Worker d7fabc7f-b225-4b92-8031-e7fdf2295568，baseline bot7d6b5d2，schema66。縮圖依實際可用寬度顯示目前與鄰近照片，不固定五張；獨立flow row收合露上方1/3、opacity0.62，hover／真鍵盤focus展開，選中高亮。收合及展開均不覆蓋照片，保留原服務、權限、網址及草稿保護；觸控原有完整可點列維持。

真Owner在既有24張合成相簿實測1699px21張、1280px17張、375px6張；三尺寸兩態均noOverlap／thumbsFit／selectedVisible，私人預覽正常。切第17張後window移至8–24，Owner網址更新、移出收合、關閉移除photoId及重開正常。獨立Guest1280px17張、相同鄰近window／高亮／鍵盤展開／關閉通過。Guest375 hosted未驗：現有IAB tab未套用viewport override而維持1280；CI的真產品Guest375檢查已通過，不把它冒稱hosted或實機觸控。暫時viewport均reset。證據docs/releases/filmstrip-adaptive-hosted-acceptance.json；截圖root .local/filmstrip-adaptive-{owner-expanded,owner-folded,owner-mobile,guest-expanded}-hosted.png。

兩次CI失敗均保留：42395835837忽略Guest既有160px最低stage，已按實際floor修正；42397770413最後Guest navigation等networkidle逾時，僅比照Owner改DOM就緒，保留HTTP200與真實按鈕／燈箱／下載斷言。最後完整CI成功，未跳過守門。原CSS fixture加入tall tools edge後證據同步raw variant；不以fixture取代clean CI或hosted。

尚有獨立Guest讀取問題：下載／交付清單錯誤在本次部署前已見，feedback於本次重載亦顯示暫時無法載入，根因未定；不能宣稱Guest完整流程零錯或完整MVP。下一步先定位其現有capability／授權session／邀請scope的讀取失敗，保留隔離，不全域開權限。ZIP／通知／EXIF及0067仍為未發布WIP；新restore67未建立、live67未採用。舊restore66僅依明確授權完整備份核對後退役、備份保留，勿重刪或重做已通過0066。

正式來源仍.local/oracle-release-20261106；根不同產品髒檔保全，不從根stage-all或重建。此次無schema／儲存路由變更；A／DNS／Review／客戶資料未改，自刪OFF/dry-run、無Cron、R2優先9GB／Oracle30GB維持。Owner與Guest驗收頁保留，Owner為使用者輸出、Guest留接續診斷。尚未驗實機觸控／負載／CPU記憶體，ZIP等不得混入此次已驗UI發布。

## 2026-11-08 第二輪 CI 導航等待修正（產品不變，待 CI／B）

de94bf8 的 CI42397770413 已通過原失敗的 Guest 縮圖檢查、完整 test:cloudflare 及 B 原生範圍驗證；最後獨立核准／交付 UI helper 在 Guest page.goto 等待 networkidle 30秒逾時，原因未定，保留失敗，不宣稱CI成功。只將該 Guest opener 比照現有 Owner opener改為domcontentloaded；原 HTTP200、照片按鈕可操作、燈箱及後續核准／固定原圖實際下載斷言完整保留，不增加逾時。

以HEAD helper隔離副本（不含ZIP／通知WIP）加此單行修正，本機現有候選bundle／隔離D1/R2實跑5組通過；這不是clean CI或hosted驗收。node --check與scoped format通過；正常CI／自動B待後續最終節。UI產品仍是87c6bdab的可用寬度／獨立列實作，schema66與A／DNS／Review／客戶資料不動。原CSS fixture增加最低高度情境後，compact evidence亦同步目前raw variant的幾何值，原失敗紀錄保留。

## 2026-11-08 自適應縮圖 CI 失敗保留與窄螢幕最低高度檢查修正

87c6bdab 的 CI42395835837 未通過；Guest browser 第1202行錯誤假設375px鍵盤展開時照片必定再縮小。此前同次 noOverlap／thumbsFit／selectedVisible 檢查已通過。獨立 production CSS fixture 實測 tall tools＋header：收合／展開 stage 均160px（既有最低高度）、rail18.922→56.797px、兩態 stage.bottom386.562≤rail.top397.75；沒有重疊，tools／scroll吸收餘下高度。保留原失敗log，不以fixture冒充完整產品驗收。

只修正測試按既有最低高度計算預期stage，保留桌面縮小、窄／寬可容納縮圖數、1/3收合、active高亮、滑鼠移出、真鍵盤focus及所有隔離斷言；不改產品CSS／服務／schema。修正後正常CI及B結果待後續最終節。A／DNS／Review／客戶資料不動，0067與ZIP等WIP不混入UI發布。

## 2026-11-08 縮圖依可用寬度顯示鄰近照片，收合／展開均不重疊（待 CI／B）

使用者最新要求取代舊overlay設計及hover不改stage尺寸的舊斷言：縮圖列恢復獨立flow row，收合只佔full高度1/3且半透明，展開時照片區1fr同步縮小，兩態stage.bottom皆小於rail.top。沒有隱藏區覆蓋照片或搶點擊。觸控保留完整獨立列；keyboard focus-visible展開，mouse click後移出收合，active外框及原導航／網址／草稿保護維持。版本比較保留既有獨立列。

沒有固定5張上限。共用pure window＋ResizeObserver量nav內容寬度、CSS縮圖尺寸、gap與padding，僅render可容納的目前／鄰近照片，保留絕對序號；窄螢幕減少、寬螢幕增加，無水平截斷。Guest hook在early return前呼叫，穩定callback ref處理比較模式卸載／重掛，原權限與私有資產不變。

本機pure window5測試與Web strict／scoped lint通過；production CSS四組Owner／Guest desktop/touch版面測試通過，收合約25.33px／完整76px；hover照片stage658.53→607.86px，兩態noOverlap、thumbsFit、selectedVisible均true。root另以真本機workerd/D1/R2/Sharp八張合成照片實際查看收合／展開，照片與縮圖分離；這不是雲端OAuth驗收。既有原生browser helper已改為新規範，CI與B結果待最終節。證據docs/releases/filmstrip-hover-layout.json；預覽http://127.0.0.1:4180（暫時驗收runtime，非正式B）。

此次前端發布不含ZIP／通知／EXIF的其餘WIP，不改schema66或儲存路由；B先前3395d58／CI42390574802／deploy42392569721已通過，但不是這份最新規範。A／DNS／Review／客戶資料不動。另依使用者本次明確授權，舊restore66完整備份、hash／152表／FK0核對後退役，備份保留，B剩9個DB；live66保持，未套0067。初次本機0067檢查誤比較整份schema hash，修正為精確舊表／舊schema及四項新增物件後通過，失敗保留；不得用它冒充遠端獨立復原。其餘WIP不混入UI-only staging patch。

## 2026-11-08 縮圖點擊後移出收合補正（待 CI／B 驗收）

第一版 d9aa056／CI42388285058／自動部署42389764115已成功，B version62538342-7f64-4251-8d23-8b15460e237e、schema66；一般燈箱已無thumbnail專用列，hover可浮出。補驗發現滑鼠點縮圖後focus-within殘留會使移出仍展開，不能把第一版宣稱完整通過。最小補丁只將展開／外框的條件改成focus-visible：滑鼠點過再移出收合，真正鍵盤Tab仍完整展開。

Owner／Guest既有browser helper新增真實點擊→移出→1/3斷言及Shift+Tab／Tab焦點可見斷言；保留選圖、網址、草稿、切圖、原授權與版本比較例外。本次仍不包含ZIP／通知／EXIF WIP，不改schema或A／DNS／Review／客戶資料。完整CI與hosted結果待後續最終節，不能以本機CSS fixture冒充正式UI驗收。

## 2026-11-07 燈箱縮圖列浮動收合（待 CI／B 驗收）

實際 Chromium 的 production CSS／最小 DOM 版面驗證四組通過：Owner／Guest 桌面 hover、focus、移出及 reduced-motion；375px touch context 完整可點。檢查真實 bounds／elementFromPoint，收合約 1/3，展開不改照片 stage 尺寸。證據 docs/releases/filmstrip-hover-layout.json（不是 API／hosted 或實機觸控驗收）。

本次只發布一般 Owner／Guest 相片燈箱的縮圖列改善：桌面未 hover 時露出上方約 1/3、透明度 0.62；hover／鍵盤 focus-within 完整浮出，選中照片外框保留。縮圖列改為覆蓋照片的定位，不再保留獨立 grid row；收合的隱藏部分不攔截照片點擊。觸控維持完整可點列，reduced-motion 關閉動畫。Owner 展開版本比較沿用既有獨立縮圖列；Guest 比較畫面原無該列。

保留既有操作／授權及 schema66，不含尚未完成驗收的 ZIP／站內通知／EXIF 工作。相關 WIP 檔案留在隔離 release checkout，未混入此次發布。A／DNS／Review／客戶資料未改，自刪 OFF／dry-run、單 R2 與 Oracle30GB 設定不變。既有 Owner/Guest 真實 browser helper 增加收合比例、hit-test、hover/focus、active highlight 與無專用列檢查。CI／部署與 hosted 尚未完成前不宣稱上線；以後續最終節及 release manifest 為準。

## 2026-11-07 代表核准與固定版本成品交付已自動部署 B 並真實驗收

最終source ac5dd7bd98ae10125f28acd8a73ed0dec72dda94，完整CI42381439868成功，既有流程自動部署42383253098成功；Worker be30a41a-f94f-4515-b601-eda1db55849a，baseline bot6980099，schema66。已明確授權退役舊restore65並保留完整備份；fresh65→獨立restore66→live parity／0066採用通過。D1約7.3MB，先前阻塞是10個DB名額，非照片或資料量滿；未刪其他DB。

真Owner在既有合成613487…相簿、a3a6…照片為V3建立兩份邀請的固定請求ecd6a2b7…；只有一位Guest代表確認，雲端唯讀核對為2個指定邀請／1筆receipt。Owner只交付INV-3061D3CE；獨立Guest實際下載V3。暫時將head3→1仍下載同一V3原圖，後還原head3／revision3；V2保持queued。三次native下載均21527bytes、SHA b26b590c55c31f7d092f2e65d400134cfb252dae3eea81c70dbbef5c2880a6c7，含撤銷後重新發布的實際檔案。

INV-40C9BFFB可看相簿但看不到交付檔名或下載控制，重播第一人的直接下載URL回GUEST_ACCESS_REQUIRED。Owner確認撤銷後，原收件人連結移除且直接重播亦拒絕；重新發布只給第一份邀請。最終保留active交付4cf01abe-0f82-45e6-b185-7426bc6b5d7e供驗收，舊167ec913…保持撤銷與歷史。雲端審計核對published2／revoked1／requested3／generated3；兩份manifest皆固定V3與唯一收件邀請，IP只檢查型別text，未輸出原值或憑證。核准在Guest登出後仍保留，沒有要求第二位確認。

實際觀察保留：部署後首次Guest核准面板讀取曾顯示一般服務錯誤，同Guest直接GET成功，透過可見重試後恢復並完成其餘流程，原因未定，不宣稱首次載入零錯誤或負載穩定。可選CLI審計首讀7403；確認B OAuth與既有D1權限、明確固定account後回讀成功，未變更／擴大憑證。先前3次CI失敗（Web narrow／OFF多讀／舊schema證據）均保留並修正；最終完整CI成功，不以失敗冒充通過。

證據docs/releases/approved-deliveries-hosted-acceptance.json、0066-restore與retired-restore65 manifests；截圖root .local/approved-delivery-{guest,owner}-hosted.png。真Owner／獨立Guest頁保留可操作，連結token只用於瀏覽器記憶體並已清除工具變數。正式候選仍在.local/oracle-release-20261106，根不同產品變更保全，勿覆蓋。

此切片完成；完整MVP未完成。下一步依MVP_RELEASE_PLAN完成ZIP／基本通知、其餘retention確認與production cutover；不要重做已通過0066復原、代表核准、固定交付、密碼或Oracle接線。未驗hosted負載／CPU記憶體數值、實機觸控、真第二租戶帳號（native跨租戶拒絕已過）。A／DNS／Review／客戶資料未改；自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。

## 2026-11-07 全部產品 CI 測試通過，發布證據版本守門修正

CI42379148941（02e334f）所有產品／原生／browser與新核准交付介面檢查已過；最終release evidence仍失敗，不稱CI成功。原因為動態manual cleanup proof已驗schema66，但checker仍要求65。已改精確66，新增拒絕65負例；原生單一manual cleanup test實跑成功（6 assets／2 versions／11276 bytes實際釋放），目前B-profile26組與完整release self-test通過。之前local65proof不能代表新schema；Git合併將新SQL CRLF正規為LF，舊raw hash失配後亦重新實跑profile產生證據，未手改proof冒充。第三輪失敗保留；再走正常CI，不重做已完成的B0066遷移，不改A。

## 2026-11-07 CI 關閉功能的多餘權限讀取已修正

第二輪CI42378092992已通過strict／unit／integration／build／前段browser，在原生Guest feedback初始read計數5!=4失敗。新交付面板於OFF仍先讀access；改為先查公開capability，OFF即返回，ON仍保留前後Guest身分及獨立權限核對。舊精確4次斷言完整保留，不以增加數量掩蓋多餘請求。Web strict、scopedlint/format、target build與5組核准交付focused browser（實際下載與OFF）通過。首個沙箱build遇Windows libuv assertion；受允許環境第二次成功，保留失敗log。再走正常CI／自動B，不更動schema66或A。

## 2026-11-07 CI 型別檢查修正

首輪CI42377707860於Web strict未通過：Guest panel status為合併union，雖runtime已隱藏loading/disabled，TypeScript未排除該成員。補上ready正向render guard，不改權限或請求；完整Web next typegen＋tsc實跑通過，scoped lint/format通過。root strict原先未包含target-ui，不能用它代替Web strict；前次本機驗證未涵蓋此點。保留失敗，接續正常CI／自動B部署與hosted驗收，不跳過檢查。

## 2026-11-07 0066 雲端獨立復原與 B 遷移通過；待 CI／部署

使用者明確允許退役已完整備份的舊 restore65；重驗SHA後只刪04966465-e0f7-4cd8-9c32-7065034406cd，備份仍保留。B先前滿的是10個DB名額；實際live DB約7.31MB，不是照片滿。新獨立庫kino-pick-restore66-cd22482b／bd1042a1-3c29-4ccb-9a8e-0c8ef80d6f9e成功復原fresh65並升66；152舊表／3306列hash、schema與sequence一致，FK0。fresh live parity後只套0066，source-after與獨立drill一致，9次CLI均0。正式manifest docs/releases/approved-deliveries-0066-restore.json；舊庫退役證據retired-restore65-20261107.json。A／DNS／Review／客戶資料不動。

保留失敗：第一輪schema核對只因CRLF/LF不一致；命令均0，未重跑restore/DDL。工具新增--verify-restore核對既有匯出、原成功命令與固定B/target，schema只正規換行，資料hash不放寬；再--adopt成功。首兩次release self-test分別發現舊65組名與66自測fixture缺nativeProof，已修正測試/守門fixture，第三次通過，沒有刪除負面守門。Product/native/browser驗證沿用同一未變來源，不重複全量本機測試。

目前live DB為66、Worker仍是前一版55af3ca／616e7a23-cd3f-4738-bc55-82da5c226ad9。接續合併已保全功能分支至main，正常CI→自動B部署→真Owner建立核准、獨立Guest代表確認、Owner發布、固定V3原圖下載與head切換／撤銷驗收。完整MVP與ZIP／通知仍未完成；自刪OFF/dry-run、R2優先／Oracle30GB保持。

## 2026-11-07 代表核准＋固定版本成品交付：本機完成，B 復原名額待確認

沿用既有0054核准與原介面；一位明確授權客戶代表確認即可，Owner再明確發布給核准名單中的收件邀請。新0066僅增2 views／3 indexes／3 triggers，固定原圖版本、檔名、節點、大小、mime、SHA與核准收據，不隨目前head切換。發布／撤銷／下載沿用append-only audit；查看與原圖下載獨立，租戶／相簿／邀請／session／期限／撤銷逐次驗證。Guest只顯示自己的安全下載歷史，不回傳原始IP。單一照片一份交付，可多次發布；ZIP／通知仍待完成，非完整MVP。

實跑：18 config/boundary＋17 Guest-history單元；26本機原生B-profile組（schema66、2影像fixture）；13攝影師回歸組；5 Chromium核准／交付組，實際存檔size／SHA一致。25份交付為同一原圖的metadata測試，不是25張上傳。strict、product/profile build與scoped lint通過。負面注入GET503與publish409後恢復正常，無草稿燈箱可關閉；精確journal重試、撤銷與request-ID衝突保留。證據docs/releases/approved-deliveries-local-acceptance.json。保留先前失敗紀錄，未把失敗／mock負面回應當正式驗收。

雲端阻塞：B實際回覆D1數量已滿，新的獨立0066復原庫未建立，未套用live0066、未部署本次功能。已完整匯出舊獨立測試庫kino-pick-restore65-20261106（04966465-e0f7-4cd8-9c32-7065034406cd），本機獨立還原65／FK0；2979263 bytes、152表／3039列、SHA e4e44ce7f81cc6b6ecd9feefcc2970c43c1f2cc6b069cb85209007246d539aff，符合原0065 proof。已提出一次刪除此舊測試資源的確認，尚未答覆；不可擅刪、不可繞過復原gate。備份在release clone的apps/worker/.local/approved-deliveries-0066-20261107/preserved-prior-restore65.sql（受ACL保護）。

下一步：收到明確允許後只退役上述舊復原庫；以固定B工具node tools/rehearse-approved-deliveries.mjs --restore產生fresh65備份並遠端獨立復原/升級，成功後--adopt做live parity再只套0066。真正manifest出現後跑release self-test→正常CI→自動B部署→真Owner／獨立Guest核准及固定V3下載、head切換驗收。工具使用隔離Wrangler config；失敗停止不覆寫live。復原優先forward fix；不要將舊snapshot覆蓋新資料，任何回滾先關新flags並保留審計與資產，不能刪歷史換綠燈。

B目前仍是source55af3ca／CI42353228572／deploy42354807451／version616e7a23-cd3f-4738-bc55-82da5c226ad9，schema65。正式候選在.local/oracle-release-20261106；根不同產品變更保全，A／DNS／Review／客戶資料未改，自刪OFF/dry-run、R2優先／Oracle30GB保持。尚未驗新CI／hosted／ZIP通知／負載／實機觸控。

## 2026-11-07 密碼分享已自動部署B並真實驗收

Source55af3ca240a976378c9ef59606363ef8eb142ec0，CI42353228572成功，Actions42354807451自動部署成功，Worker version616e7a23-cd3f-4738-bc55-82da5c226ad9，baseline bot09470f0。沿用原介面與原KDF，三種分享方式保留；系統密碼確為五位數，自訂仍沿用12–256 UTF-16／Unicode／byte限制。附密碼toggle預設OFF，ON在fragment編碼、OFF回復token-only；持完整連結者即可取得密碼。

真Owner只在既有3a21…／94ab…合成相簿建立INV-5917BFF1與INV-54189B8B。獨立Guest先登出舊session，五位數附密碼連結無手動輸密碼即可進入；自訂含Unicode與&/#/+字元，token-only入口錯密碼顯示通用拒絕且無私人照片，輸正確密碼成功，再登出用自訂附密碼連結只填稱呼也成功。兩模式各有4張320×213私人縮圖載入、fragment清除且最終無alert。Owner2次與Guest4次真KDF請求完成，不宣稱hosted CPU數值或壓測。直接DOM密碼值比較曾回false、原因未定；未手動輸密碼的實際登入已通過，沒有把該DOM探針寫成通過。

28單元、26原生B profile組、13攝影師組及完整CI通過；既有browser helper新增toggle ON/OFF斷言已在CI實跑。隔離、期限／撤銷、metadata-only recovery與native KDF釋放保留。證據docs/releases/password-sharing-hosted-acceptance.json與local proof，截圖root .local/password-sharing-{options,toggle,generated-guest,custom-guest}-hosted.png，均不含明文憑證。schema65不變，A／DNS／Review／客戶資料未修改，自刪OFF/dry-run、R2優先／Oracle30GB保持。根不同產品變更保全，正式驗收用B；舊localhost4195不代表本次來源。

下一步依MVP_RELEASE_PLAN完成其餘交付／核准／通知與production cutover驗收；不要重做已通過的密碼分享、65restore或Oracle容量接線。完整MVP仍未完成。附密碼連結應視同密碼保管；未驗hosted負載、CPU／記憶體數值、crash取消、分散猜密碼或實機觸控。

## 2026-11-07 五位數／自訂密碼分享接線：本機通過，待CI與B驗收

沿用既有分享表單、五位數產生器及固定scrypt N32768/r8/p3，僅在B collaboration profile宣告passwordModes:true並開通既有generated_password/custom_password；其他staging／production守門不變。仍限定固定B workspace、enabled Owner、immutable管理見證、單一active album與各自permission。Recovery不重發token或密碼。既有附密碼toggle預設OFF，ON只加入URL fragment；Guest啟動前移除網址片段並預填，custom字元保持原樣，不落browser storage。完整連結持有人即可取得密碼。

28相關單元、strict／scopedlint／product與B profile build、26原生profile組、13攝影師組、release checker通過。Native驗五位數、自訂、wrong/cross-invite401無cookie、非明文verifier、metadata recovery與Owner2/2 Guest5/5 KDF釋放；原隔離／撤銷測試保留。新增既有browser helper的toggle ON/OFF及fragment斷言待完整CI實跑。失敗保留：過早checker使用舊photographer proof；custom回應測試誤預期undefined，合約是null；第二次修正路徑錯未寫入，第三次正確修正後通過，產品驗證未放寬。證據docs/releases/password-sharing-local-acceptance.json。

下一步正常CI→自動B部署→合成相簿真Owner建立兩模式與獨立Guest驗收，確認hosted KDF不超資源限制；若異常不盲重試或清鎖，依KDF_ADMISSION.md。schema65不變、自刪OFF/dry-run、R2優先／Oracle30GB保持，A／DNS／Review／客戶資料不動，根不同產品變更保全。完整MVP未完成。

## 2026-11-07 Managed分享／Guest接線與照片主體燈箱：已自動部署B並驗收

最終source32ee04f577575c88a537413de2522a686b0569c5，CI42285915567成功，Actions42288958762自動部署成功，Worker version d996457b-b637-49d7-b267-f624de4911bc，baseline bot f38193c。第一版d185d1f／CI42281886730／deploy42284130975也成功，但hosted Guest發現disabled shared-review capability404誤報；已修成兩個唯讀能力200 enabled:false，資料／寫入仍不開放。此節取代待CI狀態。

真Owner透過既有GitHub正常刷新登入，在Owner建立見證的3a21…專案／94ab…合成相簿建立INV-44206342分享。獨立IAB Guest免註冊進入，四張私人縮圖320×213均載入，Oracle測試圖預覽1280×853可讀，挑選一張後重載及補丁部署後仍保留；Guest SVG切第二張成功。最終Guest無通用載入錯誤、無alert，期限顯示正常；沒有把bearer、password或session cookie寫入Git／證據。相簿單一link_only分享已接通，密碼模式仍保留原hosted守門，不稱完整MVP。

Owner與Guest上下張SVG保留aria/tooltip，右欄縮窄且可一鍵收合。真Owner測得stage1314.49→1667.11px，hover縮圖opacity0→1且照片rect完全不變，SVG下一張更新photoId並可關閉。側欄預設展開，收合時照片為主；pending禁止收合，保留原草稿與未知寫入保護。觸控常駐／reduced-motion規則與375px原生檢查通過，不宣稱實機觸控驗收。UI在補丁前後來源未變；完整CI包含新增hover／收合／SVG斷言，最終Guest已重載驗收。

本機22單元、26原生B profile組、13攝影師組與既有真草稿browser2組、strict／lint／build／release checker通過。Native已驗跨project／同project未分享album、invite recovery一致、download-only不要求view、撤銷、封存狀態fixture登出；線上無CookieOwner/Guest資料讀取仍401，兩項未開放Guest能力200 false。證據docs/releases/managed-sharing-hosted-acceptance.json，截圖root .local/managed-sharing-{lightbox,guest}-hosted.png。僅合成邀請與挑片測試，A／DNS／Review／客戶資料未修改，schema65不變，自刪OFF/dry-run、R2優先／Oracle30GB保持。

正式來源.local/oracle-release-20261106與私人GitHub已整合；根不同產品變更與舊localhost4195未覆蓋，驗收用B。下一步是hosted密碼分享模式與其KDF／濫用／跨邀請驗收，以及其餘交付／版本核准／production cutover需求；不要重做已通過的managed sharing、65restore或Oracle儲存驗收。完整MVP仍未完成。

## 2026-11-07 Managed分享已部署、Guest實測發現補充能力404；修正待CI

第一版source d185d1fe3e83c6caa46477119f6bcea7e95aa304，CI42281886730及Actions42284130975成功，B version1103ce35-498c-4742-a23a-2c84bbab384a。真Owner重新以既有GitHub登入、在managed Oracle/R2合成相簿建立分享成功，獨立IAB Guest免帳號進入，4張320×213私人縮圖載入且挑片成功。一次性連結只在瀏覽器記憶體使用，不輸出或保存憑證；瀏覽器clipboard橋接讀回空，但頁面已複製提示與提供的訪客入口有效，不宣稱橋接讀回驗收通過。

未標此切片完整驗收：GuestSharedReviewLinks固定讀取shared-reviews capability，collaboration邊界未放行而404，誤顯示通用載入失敗。補放行Guest shared-reviews與version-approvals兩個GET/HEAD能力查詢，兩者仍回enabled:false，資料／寫入路由不開放，Guest不顯示未提供功能。22單元、26原生profile組（新增false能力與POST404）、13攝影師組、build／scopedlint／release checker已通過；UI原始版本desktop hover／收合／SVG／pending斷言已在第一版完整CI通過，不重跑無關本機browser。接續正常CI→自動B部署→Guest重載無誤報＋挑片持續性、Owner/Guest燈箱互動與截圖。

schema65、A／DNS／Review／客戶資料與R2優先／Oracle30GB保持，自刪OFF/dry-run；沒有新憑證或schema。正式來源仍.local/oracle-release-20261106，根不同產品變更保全。完整MVP未完成。

## 2026-11-07 Managed新專案分享與Guest接線、精簡燈箱；待CI／B驗收

沿既有B collaboration profile擴展單相簿無密碼分享：固定B workspace、enabled Owner、project.created／album.created immutable命令見證，非管理資料仍拒絕；邀請create/recovery/revoke、Guest exchange／HTML入口／相簿API／資產／登出同一範圍。Recovery比對payload與live project/唯一album，服務仍檢查session、seal、期限、maxUses、撤銷及獨立permissions。download-only不再被額外can_view阻擋。能力加可選managedAlbums:true供既有分享表單選自己的相簿，單相簿link_only限制保留；不是全域開啟所有模式或租戶。

Owner與Guest燈箱沿用現有元件，SVG上下張保留aria／tooltip、工具欄縮窄並可收合（預設展開以保留操作路徑，pending不可收合）、桌面縮圖列hover/focus顯示、觸控常駐與reduced-motion，顯示不改photo layout。比較模式不顯示收合控制，避免藏掉比較內容。現有pending、鍵盤及網址行為保留；沒有新框架／dependency／schema。

本機最終成品：21單元、26原生B profile組（真managed邀請／exchange／挑片／縮圖、跨專案／未分享相簿／download-only／撤銷／封存狀態登出）、13攝影師組、燈箱註記真草稿／未知write復原2組、strict／scopedlint／build／release checker通過。新desktop hover不reflow、收合加寬、SVG與pending鎖斷言已加入原photo-version-heads browser helper，待完整CI實跑，不冒稱本機已跑。顧問靜態審查指出logout不應要求仍active，已修；隔離封存狀態是DB fixture，不是封存API驗收。

保留失敗：sandbox dry-run讀目錄被拒後elevated成功；首次native登出fixture缺既有requestId，第二次試以非空相簿呼叫archive API被既有守門409，改隔離archived-state fixture後通過，產品守門未放寬。證據docs/releases/managed-sharing-local-acceptance.json。下一步CI成功→自動B部署→真Owner新managed分享、獨立Guest瀏覽／挑片與燈箱互動驗收。A／DNS／Review／客戶資料不動，自刪OFF/dry-run、R2優先／Oracle30GB保持；根不同產品變更保全。完整MVP仍未完成。

## 2026-11-07 Owner協作讀取已自動部署B並真實驗收

Source f9818399921775f56e47cf257d67e39484cf5668，CI42261696602成功，Actions42263958748自動部署成功，Worker version0f258dda-bdc1-4a0a-ba04-656f90e84086，baseline bot db11be3。此節取代下方待CI狀態；schema65、R2優先／Oracle30GB、自刪OFF/dry-run保持，A／DNS／Review／客戶資料未修改。

真Owner在B新managed project驗收：邀請空清單可讀、註記初始化不再拒絕、V1正常，版本核准能力不再冒稱權限改變。在原已授權合成相簿明確選邀請1，V3空留言／註記正常；切V1後讀到既有Guest留言、Guest自由筆畫與Owner自由筆畫及編輯入口。版本紀錄V1/V2/V3與head V3正常，舊queued V2保留；沒有新增留言／筆畫／版本或改head。六個無Cookie讀取端點均401 AUTH_REQUIRED。原生與CI已驗跨邀請／非管理範圍拒絕。證據docs/releases/owner-collaboration-read-hosted-acceptance.json，截圖root .local/owner-collaboration-{comments,annotations}-hosted.png。

Ponytail審查：產品僅修兩處讀取入口，沿用既有Owner/session/workspace與managed command見證、參數化D1服務；不改DB、Guest邊界或寫入服務。新managed專案邀請POST與hosted版本核准寫入仍有原守門，勿把此次讀取修復說成已開通全部Guest分享或完整MVP。下一步處理managed專案分享發行／Guest範圍的最小安全垂直切片與正式驗收；Oracle縮圖處理仍候選。根目錄不同產品變更保全、舊本機預覽未覆蓋，正式來源仍.local/oracle-release-20261106。

## 2026-11-07 已授權Owner協作讀取修正；待CI與B真實驗收

共同根因：managed project已有Owner建立命令見證，但boundary把所有非舊驗收專案的/invites一律404。Owner留言、手繪初始化共用邀請清單，因而一起失敗。現在只讓GET沿既有managed project/session/workspace檢查讀取；非原驗收scope的POST issuance仍拒絕，Guest路由／scope不變。版本清單原服務不變；Owner版本核准capability准予讀取真實enabled:false，不擅自開啟核准寫入。

新增實際隔離managed project＋active album＋R2上傳/Sharp衍生圖＋sealed邀請，驗GET邀請、版本、留言thread、客戶註記及Owner手繪讀取200；錯邀請與未登入拒絕。沿用現有DB服務與參數化scope，不改schema或套件。9單元、26原生B profile組、13攝影師組、strict/scopedlint/build/release checker通過。首次原生因外來邀請fixture引用尚未建立相簿而FK失敗，改用已存在但不同scope的相簿後通過；產品授權未放寬。證據docs/releases/owner-collaboration-read-local-acceptance.json。

下一步：正常CI→自動部署B→真Owner留言／手繪／版本讀取驗收；A／DNS／Review／客戶資料不動，自刪OFF/dry-run、R2優先與Oracle30GB保持。根來源不同變更保全，正式來源仍.local/oracle-release-20261106；完整MVP未完成。

## 2026-11-07 燈箱／處理設定／單列複選歷史：已自動部署B並真實驗收

Source d08f20b920f686398f621248117be4426e505c14，CI42252665080成功，Actions42255098747自動部署成功，Worker version38631e68-2350-4085-a3a0-80f09193fedf；baseline bot fb7edf6。此節取代下方待CI狀態。本次無schema變更，schema65不變；A／DNS／Review／客戶資料未改，自動刪除OFF/dry-run，R2優先與Oracle30GB儲存保持。

真Owner在B驗收：處理設定正常讀取無404，候選radio可選並還原Cloudflare（未儲存新設定）；無編輯且註記讀取404時不再誤報「操作待確認」，可切下一張再關閉回相簿，網址photoId正常移除。既有註記／留言等範圍拒絕仍保留，沒有繞過授權；真草稿與不確定寫入仍由原journal保護，原生測試已驗。

歷史事件單列40px，系統／管理者／訪客checkbox常駐、可複選即時server查詢；系統單選、系統＋管理者複選、全不選的穩定空結果與還原全部24筆均真實通過。進階篩選仍收起，不影響操作者選項；未重下載線上CSV／JSON，實際原生匯出／快照／375px隔離測試與完整CI已通過。兩端無Cookie讀取history／image-processing-policy均401 AUTH_REQUIRED。證據docs/releases/ui-ux-lightbox-hosted-acceptance.json；Ponytail檢驗docs/UI_UX_SIMPLIFICATION_REVIEW.md。

正式來源位於 .local/oracle-release-20261106，已推送私人kinostudio/kino-pick。根目錄五個產品檔仍有不同變更，18個產品來源／本機4196靜態檔均保全未覆蓋；驗收請以B網址為準，不把舊本機頁當本次版本。完整MVP仍未完成；下一步處理現有managed scopes下的協作讀取拒絕與其正式驗收，Oracle縮圖處理仍是候選未接線（儲存溢位已啟用）。不要重做已通過的65restore或Oracle儲存驗收。

## 2026-11-07 燈箱誤鎖／處理設定404與緊湊歷史整合；待CI／B驗收

燈箱：OwnerAnnotations只在loading時以尚未讀完journal作暫時導航保護；error且沒有真草稿／pending／blocked journal時不再誤報待確認。真草稿、待確認寫入與blocked保護保留。原生新增404讀取失敗可關閉，既有精確寫入恢復斷言保留；修正原helper在options送達前就要求更多分頁的競態，現在等實際目標或下一頁按鈕。

B處理設定：exact allowlist補固定workspace image-processing-policy的GET／POST，無query、Owner／session／Origin／workspace服務檢查不變。原生驗讀取、儲存、相同操作重播、跨來源／身分／workspace拒絕。設定頁改全寬卡片／原生選項與開關，技術版本資訊收起，Oracle縮圖處理仍明示候選未接線，R2優先／Oracle30GB儲存不變。

歷史：事件改單列，操作者checkbox外露、可複選即時server query；新增有界actorTypes（最多3、去重拒絕、固定順序、[]明確無結果），保留legacy actorType，衝突拒絕，快照與匯出同套篩選；不是只濾目前頁面。沒有schema或新dependency。

實跑最後成品：20 focused unit、lightbox原生2組、history375px原生2組（CSV／JSON／快照／Owner變更）、photographer13組、B profile26組，rootstrict／scopedlint／format／正式build與release checker self-test通過。失敗與環境／fixture原因見docs/releases/ui-ux-lightbox-local-acceptance.json，不宣稱失敗為成功。Ponytail審查見docs/UI_UX_SIMPLIFICATION_REVIEW.md。Next正常CI→自動B部署→真Owner燈箱關閉／切圖、處理設定與多選歷史驗收；A／DNS／客戶資料不動，自刪OFF/dry-run，完整MVP未完成。不重做schema65restore。

## 2026-11-06 活動歷史正式整合並已部署B

Source 832b22c4cb8a10e7a13f3c5c89b6641ecae4b443（UI功能a17f366；832b22c僅修既有Oracle表格格式），CI42239361510成功，Actions42242718586自動部署成功，Worker version 9ebc58d7-77a6-4f36-a45e-6b41b4dc663b，baseline botf175583。首次CI42239012475因既有Oracle文件格式停止，已修正並保留失敗；未跳過或放寬部署守門。schema65、R2優先／Oracle30GB、原有授權與自刪OFF/dry-run不變，A／DNS／客戶資料不動。

真Owner在B頁面已驗全寬單欄1376px、篩選／匯出預設收起、24筆管理者篩選全為Owner、清除回全部、下一頁24→48、CSV／JSON入口可用。無Cookie明確same-origin請求回401／AUTH_REQUIRED，無私人事件；首次預設urllib得到403，僅作邊緣／前置拒絕，未冒稱應用401。線上未重新下載匯出檔；本機原生375px完整CSV／JSON、快照、串流失敗與Owner變更測試已通過，CI完整通過。證據docs/releases/history-timeline-hosted-acceptance.json，截圖root .local/history-timeline-hosted.png。

已更新正式共用來源，不另建prototype。未知操作保留明細中的原代碼；API、tenant／invite／workspace隔離不變。此歷史UI切片已完成；完整MVP仍未完成，下一高優先仍是燈箱誤報pending與workspace處理配方404，勿重做已通過的Oracle／65restore驗收。

## 2026-11-06 活動時間軸正式整合；待CI與B線上驗收

沿用已確認的簡化UI，正式OwnerWorkspaceHistory採全寬圖示時間軸，篩選／ID條件與CSV/JSON入口預設收起，原操作代碼／來源ID／UTC與安全明細保留。僅history頁隱藏專案側欄，不改API、資料庫、匯出完整性、快照cursor或Owner／workspace／tenant／invite授權。原有browser helper已配合收起狀態先展開篩選及匯出，不減少任何安全斷言。

最小原生驗證：history browser＋outbound0共2組通過，實際375px、51筆快照分頁／新增後refresh、52筆JSON／CSV下載、匯出中斷不產檔、Owner變更清除與重新授權。root strict、scoped ESLint、target build通過。部署所需同bundle photographer13groups與B profile26checks重新生成，release checker self-test通過；schema65不變，既有backup／restore沿用。證據docs/releases/history-timeline-local-acceptance.json。Next：正常CI成功→既有自動B部署→真Owner hosted頁唯讀驗收與收據；A／DNS／客戶資料不動，自刪OFF/dry-run，完整MVP仍未完成。

## 2026-11-06 活動歷史介面簡化（本機驗收）

依使用者標註，正式共用OwnerWorkspaceHistory改全寬圖示時間軸；移除history頁側欄ProjectDirectory占位，設定／邀請頁維持原配置。篩選、進階ID查詢、匯出預設收起，來源ID／UTC時間／原操作代碼與安全明細仍可展開；未知操作主標題改人話「其他操作」，原代碼留在明細。沿用既有API、權限、snapshot、分頁及匯出流程，未更動DB／審計資料。

既有瀏覽器測試同步展開篩選／進階條件並更新未知標題期待；本次未執行整組原生history harness。release clone root strict、scoped ESLint及Vite正式UI build通過（既有chunk>500kB警告保留）。4196真本機API手動驗：系統篩選成功、清除回全部、匯出CSV／JSON入口可展開；本次未下載匯出檔。截圖root .local/history-simplified-preview.png。正式來源與root4196靜態資產已更新；未push／部署B，不動A／客戶資料。Next：使用者驗收外觀，之後合併到B部署前需刷新bundle-bound release證據；不要把本機UI結果宣稱線上已發布。

## 2026-11-06 Oracle overflow 正式線上切片通過；完整MVP仍未完成

B source e6c49e8e84f65d457712a54be7afd776975a304c，CI42193586106成功，Actions42196024894成功，version36e4ed7e-585d-4595-aba5-8bf942ab5aa4；baseline bot88ab0ae。首次部署42195575135在predeploy Cloudflare API503停止，保留失敗；同版正常重試通過，未放寬任何守門。schema65與既有備份復原證據不變。

真Owner重試新c679工作成功（attempt2），再以受控R2 logical cap上傳全新KINO_ORACLE_AUTO_ACCEPTANCE_20261106.png，Oracle原圖／Cloudflare縮圖與預覽自動成功（job02f80ab3…attempt1）；結果後立即CAS＋審計還原R2 9GB，requestcb79f2f3…狀態restored、primary metrics保留。原6376工作最後attempt3亦正常成功，沒有operator改寫product slots。四筆合成job全部succeeded／reserved0；Oracle帳本71673bytes、R2 9051458bytes，兩節點active／reserved0；policyrevision1／command1／30GB／floor20GB。先前真R2恢復優先上傳保留，現在R2各3資產再次驗節點。

兩組fixed合成照片唯讀D1各6資產，changed_db=false／rows_written0。舊與全新Oracle各3物件實際GET size＋SHA全部匹配；original16336、thumbnail547、preview7008。正式Owner瀑布流四縮圖natural320×213、全新Oracle預覽1280×853皆載入，截圖保存在root .local/oracle-hosted-final-{gallery,preview,settings}.png。公開證據docs/releases/oracle-hosted-overflow-acceptance.json，含本機證據雜湊、不含憑證或原始請求。cache:no-store已經hosted修復驗證；冷HEAD轉GET是合理根因推論，仍未直接觀測Edge改寫。

R2有足夠原圖＋16MiB預算即優先R2，不足才Oracle；已存在VM照片不自動搬回，容量擴充不是備份。自刪OFF/dry-run，A／DNS／Review／客戶資料不動。30GB實體near-full、VM重開機、filesystem實體擴大與Guest Oracle完整E2E未驗。

Next最高優先：修正Owner燈箱未編輯仍誤報pending而鎖住關閉／導航（兩tab已保留，不清journal），以及workspace處理配方404；新PNG安全tail另有PHOTOGRAPHER_METADATA_IMPORT_FAILED，衍生圖已成功但不可宣稱metadata匯入成功。既有相簿留言／版本確認／註記在此新合成managed scope仍有不可用提示，屬後續正式功能驗收。完整MVP未完成；本次Oracle儲存切片完成，不再重做已通過65restore或四筆上傳。

## 2026-11-06 修正私人SigV4請求快取；HEAD改GET仍屬待hosted驗證推論

C8分類版：c8f5ccc／CI42189031679／Actions42190870619成功，version60348755-8173-4abf-8958-4c45558a0b7f，baseline botc7ea731。新合成KINO_ORACLE_DENIAL_ACCEPTANCE_20261106.png原圖上傳完成，jobc67969ea-9bd1-4773-a321-99a548a8a7d7實查attempt1／retryable／16MiB；phase thumbnail_write收到403，分類OTHER_RESPONSE／NO_S3_CODE／CF_RAY_PRESENT／SERVER_CLOUDFLARE。R2 cap51431104…已立即restore9GB並保留primary metrics。

重要更正：舊job63761339…第二次重試後preview7008實際已存在，thumbnail547也存在；所以write階段包含PUT後的HEAD，不能把此前403直接稱為PUT被拒。DNS A=161.33.30.210、AAAA無紀錄；local Node／workerd相同preview bytes寫獨立key成功。Cloudflare官方明載cold HEAD對可快取資源可能轉GET；這與SigV4綁定method相衝突，是目前有證據支持的推論，尚未直接觀測Edge改寫。不能僅憑server/cf-ray就認定A防火牆阻擋，未改A安全規則。

最小修正：S3 request增加cache:no-store，覆蓋HEAD/GET/PUT私人簽名資料；manual redirect、checksum、conditional write、404/412/304處理不變。既有compat日期已支援，不增flag。403額外只記固定HTTP method，便於辨別PUT與HEAD。13項unit驗最終aws4fetch Request的cache，rootstrict／scopedlint／target build、photographer13groups、B profile26checks及release checker self-test通過；actual local workerd對既有preview只做HEAD，cache:no-store／200／7008bytes。此read-only operator的舊顯示label沿用created，但outbound僅1個HEAD，不能解讀為新增物件；raw log保留。不是hosted修復證明。

Next：正常CI→B部署→先重試較新的c679工作，成功後驗fresh Oracle完整自動縮圖（cap後立刻restore9GB），再使用舊6376最後第3次。舊job實查attempt2，禁止盲目消耗最後機會。原圖／版本／審計保留、schema65不重做restore，自刪OFF，A／DNS／Review不動。獨立診斷小物件保留在_kino/probes供核對，不占product slot。

另：舊只讀燈箱tab1650469677在長時間媒體下載後顯示Owner pending而關閉disabled；本代理未做標記編輯，未清除任何可能journal，保留該tab handoff。新tab1650469679用於上傳驗收。此UI問題與工作區配方404仍待後續，不宣稱完整MVP完成。

## 2026-11-06 線上阻點確定為preview PUT403；保留舊工作最後重試

0eca0f7／CI42164555235／Actions42166043202成功，versionc58c40ae-1213-432c-be69-39030902e771，baseline botc505250。真Owner按新『重試縮圖』一次，job63761339…仍retryable，預期attempt2。安全tail已捕捉S3_STORAGE_HTTP_403＋IMAGE_PROCESSING_FAILED／preview_write；不再盲目重試此job，保留第三次機會。

原圖16336／SHA0ed3…與縮圖547／SHA654cf9…皆可讀；正式R2同來源preview7008／SHA7a8258…已透過可見Owner燈箱取得（browser媒體下載等待異常延長，未重複嘗試）。相同7008bytes透過Node與local workerd實際S3 adapter寫獨立私人診斷key都200，不能拿此當hosted成功；productpreviewslot未被operator改寫。VM storage／timer／Review／Caddy active，無signature/error log；Caddy未啟用HTTP access log，無既有請求記錄可分類，未修改設定。A/DNS/Review均不動，R2仍9GB。

下一版只補S3 403的最多4KiB錯誤body分類：固定HTML/XML/other、六個S3 code白名單（含constructor防護）、cf-ray存在性與server分類，不記原文／URL／headers／keys。13項S3 focused測試通過；標準建置、root strict、13groups photographer與26checks B profile、release checker self-test通過。Next：正常CI／B部署後，以新合成上傳工作收集分類（不要消耗舊job最後attempt）；R2 temporary cap結果後立即restore9GB。403來源尚未確定，不能關安全規則、移除checksum/conditional write或宣稱MVP完成。

## 2026-11-06 B Oracle原圖直傳已驗；補既有工作精確重試與安全階段日誌

f708825／CI42159596204／Actions42161310874成功，versiond97eef49-7dea-4f5e-86c8-5c4495a527af，baseline botf4588d8。真Owner頁面reload後，單張KINO_ORACLE_HOSTED_ACCEPTANCE_20261106.png已完成Oracle PUT／completion。受控R2 logical cap25828674（不是實體滿載），request6ec4d26b…；上傳結果出現後已CAS＋審計立即還原9GB，primary metrics保留。先前4999fdeb…新上傳回R2證據仍保留。

Oracle job63761339-33c5-4f71-a83f-84ae84379aab目前retryable／PROCESSING_IO_UNCERTAIN／attempt1，保留16MiB預留。原圖真S3 GET16336bytes／SHA0ed3…匹配；thumbnail已存在547bytes且NodeHEAD/GET checksum匹配，preview不存在。本機actual workerd direct GET同縮圖547／SHA654cf9…成功；後續guarded bridge helper失敗，不能宣稱bridge護欄已驗。尚未定位根因，不能宣稱Oracle完整縮圖圖庫或全MVP完成。

KISS新增Owner精確photo/version processing-retry：沿用既有Owner/session/版本SQL授權，只允許retryable／Cloudflare recipe／epoch<3／active node／非archive；POST空body＋Origin＋CF flag／IMAGES守門，B仍驗managed scope，Guest不開放。復用原job claim/lease、immutable conditional write、讀回與processing審計，不新建上傳、不改schema。圖庫只對Owner retryable照片顯示SVG『重試縮圖』，pending防連點、嚴格回應與刷新，不提供放棄/刪除操作。固定phase日誌不含job key／URL／原始exception；S3只額外分類subrequest limit，不把通用錯誤當排除限額證據。

實跑：focused4files39tests、原生processing recipes10checks（新增Owner/foreign/version/第三次人工審查守門）、B profile26checks、photographer13groups、正式UI/Worker dry-run build、root＋Web strict、scopedlint／format與release checker self-test通過。先前兩次local release self-test因新bundle/新boundary對舊本地proof hash拒絕，已跑原生工具重新產生證據後通過，未放寬守門。Next：此變更正常CI→B自動部署→安全tail只看固定phase→真Owner按同照片重試→核對原圖/縮圖/預覽與兩個節點；R2保持9GB、不重做65restore。A／Review／DNS／客戶資料不動、自刪OFF。

## 2026-11-06 Owner 切回分頁驗收同步修正

8ad7896 的 CI42157936395 於既有 Owner 回覆刪除確認失敗，未部署該前端版本。測試切回 Owner 後在快取的較後頁找到回覆便開始點擊，背景 focus 重新讀取第一頁會替換清單。現在先等待同 scope、切回後的已送達第一頁及載入狀態結束，再用既有分頁 helper 找回回覆；刪除確認、revision、Guest 隔離與 append-only 審計斷言不變，沒有改產品程式。

集中原生 D1/R2/Sharp/375px Chromium exit0，Owner 留言、處理及 outbound0 共3組通過，log SHA256825f664d5d0a4590fee70dac4a14b225f423a9abb67468fcf5720a84f42da103；scoped lint/format 通過。這不是 hosted Oracle PUT 驗收；B仍7f54d93／version59cc383f、Oracle已啟用30GB，R2維持9GB。Next：正常CI及B自動部署，reload前端後驗真Oracle PUT／縮圖及立即還原容量cap。A／Review／DNS不動。

## 2026-11-06 Oracle30GB已生效，R2恢復優先已驗；最後補前端Oracle PUT白名單

7f54d93／CI42153519040／Actions42155770338完整success，version59cc383f-e5be-41a4-aee2-c4c48adec413，baseline botdb1b365。真Owner以原指令完成同步，頁面顯示Oracle容量擴充已生效30GB、floor20GB；schema65不重做。

受控R2邏輯額度cap25804783（不是實體滿載），唯一Oracle session e77789d4…確實reserved／authorized，但前端putUploadFile僅允許R2 host而在fetch前拒絕drive.kinostudio.tw。真S3 HEAD確認無物件，瀏覽器無PUT／CORS錯誤；立即CAS＋審計還原R2 9GB且原metrics保留。Owner正常取消該測試工作，Oracle reserved回0，歷史保留。之後KINO_R2_RETURN_ACCEPTANCE_20261106.png真Owner上傳成功，session4999fdeb…node primary／completion1，私人圖庫1張，證明恢復R2額度後新上傳會回primary。

僅9行前端allowlist補固定HTTPS drive.kinostudio.tw＋kino-pick-overflow非空key，不開一般HTTPS、不動現有R2／loopback／userinfo／fragment／port及credentials omit、no-referrer、瀏覽器redirect:error。子代理focused14測試（含原R2／AbortSignal）及scopedlint／format通過；主代理審查與更新後baseline release self-test通過。Next：此UI修正CI→B自動部署→必須reload上傳頁載入新bundle→保留舊cap/restored計畫證據，再fresh cap／完整Oracle PNG＋縮圖／預覽→立即restore9GB→核對兩張各3assets節點與SHA。A／Review／DNS不動，自刪OFF。證據docs/releases/oracle-browser-upload-boundary.json。

驗收工具兩項本機修正（不改Worker／DB）：JSONC用既有TypeScript parser；預留數只算尚未完成或孤立紀錄，不能把104筆永久歷史當活躍預留。實際aggregate：held bytes0、unresolved0；SQLite self-test保留V1/V2／取消／過期歷史，真active／orphan及CAS不符仍拒絕。第一次JSON parse及歷史count preflight均停止在cap前，未改資料。

## 2026-11-06 後續schema65部署收據相容性已補齊

66f5342（Workers manual轉址修正）完整CI42149196022成功；Actions42151990068在self-test PRIOR_RECEIPT_RESOURCES停止，未寫Worker。原因是原prior收據白名單僅59–62，且後續live／secret證據仍綁首次e6→兩secret過渡。沒有改寫既有收據或放寬備份／授權驗收。

現在明確分兩種baseline：首次仍驗原secret-only全快照；既有65則須完整固定B／8secrets／65 migration hashes／獨立restore hash及parity／native admission證據，歷史secret transition整塊精確鏈結並持續保留原anchor；live必須是最近成功prior的deployment、100%單一version、source message及latest uploaded。當次D1／policy-chain／R2私人／無Cron與安全守門全保留。legacy62 positive、65 positive及錯B／少secret／restore錯誤／native migration錯誤／history斷鏈／舊版本與未核准latest等反例self-test通過，scopedlint／format通過。顧問唯讀審查無新增阻擋。

以既有B OAuth只讀實際CF metadata，新live分支也驗過目前3832118／version37e159cf／deployment837ef4a5；初次raw token過期401，經Wrangler例行刷新同授權後成功，未擴權。CI最後新增同一local-evidence self-test，避免CI綠後才發現本地收據不相容。證據docs/releases/oracle-repeat-deployment-compatibility.json。Next：新source CI→B自動部署→原Owner指令同步→VM／R2回優先線上驗收。B仍383／requested1但effectivefalse，R2未調低；A／Review／DNS不動。

## 2026-11-06 已重現Oracle根因：Workers不支援redirect error

S3 adapter使用Fetch標準redirect:error，但Cloudflare官方Request文件明載Workers僅支援follow／manual；error於Request建構即TypeError。實際adapter編譯至相同日期workerd後，舊版health讀取503且outbound0，證實失敗在外連前；Node相同簽名能讀與VM無請求錯誤的現象一致。

最小修正共用request改manual，明確拒絕3xx轉址、保留304條件讀取及404／412語意，不轉送簽章到Location。相同native adapter改後read200、302拒絕、總outbound2且沒有Location請求；focused10測試通過（含6種3xx、304與安全診斷），scopedlint／format通過。證據docs/releases/oracle-workerd-redirect.json。6790ae4僅診斷的CI已由本修正取代，正式B仍3832118／policy1／effectivefalse，原9GB未調低、hosted上傳未驗。

Next：此根因修正完整CI→B自動部署→真Owner以同requestId完成同步→受控R2不足轉VM→立即還原9GB再驗下一筆回R2。A／Review／DNS不動，65復原不重做、自動刪除OFF。隔離release clone仍為本次可發佈來源；原工作樹其他髒變更不納入。

## 2026-11-06 B自動部署成功；Oracle已要求啟用，健康同步待診斷

3832118／CI42145303014／Actions42146981782完整success，version37e159cf-6f2f-48c6-86e2-64a1894ce6f5，baseline bot6d38835。既有schema65／13guards／8secrets／私人R2／A隔離守門通過，workers.dev已開且真Owner可用。未重做65復原。

真Owner以既有介面啟用30GB，D1 requested1／revision1／唯一command1已提交，但publishVmPolicy及health讀取失敗，health表0rows；原requestId重試仍待確認，保留原操作，不新發指令。系統按設計effective=false；R2原9GB未調低、未嘗試VM上傳。本機同憑證之真S3 adapter可讀policy39bytes／revision1與fresh mounted健康126bytes／30GB，VM儲存／timer／Review API／Caddy active；B到VM的共同讀取路徑仍待定位，不能宣稱已開通。

已補最小安全診斷：Owner健康／policy失敗只記phase與最長100字的內部enum，S3只記HTTP status；不輸出原始錯誤、網址、headers、body或憑證，generic UI及fail-closed不改。兩檔focused9測試與scopedlint／format通過，含私密字串與超長值遮罩、錯誤不吞掉。下一步此診斷正常CI／B部署→安全tail同requestId→修正確切問題→hosted VM／R2回優先；A／Review／DNS不動、自刪OFF。證據docs/releases/oracle-hosted-sync-pending.json。

## 2026-11-06 完整CI通過；部署schema清單資料形狀修正

01d6cf8／CI42141264599完整success。自動Actions42144701474通過前置原生測試及復原雜湊自我檢查後，在LIVE_ORACLE_SCHEMA停止，尚未寫Worker。唯讀程式定位：queryD1回傳{type,name}物件，常數則為[type,name]陣列，原直接deep equality必然失敗。現在共用validateOracleSchema只將實際row轉成二欄陣列，SQL篩選、排序、八項exact equality不變；self-test新增真API形狀通過、缺項／錯type／錯name拒絕，全部舊守門self-test與scopedlint通過。不是放寬schema或移除守門；schema65採用／復原不重做。

本機隔離Wrangler whoami正確B且列d1 write，但只讀query回7403；未擴權或輸出憑證，原因仍待核對。Actions既有B憑證能執行query並到清單比較。公開證據docs/releases/oracle-schema-shape-check.json。下一步新source完整CI→B自動部署→Owner30GB及hosted VM／R2回優先；B目前仍e6／requested0，A／Review／DNS不動。

## 2026-11-06 Owner 留言驗收等待實際完成，集中測試通過

233156b／CI42136258344於Owner reply刪除確認測試失敗，未部署。根因成功edit的target read先於最後身分核對與journal清除，測試隨即開Guest分頁造成blur，使原操作按設計保留。共用helper現在等同一Owner／album journal確實清除後才執行後續操作；刻意pending／stale測試不加入等待，產品權限、審計、重試與guard不改。另略過已在目標版本的重複selectOption，避免合成change清空thread卻不觸發版本effect。

集中原生D1／R2／Sharp／Chromium runner exit0：Owner留言、留言處理與outbound0共3組；Guest API前置驗證4個ready且已發布版本，保留原comparison options>2與同邀請／跨邀請UI斷言。先前fixture未發布版本等失敗log保留，不列通過。scoped ESLint／Prettier通過；公開證據docs/releases/oracle-owner-comments-reconciliation.json。

下一步此修正完整CI→自動部署B→真Owner啟用30GB與hosted VM／R2回優先。B仍舊sourcee6、requested0；schema65復原不重做，A／Review／DNS不動。

## 2026-11-06 完整CI通過，自動部署在原始SQL雜湊守門停止（尚未部署）

2216d64／CI42132445238完整通過，含燈箱與Owner處理恢復修正、recipe及所有後續隔離檢查。自動觸發Actions42135465840；所有native前置驗收通過後，self-test在ORACLE_RESTORE_MIGRATION_HASHES停止，未寫Worker。根因0065已採用檔案含單一CRLF，但原.gitattributes將Git blob正規化LF；Windows工作樹raw783626…符合既有復原證據，Linux checkout raw80b5…不符合。

最小修正：只對0065設定-text及whitespace=cr-at-eol（承認既有CR為換行，其他空白規則不改）並明確git add --renormalize，將原已採用bytes原樣入Git，沒有修改SQL語意／manifest／checker。第一次一般git add沿用舊index，獨立hash斷言有失敗並停止，之後renormalize後index內容SHA256確實等於78362649605fbe19d66af6ea23813117c8892cee27ec4a8e3273e03f56f2c40b；63／64仍text auto+LF。原守門self-test通過。公開證據docs/releases/oracle-migration-byte-packaging.json；schema65不重做採用或復原，A／Review／DNS不動。

下一步此封裝修正完整CI→B自動部署→真Owner啟用30GB及hosted VM／R2回優先。B仍舊sourcee6、requested0；獨立驗收相簿94abb620-6422-4e3d-9071-12f43394ac62保持空白未分享。

## 2026-11-06 燈箱修正已越過CI，Owner處理測試需等待實際reconciliation

2cd7a2e／CI42130729104已通過新增燈箱commit時序驗收，後於comment-processing-browser.mjs:408因『標記處理中』disabled失敗；完整CI仍未通過、B未部署。唯讀定位：lost receipt相同UUID重試後，helper只等thread read及『有一筆…尚待確認』文案不存在；sending=true時文案會換成『正在傳送原操作…』，不代表最後/me複核及finishOwnerCommentIntent已完成。隨即blur/focus可能令uiStillCurrent失效，按設計保留pending journal，後續新操作鎖定。

僅在Guest edit／blur前以bounded expect.poll等同一owner／album sessionStorage journal實際清除；不改產品、不延長timeout、不移除stale／API payload／單次命令審計／CAS斷言。scopedlint／format／syntax通過，本機整套未重跑；完整驗收交由新CI，不把靜態定位列為新的runtime通過。舊失敗log保留。下一步仍完整CI→自動部署B→Owner30GB與hosted VM／R2回優先；schema65不動，A／Review／DNS不動。

## 2026-11-06 修正真實燈箱分頁鍵盤競態；待完整CI與B部署

bdcd6f1／CI42128802868在processing.mjs的cursor page剛追加後按ArrowRight仍停首張；不是recipe回歸。album-gallery的moveLightboxRef原在passive useEffect更新，DOM已顯示新照片但鍵盤仍可能用舊readyPhotos。集中processing-only runner以原生D1/R2/Sharp及375px Chromium重現：在下一張disabled→enabled的DOM commit以MutationObserver立即發一次ArrowRight，舊effect確實失敗；僅將該ref同步改useLayoutEffect後同一runner exit0／18檢查（含outbound0），保持原生方向鍵／photoId URL／Escape焦點與配額審計斷言。不加延遲、不移除測試、不改安全guard。

公開證據docs/releases/oracle-lightbox-cursor-commit.json；舊失敗log與新成功log均保留。目標build、Web strict、scopedlint通過，完整CI待新推送；B依然sourcee6／schema65／Oracle requested0，不重做復原。真Owner UI已建立獨立KINO_ORACLE_CAPACITY_ACCEPTANCE_20261106專案3a21aa9e-82d2-4f5a-a71f-deb9dac86828、啟用相簿94abb620-6422-4e3d-9071-12f43394ac62（0照片／未分享），待部署後VM／R2回優先驗收，A／Review／DNS／原有相簿不動。

## 2026-11-06 完整Cloudflare階段通過；recipe歷史fixture相容性已修正

7c2e910／CI42124508470已實際通過完整test:cloudflare與隔離auth，後續processing-recipes因schema54 fixture呼叫最新版schema65 HTTP admission而503，整體CI仍失敗，B未部署。現將fixture建立限用既有D1UploadRepository的primary預設，真正54→55 populated／故障rollback／rowhash／FK證據保持；56後補齊所有正式migration才切回最新版HTTP上傳，沒有假的view或放寬產品guard。移除不必要的Guest下載fixture。因repository具有TS parameter properties，改用獨立Vitest wrapper/config（不混入build前unit suite）。第一直接Node嘗試strip-only失敗保留，不列通過。

集中第二次Vitest exit0，10個真本機D1/R2/Sharp/API/375px檢查通過；provider是Sharp-backed mock Images，非雲端Images。公開證據docs/releases/oracle-processing-recipes-focused.json。root strict／scopedlint／format通過；下游upload20、Guest19、photographer13隔離檢查通過，activation13、collaboration26亦通過。activation首輪因獨立bindings漏填CLIENT_ACTIVITY_ENABLED、defaulttrue導致wrapper先回503，已僅補與部署config一致的false；保留真56→57 migration／rollback13群組且重跑通過。各結果docs/releases/oracle-downstream-focused.json，失敗log保留。未重跑本機整套、未重做65復原。下一步修正推送後完整CI與自動部署B，再Owner啟用30GB與hosted VM→R2回優先；A／Review／DNS不動，Oracle requested0，不得宣稱上線。

## 2026-11-06 改以集中式原生驗證，剩餘18群組通過；整體CI尚待重跑

CI42118739118已通過評分／收藏、挑片上限、共用挑片，後因inheritance helper要求「專案預設」工程標籤失敗。實際Guest有挑片權限，畫面正確顯示本次上下限；已改驗可讀文案／上下限，並另外驗刷新後API source=project與maximum，沒有將來源正確性降級為只換字樣。針對性domain6測試通過。

已停止逐條重跑整套：ignored focused runner重用既有Miniflare／syntheticOwner／小PNG，實際跑繼承、matching-rules與Owner歷史。首版抓到schema65每筆queued metadata保留16MiB，1,001筆超出舊fixture配額；內部failedGroups不算通過（原Vitest包裝banner曾誤顯示pass，已改aggregate失敗直接throw）。集中第二次exit0／18群組／failed0／outbound0，含1,001筆完整metadata歷史與375px規則UI，證據docs/releases/oracle-remaining-ui-focused.json及clone .local/oracle-remaining-ui-focused-second.log。

正式test local-smoke僅在後段大量metadata/index benchmark前，將該ephemeral primary及gallery workspace最低quota設64GB；前段9GB配額邊界測試原樣保留，不改guard、pending預算或job狀態。這不是64GB物理上傳，B的R2 9GB／VM30GB與資料皆未改。新schema沒有變，不重做65復原；A／Review／DNS不動。下一步集中修正推送→完整CI與B自動部署→真Owner啟用與hosted VM/R2回優先驗收；目前B仍舊sourcee6、requested0，勿宣稱已上線。

## 2026-11-06 CI42116040580 通過歷史與版本管理後停在舊初始讀取次數

01b1022 的CI通過歷史撤權與Owner版本控制，之後guest-feedback-browser.mjs:388仍假定2次album access；實際現在是回饋、下載、期限顯示及預設背景瀏覽紀錄各1次，共4次。已核對四個caller與fixture flags，將讀取次數改4，評分／收藏仍限各1次批次及每批1–24筆，沒有改產品。另補matching-rules helper在專案goto/reload與成功／衝突／同UUID重試造成整頁更新後開啟既有「專案進階設定」；CAS、identity、recovery與歷史斷言全保留。matching-filename-index helper已會開「進階相簿整理」，未改。scoped syntax／format／lint通過；完整CI仍待下一版，B未部署且requested0，schema65不動，A／Review／DNS不動。已保留失敗log，不重跑已接受備份復原或本機全套。

## 2026-11-06 CI42111866894 通過入口後停在歷史頁舊撤權提示

目前 aa1a5d0 的完整CI仍失敗，沒有部署。Chromium安裝曾因Ubuntu字型下載耗9m37s後自行完成；瀏覽器／Cloudflare整合已通過訪客入口、新建分享與留言恢復，之後 guest-history-browser.mjs:423 仍預期舊「工作階段已失效」文案。已將該斷言對齊實際generic alert，保留401、舊24筆紀錄清除；另修selection-policy-inheritance舊未開放提示為提示及送出按鈕皆不存在。標籤helper本就先開Lightbox，19/20→20/20等來源符合，未改；其runtime仍由後續CI驗證。只有測試與交接變更，scoped格式／lint／syntax通過。新CI成功前仍不啟用B分流，不改A／Review／DNS、schema65不動，不重做復原與本機整套。

## 2026-11-06 CI42107886933 停在舊訪客入口文案，B未部署

ca4b117 的CI已通過分享邀請建立／不確定結果重試，隨後 guest-entry-ui-browser.mjs:503 因仍要求暴露停用原因的舊文案失敗；失敗log保留於受控clone apps/worker/.local/ci-42107886933-failed.log。現僅修測試：四處入口提示對齊generic denial／完整連結提示，並將select-only「未開放送出」改驗提示不存在；原無POST／無session／原UUID／cookie與秘密保護、送出按鈕缺席／仍可選片斷言保留。產品不改，scoped格式／lint／syntax通過，另補版本設定helper在停用初始頁與成功重試重新載入後展開專案設定，保留可見／CAS／審計斷言。selection-policy、shared-review雙端與Owner history的靜態核對未發現確定過時定位器，runtime仍待CI。完整結果待新CI；不再重跑本機整套，A／Review／DNS不動，schema65／Oracle requested0。下一步仍是完整CI→自動部署B→Owner啟用30GB→hosted VM上傳／縮圖與R2回優先。

## 2026-11-06 比較模式留言撤權回呼修正

本機 run16 失敗定位到真實接線缺漏：GuestVersionComparison 內 GuestCommentsPanel 未傳既有 onUnauthorized，401 後留言面板隱藏但私有比較燈箱未清除。已補單一 prop，與相鄰註記面板一致；不改409重試或舊generation guard。保留 run15/run16 失敗證據及整個燈箱必須清除的斷言，不能只換字樣。新版 dry-run build、Web strict、scoped lint／format 通過；run17 已實證401會清除整個燈箱／私有圖庫，並提供相簿「重新載入」；驗收補上重新載入此相簿再恢復原操作的必要步驟，完整結果仍待CI。前一10a9f42／CI42105215394不應視為最終通過版本；後續CI必須驗此修正後SHA才可部署。B分流仍關閉，不改A／Review／DNS。

## 2026-11-06 Oracle corrective release — CI 尚未通過、B 分流仍關閉

目前私人 main 為 9e61a147a147fa0339c26c68465981d5c0079ac3，CI42086340827 因既有 UI 驗收步驟不符新版相簿導航失敗，尚未部署此版；B 仍 sourcee6d4d68／secret-only versioned43c23d-ae6c-4b73-b5d8-d1916a180e37、schema65、Oracle requested_enabled0。不要將本機通過或實際 VM 測試誤報為 hosted 分流已啟用。

修正於受控 .local/oracle-release-20261106：驗收 helper 沿用正式相簿卡片、燈箱與隱藏無權限操作的流程，保留 API／資料庫／隔離斷言；另修正邀請撤銷誤傳短顯示編號（API 恢復完整 UUID）、選片 SVG 攔截點擊、批次留言成功後收合而隱藏結果。Oracle OFF 且 R2 已滿維持既有 409 配額錯誤。部署 checker 接受具有完整 Owner 命令／審計鏈的已啟用設定，並驗正確 numeric0/1 result。root strict、完整 lint／format 通過；實際批次留言成功可見已驗，401 後同一請求恢復與後續頁面完整驗收於 run16 執行中，先前15次失敗 log 均保留，不計為通過。不要推 root 全量 dirtytree。

VM 已實際採用內層檔案系統可用空間 guard，保留512MiB scratch；5個 stdlib 單元測試通過。實際小量 scoped vacuum 回收5,251,072 bytes、存留 SHA 不變，再回收1,052,672 bytes，最終兩個零位元 fence，Review／Caddy 等6服務 active。首次非同步刪除未完成導致的失敗及同一 job 恢復證據均保留。公開證據 docs/releases/oracle-filesystem-free-guard.json、oracle-physical-reuse-small.json；這不代表30GB近滿容量／重開機／擴容驗收。

下一步：選定 corrective commit 推送，CI 與本機 run16 並行；完整 CI／既有 gate 通過後自動部署 B→真 Owner 啟用30GB→隔離合成照片驗 hosted VM／縮圖／私人圖庫與 R2 回優先。不要重跑已接受65備份復原；不改 A／DNS／客戶資料、Review，自動刪除 OFF。暫時配額模擬僅能於部署完成後操作且必須恢復9GB，不得跳過 gate。

## 2026-11-06 Oracle 容量登記與隔離部署驗證完成

B 已採用 schema65；備份、獨立復原與舊146表3035列保全已通過，不重跑。平台 Owner 指定工作區 bd927a6d-d5d3-4743-bbae-e4560cdda4c7 已由系統審計將總額度9→39GB，固定 oracle-vm 節點30GB／used0／reserved0已登記，其他租戶額度不變；公開證據 docs/releases/oracle-storage-capacity-bootstrap.json。Oracle policy requested_enabled仍0，網站分流尚未啟用。

受控 release checkout .local/oracle-release-20261106 已完成產品／profile build、攝影師13群組、schema65協作26群組與checker self-test；新案例驗公開背景統計能力、平台Owner設定可讀及非平台Owner拒絕。測試曾誤用status()而未解析JSON，已改用現有json() helper後通過；保留失敗log，不列為產品故障。下一步必要型別／格式檢查、選定變更推送、CI與B自動部署、真Owner啟用及hosted驗收。不要推全foundation dirtytree、不向GitHub存Oracle金鑰、不改A／DNS／Review，自動刪除OFF。

## 2026-11-06 B 授權恢復與 schema65 已採用

B最小OAuth五scope已恢復且限定B；freshbackup、獨立restore/63–65升級、freshliveparity及B採用全通過，舊146表3035rows保留，B現152表3039rows/FK0。Oracle兩項Secret僅存B，程式/設定/入口資產不變的secret-only新baseline為ed43c23d-ae6c-4b73-b5d8-d1916a180e37，source仍e6d4d68。網站Oracle分流仍未啟用；Ownerworkspace39GB明確授權投影、node註冊、受控CI/部署與hosted驗收待續。詳HANDOFF及docs/releases/oracle-storage-0065-restore.json、oracle-secret-stage-baseline.json。不要重問B登入，不重跑已接受restore，不推全dirtytree。

## 2026-11-05 — Hosted acceptance caught outer-profile routing regression; hotfix ready

Source6b5f41f CI41900526273 fully passed; auto-dispatch41903699008 and deployment41903718393 succeeded. B versionf83ffd5b-9da2-47a7-9702-c4a39915c9a6/deploymentcbbacb65-296e-4d92-8673-791d12d19cd9 is live, schema61. Hosted real Owner successfully created project62fcddb5-9bbc-4745-a35c-ff5a68a9ac21 named KINO_DELETE_ACCEPTANCE_20261105, but its albums page failed: outer tools/staging-collaboration-validation-worker.ts still called the static fixed-scope route shape and omitted DELETE. Do NOT claim this source passed hosted Owner creation workflow or storage reclamation. No hostedalbum/photo/deletion yet; preserve and reuse this project.

Hotfix changes only structural UUID route targets in the outer profile, adds DELETE with Origin enforcement, and leaves authoritative inner managed D1 witnesses intact. New actual wrapped-native flow traverses projectcreate/read,albumcreate/list,preview,foreignOriginDELETE403/nojob,correctemptyalbumDELETE/completedjob,projectDELETE/404; Ownerforeign404 and allGuestdenials retained. Focusedprofile25 passed (.local/manual-delete-wrapper-integration.log). Gatechecklist nowrequires25 including this flow. Root strict/scopedlint/format passed; source needs a new CI/automatic B deployment then hosted continuation. Schema61 is unchanged: do not redo or mutate the already-adopted migration/backup.

## 2026-11-05 — Manual storage reclaim and managed Owner creation; B61 adopted, deployment pending

User clarified deletion must reclaim real R2 payloads, not just archive/empty content. Implemented immutable creation-command managed scopes in the existing workspace, strict tenant/foreign/invite denial, native manual deletion jobs/items, preview+exact-name confirmation, bounded retries, zero-byte ETag-conditional permanent fences and exactly-once quota/audit. All albums must finish reclaim before project tombstone deletion. No workspace deletion, automatic cleanup, new Guest scope promotion or production bucket cutover is claimed. See docs/MANUAL_STORAGE_DELETION.md.

B source D1 now schema61: fresh backup SHA25665e5887902db81ab1e93f638c90a1e3a1dd0e7a29b940356be4d503aa14af9b7, distinct drill e94143eb-fa9a-44db-9240-73c09264022d; old144tables2997rows/schema/sequences preserved, FK0. Source after61 has146tables2998rows. Private proofs apps/worker/.local/manual-delete-0061-20261105, nonsecret releases/manual-album-deletion-0061-restore.json. Initial backup attempts stopped at an ACL identity mismatch before export; ACL now grants only the sandbox runner and AERO15/Aaron. No cloud payload deleted; no A/DNS change.

Native schema/API/photo-pin3 groups passed, managed boundary8, historyprojection14, root strict/scopedlint/format and target build passed. Real local R2 V1/V2 six asset payloads11276bytes→0, stale immutablePUT denial, audit-failure recovery and exactly-once ledger accepted; .local/manual-album-deletion-native-proof.json binds migration/runner/core source hashes. Local focused collaboration24 on61 and photographer13 passed. UI4191 actual creation/project/album/preview passed; permanent UI confirmation was not clicked. Old helper's direct reversible deleting-state mutation was replaced by asserting the new immutable guard and using archived state for Guest denial.

Known blockers: any live approval request, active Guest/recent human view, pins/holds, unexpired grants/reservations, and every nonsucceeded processing job conservatively prevent manual cleanup. queued/unsupported cancellation and orphan reconciliation remain required. No automatic deletion/Cron/multiR2, no production deployment. Current live Worker remains source4a3a6fc/version36838b5a until new CI/auto-deploy/hosted acceptance completes. Continue that release rather than repeating already-green native tests. Preserve all unrelated dirty files and checkpoints.

## 2026-11-05 — B schema60 automatic deployment and hosted scoped acceptance

Completed: fresh B backup, independent cloud restore/0060 upgrade, fresh source parity and source adoption; CI `41874139521` passed for source `4a3a6fcf42d12ee6151e2ea6873fc739b021ce71`. Automatic trigger `41876809935` successfully dispatched deployment `41876831641`; all deployment steps including preflight, postdeploy, entry activation and baseline receipt commit succeeded. GitHub run summary still reported in_progress at final API read; actual live version and hosted behavior were independently verified. No manual deployment shortcut was used.

Live B Worker `kino-pic-staging`: version `36838b5a-8138-4032-a79a-67c129fde64a`, deployment `4eb73a4d-ac40-4df9-a8c9-0ade5f14724b`, URL https://kino-pic-staging.kino-pick-aaron2026.workers.dev . Main metadata commit `04fa9885c2426339b35e93f1d53ed52b43eec021` records the verified source/receipt for subsequent releases; it does not change product code. Origin/main was fetched without changing the dirty foundation checkout.

Actual browser acceptance: real GitHub Owner login; private24-photo page; masonry/list toggles; URL-addressed full-page lightbox and24-thumbnail strip; deep-link reload; synthetic photo pin/unpin persisted. D1 confirms two distinct requests, one Owner session, two paired command/result/audit rows, final unpinned revision2 and FK0. Anonymous capability GET and pin PUT both401, homepage200. V1/V3 private previews both900x600 and comparison slider35% were observed. Photos/assets were not deleted; recommendation metadata and queued historical V2 remain.

Local proof `.local/hosted-0060-acceptance.json`, deployed receipt `.local/hosted-0060-deployment-receipt.json`, anonymous proof and screenshots `.local/hosted-0060-*.jpg`. SQL backups remain protected and ignored. Remote non-secret restore manifest and automatically recorded deployment receipt are committed. This final local handoff does not trigger another redundant code deployment.

Full MVP remains incomplete: next existing-workspace Owner project/album creation with managed scopes and tenant/invite/foreign denial; remaining release-plan features and production cutover still required. This run did not repeat100uploads, Google login, full Guest hosted flow or mobile viewport acceptance. A/DNS/customer data untouched, private single R2, deletionOFF/dry-run, no Cron.

## 2026-11-05 — B 0060 backup, independent restore and adoption accepted

B staging D1 is now schema60 (144 tables / 2,988 rows). Fresh protected SQL backup SHA256 `580d58f479297ae27c267fbe0997c23cd1e5051df7b8d061a45d96eb4a25b78e` was independently restored in B drill `ada35da7-b075-4d42-b358-86d6dbf25cbf`: all 141 old tables / 2,987 rows, schema, sequences and FK definitions matched. The drill was upgraded to0060 before a fresh source parity check and source adoption. All existing product data/schema/sequences were preserved; FK0. Only the new migration's applied_at timestamp differs between independent executions; ledger id/name and other hashes match. No source backup was restored over live data.

Evidence: `docs/releases/photo-pins-0060-restore.json`; private SQL/proofs remain ACL-protected under `apps/worker/.local/photo-pins-0060-20261105/`, never commit or print them. Scoped operator helper `apps/worker/tools/rehearse-photo-pins-0060.mjs` requires an explicit operation, fixed B/source/new drill and a verified saved backup; no deletion operation. Recovery: retain new append-only pin ledgers and fix forward; reverting Worker to59 remains read-compatible, but do not restore an old SQL dump over newer writes.

Focused populated59→60 native API test, photographer13 and collaboration24 ephemeral D1/R2 checks, Worker/profile builds and release-checker self-test passed locally. Existing immutable59 restore/prior-release evidence is retained; new60 proof/hash/schema/native checks extend it. Deployment now records its verified receipt as the next baseline after entry activation; this metadata-only GITHUB_TOKEN commit does not recursively trigger Actions. Predeploy accepts only the verified prior version, with previews disabled; deploy closes entry through the existing profile before postdeploy validation and reactivation.

Preserved failed attempts: initial D1 internal metadata read; unsupported migrations --yes flag; final parity check on the new applied_at timestamp. The source migration command itself succeeded and was not repeated; verification resumed against retained exports. Initial local build sandbox access failure was resolved using isolated Wrangler build config outside the sandbox. CI and automatic hosted deployment remain pending at this checkpoint; do not call local checks online acceptance. A/DNS/R2/customer data untouched; deletionOFF/dry-run, single R2, no Cron.

## 2026-11-05 — 0060 populated upgrade local acceptance; B reauthentication required

Enhanced `apps/worker/tests/photo-pins-api.test.ts` to seed Owner/session/workspace/project/albums/photos/versions/private assets on migrations 0001–0059, then apply 0060. All pre-existing product rows and schema objects remain identical; FK violations are zero. The existing native D1 pin API/cursor/audit/rollback/authorization/legacy-read test then passes. Focused Vitest via ignored `.local/photo-pins-vitest.config.mjs`, scoped lint and formatting passed. First attempt failed on D1's protected `_cf_METADATA`; only this provider-internal table was excluded from row reads, retaining product tables and sqlite_sequence. No hosted acceptance is claimed.

B readonly D1 inventory failed with Cloudflare API 10000. Isolated Wrangler config expiration was 2026-11-04T17:44:36.727Z. User was asked once to log in with B using `%TEMP%/kino-pic-wrangler-isolated-config`; no credentials printed. Fresh remote backup, independent restore, 0060 adoption, release-gate update, deployment and hosted acceptance remain pending. Existing 59 gates remain intact; A/customer data untouched. Do not use old backups or claim remote schema state before a successful new authenticated inventory.

## 2026-11-05 — Cloudflare B 自動部署

新增 `.github/workflows/auto-deploy-cloudflare-b.yml`：僅同倉庫 main 的 push CI `checks` 成功才自動 dispatch 既有受控部署，傳入該次 CI 的完整 SHA；若 main 已前進則跳過舊結果。PR、fork、失敗 CI 不會觸發部署。現有手動部署入口、B 帳戶／資源／復原／部署後驗證全部保留。

必要最小驗證：YAML 與格式、權限範圍、成功 main／失敗／PR／其他分支／fork 條件、舊 SHA 跳過及完整 SHA dispatch 均通過本機 assert 檢查（GitHub API 為 mock）。這不是線上部署驗收。

已知阻擋：main 有 migration 0060，但現有部署復原閘門仍要求 59 份 migration。未完成 0060 的 B 備份、獨立復原及相容性證據前，自動部署應停止；本次未放寬閘門、套用 migration 或修改 A。

## 2026-10-29 — Retention pure-planner foundation accepted

Implemented `packages/domain/src/retention.ts` and exported it through existing domain index. Deterministic dry-run only:defaultOFF;30-day inactivity/7-day minimum;80→65% estimates including reservations;oldest/least-viewed+UUID order;preservation/protection/busy/reference/recent-state guards;metrics/inventory fail-closed;whole-album caps and dual-reason dedupe. `preservationRequested=true` excludes;`cleanupAllowed` is the independent cleanup opt-in. Both mode traverses the global order once and continues required inactive candidates after the pressure target is estimated reached. Inputs are validated and not mutated;no DB/R2/delete adapter or clock/random dependency.

Focused13 tests pass (`.local/retention-planner-focused-final.log`),final root strict passes (`.local/retention-planner-types-third.log`),scoped lint passes (`.local/retention-planner-lint-final.log`;React detect warning only). Acceptance `.local/retention-planner-acceptance.json`. Earlier strict failures were fixed without relaxing TS:date tuple/exclusion reason safety and a test helper's overly narrow UUID literal type. No broad suite/build/browser run was needed or claimed for the pure module.

Critical boundary:current D1 has no effective-human-view heartbeat/projection,and several policy/busy/reference witnesses remain incomplete. This is NOT a usable D1 cleanup candidate API or deletion service. Next implement authorized visible-photo heartbeat evidence and rolling5-minute session dedupe,then read-only snapshot adapter,persisted plan/Owner UI/explicit opt-in+confirmation,locks/rechecks,delete/retry/reconciliation. Permanent fences/history must remain intact.0052 remains locally adopted;all feature/default hosted gates and automatic deletion remainOFF/dry-run. Version-approval aggregation question remains pending;fullM1–M5 remains ACTIVE/incomplete. See docs/RETENTION_PLANNER.md. Preserve unrelated dirty edits;no commit,push or deploy.

## 2026-10-29 — 0052 adopted LOCAL ONLY; version confirmation policy pending

The accepted Guest current-version download migration is now adopted in persistent LOCAL D1. Run `apps/worker/.local/guest-downloads-adopt-0052-third.log` exited0:8 actual CLI commands all0. Fresh backup was restored and upgraded in an isolated config directory,then a fresh live snapshot was compared before apply. All123 product-table row hashes match the accepted0051 development snapshot;all4 development rows,existing schema and product sequences are unchanged. Exactly one audit trigger was added;ledger is52,no pending migrations,and foreign-key checks on exported snapshots are empty. Live-after schema equals isolated-upgraded schema. Download/default hosted flags remainOFF;automatic deletionOFF/dry-run. No remote/customer data,commit,push or deploy.

Proof `apps/worker/.local/guest-downloads-adopt-09a31a74-8bb1-4913-ac86-9eea3b29515a-proof.json` SHA256 `39405b94e76c07bb607fae599cb9b2e68b0c1dcc081238f2c6c69b603c917300`. Fresh backup `apps/worker/.local/guest-downloads-adopt-09a31a74-8bb1-4913-ac86-9eea3b29515a-before.sql`,SHA256 `ae713c7515505a10cbc5d26ecee941da3af5668d31cd1e2ce44cdfc7ee282502`.0052 source SHA256 `a247e8efe8b3cf2152cffb500b5d8dacc5eab6385e4ce96086672600645dbb81`. Preserve failed preflight proofs:first CLI export did not support persist-to;second checker compared SQLite null-prototype rows with plain objects. Both stopped before persistent apply;neither is acceptance. The successful run uses an isolated Wrangler config directory and normalized sequence rows;no old backup was restored over live data. Recovery:keep flagOFF,retain audit/assets,prefer forward fix;drop only the new guard if reverting schema deliberately.

Read-only version-approval inventory found no approval permission in the existing12-bit mask. Do not reinterpret can_view/can_compare_versions/can_select as approval authority or enlarge persisted4095 mask casually. A separate Owner-authorized sealed request/invitation relation can pin exact photo/version/head revision and preserve individual Guest receipts. The user has not decided whether one representative or all designated clients must confirm;they requested clarification,which was provided,with a simplified question still pending. Do not silently choose an aggregate publication policy or show an unimplemented approval control. Owner history/head switching exists;Guest comparison canvas exists;Owner equivalent comparison remains required. See docs/VERSION_APPROVALS.md. FullM1–M5 remains ACTIVE/incomplete;next implement independent exact-version confirmation records and resolve the final delivery gate without deleting any existing product requirement.

## 2026-10-29 — Guest current-version downloads accepted locally

KISS: reused existing Guest sessions, private R2 adapter/current heads and append-only audit. Independent preview/original rights work without can_view. Bounded24-row catalogue + native attachments + download-only375px UI/logout are implemented. Source filenames use immutable V1/V2 completion witnesses; asset IDs are not upload session IDs. Fixed a real SQL bug discovered by native execution: request candidate omitted photoId/versionId used by its audit INSERT. Bounded server-side failure logs contain phase/requestId/error message, never credentials/SQL bindings.

Actual isolated runner seventh exited0 (`apps/worker/.local/guest-downloads-focused-seventh.log`):3 API groups + one375px Chromium flow. One PNG used existing Owner upload/init/authorize/local R2 put/complete and real LocalSharp processing. Preview/original bytes and SHA match; requested/generated rows pair exactly; native forged audits abort; injected generated-audit failure returns503 JSON/no file and retains requested only; opposite/view-only/foreign/unshared/revoked access denies without new download audits. Chromium saved the native attachment with exact size/hash and logout removed private filename/cookie. Root inspected `apps/worker/.local/guest-downloads-mobile.png`. Proof `apps/worker/.local/guest-downloads-focused-acceptance.json`;log SHA256 `59a56a0ed0d62bb908daa74ef00bf69f34b8d135ceba7dd92f0ce5483e90e707`. The injected error in the successful log is expected fail-closed evidence. Earlier failed logs remain failures,not acceptance.

Corrected target Worker/UI build passes (`.local/guest-downloads-sql-fix-build.log`);final root strict/scoped lint pass (`.local/guest-downloads-final-types.log`,`.local/guest-downloads-final-lint.log`). Prior scoped9 contract tests and Web types passed;full broad suites were not repeated. Browser helper uses a small real loopback HTTP bridge because route interception canceled native attachment persistence;no synthetic API responses. GUEST_DOWNLOADS_ENABLED remainsOFF/hard-local.0052 is SOURCE ONLY:default persistent local D1 remains0051;no production/customer writes,commit,push or deploy. Automatic deletionOFF/dry-run.

This supports current ready-version downloads,not a final published/approved delivery package. FullM1–M5 remains ACTIVE/incomplete. Next inspect version-approval/publication requirements and implement immutable delivery manifests,then notification/ZIP and remaining retention/hosted acceptance without removing earlier requirements. Any later0052 persistent adoption needs a fresh backup/restore/parity proof. See docs/GUEST_DOWNLOADS.md.

## 2026-10-29 — M3i5b first multi-file resolved UI accepted locally

Keep KISS: the new opt-in queue wraps the existing ResolvedAlbumUpload and its journal/lock/network pipeline. Gallery now mounts ResolvedBatchAlbumUpload. RESOLVED_BATCH_UPLOAD_ENABLED defaultsOFF in all environments/example,requires the full matching-rules chain,and rejects hosted activation. Owner-only GET /api/v1/resolved-batch-uploads/capabilities exposes strict1000-file/24-row limits. No new D1 migration or production/customer write occurred.

Implemented: multi-file descriptors/IDB queue,explicit start,one-file-at-a-time fresh preview and upload,24-row progress/reselection,pause and queued-only skip;stable async journal port with fixed request IDs and committed persistence before network;current-session checks and private filename hiding on access loss;captured-intent recovery retained when new batch admission is disabled. Queue creation briefly reuses the existing album Web Lock and rereads its pointer,preventing stale tabs from replacing another queue. Per-file parent Gallery refresh is coalesced. Human rule/error copy replaces internal codes. Server-confirmed review/rejection records remain retained;unknown captured jobs are not discarded.

Actual focused local run12192 exited0 (`apps/worker/.local/m3i5b-browser-run-fifth.log`):three375px browser scenarios/six checks true:OFF keeps legacy widget;stale-tab pointer remains one queue;three files complete signed local R2 uploads;dropped accepted reservation restores with exact original UUID/body after a rules change;new stale-policy admission stops;foreign identity clears filenames and performs no upload writes. Acceptance `apps/worker/.local/m3i5b-focused-acceptance.json`,SHA256 `57c4cd4f22ca30514e2ba71e916355c6c28ad1f72e51cc06dee99cd7d88515cc`. LogSHA256 `0e33b40bc02a29bce16d4a364a3f9e581e14f3e35a129546f95958703299f090`. The old runner success banner incorrectly included Sharp;the log is preserved and runner banner corrected for future runs. This helper did NOT invoke Sharp/derivative processing. Do not repeat that overclaim or add a redundant image-engine test.

Second target UI/Worker dry-run build exited0 (`.local/m3i5b-worker-build-second.log`);root strict and scoped final UI/helper lint exited0 (`.local/m3i5b-root-types.log`,`.local/m3i5b-ui-lint.log`). Scoped web TypeScript/Prettier pass;new gate18 unit tests,codec9 and existing journal/protocol48 targeted tests pass. Full650 unit and17 native IDB tests are earlier foundation checkpoints,not rerun or summed into a fabricated new total. Preserved failures:first real hidden pre-create/stale-pointer notice was fixed by root;other attempts exposed fixture basename,existing two completion-reconciliation probes,and an obsolete raw-code UI assertion. No failed run is reported as a pass. Main full smoke/Next reference suites were not repeated per user minimal-validation instruction.

Boundary: local workerd/D1/R2/Chromium only;no real OAuth/remoteCloudflare/production deployment,Sharp in this run,1000 physical transfers,power-loss or native-headed acceptance. Batch admission remainsOFF in checked-in config. Active captured server cancellation and remaining comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness remain unfinished.0051 stays adoptedLOCALONLY;automatic deletionOFF/dry-run. FullM1–M5 ACTIVE/incomplete. Next prioritize the roadmap's remaining real delivery features using existing services;inspect current docs/code before starting and avoid new frameworks/unnecessary test expansion. Preserve unrelated dirty work;no commit,push or deploy.

## 2026-10-29 — M3i5b integration seam in progress (KISS)

Reuse the existing resolved uploader instead of creating another upload engine. `ResolvedAlbumUpload` now accepts an optional async `ResolvedUploadJournalPort` (itemId/load/save);default localStorage behavior and existing Web Lock key are preserved. Loads/saves use the original strict max-one journal protocol. Persistence is awaited before reservation and subsequent mutations;refs/UI update only after committed save and current-generation checks. The port supplies the descriptor item ID;the three operation UUIDs remain generated once and fixed. Use a stable/memoized port object.

A batch envelope can now retain terminal `rejected` metadata for an unreserved request after a definitive server rejection,without overwriting its body or pretending the server placed it in needs_review. Controller code must establish that definitive outcome;the codec cannot determine network truth. Timeouts,AbortError and unknown outcomes must never take this path. Reserved or terminal rejected intents cannot be reactivated or rewritten. Targeted codec9 tests pass;existing journal/protocol48 tests pass after the async seam. Scoped lint plus root/Web strict checks pass. Full650 unit/17 native storage results below are prior foundation checkpoints,not a new batch UI acceptance claim;no broad suite was repeated for these isolated changes.

Actual multi-file chooser/queue/controller,session reauthorization and UI/native transfer acceptance remain unfinished. Next add the small queue wrapper and existing port binding;keep explicit current policy checks for unstarted items and exact old-intent replay for captured work. Do not introduce a new lease/timer system or another lock namespace. Default/hosted gates and automatic deletion remainOFF/dry-run;0051 stays local-only. FullM1–M5 goal ACTIVE/incomplete. Follow user KISS and minimal relevant validation;do not restart quota investigations or repeat already-green checks without a concrete reason.

## 2026-10-29 — M3i5a internal storage foundation accepted locally

Follow the user's KISS instruction: reuse existing flows/helpers/locks, add only necessary abstractions, and run the smallest meaningful checks for changed behavior. Do not repeat passing suites without a relevant source change or failure;do not expand browser-internal quota experiments. Full product scope is unchanged.

Final isolated Chromium harness exited0 with17 groups (`apps/worker/.local/m3i5a-resolved-batch-browser-final.log`;summary `apps/worker/.local/m3i5a-resolved-batch-browser-a4ae4c38-f691-4130-83d9-b294912494b8.json`,SHA256 `4c32e45f644cb4e815d64d0cff2283f8ea2e94d2fccda96ad13dccc172c7c3f6`). Actual native IndexedDB evidence:49 rows page24/24/1 with25-row lookahead;1,000 synthetic metadata rows over42 pages;updates exactly2gets/0getAll/0cursors;native operation/session uniqueness;scope/session/policy/wrapper denial;fixed intent immutability;existing-data preservation on transaction abort;reload/second-page commit;two-page same-revision CAS one winner/one conflict;fresh-context native quota rejection. Metadata volume is not physical upload acceptance. Quota lowering after existing usage remains not_checked;Chromium accepted writes despite live lowered overrides. Existing-data preservation is separately proven by native transaction abort. No further quota experiments are needed for this slice.

Latest full unit650/73 files passes (`.local/m3i5a-unit-second.log`). Full generated strict35349/whole lint28524 passed before the additive optional PUT AbortSignal;after that change root/Web strict and scoped lint pass (`.local/m3i5a-root-tsc-after-abort.log`,`.local/m3i5a-web-tsc-after-abort.log`). Final helper syntax/ESLint/Prettier pass. Native runner bundles actual adapter/codec;no app assets or main smoke runner were changed. Earlier harness failures (absent file/API name assumptions,scan scope,unsynchronized race,expanded quota experiments) are retained as failed diagnostic evidence,not accepted passes.

Next M3i5b: integrate a genuine multi-file queue with existing ResolvedAlbumUpload,its existing resolvedUploadJournalKey Web Lock,and the new storage. Avoid a new persistent lease/timer system. Existing resolved/single upload UIs already fail closed without Web Locks;do not claim unsupported-browser fallback. Preserve per-file fresh preview/fixed UUIDs/current identity/session/recovery and explicit review. Batch UI/controller and active cancellation remain unfinished;no new batch capability is exposed.0051 stays adopted LOCAL ONLY;all hosted/default gatesOFF,automatic deletionOFF/dry-run. Real OAuth,hosted/productUI integration,physical R2 bulk and power-loss acceptance remain not_checked. FullM1–M5 goal ACTIVE/incomplete. Preserve all unrelated dirty work. Read RESOLVED_BATCH_UPLOADS.md and the accepted0051 proof below.

## 2026-10-29 — M3i5a internal foundation in progress

Added strict metadata-only batch manifest/per-item codecs with1,000-descriptor bound, per-record64KiB/manifest1MiB limits, exact legacy/profile-aware intents, revision CAS, frozen descriptors/policy/UUIDs and explicit lifecycle transitions. Manifest touches do not load all item payloads. Existing single-item journals remain unchanged. Added `getUploadIdentity(signal?)` returning validated Owner UUID plus opaque session ID while stripping extra metadata;existing `getUploadOwner` callers remain unchanged.

Root latest `pnpm test:unit` exited0:650 tests/73 files (`.local/m3i5a-unit-second.log`), including8 new codec,12 identity-client and5 interruptible-PUT tests. `putUploadFile` now accepts an optional AbortSignal without changing existing call sites;already-aborted calls never start transport,in-flight interruption retains unknown-server-outcome semantics and fixed intent recovery. Scoped lint plus root/Web strict checks after this additive change exited0 (`.local/m3i5a-root-tsc-after-abort.log`,`.local/m3i5a-web-tsc-after-abort.log`). These include mocked fetch/unit evidence, not browser or hosted OAuth acceptance. IndexedDB adapter is implemented and frozen:atomic create,24+1 paging,two-read target updates,no queue-wide update scan,unique operation/session indexes and per-row scope/session/policy/wrapper checks. Root generated full typecheck35349 exited0 (`.local/m3i5a-types-first.log`);whole lint28524 exited0 (`.local/m3i5a-lint-first.log`). The isolated native Chromium harness is still being implemented; do not claim native storage acceptance,batch UI/controller,processing lease,cross-tab admission ownership,active cancellation or physical bulk upload ready. Root found and required removal of the draft adapter's all-item update scan: final update must read manifest+target only, with native unique indexes for operation IDs and upload sessions. Per-item case-insensitive UUID collisions must also fail codec validation, because a multiEntry index deduplicates keys within one row.

0051 remains adopted LOCAL ONLY with all gatesOFF and deletionOFF/dry-run;see next M3i4 accepted checkpoint and RESOLVED_BATCH_UPLOADS.md. Full goal ACTIVE/incomplete. Next finish actual IndexedDB transaction/abort/quota/CAS/reload tests, generated strict/lint and docs before UI/controller integration.

## 2026-10-29 — M3i4 accepted locally;0051 adopted LOCAL ONLY

Complete standard67362 exited0:367 actual local Cloudflare checks (`.local/m3i4-cloudflare-first.log`); focused15850 exited0:15 actual workerd/D1/R2/Sharp/API/375px groups (`apps/worker/.local/m3i4-focused-eleventh.log`).625 unit/70 files, final strict30771/lint41244,61 reference integration tests, Next build and14 reference Chromium tests pass. Large history fixtures are synthetic metadata, not1,001 physical R2 uploads. Draft-album compatibility and normal BetterAuth identity envelopes were fixed and exercised; unknown-outcome recovery keeps exact IDs/body. Earlier failed runs remain retained as failures.

Root local adoption31615 exited0 (`apps/worker/.local/m3i4-root-adopt-0051-second.log`):62 CLI commands all0;119 old tables/hashes/4 development rows/product sequences preserved;exactly one replaced resolution guard matches isolated SQL;46 added objects/four empty tables/123 total tables;FK0;ledger51/no pending. Proof `apps/worker/.local/m3i4-persistent-local-adoption-proof-323e0e3a-e1ac-4493-bea0-e84dc8000281.json`, SHA256 `dcfd4da8248b4b32cca4bd71eb9b9996ce17695c73b790cdf6db539dd08bc634`. Backup `apps/worker/.local/d1-before-0051-1e6340d0-a00b-4967-b732-9e9cb8ce8a36.sql`,699926 bytes,SHA256 `a550d2a4e353fa3f7ef5ce91a69b62cc77807673b03e8f62d64adda0ff98615e`. Source0051 SHA256 `4751bd2696f6b766ce42869470b3f98ca36c3338975cfb8cca29623108940ed3`.

Isolated prep retained all200 recorded CLI exits0 after evidence-only reconciliation of four late proof queries: `apps/worker/.local/m3i4-adoption-prep-proof-reconciled-1e6340d0-a00b-4967-b732-9e9cb8ce8a36.json`,SHA256 `f3c59003c1f4d394e952e734d716f913c7e79b46bc5a800091dac27c50e6f61c`. Preserve original failed/count-mismatched proofs. Resume fixed only snapshot `table` versus `tbl_name`;root's first adoption attempt stopped before any CLI at a multiline-Zod preflight regex, then corrected whitespace parsing without product changes. Never restore stale backups over newer writes.

All hosted/default gates remainOFF/hard-local and automatic deletionOFF/dry-run. No remote/customer write,commit,push or deploy. Real OAuth/remoteR2/CORS/edge latency/CPU/free-tier/hosted acceptance remains not_checked. FullM1–M5 goal remains ACTIVE/incomplete. Next M3i5a is internal strict batch manifest/per-item codecs and IndexedDB storage/tests;multi-file resolved UI/controller,processing lease,active cancellation,identity recovery and full native acceptance are not yet implemented. Read MATCHING_RULES.md and RESOLVED_BATCH_UPLOADS.md. Preserve all unrelated dirty work.

## 2026-10-28 — M3i4 full local runtime acceptance; persistent adoption pending

Complete `pnpm test:cloudflare` exited0:367 actual local workerd/D1/R2/API/Chromium checks (`.local/m3i4-cloudflare-first.log`). Final focused run exited0:15 groups (`apps/worker/.local/m3i4-focused-eleventh.log`), covering eight fixed profiles, Unicode expansion, full immutable history, rule CAS/ABA, fresh versus replayed six/seven-field intents, native atomic rollback and same-UUID retry, real small R2/Sharp transfers and375px settings/index/recovery UI. The1,001 appended history records are synthetic metadata, not1,001 physical uploads. Screenshots are local development UI, not hosted or final visual-design acceptance.

625 unit tests/70 files, final generated strict30771, whole lint41244,61 reference integration tests, Next reference build and14 reference Chromium checks passed. Final logs: `.local/m3i4-unit-first.log`, `m3i4-types-final.log`, `m3i4-lint-final-second.log`, `m3i4-integration.log`, `m3i4-reference-build.log`, `m3i4-reference-e2e.log`. First lint failed on generated nested `.local` artifacts; ESLint now ignores `**/.local/**`, retaining tracked production/test checks. Earlier focused failures are preserved as failures, not accepted passes.

Two real regressions were fixed and covered: the replacement resolution guard now preserves draft as well as active albums; settings/index identity readers accept the normal BetterAuth session envelope while retaining validated identity fields. The lost-response test now suppresses transparent automatic PUT retries until explicit recovery; original intent bytes/UUID and single command/result/event remain asserted.

Persistent local D1 remains0050. Source0051 SHA256 `4751bd2696f6b766ce42869470b3f98ca36c3338975cfb8cca29623108940ed3`. Fresh backup/isolated restore/upgrade proof is still running; first two prep attempts stopped before0051 execution at runner inventory-count assertions (47 unique CREATE objects,46 added objects and one replaced guard), not a migration failure. Third prep executed0051 successfully only in the isolated store, then stopped at a verification-only field-name mismatch: snapshots expose `table`, but the assertion read `tbl_name`. All144 recorded CLI exits were0. Resume verification against the retained store after correcting the checker; do not repeat DDL or weaken product assertions. Do not apply persistently before successful proof plus fresh live parity. No remote/customer write, commit, push or deploy. All hosted/default gates and automatic deletion remainOFF/dry-run. Full M1–M5 goal remains ACTIVE/incomplete. Next: finish local0051 adoption, then genuine per-file batch/captured-identity recovery and remaining roadmap.

## 2026-10-28 — M3i4 immutable matching rules in progress

Read docs/MATCHING_RULES.md. Source0051 adds nondefault keys/union view and separate immutable project rule ledger/head/result with shared project revision bump and full Owner namespace. Domain fixed8profile registry,strict contracts,default-OFF/hard-local flag,configuration/index services/routes,profile-aware indexed snapshot/cursor/native resolution context,upload dual-key batch,Owner settings/current-rule index UI and safe history projection are written. Old default keys/mode ledgers/request bodies are preserved. All production/default gates and automatic deletion remainOFF. Persistent D1 remains0050;no0051 adoption or remote/customer/commit/push/deploy.

625 unit/70 files and generated full strict28002 pass;first target dry-run build .local/m3i4-worker-build-first.log exited0. Fresh native0001–0051 syntax/schema/view-plan probe passes123 tables/FK0,but populated upgrade acceptance is pending. Root actual isolated workerd/D1 core probe passes default/no-op/profile transitions,index-gap review/bounded advance/casefold pending match,nondefault feature-OFF failclosed,reset and exact old command replay;metadata only,no R2 transfer claimed. NativeR2/Sharp/375px/full-history/CAS/replay and complete standard remain pending;runtimeagent owns matching-rules.mjs and focused runner,UIagent owns matching-rules-browser.mjs. No assets rebuild during a live focused runner;poll its reported exact handle. Standard harness already has matching-rules-test and0051 upgrade helper but not runtimehelper invocation yet. Root owns that integration.

Current key risks: actual union-view/profile snapshot plans/atomic rollback,strict new context with historical absent payloads,cross-namespace/source witnesses,Unicode expansion500-char keys,new UI recovery/identity/focus and representative-volume cost. Native large-history fixtures must be called synthetic metadata,not bulk R2 E2E. Next complete this full vertical slice/backup-live-parity adoption,then genuine per-file batch/captured-identity recovery and remaining M1–M5. Goal remains ACTIVE/incomplete. Preserve huge unrelated dirty worktree and all M3i3/older proof artifacts.

## 2026-10-28 — M3i3 Assisted catalog accepted locally

Complete standard18844 exited0:352 actual local workerd/D1/R2/API/Chromium checks (.local/m3i3-cloudflare-third.log). Final focused18128 exited0:7 checks (worker .local/m3i3-focused-runner-final7.log),including1,001 guarded synthetic logical photos over24-row BINARY pages,exact Owner/session/scope/expiry/HMAC/query checks,arbitrary final-page selected-head reserve/replay,375px first/previous/next/off-page selection,correct explicit-choice headings,separate native radio groups,late identity clearing,lost-response same-UUID recovery,one real signed R2 original upload/native Sharp derivatives,stale head/sequence no-write and legacy1,000/truncated/default-OFF preservation. Root inspected final worker .local/assisted-candidate-catalog-mobile.png. Synthetic metadata is not bulk physical R2 E2E; the metadata-only picker is not final visual design.

588 unit/67 files,full strict68388/lint8613 plus later UI scoped strict/lint and final helper10/10,61 reference integration95549,Next build/14 reference Chromium13914,52-document presence and diff checks passed. Final target build was .local/m3i3-worker-build-final3.log; the second standard rebuilt the same final product source. Third standard used those unchanged assets after only the Guest-comment recovery test assertion changed. First86510 failed after338 groups at an obsolete privacy-helper assertion; second47811 failed after192 at existing recovery-form-versus-journal timing. Root replaced only that assertion with bounded polling of actual sessionStorage cleanup,retaining three exact retry payloads and single command/result/change/comment assertions; read-only source review confirmed pending hides the form before authoritative cleanup. Earlier failures are historical,not accepted passes. Deliberate one-row fixture audit delta is processing.enqueued/upload.authorized/upload.completed/upload.reserved each+1; stale denial changes no post-fixture state.

0050 is now applied LOCAL ONLY. NEW699707-byte backup worker .local/d1-before-0050-eddfe26a-9645-4a9a-b497-a4e7bbb3d58a.sql SHA25666eda00c7faff5744680489ca46607c82e2f14a765af9695062b114e11645bf0. Source0050 SHA2569c8fd019d57d00df0bf56a732ff8215e10e1bad1c7f9183fd27cb6a9b67d480b. Isolated prep35093 exited0:145 Wrangler commands all0,backup restored under a unique .local/m3i3-isolated-persist path,119 old tables/hash/schema/sequences/ledger unchanged,one scoped seek index,FK0 and native unforced covering-index BINARY ID range/no temp sort. Root verified hashes and performed fresh live parity before adoption38239 exit0:61 local CLI commands all0;all119 old product tables/rows/schema/product sequences unchanged,same4 development rows,one index,FK0,ledger50/no pending. Proofs: worker .local/m3i3-local-adoption-proof-eddfe26a-9645-4a9a-b497-a4e7bbb3d58a.json and .local/m3i3-persistent-local-adoption-proof.json;before/after snapshots and apply output retained. Preserve these and older M3h/M3i2 proofs; never restore a stale backup over newer writes.

ASSISTED_CANDIDATE_CATALOG_ENABLED and all hosted/default gates remainOFF/hard-local;automatic deletionOFF/dry-run. No remote/customer write,commit,push or deploy. Real OAuth/remoteR2/CORS/edge latency/CPU/free-tier/native-headed acceptance remains not_checked. Next Task: distinct immutable opt-in matching profiles and genuine per-file batch/captured-identity recovery;coverage-scan cost,legacy witnesses,expiry/preview liveness and metadata-picker UX remain. Comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness are still required. FullM1–M5 remains ACTIVE/incomplete. This entry supersedes earlier in-progress run states; preserve unrelated dirty work.

## 2026-10-28 — M3i3 third complete standard LIVE (supersedes earlier run states)

Root18844/.local/m3i3-cloudflare-third.log is LIVE, executing the complete tests/local-smoke.mjs against the unchanged second-built final target/harness assets. Poll this same handle; never restart solely on observation timeout. Second47811 exited1 after192 groups at existing Guest-comment recovery helper623: the recovery form disappears during pending retry before follow-up authority reads and final sessionStorage cleanup. Root changed only that assertion to bounded polling of the same request ID's actual journal absence. Three identical retry payloads and one command/result/change/comment assertions remain. Scoped format/lint pass; read-only product source analysis independently confirmed the lifecycle ordering. No product fix or rebuild was needed for this test correction.

Final M3i3 focused18128 remains7/7 on final3 source/build with screenshot inspected,588 unit plus reference/strict/lint checks as below. Complete standard acceptance is still pending; first86510 and second47811 are failures,not passes. Persistent local D1 remains0049. Separate fresh backup/isolated0050 evidence is being prepared only; no persistent0050 apply before complete acceptance/live parity. All hosted/default flags and deletion remainOFF/dry-run; no remote/customer/commit/push/deploy. FullM1–M5 remains ACTIVE/incomplete; see ASSISTED_CANDIDATE_CATALOG.md and preserve all unrelated dirty work.

## 2026-10-28 — M3i3 final focused acceptance; complete standard LIVE

Read docs/ASSISTED_CANDIDATE_CATALOG.md. Final target build .local/m3i3-worker-build-final3.log exited0; final focused18128 exited0 with7 real workerd/D1/API/Chromium groups (.local log under apps/worker). Covers1,001 guarded synthetic logical-photo fixtures over24-row pages,exact cursor/session/scope/expiry boundaries,arbitrary final-page selected-head reserve/replay,375px first/previous/next/off-page selection,three correct decision headings,separate native radio groups,late identity clearing,lost-response same-UUID recovery,one actual signed R2 upload/native Sharp derivatives,stale head/sequence no writes and legacy/default-OFF. Root inspected worker .local/assisted-candidate-catalog-mobile.png; a filename list is not final visual-design acceptance. Exact fixture audit deltas are processing.enqueued/upload.authorized/upload.completed/upload.reserved each+1; stale denial full-state baseline is unchanged.

588 unit/67 files,full strict68388/lint8613,subsequent UI strict/scoped lint,final helper10/10,61 reference integration,Next build/14 reference Chromium,isolated populated0050 preservation/native range plan,52-document presence and diff checks pass. First full attempt86510 exited1 after338 groups at the obsolete privacy helper assertion imported before its correction; not a full pass. SECOND standard pnpm test:cloudflare is LIVE root47811/.local/m3i3-cloudflare-second.log. Poll that exact handle; do not restart for observation timeout. Final standard acceptance remains pending.

Persistent local D1 remains0049; source0050 is index-only and isolated-tested,not adopted. Before adoption require complete standard acceptance,fresh backup/isolated restore/upgrade/live parity. All hosted/default gates and deletion remainOFF/dry-run. No remote/customer write,commit,push or deploy. FullM1–M5 remains ACTIVE/incomplete. Next after acceptance: configurable opt-in matching profiles,true per-file batch/recovery,then comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness. Preserve the large dirty worktree and all proof artifacts.

## 2026-10-28 — M3i3 validation checkpoint (not complete acceptance)

Final target build .local/m3i3-worker-build-final2.log exited0 after both cursor-cycle and native radio-group corrections. Actual588 unit/67 files,final full strict68388,whole lint8613,61 reference integration95549,Next reference build and14 Chromium13914 pass.52-file document presence/diff checks pass. Isolated native D1 populated0049→0050 preserves119 old table hashes/schema/sequences/FK0 and chooses the new unforced covering index for the scoped BINARY ID range seek (worker .local/m3i3-catalog-plan-probe.log). Persistent local DB remains0049.

Focused final2 passed catalog setup,complete1,001-row bounded paging,Owner/session/scope/HMAC/query/expiry checks and arbitrary final-page head reservation/exact replay,then stopped at PHOTO_VERSION_NOT_READY when a synthetic alternate version was used for set-current. The guard is correct; the fixture is being changed to use a genuinely uploaded and Sharp/R2-processed alternate version. Never mark synthetic metadata ready or bypass processing. Browser radio/first-page/lost-response and full standard remain pending; no full M3i3 acceptance or0050 adoption is claimed. All hosted gates/deletion remainOFF; fullM1–M5 ACTIVE.

## 2026-10-28 — M3i3 Assisted catalog in progress

Read docs/ASSISTED_CANDIDATE_CATALOG.md. Source now includes default-OFF/hard-local Assisted catalog, signed24-row keyset pages, real chosen-head authorization outside the tiny preview map, bounded UI paging/selection and additive source migration0050. Gate OFF retains legacy Assisted behavior. Persistent local D1 remains0049; no0050 adoption, remote/customer write,commit,push or deployment.

Actual588 unit/67 files, full strict76374 and whole lint58155 exited0. Initial target build passed; a later source-only cursor-cycle fix needs rebuilt browser acceptance. Focused runtime owner is continuing actual workerd/D1/R2/Chromium tests; previous failures were test assumptions, not full acceptance. Do not claim M3i3 complete or apply0050 before complete runtime validation and fresh backup/restore/live parity. All hosted flags and automatic deletion remainOFF/dry-run. FullM1–M5 remains ACTIVE/incomplete.

## 2026-10-28 — M3i2 indexed automatic matching accepted locally

Branch: codex/kino-pic-foundation; HEAD remains b14d505. Existing dirty/untracked work was preserved. No stage,commit,push,remote/customer modification or deployment. Read INDEXED_VERSION_MATCHING.md for contracts, current source boundaries and the complete remaining scope.

Implemented: D1IndexedVersionMatchCandidates plus pure classifyIndexedVersionMatch use a single current-Owner/live-session/owned-active-scope snapshot for immutable canonical coverage, distinct logical-photo matches, pending work, full version-history aggregates, revisions/watermark and current head. No1000-row materialization limit is raised. Auto_filename uses this path under independent default-OFF/local-only INDEXED_VERSION_MATCHING_ENABLED and supporting gates; other modes preserve the existing reader and Assisted target choices. The response candidate list contains at most the current-head display/authorization entry for automatic mode, not materialized historical evidence. Missing coverage yields filename_index_not_ready with no fresh reservation. Current workspace ownership permits old uploading-actor witnesses without weakening scope.

Ordinary, explicit-version and resolved reservation paths attempt derived keys in the same guarded D1 batch. Hard key failure rolls back request/session/quota/audit/watermark; known errors retain their codes and unknown index failure maps to RESOLUTION_UNAVAILABLE503. Exact replay remains before fresh checks and retains its original UUID/target/bytes. No-op/expiry gaps are detected through completeness. Cancelled/expired uncompleted invalid source keys retain their immutable marker but no longer permanently block readiness. Panel heading IDs are per album. Final product copy displays human matching labels instead of raw enum/matching sequence/project revision; internal CAS/journal fields remain intact.

Actual verification:

- `pnpm test:cloudflare`: standard41146 exited0 with345 local workerd/D1/R2/API/Chromium checks; .local/m3i2-cloudflare-second.log. All13 new groups pass,including1,001 actual API pending reservations, a1,003-version history at the main proof checkpoint, actual R2 original/derivative processing, production SQL EXPLAIN canonical partial-index use, full-history hash/crop/ambiguity/pending cases, rollback,stale sequence/head CAS,exact replay,Assisted parity and375px UI.
- `node .local/m3i2-focused-runner.mjs` from apps/worker: final44905 exited0 with13 checks; worker .local/m3i2-focused-7.log. Adds real foreign-tenant preview/reserve404/no-write proof and final-copy375px not-ready screenshot. The full345 standard predates this copy-only refinement; final focused coverage is supplementary. Root inspected the complete panel screenshot apps/worker/.local/indexed-version-matching-not-ready-mobile.png: human mode label, explanation and disabled reserve control are readable without overflow.
- `pnpm test:unit`:563 tests/65 files; .local/m3i2-unit-first.log.
- `pnpm typecheck`: generated Worker/shared/Web strict38151 exit0; .local/m3i2-types-final.log. After final copy, Web strict82013 and scoped lint49141 also exit0 (.local/m3i2-ui-copy-types.log and m3i2-ui-copy-lint.log).
- `pnpm lint`: whole project92653 exit0; .local/m3i2-lint-final.log. Supplementary helpers passed targeted syntax/lint/format checks.
- `pnpm test:integration`:61 reference tests/10 files,32407 exit0; .local/m3i2-reference-integration.log.
- `pnpm test:e2e`:14 reference Chromium tests/27.1s,74294 exit0; .local/m3i2-reference-e2e.log.
- `pnpm build`: Next reference73991 exit0; .local/m3i2-reference-build.log. Target Worker/Web dry-run builds also pass, including final-copy .local/m3i2-ui-copy-build.log.

Final `pnpm format:check` passed (36349/.local/m3i2-format-final-pass.log); `python tools/check_handoff.py` verified51 document files and `git diff --check` passed. Document presence checking is not an application test.

Large-history completion fixtures are guarded synthetic D1 metadata with distinct source/command/completion witnesses and no dropped guards. They are not1,001 physical R2 transfers. Three actual small-image originals and their preview/thumbnail derivatives are separately processed through native local R2/Sharp/D1. EXPLAIN proves a local index plan, not hosted CPU/latency/free-tier acceptance. Expected injected audit/export failures in passing logs are negative-test evidence.

Earlier standard88308 stopped after322 checks on a helper expecting a wrapper around the direct legacy snapshot. Focused iterations corrected that shape, processed actual versions before set-current, distinguished native hostile-Origin/plaintext from missing-Origin JSON, truly omitted undefined headers, and used structural row equality. These failed attempts are not acceptance; final standard and focused logs above are authoritative. No product readiness guard was weakened.

Schema and Recovery: migration0049 is now applied LOCAL ONLY. Fresh backup .local/d1-before-0049-ba464a89-7597-4fcc-81a7-8ac51a2f6d35.sql is695697 bytes, SHA25600158b519d7179be6c423c4c2a36b154ee66a849fce13335674f8e9845208414. Source49 SHA2565843c7a5fe71c8cef3eea2b0eced406e29bb866e2de01c4b625849068f4f3a16. Backup47039 exit0 and successful isolated restore/upgrade98395 exit0 recorded123 successful CLI commands; all118 old table hashes/schema/product sequences preserved, new table empty,FK0. Initial isolated verifier16711 failed only because it counted SQLite's implicit autoindex; a fresh isolated rerun corrected explicit-index assertions. No persistent apply occurred during that drill.

Root `node .local/m3i2-adopt-0049.mjs --local-only` then rechecked acceptance,source/backup hash,all default gatesOFF and a fresh118-table live snapshot against the NEW backup baseline before applying. Adoption94446 exited0:60 CLI commands all exit0;119 product tables,same4 development rows,all118 old table hashes/schema/product sequences unchanged,matching_filename_index empty,FK0,ledger sequence48→49 and no pending migrations. Evidence in worker .local/m3i2-backup-integrity.json,m3i2-isolated-upgrade-proof.json,m3i2-final-live-before-adoption.json,m3i2-after-0049-state.json,m3i2-local-adoption-proof.json and m3i2-local-adoption.log. Preserve all backups/proofs and old M3h artifacts. Rollback disables the new gate and retains immutable records; repair forward through new profiles/migrations. Never restore an older backup over newer writes.

Remaining risks: coverage scans still grow with album history; edge CPU,latency,index storage and free-tier costs are unmeasured. Legacy unlinked history needs a truthful forward-witness strategy. Pending work requires durable cleanup/fencing; existing reserve-time expiry can advance a watermark and force explicit re-preview. Do not bypass CAS or time fences. Hosted OAuth/remoteR2/CORS/native-headed/free-tier checks remain not_checked. Every hosted/default feature gate and automatic deletion remainOFF/dry-run.

Next Task: implement bounded Assisted catalog pagination/current selected-head checks, then versioned opt-in rule profiles and genuine per-file captured-identity batch/recovery. Owner comparison refinements,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted readiness remain. FullM1–M5 goal is ACTIVE,not complete. Reproduce with `pnpm test:cloudflare`; all substitutes remain local/synthetic.

## 2026-10-28 — M3i1 filename index maintenance accepted locally

Branch: codex/kino-pic-foundation; HEAD remains b14d505. Preserve the extensive pre-existing dirty/untracked work. No stage,commit,push,deployment or remote/customer modification occurred. Read MATCHING_FILENAME_INDEX.md for source contracts and full next-slice acceptance.

Implemented: source migration0049_matching_filename_index.sql; strict status/capability contracts; D1MatchingFilenameIndex current-Owner scoped reader and at-most24-session idempotent builder; strict Origin/expected-actor/empty-body/1024-byte/query guards; independent default-OFF/hard-local MATCHING_FILENAME_INDEX_ENABLED; scoped Owner gallery panel with explicit progress/next-batch/refresh, owner rechecks, captured actor, suspension clearing and generation cancellation. Canonical keys retain exact immutable source witnesses; invalid names are explicit markers. Incomplete legacy versions/heads block readiness. Product matching/Assisted choices remain unchanged. A real existing gallery accessibility bug was fixed: aria-label now follows view/collapse state with album name, retaining aria-expanded.

Actual verification:

- `pnpm test:cloudflare`: complete standard41317 exited0,332 local workerd/D1/R2/API/Chromium checks; .local/m3i1-cloudflare-third.log. All6 new index groups pass, including real375px default-OFF hiding, manual batch, blur clearing, a held200 then current Owner denial, exact scope switch and blocked-state display. Existing history still covers74 actual action families and complete exports. Expected injected audit/stream failures in the log are negative-test evidence, not unresolved failures.
- `pnpm test:unit`:541 tests/63 files; .local/m3i1-unit-final.log.
- `pnpm typecheck`: final generated Worker/shared/Web strict19376 exited0; .local/m3i1-types-third-final.log.
- `pnpm lint`: final whole lint60259 exited0; .local/m3i1-lint-third-final.log. Separate new-helper no-undef/syntax checks passed.
- `pnpm test:integration`:61 tests/10 files; .local/m3i1-reference-integration.log/session23532 exit0.
- `pnpm test:e2e`:14 reference Chromium tests/28.3s; .local/m3i1-reference-e2e.log/session9942 exit0.
- `pnpm build`: Next reference build3417 exit0; .local/m3i1-reference-build.log. Target UI/Worker were rebuilt by the final standard command.

Final `pnpm format:check` passed (.local/m3i1-format-final-pass.log/session66347);50-file document presence and `git diff --check` passed. Presence checking is not app verification.

First standard7186 failed after315 old checks because the fixture requested a101st workspace; it now reuses the existing synthetic workspace with its own new project/albums. Helper duplicate body consumption, native hostile-Origin expectation and stale copy were corrected without relaxing product guards. Second69450 passed320 checks and the new mobile build/privacy flow, then found the real gallery accessible-name mismatch during collapse. The final third run rebuilt the actual correction and completed all332. Root inspected the375px state/counter/refresh-area capture at apps/worker/.local/matching-filename-index-mobile.png; this is a partial viewport, not full-panel visual acceptance.

Current source0049 SHA256: `5843c7a5fe71c8cef3eea2b0eced406e29bb866e2de01c4b625849068f4f3a16`.

Schema and Recovery: populated isolated0048→0049 verifies all118 pre-existing product table row hashes/counts, old schema/guards and SQLite sequences unchanged, one empty new119th table and FK0. Persistent local D1 remains0048; no persistent0049 application, backup/restore adoption or hosted migration is claimed. Before adoption create and verify a fresh backup/isolated restore, pin migration hash and compare live state again. Application rollback disables the gate and retains immutable records; repair through a new profile/forward migration. Never restore an old backup over newer writes. All hosted gates and automatic deletion remainOFF/dry-run.

Remaining risks: maintenance status still scans album coverage; representative-volume latency/edge CPU and index cost are not measured. New uploads are not dual-writing keys yet and make completeness missing again. Legacy unlinked versions require an explicit forward witness strategy. The ready status is an advisory snapshot and cannot authorize matching or upload. Index classification, rules and batch are not implemented by this foundation. Per-instance heading IDs should be refined for simultaneous panels before hosted enablement. Real Google/GitHub/remoteR2/CORS/edge/free-tier/native-headed acceptance remains not_checked.

Next Task: integrate scoped indexed classification with full immutable history/pending coverage and reserve-time sequence/head CAS; preserve all Assisted choices through a paginated catalog; add distinct opt-in profiles and per-file captured-identity batch recovery. Then comparison refinements,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted readiness remain required. FullM1–M5 goal remains ACTIVE,not complete. Reproduce locally with `pnpm test:cloudflare`; all service substitutes are explicitly local/synthetic.

## 2026-10-28 — M3h Owner workspace history/export accepted locally

Full standard run41792 exited0:326 local workerd/D1/R2/API/Chromium checks (.local/m3h-cloudflare-seventh.log),including all10 new history API groups and actual375px enabled/default-OFF history filters,paging,complete CSV/JSON Blob files,error/no-file and late-identity privacy. It reads74 actual workspace action families across every owned workspace,retains original actor/session/request/UTC context and safe before/after values,and proves reads create no audit/retention activity. Unknown/malformed details never expose raw JSON. Current Owner/session/workspace checks repeat on pages/chunks; signed24-row snapshots exclude later backdated appends and survive a fresh authorized Owner session. Related invitations include immutable Guest/Owner witnesses,multi-invitation reviews and exact long reopen IDs. Guest visibility/read-right boundaries are unchanged.

Real Gallery bug fixed and accepted in this standard run: a pending page changed the navigation callback and tore down the open modal lifecycle,losing the opener focus. Keyboard callbacks now update through a ref; lifecycle cleanup occurs on actual open/close. The deterministic real-cursor hold regression opens the modal before releasing a new eligible photo,tests latest keyboard navigation and Escape focus restoration. Synthetic fixture timestamps/order are restored in finally; images/versions/keys/guards remain unchanged. Root inspected the final375px Owner history viewport and Gallery focus-ring captures (worker .local/owner-history-mobile-viewport.png and gallery-grid-mobile.png).

529 unit tests/61 files (.local/m3h-unit-sixth-final.log),integrated generated strict types (.local/m3h-types-sixth-final.log),whole lint (.local/m3h-lint-sixth-final.log),61 original reference integration,14 reference Chromium and Next reference build passed. Separate real workerd/D1 probes verify160-codepoint project/album create/rename/before/after retention (.local/m3h-unicode-probe.log) and512-character opaque session provenance across51 events/3 pages/complete JSON export (.local/m3h-session512-probe.log). Unit boundaries also reject unsupported513-character session IDs. The local/synthetic-only stream test Worker delegates to the real repository/D1 and proves pre-generation cancel/session expiry yield1 start/0 completion,restores the session and permits read200; native preinstalled completion-audit failure rejects the body. It is never mounted in the production API. Server generation is not client receipt. Standard run includes these checks; earlier failed/partial runs below are historical,not acceptance.

0048_owner_history_indexes.sql is applied LOCAL ONLY:8 CLI commands succeeded,7 indexes added. NEW694741-byte backup SHA256c5c604d5bb06170f83e5d4677138d57b235630bffadf2bb1a95252c52799444f was isolated-restored/isolated-upgraded and compared with a fresh live118-table snapshot before adoption22101 exit0. After adoption all118 old-table row hashes/counts/same4 development rows are unchanged,FK0,no pending migrations. Evidence: worker .local/m3h-local-adoption.log,m3h-apply-0048.log,m3h-after-0048-state.json and m3h-isolated-upgrade-proof.json. Migration SHA2560add396c3c6e0e1e4ad3d0fc519f0dca2cd8ae4e25ce98ec04042ba34206158f. Populated standard upgrade also preserves sequences/audit triggers; actual D1 plans use workspace-time/photo indexes and a workspace/implicit-rowid seek. No history-wide MAX is recomputed on every authority check. Leave data/ledgers intact,disable gate and repair forward; never restore an old backup over newer writes.

All hosted/default gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer modification,commit,push or deployment. Real OAuth/remoteR2/CORS/edge/free-tier/native-headed acceptance remains not_checked. Sparse actor/invitation filters and large exports need representative-volume assessment; client files above64MiB fail explicitly. Workspace history information hierarchy needs refinement before hosted enablement. Original independent Guest annotation read-permission question remains pending,so can_annotate128 is unchanged.

Next Task: scalable indexed matching/rules/batch upload,with Owner comparison refinements,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted readiness still required. FullM1–M5 goal remains ACTIVE and incomplete. Read docs/OWNER_HISTORY.md and preserve the large unrelated dirty worktree. This entry supersedes historical pending/run-state entries below.

## 2026-10-28 — M3h fourth standard run active

Current actual process48775/.local/m3h-cloudflare-fourth.log is LIVE; poll this same handle and never restart solely for timeout. Third78128 exited1 after315 old checks plus2 new API groups: the broad actual-source helper shallow-compared nested processing outputs against raw JSON,incorrectly expecting deliberately omitted SHA256 hashes. It now recursively checks every retained value,all array lengths/order and sensitive-key exclusion. Product privacy was correct; no hash was added back. Separate real-data bug fixed: project/album160-codepoint names can exceed256 UTF-16 units,so content-name projection now matches the original160-codepoint rule.528 unit/61 files pass; final full strict18605/lint45506 pass. Actual rebuilt workerd/D1 Unicode probe .local/m3h-unicode-probe.log preserves create/rename/before/after values and the prior51-event snapshot. Main fourth rebuilt the final source and includes all10 history API groups plus375px enabled/default-OFF browser coverage. Persistent DB remains0047 pending complete vertical acceptance; no remote/customer/commit/push/deploy. FullM1–M5 remains active.

## 2026-10-28 — M3h third standard run active

Current actual process78128/.local/m3h-cloudflare-third.log is LIVE; poll the same handle,do not restart on timeout. Second43270 exited1 before new history API checks: existing owner-annotation-authoring-browser helper immediately asserted journal null after server current-target200,before browser consumption. Root changed only that assertion to bounded expect.poll of actual sessionStorage null; target/current revision/command audit/UI assertions remain. Product source is unchanged. Third includes latest product build,all10 new history API groups and enabled/default-OFF375px history browser helper. Final527 unit,full strict53951,whole lint63688,format check,49-file document presence and diff checks pass; actual Next build/61 integration/14 reference Chromium remain green. Persistent DB remains0047. Pre0048 backup/restore/index-only isolated upgrade and pinned proof are ready; ignored adoption script requires a not-yet-created verified326-check acceptance file before local application. Full vertical acceptance is still pending; no remote/customer/commit/push/deploy. FullM1–M5 remains active.

## 2026-10-28 — M3h workspace history/export in progress

Read docs/OWNER_HISTORY.md. Source service/routes/contracts/projection/UI and independent default-OFF/hard-local OWNER_HISTORY_ENABLED are integrated.0048 is additive seven indexes only; persistent development DB remains0047/118 product tables/same4 development rows/FK0. FullM1–M5 remains active; no remote/customer edit,commit/push/deploy.

Actual527 unit/61 files and61 original reference integration tests passed; integrated strict types86713 and Next reference build86904 passed, plus14 reference Chromium tests29540. First full standard96007 exited1 after all315 old checks (including genuinely populated0047→0048 preservation) because a new helper expected application JSON for native hostile-Origin403; exact native403 and missing-Origin application JSON are now separate checks. Do not call this a complete M3h pass. Lint first found root this-alias, then an unused ignored-probe variable; both fixed, final whole lint still to confirm. Initial strict/UI Blob/optional-field errors were fixed and verified.

The latest rebuilt product passed actual isolated workerd/D1/Chromium probe (.local/m3h-browser-probe-third.log under worker), including24-row snapshot paging,complete CSV/JSON Blob downloads,forced completion-audit failure/no file,blur/focus,held200 followed by invalid identity,and genuine default-OFF UI. Root inspected the375px viewport capture .local/owner-history-mobile-viewport.png. Expected OWNER_HISTORY_EXPORT_FAILED in that log is injected stream-failure evidence,not a successful production download. The later capability lifecycle fix was rebuilt before this third probe; older runs used the prior bundle.

Actual isolated workerd/D1 upgrade (.local/m3h-upgrade-probe.log) preserves118 tables/71 populated fixture rows/39660 canonical bytes/audit trigger SQL/FK0, adds seven indexes and verifies workspace-time/photo/rowid-seek query plans and seek bytecode. The main populated upgrade also exercised existing command and sequence history before its later unrelated API-helper failure. NEW pre0048 backup694741 bytes SHA256c5c604d5bb06170f83e5d4677138d57b235630bffadf2bb1a95252c52799444f was restored into a separate directory and isolated-upgraded: all118 old-table hashes/counts/same4 development rows preserved/FK0/no new tables (.local/m3h-backup-restore.log and m3h-restored-upgrade.log). Current0048 SHA2560add396c3c6e0e1e4ad3d0fc519f0dca2cd8ae4e25ce98ec04042ba34206158f. No persistent0048 adoption until complete vertical acceptance and fresh live-state recheck. Keep gates OFF,repair forward,never restore over newer writes. Real OAuth/remoteR2/CORS/edge/free-tier/native-headed acceptance remains not_checked.

Next: finish full standard API/UI acceptance with actual per-action source checks across all owned workspaces,then local adoption if verified; afterwards scalable matching/batch,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted gates remain required. Preserve other dirty edits.

## 2026-10-28 — M3g5 independent annotation processing accepted locally

Genuine Owner processing of Guest annotations is implemented across schema/service/API/current reads/UI/recovery/tests. Independent open/in_progress/resolved decisions retain real Owner provenance and never modify Guest geometry, authorship or lifecycle. Guest content edits make the decision stale; explicit Owner reack pins the current content revision. Same-invitation sharing and different-invitation isolation remain enforced. The separate read-versus-write permission question is still pending: preserve can_annotate128 metadata read eligibility.

Final complete standard run17448 exited0:315 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g5-cloudflare-twelfth.log), including a fresh product build and the final mobile layout correction. Earlier complete runs31021/12781 and main rerun68398 also passed315; historical failed/partial runs below are not passing evidence. Coverage includes dual revision CAS, audit rollback, fresh-session historical replay, actual Owner A→B→A recovery isolation, held real200/full reload/exact UUID retry/current targeted read, and real historical AfterV28 Guest point/color edit. Guest own-target verification precedes fresh shared-target reconciliation; stale processing remains visible before reload, and Owner reack acknowledges content revision4.498 unit tests/58 files, generated integrated strict types, full lint and Next reference production build passed (m3g5-unit-indexed/types-indexed/lint-indexed/next-build logs). Root visually inspected the final Owner and Guest375px captures (worker .local/annotation-processing-owner-mobile.png and annotation-processing-guest-mobile.png). Guest labels/status are readable above the separate mobile action row; no horizontal overflow. Native-headed delivery remains unverified. Whole-repository Prettier,48-file document presence checker and git diff --check passed; the document checker is not an app test.

0047_owner_annotation_processing.sql is now applied LOCAL ONLY:48 commands succeeded. New651211-byte backup SHA256199ee6cc95a9cc0328de16c69e017c50cd3a59ef38940d8b91773bfd39ab770b, actual isolated restore70166/upgrade13204 and fresh live114-table parity passed before adoption. Post-adoption118 product tables/same4 development rows: all114 old table hashes/counts unchanged,4 new processing tables empty,FK0,no pending migrations. Evidence: worker .local/m3g5-local-adoption.log, m3g5-apply-0047.log and m3g5-after-0047-state.json. Current migration SHA2561d9ba2b88d59beb606be1b5457650c8e9fd8f0ca8a087f75ded146c182eef9ee is pinned in m3g5-isolated-upgrade-proof.json. Never restore an old backup over newer writes; gates OFF plus forward repair.

Actual current Wrangler/workerd D1 EXPLAIN verifies exact/page partial-index seeks and no global annotation/history materialization (.local/m3g5-query-plan-after-actual.log); readers join scoped processing states directly. This is local query-plan evidence, not edge CPU, latency or free-tier cost acceptance. All hosted/default feature gates remain OFF/hard-local; automatic deletion OFF/dry-run. Real OAuth, remote R2/CORS, edge deployment and native-headed delivery remain not_checked. No remote/customer modification, commit, push or deployment.

Next Task: full Owner operation history and exports, then scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, roles/multi-node and hosted acceptance. Full M1–M5 goal remains active. Preserve unrelated dirty edits. Earlier entries below are historical checkpoints; this entry supersedes their0046/pending0047 status.

## 2026-10-28 — M3g5 API accepted within partial runs; full UI acceptance active

All6 new processing API groups have actually passed in fourth76307/.local/m3g5-cloudflare-fourth.log: independent gate/input/current Owner boundary, body-free real Owner state/audit with unchanged Guest/comment sources, dual CAS+concurrency, content stale versus lifecycle +explicit reack, deleted-parent historical replay after original-session pruning, and Owner/Guest shared processing-clock cursor invalidation. The same run passed existing Guest annotation, Owner readonly and Owner authoring browser groups. It then failed only the new helper's parsing of the stored journal envelope as flat metadata; fixed. Fifth94575 passed a real accepted held processing request/full reload and then failed an overly strict raw-envelope equality: status legitimately changed ready→uncertain while metadata/command stayed identical. The helper now allows only that status transition and compares every original metadata field; B/A switching still requires unchanged post-reload raw bytes.

498 unit/58 files (.local/m3g5-unit-complete.log), final generated Worker/shared/Web strict (.local/m3g5-types-second.log), full lint (.local/m3g5-lint-final.log) and actual Next reference production build (.local/m3g5-next-build.log) pass. No hosted evidence. Current full standard run26971/.local/m3g5-cloudflare-sixth.log is ACTIVE; do not restart solely on observation timeout. The historical GuestAfterV28 setup and actual Guest UI point/color edit are in this helper, with strict own-target read preceding shared-target processing reconciliation and pre-reload stale-label assertion. A/B same-photo/version cross-invite recovery is also in source and still awaits a complete runtime pass. Root source/journal scopes were reviewed and hardened; no cross-invite replay/read/reconcile is allowed.

New651211-byte pre0047 backup and actual isolated restore/upgrade are verified as below:114 old-table hashes/4 development rows preserved,4 empty new processing tables,118 total/FK0. Persistent development DB remains0046/114tables;0047 adoption has NOT happened. Prepared ignored .local/m3g5-adopt-0047.mjs performs migration SHA/backup SHA/current114-table parity before local-only application, but must not run before full vertical acceptance. All default/hosted flags OFF/hard-local and deletion OFF/dry-run. No remote/customer edits, commit/push/deploy; fullM1-M5 remains active.

## 2026-10-28 — M3g5 independent annotation processing in progress

M3g4/0046 remains the last locally accepted baseline (308 Worker/browser checks,467 unit,114 persistent product tables/same4 development rows/FK0). This turn continues genuine Owner processing of Guest annotations: separate open/in_progress/resolved decision/revision, expectedAnnotationRevision + expectedProcessingRevision CAS, immutable body-free receipts and real Owner audit. Guest create/update (geometry/style/link) advances content watermark and makes prior decisions stale; Guest resolve/reopen/delete do not count as content edits. No Guest geometry/authorship/lifecycle is modified or impersonated.

Contracts, service/routes/default-OFF hard-local gate, current SQL readers, Guest status reconciliation, Owner processing panel and metadata journal are integrated.498 unit/58 files (.local/m3g5-unit-complete.log) and generated Worker/shared/Web strict types (.local/m3g5-types-second.log) pass; full lint passed before final scope hardening, whose focused Web lint/typechecks also pass. Cross-invite recovered A intent under B was found by read-only review and fixed before acceptance: full target match before claim/send/read, metadata-only guidance under B, and actual source scope in parent reconciliation. The browser regression is written but not yet passed. Root also requires the Guest content-edit browser path to prove strict own read followed by current shared processing projection without losing status.

First runtime99760 passed actual populated0046→0047 history preservation then failed the old Owner read field whitelist; processing was added explicitly with exact initial/null assertions, retaining all privacy restrictions. Second78496 failed the hostile-Origin fixture's expectation; real native403/Invalid Origin header is now checked separately from missing-Origin JSON403. Third81557 passed the first3 processing API groups and all content/lifecycle/reack assertions, then the privacy fixture incorrectly serialized its own body-bearing comment objects; it now checks only real receipt/annotation projections. No weakening of server checks. Guest historical UI helper was corrected to select actual AfterV28 (with a third Before) rather than silently switching the fixture to currentV1. Full runtime/UI acceptance remains PENDING; do not call this enabled/hosted usable.

NEW pre0047 backup651211 bytes, SHA256199ee6cc95a9cc0328de16c69e017c50cd3a59ef38940d8b91773bfd39ab770b, worker .local/m3g5-backup-integrity.json. Actual isolated restore62330 exit0 preserves all114 old-table hashes/4 development rows/FK0. Isolated0047 upgrade95858 exit0 preserves those114 tables and adds4 empty processing tables, total118/same4 rows/FK0. Proof .local/m3g5-isolated-upgrade-proof.json pins migration SHA256 ed8eceb5b18908a6a10fb617658d908f4eb1681ee85c13eaf23c0b888610dd11. No persistent0047 adoption; live remains0046. Before eventual adoption finish current API/UI acceptance and recheck current114-table contents against this backup. Before eventual adoption require NEW pre0047 backup/isolated restore/current114-table parity, populated-history preservation and full vertical acceptance; do not restore the pre0046 snapshot over newer data.

Guest /annotations/own and immutable Guest receipts remain unchanged. GuestShared cursor becomesv3 with independent Guest/Owner/processing counters; Owner Guest-read cursor becomesv2 with independent Guest/processing counters. Existing author-only OwnerOwn reader is unchanged. Current can_annotate128 read boundary stays unchanged pending the separate read-permission answer. All hosted gates and auto deletion remain OFF/dry-run. No remote/customer edit, commit/push/deploy. Read docs/ANNOTATION_PROCESSING.md for the frozen contract; preserve other dirty edits.

## 2026-10-28 — M3g4 genuine Owner annotation authoring accepted locally

M3g4 is locally accepted. Genuine Owner create/update/delete/resolve/reopen use separate commands/projection/changes/results, strict current Owner/session/exact invitation/photo/version authority, immutable before/after user audit and exact replay under a fresh valid Owner session. Owner can retain metadata for expired/revoked invitations and private versions; this never publishes bytes or broadens Guest access. Owner author-only recovery is separate from the existing readonly Guest annotation viewer. Guest shared lists include explicit Owner/Guest roles within one invitation, never peer write authority or identity IDs. Independent Guest/Owner cursor watermarks invalidate on either source, and the combined lifetime1000 cap includes tombstones while permitting replay/edit/lifecycle at capacity. Cross-role IDs and symmetric Owner request namespaces are guarded.

Actual final complete standard run94669 exited0:308 local Worker/workerd/D1/R2/Chromium checks (.local/m3g4-cloudflare-fourth.log). Prior complete third30871 also passed308.467 unit/55 files (.local/m3g4-unit-complete.log), generated Worker/shared/Web strict (.local/m3g4-types-complete.log), full lint (.local/m3g4-lint-final.log) plus focused final visual-helper lint passed. Same-turn Next reference build passed; it is not hosted E2E. Real375px Owner pointer geometry, reverse rectangle, full lifecycle, a held accepted create across full reload/exact UUID replay/current-own reread, and genuine disabled-Owner403 hiding Gallery/photos while preserving the exact raw journal all passed. Root visually inspected worker .local/owner-annotation-authoring-updated-mobile.png: actual purple private preview and red rectangle are visible. The helper also checks saved SVG geometry/visibility and actual red stroke pixels, retaining a canvas capture. Native headed delivery, real OAuth/remote R2/CORS/edge/free-tier acceptance remain not_checked.

A real integration defect found by the second runtime (Object.toString on a parsed query) was fixed with the production URLSearchParams helper and3 regression tests; strict types alone had not caught it. Initial raw-tamper error assertion was corrected to the actual predecessor guard without allowing writes. Current Owner auth denial and verified identity changes invalidate panel and Gallery caches/controllers under exact scope/generation guards, retaining journals; stale callbacks cannot repopulate or clear a replacement scope. Guest own/result contracts remain unchanged.

0046 is applied LOCAL ONLY:50 commands succeeded after NEW594730-byte backup SHA256 bf27e82976d3bddb995ca669f2f39eadfc6eca85228cc385403b7a1a4b9c3d09, isolated restore/isolated upgrade and a fresh live110-table hash comparison. Successful adoption36744 exit0: worker .local/m3g4-local-adoption-second.log and m3g4-apply-0046.log. All110 old tables remain byte-content-hash/count identical;4 new Owner tables empty, total114 product tables/same4 development rows/FK0/no pending migrations. Proof pins migration SHA256 c2288d201616fa486fed664bc019ac2a6a6249a9f629626986a1193d0eefd230 (.local/m3g4-isolated-upgrade-proof.json). First adoption11759 failed before migration because this Wrangler version has no --yes on migrations apply; read-only list confirmed0046 still pending. Corrected non-interactive local-only invocation rechecked the live snapshot before success. Never restore either backup over newer writes; gates OFF and forward repair.

All annotation hosted/default gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer edit, commit/push/deploy or production acceptance. The user-confirmed same-invitation sharing policy is resolved. The separate read-versus-write permission question remains pending, so can_annotate128 read eligibility is unchanged. Owner browser coverage does not claim native headed delivery or every valid-B delayed-response scenario (Guest already has separate actual coverage; Owner metadata CAS has unit/source review).

Next Task: genuine Owner processing decisions on Guest annotations with independent processing revision/status/audit (never modify Guest geometry/lifecycle or impersonate a Guest), then full Owner history/exports. FullM1-M5 remains active: scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, roles/multi-node and hosted acceptance remain unfinished. Preserve unrelated dirty edits.

## 2026-10-28 — M3g4 functional runtime passed; final visual check pending

Actual complete standard run30871 exited0:308 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g4-cloudflare-third.log), including all genuine Owner annotation API/cap/collision/history/replay cases, shared paired watermarks, real375px point/reverse rectangle/create/update/resolve/reopen/delete, a held accepted create across full reload with exact UUID/current-own reread, and real disabled-Owner403 clearing Gallery/photo cache while retaining the exact raw journal.467 unit/55 files (.local/m3g4-unit-complete.log), generated strict types (.local/m3g4-types-complete.log) and full lint (.local/m3g4-lint-final.log) pass. Earlier Next build passed; no hosted evidence.

Root visually inspected the first new Owner screenshot and found only controls/black canvas top visible because the nested scroller was positioned above the actual image. Functional assertions passed, but that capture was NOT visual acceptance. Helper now explicitly scrolls real decoded photo/rectangle into view and verifies saved SVG attributes plus actual red stroke pixels before capturing; final full run94669/.local/m3g4-cloudflare-fourth.log is active. Do not restart solely on observation timeout. Product source is unchanged by the screenshot-only strengthening.

NEW backup/isolated restore/isolated0046 upgrade are verified as detailed below. Latest live pre-adoption snapshot90074 exit0 still matches all110 backed-up tables/4 rows/FK0 (.local/m3g4-pre-adoption-parity.log under worker). Persistent DB is still0045; adoption is pending final checks. All flags OFF/hard-local; deletion OFF/dry-run; no remote/customer change, commit/push/deploy. FullM1-M5 remains active.

## 2026-10-28 — M3g4 genuine Owner annotation authoring in progress

The confirmed annotation policy remains same-invitation shared / different-invitation isolated. Owner authoring uses new strict contracts, independent commands/projections/changes/results in source-only migration0046, genuine user/session audit actions and a current Owner author-only recovery reader. It never writes a Guest command. Owner metadata can target any owned immutable version and retained invitation; Guest visibility still requires a live authorized invitation and an eligible published version. OWNER_ANNOTATION_AUTHORING_ENABLED defaults OFF and is hard-local, independent of Guest/comment flags.

Current source integrates Owner service/routes/editor/journal and mixed Guest/Owner shared rows with explicit authorType and independent Guest/Owner cursor watermarks. Actual464 unit/54 files (.local/m3g4-unit-final.log), generated strict types (.local/m3g4-types-final.log), full lint (.local/m3g4-lint-second.log) and Next build (.local/m3g4-next-build.log) passed before the latest URL serializer correction. First full runtime39250 exited1 only on an overly narrow raw-tamper error assertion; the trigger correctly rejected the write. Second5450 passed every new Owner API group, combined1000-row/tombstone cap, cross-role ID collision, paired stale cursors, populated0046 upgrade, Guest annotation browser and Owner readonly browser, then failed the new editor initial read. Root found the parsed query object was serialized with Object.toString instead of URLSearchParams; correction and a production-path regression test are underway. Full M3g4 UI acceptance remains PENDING. Current-auth denial/identity change now force Gallery cache/selection/request invalidation under generation guards while preserving all journals; actual disabled-Owner403 browser coverage is being added.

NEW pre0046 backup594730 bytes, SHA256 bf27e82976d3bddb995ca669f2f39eadfc6eca85228cc385403b7a1a4b9c3d09, worker .local/m3g4-backup-integrity.json. Actual isolated restore54476 exit0 matches all110 old-table hashes/4 development rows/FK0. Isolated upgrade68699 exit0 preserves all110 tables and adds four empty Owner tables, total114/same4 rows/FK0. Proof .local/m3g4-isolated-upgrade-proof.json pins migration SHA256 c2288d201616fa486fed664bc019ac2a6a6249a9f629626986a1193d0eefd230. Migration0046 has NOT been applied to persistent local D1; it remains0045. Before eventual adoption complete actual UI acceptance and recheck live110-table state against the NEW backup; never restore either older snapshot over newer writes. All hosted flags OFF, automatic deletion OFF/dry-run. No remote/customer changes, commit/push/deploy or hosted OAuth/R2 acceptance.

A separate read-versus-write permission question remains pending: retain the existing independent can_annotate128 read boundary until explicitly answered; do not infer permission broadening from elapsed time. Owner processing of Guest notes and remaining M1-M5 features are unfinished. Preserve all unrelated dirty edits.

## 2026-10-28 — M3g3 invitation-shared annotations accepted locally

The user-confirmed policy 同邀請共用（比照留言） is implemented and locally accepted. Guest main lists and overlays use /annotations/shared for the current sealed invitation; different invitations remain isolated. isMine and plain client badges derive from exact stored identity, with no peer edit/delete/resolve/reopen controls. /annotations/own remains strict author-only for command recovery and postreceipt current-row reconciliation. Commands, revision CAS, immutable witnesses and full Guest audit are unchanged; sharing never grants peer writes or image/compare/comment privileges. Shared cursors have their own viewer/session/scope domain and all-author watermark. Peer comment links are redacted without can_comment; no peer Guest IDs, bodies, keys, credentials or media URLs are exposed. No new migration was needed beyond0045.

Actual complete standard run:295 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g3-cloudflare-first.log, session43746 exit0).430 unit/50 files (.local/m3g3-unit-first.log), generated Worker/shared/Web strict types (.local/m3g3-types-first.log) and full lint (.local/m3g3-lint-first.log) passed. The same turn also passed61 reference integration/10 files,14 reference Chromium/28.1s and Next production build; these are reference coverage, not hosted E2E.375px Guest and Owner screenshots in apps/worker/.local were visually inspected; Owner capture includes the actual version overlay. Controlled delayed200/401 cases are distinct from explicitly canceled headless lifecycle cases; no native headed delivery claim.

Own canvas/recovery and Owner readonly base first passed288 checks (.local/m3g2-cloudflare-eighth.log, session78510 exit0). Actual tests cover point/reverse rectangle/keyboard/portrait/resize/zoom+pan pointer mapping, ancestor clipping, source version scope, real same-invitation peers and different-invitation isolation, own-only recovery reads, current tombstones, lost response/full reload/exact metadata CAS, live late200/401 versus valid replacement raw intent, corrupt/unavailable storage, cookie identity changes and current401 gallery-wide privacy clearing. Owner viewing supports explicit invitation/version, all authors, retained expired/revoked invite history and private draft metadata; bytes remain separately authorized. Cached image onLoad dimensions survive no-op selection and invite switching. Owner resource UUIDs retain exact SQLite identity; only new request UUIDs have canonical case.

0045 is now applied LOCAL ONLY:48 commands succeeded after a new550884-byte backup and isolated restore/upgrade proof. Backup SHA256 e031882926ae6237b483ab9008d8a5cb60d8ea719433e62d5f42487a90475b91; manifest apps/worker/.local/m3g2-backup-integrity.json. The live pre-adoption snapshot still matched all106 backed-up old tables. Post-adoption hashes preserve every one of those106 tables;4 new annotation tables are empty, total110 product tables/same4 development rows/FK0/no pending migrations. See worker .local/m3g3-apply-0045.log, m3g3-post-adoption-snapshot.log and m3g3-post-adoption-parity.log. Never restore this old backup over newer writes; gate OFF and repair forward. All Guest/Owner annotation gates remain OFF/hard-local, automatic deletion OFF/dry-run. No remote/customer modification, commit/push/deploy or real OAuth/R2/CORS/edge/free-tier acceptance. FullM1-M5 remains active: next genuine Owner annotation authoring/processing (never Guest impersonation), full Owner history/exports, scalable matching/batch, delivery/notifications, retention confirmation/retry and hosted/role/multi-node acceptance. Visibility is resolved; do not ask again or revert to own-only final display.

## 2026-10-28 — User decision: same-invitation annotations are shared

The user explicitly answered 同邀請共用（比照留言）. The prior visibility question is RESOLVED. Implement an invitation-shared reader/API/list/overlay while retaining the explicit own reader for exact recovery and existing author-only create/update/delete/resolve/reopen authority. Different invitations must remain isolated. See the new DECISIONS/GUEST_ANNOTATIONS/TASKS entries. Backend shared-reader/API test work is underway in new files; shared UI and full acceptance remain pending. Do not claim own-only display satisfies the final user policy.

Guest own drawing/recovery/identity/mobile acceptance passed within sixth/seventh runs, and375px Guest screenshot was visually inspected. Seventh failed on Owner cached-preview geometry after changing invitation: root fixed passive-effect clearing of image dimensions and made no-op selector changes idempotent. Eighth full local run .local/m3g2-cloudflare-eighth.log/session78510 is active; do not restart solely on observation timeout. Backup/isolated restore/isolated0045 upgrade are verified as documented below; persistent DB remains0044 and no annotation tables are persistently present. New policy does not enable any hosted flag; deletion stays OFF/dry-run. FullM1-M5 remains active.

## 2026-10-28 — M3g2 backup/isolated upgrade verified; complete UI acceptance pending

New pre0045 local backup is550884 bytes, SHA256 e031882926ae6237b483ab9008d8a5cb60d8ea719433e62d5f42487a90475b91, manifest apps/worker/.local/m3g2-backup-integrity.json. Actual restore to a new isolated directory matches all106 old-table row-content hashes,4 total development rows and FK0 (.local/m3g2-backup-restore.log under worker, session5620 exit0). Applying0045 ONLY to that restored copy also preserves all106 old tables, adds4 empty tables, total110 tables/same4 rows/FK0 (worker .local/m3g2-restored-upgrade.log, session3506 exit0). Persistent development DB is still0044; before eventual adoption recheck live state against this snapshot and take a new backup if anything changed. Never restore the old snapshot over newer writes.

Fourth full run53696 and fifth94286 both ended exit1 at the historical comparison selector, after actual point/rectangle/keyboard/zoom+pan pointer creates and all five new Owner API groups. Fifth diagnostic proves version GET200 and correct3457 permission mask; V28 is the selected Before and intentionally omitted from After to prevent equal-version comparison. Fix the test to select a different Before before choosing V28 as After; retain the product guard. Complete remaining portrait/version/recovery/delayed-response/identity/Owner browser checks and visual screenshot inspection before accepting M3g2.

Source now maps pointers from the actual decoded image rectangle while rejecting viewport/ancestor clipping via hit testing. Exact same-intent current401 clears the entire Guest gallery/Lightbox and selection state through a guarded callback, retaining metadata recovery; independent403 remains scoped. Guest pageshow reauthorizes. Stale A must not invoke global clearing or change replacement B. Live200/401 raw-replacement, cancellation-only and current401 gallery clearing tests are in source but NOT yet reached by a complete passing run.

Actual427 unit/49 files (.local/m3g2-unit-complete.log),61 reference integration,14 reference Chromium/28.1s, full generated integrated strict types (.local/m3g2-types-integrated.log), earlier full lint plus focused final integration lint and Next build pass. Full final lint/Worker UI suite remain pending after the latest source/test edits. Gates OFF/hard-local, deletion OFF/dry-run; no remote/customer change, commit/push/deploy or hosted/native headed acceptance. FullM1-M5 remains active. See GUEST_ANNOTATIONS.md/TEST_ACCEPTANCE and preserve dirty worktree.

## 2026-10-28 — M3g2 third runtime checkpoint

Third full local run .local/m3g2-cloudflare-third.log/session63283 ended exit1 at the first actual Guest point-coordinate assertion: request y412205 versus DOM-painted expected y412256, a51/1,000,000 discrepancy. All five new Owner API groups passed first, including genuinely expired/revoked invitations, readonly multi-author/tombstone pages, cursor changes and a fresh expired Owner session without altering the primary OAuth session. This is not complete Guest/Owner UI acceptance.

Next fix pointer mapping against the decoded rendered image rectangle, keeping the original viewport clipping check and pure oriented-image adapter, rather than weakening request/DB equality. Current 401/403 command/pagination denials must clear private UI only for the matching generation/Guest/full intent while retaining recovery metadata. Also distinguish a canceled lifecycle request from a genuinely delivered late panel response; add raw-journal-replacement acceptance for real delayed200/401 without weakening the send mutex. Final427 unit/61 reference integration/14 reference Chromium, generated strict types, full lint and Next build evidence remains in the preceding checkpoint; rerun focused/full relevant checks after these edits.

0045 remains source-only/local DB0044; all hosted gates OFF/hard-local and deletion OFF/dry-run. New ignored .local/m3g2-local-state.mjs is prepared for later backup/restore/hash parity but has not been executed. No persistent migration, remote/customer modification, commit/push/deploy or hosted acceptance. FullM1-M5 remains active.

## 2026-10-28 — M3g2 annotation UI integrated; acceptance in progress

Guest own point/rectangle canvas, version-bound drawing/list/lifecycle and metadata-only recovery UI are now mounted in the current Lightbox and After comparison view. Pending operations protect navigation. Authenticated Owner readonly invitation/version annotation contracts, D1 reader, routes, independent default-OFF OWNER_ANNOTATIONS_ENABLED gate and viewer are integrated. Owner metadata may include owned private drafts; Guest eligibility and private image-byte authorization remain independent and unchanged. Peer annotation visibility still awaits the explicit product decision; no peer list is exposed to Guests.

Actual checks this turn:427 unit/49 files (.local/m3g2-unit-final.log),61 reference integration/10 files,14 reference Chromium/28.1s, Next production build, final generated Worker/shared/Web strict typecheck (.local/m3g2-types-final.log) and full lint (.local/m3g2-lint-final.log) passed. Initial test discriminant and Owner React lint findings were fixed. First Cloudflare run32344 exited1 on an observation bug: ordinary annotation POSTs were not included in the helper mutation list; bridge now observes every actual command. Second run12542 passed the first three new Owner API groups, then exited1 because the expiry fixture tried to UPDATE an immutable deadline; the guard correctly rejected it. Fixture now creates a genuinely short-lived sealed invite, proves pre-expiry access and polls the D1 clock before post-expiry assertions. Full-metadata late-response CAS, synchronous Owner scope clearing and explicit visible SVG strokes are repaired. Third full API/browser acceptance and screenshot inspection remain pending; do not call M3g2 accepted yet.

0045 remains source-only; persistent development DB remains0044. New pre0045 backup/isolated restore/old-table parity and local adoption are pending after vertical acceptance. All hosted gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer data modification, commit/push/deploy or real OAuth/R2/CORS/edge acceptance. Full M1-M5 remains active and unfinished. Preserve dirty worktree and use actual terminal logs before updating acceptance claims.

## 2026-10-28 — M3g1 annotation backend/coordinates accepted locally; UI pending

M3g1 Guest annotation backend and coordinate foundation are accepted locally. Point/rectangle geometry is normalized to integer1e6 in the oriented preview frame and immutable photo/version scope. Independent can_annotate128 never grants images/comments/selection/compare. Author-only create/update/delete/resolve/reopen, dual immutable command/state/change/result witnesses, full before/after Guest audit, exact same-session replay, lifetime cap and scoped own cursor pages are implemented. Optional own-comment links additionally require can_comment256. Public own activity exposes only annotationId/revision/state, never geometry/style/comment link/body. No drawing UI or peer list is shipped in this slice.

Actual final standard run:281 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g-cloudflare-seventh.log, session83933 exit0);406 unit/46files (.local/m3g-unit-first.log),61 reference integration/10files,14 reference Chromium(26.8s), generated strict Worker/shared/Web types (.local/m3g-types-final.log), full lint and Next/Worker builds passed. Populated0044→0045 upgrade preserves every prior table row and existing comment marker sequence, with four new tables empty/FK clean. It includes genuine guarded Guest/Owner comments plus a genuine Owner processing decision against actual private R2/Sharp ready V2. Own-author page/watermark indexes are verified by actual D1 EXPLAIN QUERY PLAN, including in the final populated full run; the separate ignored worker .local/m3g-index-probe.mjs also passed45 migrations/FK/plan assertions. This is structural query-plan proof, not hosted performance/free-tier acceptance.

0045 is source-only and NOT persistently applied; development DB remains at0044. GUEST_ANNOTATIONS_ENABLED=false in all Wrangler environments/.dev.vars.example and rejects hosted activation. No new annotation UI, local adoption/backup for0045, remote/customer modification, commit/push/deploy or real OAuth/R2/CORS/edge acceptance. Automatic deletion remains OFF/dry-run. Previous local0044 backup proof does not substitute for a NEW pre0045 backup/restore before later adoption.

Owned source: packages/contracts/src/annotation-geometry.ts and guest-annotations.ts; apps/web/target-ui/annotation-coordinates.ts; worker guest-annotations.ts (writer), guest-annotation-read.ts (own reader), guest-annotation-routes.ts; additive0045; Guest own history contracts/worker/UI projection; default-OFF config and actual guest-annotations.mjs/upgrade fixture. Independent can_annotate only permits geometry/current own metadata; image bytes keep their separate gateway permissions. A nonnull comment link requires a live own comment of exactly the same invite/photo/version and additional can_comment; lifecycle command link columns are null while stored links survive resolve/reopen. Legacy uppercase Guest comment IDs retain their exact stored identity; only new request UUIDs are canonical lowercase.

Diagnostics remain in first–fourth logs: native-Node relative history import needed .ts; public comment fixtures wrongly included internal commentId (now normal API targets onlyphoto/version, legacy uppercase fixture uses actual guarded42 command insert); an audit count incorrectly compared one annotation against all annotations; long LIKE pattern hit local D1 limits (now exact source event witnesses/action allowlist). Fifth/sixth standard runs passed280; the first added index check was accidentally after return, so it did not execute in sixth. It was moved before return, extracted into a shared assertion, independently run against real isolated D1/schema and then executed in the complete seventh281-check run. No product/data guard was weakened or disabled. Intentional TEST_* trigger exceptions in passing logs are asserted rollback injections. Static independent review found no actionable issue but is not hosted security acceptance.

Next M3g2: implement actual Guest own drawing/list/lifecycle/recovery UI and authenticated Owner readonly invitation/version annotation viewer, then actual375px pointer/keyboard/resize/zoom/pan/unknown-result/lifecycle acceptance. Integrate alongside existing GuestCommentsPanel in guest-selection.tsx and guest-version-comparison.tsx; use annotation-coordinates.ts with actual oriented image natural dimensions. Pending async product question: peers of the same invitation share annotations like comments, or only author+photographer see them? Do not infer that answer from the earlier comment-sharing decision. Explicit /annotations/own is valid under both choices; own UI/Owner readonly work can continue without exposing peer data. Genuine Owner annotation authoring/processing, shared display policy, full history/exports, scalable matching, delivery/notifications/retention and remaining M1–M5/hosted acceptance are still required; never impersonate a Guest for Owner writes.

Recovery: gate OFF and repair forward; retain annotation ledger/tombstones/audit and immutable photo versions/assets. Before local0045 adoption, take a NEW ignored current0044 export, hash it, restore to a fresh isolated path and compare all old tables. Do not reuse the pre0044 backup as a pre0045 snapshot. Existing annotation references must be accounted for before per-version retention is enabled; whole-album expiry remains subject to explicit policy/history protection.

Branch codex/kino-pic-foundation/base b14d505; dirty/untracked work is not committed. All root validation handles are terminal after final checks; do not infer missing work exists in prior chat. Copyable next command: `python tools/check_handoff.py`, then read GUEST_ANNOTATIONS.md/TEST_ACCEPTANCE and inspect the two real GuestCommentsPanel mount sites. Own drawing can be built before the peer-visibility answer; do not expose peers while it is pending.

## 2026-10-28 — M3f2b Owner processing vertical accepted locally

Independent Owner processing (待處理/open, 處理中/in_progress, 已處理/resolved) is now locally integrated and accepted. It preserves Guest text, lifecycle and revision; Guest body edits mark the saved decision stale, and explicit acknowledgement uses both CAS revisions. Same-invitation Guests see readonly status; other invitations stay isolated. Body-free receipts, genuine Owner audit and shared cursor markers commit atomically. Status and reply recovery share full metadata CAS and always reconcile a fresh authorized thread row before confirmation.

Actual terminal evidence:269 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3f2b-cloudflare-ninth.log, session94874 exit0);369 unit/42files (.local/m3f2b-unit-complete.log),61 reference integration/10files,14 reference Chromium(28.6s), generated strict Worker/shared/Web types (.local/m3f2b-types-fixed.log), full lint (.local/m3f2b-lint-last.log), Next production build and Worker dry-build passed.375px processing screenshot apps/worker/.local/comment-processing-mobile.png was visually inspected. Hosted OAuth/R2/CORS/edge and native headed lifecycle delivery remain not_checked.

0044 applied LOCAL ONLY after verified ignored512749-byte pre-migration backup and isolated restore.46 commands succeeded; all102 old tables retain exact row-content hashes,4 new tables start empty, total106 product tables retain the same4 development rows, FK clean/no pending migrations. Backup SHA256 c63607d764a0693498755c717639f54582f799c156195854e99c713a0fb60e44, worker .local/m3f2b-backup-integrity.json. Populated0043 upgrade also preserves actual Guest/Owner histories and existing shared marker rows/sequence. No remote/customer change, commit/push/deploy. Keep OWNER_COMMENT_PROCESSING_ENABLED=false and all hosted gates OFF/hard-local; deletion OFF/dry-run.

Important implementation corrections: canonical status updates use separate guarded UPDATE/initial INSERT, avoiding SQLite UPSERT firing the strict initial-insert guard on updates. Legacy Owner reply UUID case matching has an expression index. Guest content watermark counts only create/edit; same-state reaffirmation records a new Owner decision. Old immutable Guest/Owner receipts are unchanged, defaulting missing processing to null in parsers; current thread reads supply a live snapshot, Owner reply processing is always null. No new browser storage contains Guest text, bearer credentials or OAuth/session secrets.

First–eighth full attempts remain failed diagnostic logs, not accepted runs. Corrections addressed Node strip-only import incompatibility in the upgrade helper, strict public-field/status-label fixtures, test-helper UUID type inference, duplicate Response consumption, Guest recovery assertions racing reconciliation, and namespace tests accidentally using the intentionally full reply-cap invite. The final inverse namespace check uses a separate live invitation below cap; the full invite and all histories remain intact. Ninth complete run passes every old/new check. Intentional TEST_* audit-trigger exceptions in its log are asserted rollback injections.

Recovery: gate OFF, preserve commands/state/history/receipts/audit/markers/Guest text and immutable assets, repair forward. Original backup remains ignored; the isolated restore directory was removed only after literal absolute-path/prefix/non-reparse checks. This proves local D1 restore, not cloud/R2 disaster recovery.

FullM1–M5 remains active and incomplete. Next implement independent normalized point/rectangle annotations with separate permission, immutable version/scope, genuine actors and history; then complete full Owner history/exports, scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, production processing/roles/multi-node and hosted acceptance. Read COMMENT_PROCESSING.md and latest HANDOFF before continuing. Preserve the dirty codex/kino-pic-foundation worktree at base b14d505.

Next operator: run `python tools/check_handoff.py`, read docs/TEST_ACCEPTANCE.md and annotation requirements before designing the next migration. Current branch codex/kino-pic-foundation/base b14d505; untracked work is not committed. No root test/migration process remains live after the accepted checks and adoption.

## 2026-10-28 — M3f2b independent Owner processing integrated; full runtime pending

Branch codex/kino-pic-foundation, base b14d505; preserve dirty/untracked work. Task: independent Owner status for Guest parent comments, keeping Guest text/lifecycle/history unchanged. New0044 immutable commands/changes/results + guarded state + current snapshot view use create/edit content watermark; Guest edits mark stale, explicit acknowledgement/reopen remains Owner-authored. Body-free receipts and genuine user audit share the existing marker sequence. Current Owner/Guest authorized reads join the status in the same SQL snapshot. Owner status intents share actor/album reply journal, restore without body entry and require current targeted reads before confirmation.

Actual checks:369 unit/42files (.local/m3f2b-unit-final.log),61 reference integration,14 reference Chromium(28.6s), generated strict types, full lint, Next build and Worker dry-build passed. The isolated0043→0044 upgrade has actual Guest and Owner history and preserves all old rows/shared markers/sequence; FK clean/new4 tables empty. Static independent security review found no actionable issues but is not runtime acceptance.

Full Cloudflare attempts: first stopped at unsupported native-Node TypeScript parameter-property import in upgrade helper; replaced with actual guarded canonical command inserts. Second passed populated upgrade then found exact public-key allowlist needed processing. Third passed Guest API then found Guest own-status labels needed the newly explicit customer wording. These fixtures are corrected; ninth run is active (session94874, .local/m3f2b-cloudflare-ninth.log). A later namespace test now reuses an actual prior Owner reply command because the earlier cap acceptance intentionally fills that invite to1,000; no history/cap was cleared or weakened. Full new API/browser is not accepted yet.

0044 NOT persistently applied. Ignored512749-byte local pre0044 backup exists, SHA256 c63607d764a0693498755c717639f54582f799c156195854e99c713a0fb60e44; snapshot102 tables/4rows/FK0. Isolated restore completed successfully:102 old tables retain exact row hashes,4 rows/FK0 (.local/m3f2b-backup-restore.log). Verified temporary restore directory was removed after literal absolute-path/prefix/non-reparse validation; original backup remains. New status API first6 groups passed in the sixth/eighth diagnostics, including current snapshots, auth/CAS/staleness, concurrent single-winner and fresh-session replay; full API+browser remains pending. Fourth/fifth failures were additional strict public-key/Owner tombstone label fixture updates; sixth found a helper consuming one Response twice; seventh found an existing Guest recovery test reading storage before reconciliation completed; eighth found the inverse namespace test used a full reply-cap scope. Corrected these without dropping history, skipping checks or weakening capacity. The inverse namespace now uses a separate live Guest invitation below cap. Full strict initially found a new test helper UUID default inference issue; explicit string annotations passed the final generated strict rerun (.local/m3f2b-types-fixed.log). Original development DB untouched; no remote/customer changes, commit/push/deploy. All feature gates OFF/hard-local, deletion OFF/dry-run.

Next: inspect the actual live process handles/logs, resolve failures, pass full API+375px processing/recovery and inspect screenshot. Then verify restore parity, apply0044 locally only, recompare old row hashes/new4empty/FKs and update these pending checkpoints. FullM1–M5 remains active, including independent annotations, full Owner history/exports, delivery/notifications, retention preview/confirmation/retry, scalable matching and hosted acceptance. Copyable next command: `Get-Content .local/m3f2b-cloudflare-ninth.log -Tail 40` from project root. Never start a duplicate suite while its handle is live.

## 2026-10-28 — M3f2a Owner reply vertical accepted locally

Supersedes pending M3f2 checkpoints below. Genuine Owner thread reads/reply/edit/delete, explicit invitation/version UI, readonly same-invitation Guest visibility, durable recovery and shared thread cursors are integrated. Actual final standard run:260 local Worker/D1/R2/Chromium checks passed (.local/m3f2-cloudflare-twelfth.log, session94956 exit0);345 unit/41files,61 reference integration,14 reference Chromium(33.9s), generated strict types/lint/Next build passed.375px Owner screenshot was visually inspected. Hosted services and native headed lifecycle delivery remain not_checked.

0043 applied LOCAL ONLY after verified ignored468000-byte backup and isolated restore.63 commands succeeded;97 old tables retain exact row-content hashes,5 new tables start empty, FK clean/no pending migrations. Populated pre0043 Guest history upgrade also passes using guarded commands and an actual private16x16 R2/Sharp V2. Keep shipped OWNER_COMMENTS_ENABLED=false/hard-local, deletion OFF/dry-run. No customer/remote changes, commit/push/deploy. FullM1–M5 remains active; next Owner processing status with genuine actor provenance, then independent point/rectangle annotations, full history/exports/delivery/retention/hosted acceptance. Read OWNER_COMMENTS.md and HANDOFF before continuing.

Final packaging follow-up: full repository lint passed (.local/m3f2-lint-final.log,session84743 exit0). The comprehensive targeted Prettier check found only owner-comments.ts style; it was formatted, its recheck passed (.local/m3f2-format-fixed.log),44-file handoff checker passed, and git diff --check passed (.local/m3f2-diff-final.log; existing CRLF notices only). No semantic code changes followed the final260-check runtime acceptance. Branch/head remain codex/kino-pic-foundation/b14d505 with the existing dirty worktree preserved.

Current implementation:0043_owner_comment_replies.sql adds Owner commands/replies/changes/results and shared comment_thread_changes, preserving0042 Guest author/session FKs and stored receipt JSON. Owner APIs use current internal Owner/session, exact sealed invitation/photo/published-ready version, new-request parent/reply CAS and immutable audit; expired/revoked invitations remain reviewable by their Owner but deny Guests. Canonical lowercase request IDs and indexed case-insensitive legacy probes conflict symmetrically with all prior Owner ledgers, external claims, user fences and selection.reopened witnesses. Historical exact replay may use a fresh valid Owner session while retaining the original audit session string. Transient owner_sessions are not pinned by new FKs; never recreate a previously audited session ID.

UI is mounted in the existing Owner AlbumGallery Lightbox. Explicit invitation and version selectors,24-item pages, literal text, author role badges and reply/edit/delete confirmations are functional. Guest readers see readonly Owner replies only in the same invitation. Browser journals contain metadata/body SHA only, no plaintext or credentials; full reload requires original body reentry. Atomic send claims, full-metadata CAS, storage revalidation, generation/visibility guards and a short preparation mutex preserve newerB against lateA200/401. Confirmed receipts are reconciled through current targeted reads before journal completion. Blur/hidden clears visible text; focus/pageshow can restart interrupted bootstrap. Initial hidden mounting has a source guard; direct hidden-at-mount and native headed event delivery were not independently exercised. Default-OFF capability loading never locks existing gallery keyboard navigation.

Actual final runtime covers16 new API groups plus the375px Owner workflow: actual ready versions, independent scopes, parent/reply CAS, tombstones, audit/marker rollback, exact fresh-session recovery, case-variant legacy namespace collisions,1,000 lifetime replies including tombstones with1001st rejection/reads/replay/edit at capacity; initial capability response interrupted by explicit blur/focus/pageshow; literal HTML text; a committed lost200 then full reload/body reentry/exact replay; edit/delete current reads; peer Guest readonly UI and other-invitation isolation; same-Owner A/B pending journals protected against delayed actual200 and test-injected401 after real commits. The401 fault is verified as an actual browser401 response with a fully received body, not a content-length/network failure. One command/result/change/marker/audit per request is asserted. Screenshot apps/worker/.local/owner-comments-mobile.png (375x812) was visually inspected; recovery screenshot is separate. Full M1–M5 is not complete.

Backup: apps/worker/.local/d1-before-0043-20261028-014104.sql,468000bytes,SHA256 e777bfe679555dbf8e3b43064ef6358d38f043d41b180bd60674fe4dd174b703. apps/worker/.local/m3f2-backup-integrity.json records export, isolated import/row-content hash parity and scoped cleanup. Actual development DB held4 rows across97 product tables before adoption; a separate guarded populated Guest fixture proves nonempty comment/command/change/result/audit preservation through0043. Post-adoption has102 product tables and the same4 old rows. Tracking/internal tables are excluded from content comparison; Wrangler separately confirms no migrations pending. Both DB copies had empty foreign_key_check. This proves local DB restore/content parity, not remote/R2 disaster recovery. The verified isolated restore directory was removed after literal-path/prefix/non-reparse checks; original DB and ignored SQL backup remain.

Evidence: .local/m3f2-cloudflare-twelfth.log (260,exit0) supersedes eleventh260 pass by adding the populated0042 upgrade fixture. .local/m3f2-unit-ui-final.log (345), reference-integration-final.log (61), reference-e2e-final.log (14), types-ui-final.log, lint-ui-final.log and next-build-final.log. Exact-root filenames carry the m3f2 prefix. Final formatting/docs/lint checks are recorded separately. No hosted OAuth/R2/CORS/edge/free-tier/deployment acceptance is claimed.

Failure history remains in first–tenth logs. First: extensionless native-Node TS import; second: stale Guest browser field list; third: workspace fixture hit existing100 cap (fixed by existing-workspace project); fourth/fifth: expiry test removed/recreated main audited session (fixed with an independently signed unique synthetic session, preserving APPEND_ONLY_AUDIT); sixth passed258 backend checks. Seventh found a real default-OFF boot-navigation lock; fixed source without weakening keyboard tests. Eighth selected an earlier target-read witness after edit; fixed sequence-bounded read assertion. Ninth read comparison options before async history arrived; now waits actual options. Tenth expected a standalone deletion label while UI renders combined revision/state; assertion now scopes the actual Owner article/state. Independent review also found request UUID case replay, initial blur/bootstrap deadlock and hidden-at-mount visibility gaps; source fixes and applicable regressions passed. Two additional journal regression tests reproduced cached-storage overwrites before the full-metadata/storage fix; all7 journal tests now pass. Do not relabel these intermediate failures as full passes.

Next concrete task: genuine Owner processing-status commands/projection without impersonating Guest or rewriting Guest-authored text/state, then normalized point/rectangle annotations respecting orientation/letterboxing and immutable versions. Full Owner history/exports, proactive/batch Owner workflow where required, indexed matching/rules/batch, delivery/notifications, retention confirmation/retry, production processing/roles/multi-node and hosted acceptance remain open. Recovery: disable Owner comment writes, retain0043 schema and immutable ledgers/markers/audit, and repair forward; Guest thread reads now use0043 tables even when the Owner gate is OFF. Restore only into an isolated verified recovery copy. Preserve dirty codex/kino-pic-foundation base b14d505 and all unrelated edits; no staging/commit/push/deploy was performed.

## 2026-10-28 — M3f2 backend accepted locally; Owner UI pending

Actual standard full local Worker run passed258 checks (.local/m3f2-cloudflare-sixth.log, session1557 exit0), including15 new Owner reply/API cases, existing Guest/Owner Chromium and actual isolated D1/R2/Sharp flows.338 unit/40files, root strict types, lint and isolated43-migration/FK probe passed before the newest UI work;7 additional Owner journal tests now pass after reproducing/fixing2 stale-storage overwrite cases. Do not treat these as final full Owner UI acceptance.

0043 source adds genuine Owner replies/commands/changes/results, shared Guest/Owner markers, canonical request casing and symmetric indexed legacy namespace guards. No persistent0043 application, remote change, commit/push/deploy. Owner replies remain OFF/hard-local in all environments; deletion OFF/dry-run. Owner UI is now mounted behind the gate, but bootstrap visibility/race fixes, new1000-reply capacity case and actual375px workflow/recovery acceptance are pending. Read docs/OWNER_COMMENTS.md and latest HANDOFF. FullM1–M5 remains active; Owner status/annotations/delivery/retention/hosted acceptance are unfinished.

Backend evidence covers readonly invitation/version scoped reads; reply/edit/delete CAS and tombstones; exact historical receipts after parent edits/deletion; readonly same-invitation Guest visibility and different-invitation isolation; current authority; genuine Owner audit provenance and rollback; shared cursor invalidation in both directions; primary/alternate marker guards; case-variant legacy namespace conflicts in both insertion orders; and fresh synthetic-session D1 replay retaining old session strings after logout-safe deletion. The expiry-denial case now creates an independently signed synthetic session using installed better-auth/crypto, verifies it through HTTP, expires it and leaves the main OAuth session untouched. Provider services are mocked; hosted OAuth/R2/CORS/edge is not_checked.

Failures are preserved: first run failed before tests on a Node native TypeScript extensionless import (fixed explicit .ts); second passed new Guest API but hit an old browser exact-field list (updated to include authorType,parentCommentId with privacy checks retained); third passed Owner lifecycle/isolation then hit the existing100-workspace fixture cap (use project creation in its existing workspace, do not raise cap); fourth passed all15 Owner checks but pruned the main expiry-test session, breaking a later baseline; fifth attempted restoring that audited session ID and correctly failed APPEND_ONLY_AUDIT. The sixth fixes only the fixture with a unique synthetic signed cookie/session and passes all258 checks without weakening production audit. Root also fixed opaque BetterAuth session parsing, removed transient session FKs and added DB clock defaults/Guest-only reply parents before runtime acceptance.

Current UI files are apps/web/target-ui/owner-comments.tsx and owner-comment-journal.ts, mounted from album-gallery.tsx. Pending journals lock Lightbox navigation. Two stale-storage regression tests initially failed and now pass: cached-empty storage cannot overwrite later corruption, and confirmedA cannot overwrite unknownB. Atomic send claim and generation/CAS protections are implemented; an independent reviewer found initial blur/focus bootstrap deadlock and initially-hidden mounting, now under repair by /root/owner_comment_contracts. /root/owner_comments_api_tests is writing actual owner-comments-browser.mjs and has appended an unexecuted16th actual1000-reply cap case. Root owns final integration. Do not advertise Owner UI as accepted until actual browser/full suite passes. Populated0042 Guest-history upgrade verification is still required before persistent0043 adoption. Recovery: gate OFF, retain immutable commands/replies/changes/results/markers/audit and repair forward; never recreate a previously audited Owner session ID or drop history to make tests pass.

## 2026-10-28 — M3f2 Owner reply contracts; runtime pending

Owner reply/edit_reply/delete_reply now have strict shared Zod contracts and meaningful validation tests. Commands reject client actor/session/workspace/Guest identity injection, bind new replies to invitation/photo/version/parent revision, and require reply CAS for edits/deletion. Owner thread pages enforce scoped unique items; authorType/parent/canEdit and tombstone/result invariants prevent representing Guest text as an editable Owner reply. Body normalization reuses the existing Guest Unicode rules.

Actual checks this turn:325 unit tests/39files passed (including9 new Owner contract cases); root TypeScript strict check and focused ESLint passed. ESLint emitted the existing React-detection warning, with no lint findings.44-file documentation portability check passed (presence only). Initial tsc caught a test reading body without narrowing the delete_reply union; corrected narrowing passed the rerun. Existing243 Worker/reference/browser acceptance remains historical and was not rerun for these unexposed contracts. No new migration, API, UI, persistent DB change or hosted deployment.

Read docs/OWNER_COMMENTS.md for the concrete next implementation. Add genuine Owner commands/replies/changes/results and a shared transactionally guarded thread watermark; preserve0042 Guest actor/session FKs, all Owner request namespace witnesses and exact replay under a fresh valid Owner session. Then service/API/UI/runtime acceptance; Owner processing-state transitions require explicit actor-aware projection. Do not advertise Owner replies as available yet. All default-OFF/hard-local flags and deletion OFF/dry-run remain unchanged. FullM1–M5 remains active; annotations/delivery/retention/production acceptance are unfinished.

## 2026-10-28 — Local backup restore follow-up

The pre0042 backup was imported successfully into a fresh isolated --persist-to directory without overwriting the development DB. Read-only verification matched counts for23 existing tables and found empty foreign_key_check in both copies; restored schema had0 new comment tables versus4 in the current local DB, confirming the pre0042 boundary. This is local restore evidence, not hosted/R2/full-content checksum parity. The isolated directory was then removed after literal-path/prefix/non-reparse validation; original backup and development DB remain.

Backup SHA-256: cf3104f7a6b6d29d64a0f03a8a0a9aa9d3baca38ae37784996252e84bbecd352,430590bytes. Manifest: apps/worker/.local/m3f-backup-integrity.json. First23-term UNION verification query hit the local runtime compound-SELECT limit; smaller5-term read-only query batches passed. Import itself was successful; no data corruption or app code change was involved. Final targeted Prettier,43-file portability checker and git diff --check passed. FullM1–M5 stays active; next concrete work remains genuine Owner comment workflow then annotations.

## 2026-10-27 — M3f1 Guest version comments accepted locally

This supersedes pending M3f1 checkpoints below. The primary Cloudflare Guest gallery now has single-photo and independent batch comment composition, published-version threads, author-only edit/delete/resolve/reopen,24-item pagination, safe display labels/times, and same-invitation shared reads. Different invitations remain isolated even for the same photo. can_comment is independent of view/select/annotation/compare; image access retains its own rights. Batch targets are separate from picks, bounded to24 distinct logical photos in one album, with atomic all-or-none outcomes.1,000 lifetime comments per invitation/photo/version includes tombstones. Newer photo heads do not move old comments.

0042 adds guest_comments projection, immutable guest_comment_commands/changes/results, scoped ready/published-version view, symmetric guards for all7 prior Guest request ledgers and a comment audit-change witness guard. Author/revision/transition checks and audit are one SQLite statement. A change must bind its command's exact commentId as well as scope/predecessor. Exact accepted replay checks current authority before returning the same same-session result. Guest audit uses guest_session_id and NULL Owner session_id. Canonical body is stored once per command; bounded batch receipts permit the valid24-target/2,000-codepoint case. Raw trusted SQLite lacks NFC normalization; application Zod enforces Unicode normalization/trim.

The UI preserves captured intent in scoped module memory and metadata-only sessionStorage (UUID/op/targets/revision/Guest/body hash), never plaintext/secrets. Corrupt/unavailable recovery data blocks replacement writes. Late success/401 and abandonment use intent compare-and-set; an older A cannot erase newer B. Preparation mutex ends before network waits, so explicit abandonment does not indefinitely lock a fresh command. Blur/hidden clears data and focus/visible refreshes current access. Native headed event delivery was not validated: headless tests explicitly dispatch lifecycle events. Immutable historical write receipts may contain the old author's prior body; ?commentId= independently re-reads current state before UI reconciliation and revision-monotone merge, so later deletion is never resurrected. Pending intent remains serialized through that reconciliation. Tombstone success clears delete-confirmation/editor state. Public own-history exposes revision/state only, with no comment body or peer actions.

Actual final checks: `pnpm test:cloudflare`243 checks passed, session87245 exit0, .local/m3f-cloudflare-third.log. This includes populated0042 old-table preservation, real private R2/Sharp photos, all comment APIs,24-target/2,000-emoji batch,1,000-row cap and rollback/replay, CAS, publication privacy, forged sibling/change/audit defenses, all legacy namespaces, expiry/revocation and actual375px browser UI. Browser acceptance covers plain HTML text, readonly peers, historical-version comments, exact lost200 retry, stale CAS, lifecycle/delete reset, delayed create after another client deletes it, stale-identity response, same-Guest late200/401 A/B journal races, corrupt/quota-failed storage and real pagination/watermark refresh with no read-side ledger writes. Screenshot apps/worker/.local/guest-comments-mobile.png was visually inspected.316 unit/38files,61 reference integration/10files,14 reference Chromium(26.4s), final generated strict types/lint and Next production build passed. Targeted diagnostic22-check pass is supplemental, not a replacement for the full243 run. TEST_* audit exceptions are intentional asserted fault injection; reference chunked-cookie warnings are asserted malformed-cookie cases.

0042 applied ONLY to local development D1 after ignored backup apps/worker/.local/d1-before-0042-20261027-234330.sql (430590bytes):36 commands succeeded. Follow-up migration list has none pending, PRAGMA foreign_key_check is empty, all4 new tables and comment audit count are0. No existing comment rows were backfilled or customer/remote resources modified. Recovery disables GUEST_COMMENTS_ENABLED, retains immutable command/change/result/audit and current projection, preserves private asset ACL and repairs forward; restore backup only into an isolated verified copy. All3 Wrangler environments/.dev.vars.example keep the new flag false and configuration rejects non-local enablement. Automatic deletion stays OFF/dry-run. No stage/commit/push/deploy; preserve dirty codex/kino-pic-foundation worktree, base b14d505.

Failed runs remain evidence: API diagnostics58655/55592 found stale24-vs2 assertions and outer malicious-Origin plain403 expectations. Standard71187 caught peer authorization401 versus CAS409 fixture mismatch; collector92825 caught revision5 counting and an already-submitted inverse namespace fixture. Standard57110/targeted94792/49023 exposed actual stale editor/delete-prefix defects and an ambiguous body selector; targeted22417 caught a Response.json fixture error; targeted47429 found a preparation lock wrongly held across an abandoned in-flight request. Source defects and fixtures were corrected without relaxing authority, atomicity or idempotency. Targeted42611 passed all22 checks, then final standard87245 passed243. Logs .local/m3f-* retain boundaries; do not label intermediate failures as passes.

Next concrete task: Owner-authorized invitation/version comment reads, replies and processing status in schema→service→API→UI→tests→docs order.0042 Guest author/session FKs must not be bypassed or impersonated; design a separate Owner command namespace and explicit immutable actor/projection provenance before Owner writes. Then independent normalized point/rectangle annotations (respect actual displayed image orientation/letterboxing), full Owner history/exports, indexed matching/rules/batch, delivery/notifications, retention confirmation/retries, production roles/processing/multi-node and hosted backup/restore/deployment acceptance. Comments are still Guest-side only; Owner comment UI/replies and annotations are not advertised as implemented. FullM1–M5 remains active. Next operator: `python tools/check_handoff.py`, read GUEST_COMMENTS/DECISIONS and inspect git status before starting the Owner actor design. Hosted Google/GitHub/R2/CORS/edge/free-tier use remains not_checked.

## 2026-10-27 — M3f1 source integrated; runtime acceptance pending

Schema0042, D1GuestCommentsRepository, strict routes/default-OFF gate and actual Guest single/batch UI are integrated; no persistent0042 application.315 unit tests/38files passed. Isolated42-migration workerd/D1 syntax/FK probe passed with all4 new tables empty. Full generated Worker/shared/Web typecheck passed; later UI journal-race hardening also passed Web strict checks. First Next build passed before the final recovery hardening; final build remains required. Full lint initially found unused new-test variables plus a temporary diagnostic harness; tests were corrected and the completed temporary harness removed. No final full-suite acceptance yet.

Two API diagnostic runs use real baseline Worker/R2/Chromium and actual new comment HTTP/D1 fixtures; new comment browser checks were explicitly omitted. First58655 failed on stale24-target fixture assertions expecting2; production returned24 valid results. Second55592 passed same-invitation privacy, independent can_comment and the24-target/2,000-emoji batch, then failed because a malicious Origin is rejected by the outer runtime with plain403 `Invalid Origin header`, while the fixture expected application JSON. An isolated actual Worker probe verified missing Origin JSON403/FORBIDDEN_ORIGIN versus malicious-Origin plain403; tests now distinguish both without relaxing protection. Preserve .local/m3f-cloudflare-api-first.log and second.log. Capacity/CAS/full browser cases remain unaccepted until the standard full run.

Static review found and fixed duplicated batch body/result-size bounds, missing Owner-creator binding/timestamp/audit-session consistency, and a missing comment audit-change witness guard. A second independent UI review found delayed old responses could erase a newer request journal for the same album/Guest. Root added metadata/operation compare-and-set to success, denial demotion, abandonment and async recovery; a real same-Guest two-command browser regression is being added. Unknown intents stay scoped across401/409, and browser storage contains only metadata/body hashes. NFC/Unicode trim is enforced by application Zod; trusted raw SQLite writers lack built-in NFC normalization. Public thread deletion gives tombstones; same-author/same-session historical exact command replay may return its immutable prior body, while own activity exposes only revision/state.

Next: complete standard full Worker/API/Chromium regression, final types/lint/build/format/docs checks and only then consider local0042 adoption after backup. Keep hosted flags OFF/local-only, deletion OFF/dry-run, no commit/push/deploy/customer writes. FullM1–M5 remains active; Owner comment work, annotations, full history/delivery/retention/hosted acceptance remain required.

## 2026-10-27 — M3f1 invitation-shared version comments underway

M3e is accepted locally (228 Worker checks); M3f1 is not yet accepted. Root froze strict comment contracts, default-OFF/hard-local GUEST_COMMENTS_ENABLED and HTTP routes;25 new contract/gate unit tests passed.0042 schema/service, actual UI, same-invitation/different-invitation authorization and browser recovery tests are under parallel implementation. No0042 application or hosted acceptance. See docs/GUEST_COMMENTS.md. FullM1–M5 remains active, including independent annotations and later Owner/history/delivery/retention work. Preserve current dirty worktree and all previous accepted evidence.

## 2026-10-27 — M3e Guest published version comparison accepted locally

This supersedes the pending M3e checkpoints below. Guest Lightbox now provides published version history, slider, side-by-side and overlay comparison with synchronized zoom/pan, keyboard controls, preserved image proportions and explicit size/aspect warnings. Current version metadata remains pinned even outside the24-item history page. Authorization requires independent can_view + can_compare_versions, never can_select. Ready unpublished drafts are excluded from history AND direct Guest derivative requests; current/baselineV1/immutably published versions remain eligible. Every metadata/byte request rechecks live session, invitation, Owner and active parent scope.

Final handoff check: `python tools/check_handoff.py` passed42 portable specification files (presence/portability only); `git diff --check` passed.

Actual final evidence:228 local workerd/D1/R2/Chromium checks passed (session21352, .local/m3e-cloudflare-seventh.log, exit0);288 unit tests/37files, full generated strict typecheck, lint, Next production build and targeted Prettier passed.375px comparison screenshot apps/worker/.local/guest-version-comparison-mobile.png was visually inspected. New tests use actual local R2 originals and Sharp derivatives,27 published versions plus an unpublished ready draft, a restored V1 outside page one, portrait V2 and a neighboring photo. They cover strict/head-bound pagination, safe metadata, independent permissions, unpublished-byte denial, readonly ledgers, keyboard/focus and live revocation. Reference integration/E2E were not rerun for M3e; their prior61/14 passes remain historical baseline. Hosted Google/GitHub/R2 CORS/edge, real cloud quotas and deployment remain not_checked.

Earlier failures remain in first–sixth logs. Actual fixes include access-envelope parsing, upload-session metadata joins that do not confuse init/completion request IDs, nullable head typing, and capturing range values before deferred React state updates. Sixth run passed new API/browser checks but failed later while an old exchange test held four unconsumed Response handles. It now issues and validates each denial sequentially with all original assertions; seventh full run passed. The underlying transport/body-consumption cause is not proven and no production login fix is claimed. Intentional TEST_* audit-trigger exceptions in the passing suite are asserted rollback injections.

No new schema/migration or persistent development/customer data changes in M3e;0041 remains latest locally applied. No commit, push, remote resource or deployment. GUEST_VERSION_COMPARISON_ENABLED remains false in all Wrangler environments and rejects non-local enablement. Automatic deletion stays OFF/dry-run. Recovery: disable comparison, retain immutable assets/versions/publication witnesses/audit and preserve the stricter asset ACL; repair forward. See docs/GUEST_VERSION_COMPARISON.md.

Next task: version-bound comments/annotations with independent rights, same-invitation comment sharing and different-invitation isolation, delivered through schema/service/API/UI/tests/docs. Owner comparison/history, canonical indexed matching/rules/batch, delivery/notifications, retention planning/confirmation/retry, production processing/roles/multi-node and hosted acceptance remain required. FullM1–M5 stays active. Next operator: run `python tools/check_handoff.py`, then read the comparison contract and latest TASKS before starting the comment schema. Preserve the dirty codex/kino-pic-foundation worktree (base b14d505); do not assume untracked files are committed.

## 2026-10-27 — M3e comparison runtime verified; full regression pending

Guest published history and Lightbox slider/side-by-side/overlay are implemented behind default-OFF/hard-local GUEST_VERSION_COMPARISON_ENABLED. Both can_view and can_compare_versions are required independently of selection. Current/baselineV1/immutably published ready versions are eligible; never-published drafts remain inaccessible through both history and direct asset URLs. The current version is pinned outside DESC24 pages; each request rechecks live authorization.

Latest actual checks: full generated typecheck, lint,288 unit tests/37files and Next production build passed. Sixth local Worker run passed all new version API cases and375px Chromium comparison, including real private R2/Sharp derivatives, portrait/landscape letterboxing, keyboard ranges, synchronized transforms, readonly ledgers and live revocation. Screenshot apps/worker/.local/guest-version-comparison-mobile.png was inspected. The full run then failed in the existing Guest exchange denial fixture with Body is unusable: Body has already been read; its diagnosis/full rerun remains pending. This is not final full-suite acceptance.

Fixed actual integration defects: access response envelope, upload-init versus completion request-ID join, nullable head typing, and deferred React range event access. Earlier failed runs remain in .local/m3e-cloudflare-first.log through sixth.log; do not overwrite their evidence. No schema/migration, persistent data operation, commit, push or deployment in M3e.0041 remains latest locally applied; hosted OAuth/R2/CORS/edge acceptance is not_checked. Automatic deletion stays OFF/dry-run. FullM1–M5 remains active.

Next: diagnose the Guest exchange fixture, rerun the full local Worker suite, finalize comparison docs/portability checks, then implement version-bound comments and annotations with same-invitation sharing and different-invitation isolation. Large-album indexed matching/batch, Owner comparison/history, delivery/notifications, retention and hosted acceptance remain required.

## M3e Guest published version history/comparison underway

Current source adds default-OFF/hard-local GUEST_VERSION_COMPARISON_ENABLED, requiring Guest exchange and photo-version supporting gates. Guest history/API/UI requires independent can_view + can_compare_versions, not can_select. Metadata and every private image recheck current session/invite/Owner/parent ACL. Current version, baselineV1 and versions with immutable successful head-publication history are eligible; ready never-selected drafts are excluded from history and direct generic Guest asset fetch. No schema/migration or persistent data change in this read-only slice;0041 remains latest locally applied.

Contracts/backend/Lightbox UI are integrated, including a pinned ready currentVersion outside DESC24 history pages, head-bound cursors, safe role/labels metadata, slider/side-by-side/overlay, synchronized zoom/pan, letterbox and parent keyboard focus handling.288 unit tests/37files passed. Root initial full type/lint found and fixed nullable head-anchor typing and a displaced use-client directive; focused/root strict checks now pass. API fixtures create actual R2 originals/Sharp derivatives,27 published versions plus an unpublished ready draft and a neighboring photo. V2 is portrait24x48 versus V1 landscape48x24. New API/browser tests are being integrated; no final acceptance/hosted comparison claim yet. Do not mark fullM1–M5 complete. Next run full local Cloudflare regression, then final types/lint/build/docs. Same-invitation comment sharing and other-invitation isolation remain required future work.

## 2026-10-27 — M3c2b2 resolved single-file upload vertical slice accepted locally

This supersedes pending checkpoints below. The Owner workbench now has real strict preview, explicit Auto/Assisted choice, atomic reservation, authorized create-once R2 PUT and ordinary/private-version completion. Same-name changed content can create a private retouch version of one logical photo without switching its visible head. Assisted mode explicitly selects a same-album head or independent photo; exact duplicates/invalid/incomplete/pending-name evidence cannot allocate a resolved upload. The old independent-photo uploader remains an explicitly labelled manual override. Four confirmed project modes are offered only behind the new matching capability.

Existing immutable upload_requests payloads capture resolution and optional server-derived versionTarget.0041 atomically checks the0040 watermark plus project mode/revision before reservation; prior namespace/ACL/quota/head-CAS/replay guards remain. Two UUIDs from one preview have one reservation winner; exact accepted retry retains one original session/target. Actual private R2 raw dimensions must match declared matching dimensions for both ordinary and version completion. A mismatch records existing UPLOAD_METADATA_MISMATCH review state, returns the specific422, retains quota and creates no V2 metadata. SQL separately rejects mismatched workflow completion. Processing/full decode remains separate; no implicit head switch.

The scoped write-ahead journal keeps original bodies/UUIDs, file fingerprints and captured target, with no bytes/object keys/signed URLs/secrets. Unknown results retry/check original work and cannot silently allocate a replacement. Saved work stays visible/resumable after project mode changes to Off/Manual; modeActive blocks only fresh matching controls. Needs-review work retains its journal and stops further PUT/reservation attempts. Server-confirmed completion notices survive local gallery refresh.

Final run79633 (.local/m3c2b2-cloudflare-fifth.log) terminated0:220 local workerd/D1/R2/Chromium checks. New actual API cases cover default-OFF/mode gates, canonical replay/current ACL, deterministic stale SQL clone, same-preview race, pending names/isolation, failed-audit full rollback/exact retry, real PNG V1→privateV2/head preservation, explicit assisted new-version/new-photo and foreign-head denial, and declared-vs-actual dimension review/quota retention.375px browser uses checked synthetic SigV4 PUTs; lost accepted201 is recovered by exact replay after changing Auto→Manual, reload/reselect, then restoring Auto for V2. Original guest/history/version/quota/immutability/Cron regressions passed.

Also passed:260 unit tests/35files (.local/m3c2b2-unit-complete.log),61 reference integration/10files (.local/m3c2b2-integration.log),14 reference Chromium29.1s (.local/m3c2b2-reference-e2e.log), full generated Worker/shared/Web strict types60186 (.local/m3c2b2-types-complete.log), final full lint63540 (.local/m3c2b2-lint-final.log), Next production build16854 (.local/m3c2b2-next-build.log), targeted formatting and documentation checks. Reference OAuth providers and local SigV4/R2 bridge are synthetic; hosted Google/GitHub/R2 CORS/edge/deployment/free-tier limits remain not_checked.

0041 applied ONLY to local development D1 after ignored backup apps/worker/.local/d1-before-0041-20261027.sql (426031bytes).10 commands successful; none pending, foreign_key_check empty, resolved_requests0 with no backfill. The populated upgrade test preserves all old rows. A static comparison proves the three replaced guards retain predecessor checks except reviewed mode/key-count changes. No remote/customer migration, commit, push or deployment. PHOTO_VERSION_MATCHING_ENABLED is false in all Wrangler environments, requires all supporting upload/version/configuration flags, and rejects non-local enablement. Automatic deletion stays OFF/dry-run.

Intermediate failures are retained as evidence: first run19503 hit an invalid JSON expectation for the existing plain-text403; two unused fixtures and a generated literalfalse type mismatch were corrected. Second90447 hit a browser assertion confusing public choice with server-derived versionTarget. Third4197 hit a redundant nested locator after successful mode-change recovery. Fourth80937 passed new browser acceptance but an old test's zero-held-quota expectation shared the new deliberate needs-review fixture workspace. New acceptance now creates its own workspace; held quota was never cleared to satisfy the old assertion. Fifth is the final full pass. Intentional audit-failure injection log lines are expected and asserted.

Next: finish scalable canonical lookup, persisted opt-in matching rules and multi-file batch matching; single-file complete-set cap remains1000 version/pending rows. Guest version history/Before-After slider/side-by-side/overlay is the next independent product vertical slice. FullM1–M5 remains active: comments/annotations (same invite visible, different invite isolated), full Owner history/downloads, delivery/notifications, production processing/retention/roles/multi-node, backup restore and hosted release gates remain required. See RESOLVED_UPLOADS.md. Recovery disables matching/configuration writes, retains0040/0041 guards/history/targets/fences/quota, and repairs forward; restore backups only into an isolated verified recovery copy.

## M3c2b2 resolved upload vertical slice underway

0041 is active source but NOT applied persistently. Root added strict atomic expected-watermark/project-mode guards and resolution raw-dimension completion backstop, retaining old command namespace/quota/CAS/replay checks. Existing upload_requests payloads now capture resolution and optional immutable versionTarget; no new Owner ledger. New default-OFF/hard-local PHOTO_VERSION_MATCHING_ENABLED controls preview/reservation routes, configuration modes and Owner uploader. Contracts/backend/UI/journal/API/browser tests are integrated in source.259 unit tests/35files passed;41 migrations passed an isolated empty workerd/D1 syntax/FK probe. No final M3c2b2 acceptance or deployment yet.

Run19503 failed at the new origin test incorrectly expecting JSON from the existing plain-text403 middleware. Fixture corrected without weakening origin checks. Type generation exposed a too-narrow literalfalse field; WorkerEnv now omits that generated matching flag and validates its string at runtime, while production enablement is still rejected. Two unused fixture imports/helpers were removed. Run90447 passed all new HTTP/D1 cases (default-OFF, canonical replay, current ACL, race/stale/pending/audit rollback, real PNG V1→V2, explicit assisted choice/foreign-head denial, dimension mismatch review/quota preservation), then browser stopped at an assertion expecting internal versionTarget in the public request instead of choice. The test is being corrected to check server-derived canonical D1 payload.

Root found a real recovery UI gap: mode auto/assisted→Manual/Off could hide an accepted pending resolved journal. Root now mounts the uploader regardless of current mode; UI agent is adding modeActive to hide only fresh matching controls while retaining existing intent recovery. Browser acceptance is being extended to change mode after a lost accepted reservation, reload/reselect/exact replay, then restore Auto for V2. Source changes require a fresh full run. Do not claim the second run passed or apply0041 yet. Final strict/full lint and Next build remain required. Hosted flags and automatic deletion stay OFF/dry-run. FullM1–M5 remains active.

## 2026-10-27 — M3c2b1 candidate watermarks and pending uploads accepted locally

Migration0040 adds append-only `album_matching_changes`: future photo/version inserts, head insert/switch and upload reserved/cancelled/expired transitions append scoped internal invalidation markers in the source transaction. Safe integer sequence, immutable source identity, causal current-source and exact scope validation, and UPDATE/DELETE/OR REPLACE guards protect the watermark. No backfill or prior-table rewrite; existing content starts at0. These are internal invalidation markers, not actor/request operation audits. AFTER-trigger sequence order must not be interpreted as causal ordering.

`D1VersionMatchCandidates` now reads changeSequence and unfinished reservations in the same current-Owner scoped statement as immutable versions/head/configuration. One authority anchor plus1001 data rows bounds returned data; only1000 complete version/pending rows may classify. Same canonical-name pending uploads force review for automatic new-photo/new-version decisions; Off/Manual and duplicate-without-upload remain explicit separate behavior. Reserved URL expiry alone never removes pending evidence: actual completion or a safe cancelled/expired state is required. This is still an internal advisory read; no automatic/assisted mode, public resolver or resolved upload UI is enabled.

Final full run2321 (.local/m3c2b-cloudflare-final.log) terminated0:209 local workerd/D1/R2/Chromium checks. New runtime groups prove scoped reservation/cancellation/exact retry, unchanged unrelated-album clocks, immutable markers/invalid source/scope denial, failed upload audit rollback of marker/quota/request/session followed by exact retry, processed gallery stability, populated upgrade preservation, and final coverage for actual photos/versions/current heads/reservation expiry after the complete lifecycle. Earlier run81396 passed208 before the final lifecycle assertion.212 unit tests/33files passed (.local/m3c2b-unit.log); same-name automatic pending classification is unit evidence, not public automated-upload E2E. Final root strict types31521 and full lint94794 passed. Worker/UI bundles built within the suite. Reference integration/E2E and Next build were not rerun for this Worker/internal-schema change; hosted OAuth/R2/CORS/edge remains not_checked.

0040 applied ONLY to local development D1 after ignored backup apps/worker/.local/d1-before-0040-20261027.sql (418844bytes).12 commands successful; migration list has none pending, foreign_key_check empty, marker_count0 as expected with no backfill. No remote/customer migration, commit, push or deployment. Keep all hosted flags OFF/hard-local and deletion OFF/dry-run. Recovery retains0040/table/triggers/history and repairs forward with matching writes disabled; never drop the table beneath the new reader. Restore only into isolated verified recovery copies.

Next is the actual resolved reservation/API/UI slice, not more standalone matcher scaffolding. Prefer binding canonical resolution, expected watermark/configuration/head and explicit assisted choice into the existing immutable upload_requests command/target path, with one atomic pre-reservation guard; add a new ledger only if existing command guarantees cannot cover the requirement. Current authorization precedes historical replay; exact accepted retry must recover its original target before treating the reservation's own watermark change as stale. Prove simultaneous same-name first uploads, stale preview, safe conflict/unknown response recovery and no implicit head switch, then expose confirmed automatic/assisted settings and usable UI. Scalable canonical candidate lookup and persisted opt-in rules remain required. FullM1–M5 stays active: Guest comparisons, comments/annotations (same invite visible, different invite isolated), full history, delivery/notifications/retention, multi-node and hosted release gates remain unfinished.

## 2026-10-27 — M3c2a scoped advisory candidate snapshots accepted locally

Implemented `D1VersionMatchCandidates`: one prepared SELECT binds current enabled Owner, exact live session and active workspace/project/album scope to persisted mode, project/album revisions, immutable per-version completion filenames/hashes/encoded dimensions and captured current heads. Empty authorized albums return an empty complete snapshot; missing authority returns404. No storage keys, credentials or session secrets are returned. Caller evidence cannot set scope/mode/options/candidates. More than1000 rows or missing version/head evidence forces review; this bounds returned rows, not total SQLite scan work.

After filename identification establishes one logical photo, the resolver checks its complete immutable version history, including differently named current heads, before suggesting a new version. This detects hidden crop differences and duplicate hashes under another version name without rewriting candidate names. Explicit JPG/JPEG aliasing now handles uppercase/mixed-case extensions while preserving basename case sensitivity. Malformed historical names still conservatively force review; scalable indexed candidate lookup and persisted opt-in matching rules remain unfinished.

Verified final source: `pnpm test:cloudflare` session65035 terminated0,204 local workerd/D1/R2/Chromium checks (.local/m3c2-cloudflare-final.log). First run48650 also terminated0/204 before the final full-history refinement. Six new runtime groups cover current actor/session/disabled Owner denial, scoped revisions/head and secret exclusion, immutable completed metadata with Manual staying disabled, forged evidence rejection, missing album, and authorized empty/archived album. `pnpm test:unit`:211 tests/33files (.local/m3c2-unit-final.log), including unit-only1000/1001 completeness and differently named head/duplicate cases. Root strict TypeScript passed (.local/m3c2-types-head-fix.log); full lint session69244 terminated0 (.local/m3c2-lint-final.log). Worker/UI bundles built in the full suite. Reference integration/E2E, Next production build and hosted OAuth/R2/CORS/edge were not rerun or verified for this internal Worker read layer. Test-only entry stays outside the deployable Worker.

No schema/migration application, persistent customer-data change, commit, push or deployment.0039 remains the latest migration from the prior accepted slice. All hosted flags remain OFF/hard-local; automatic deletion OFF/dry-run. This is an internal advisory read, not a public API, durable resolution ticket or upload authorization; automatic/assisted mode settings remain unavailable.

Next M3c2 work: persist exact resolution/explicit assisted choice and atomically revalidate current authority, configuration, complete candidate set and head during reservation. Project/album metadata revisions alone do not capture photo/version additions. Prove concurrent same-name first uploads, stale decisions, conflict/unknown-result retry, immutable targets and no implicit head switch, then add API/Owner UI/browser acceptance. FullM1–M5 remains active: Guest version comparisons, comments/annotations (same invitation visible; different invitations isolated), complete operation history, delivery/notifications/retention, multi-node routing and hosted release gates remain required. See PROJECT_VERSIONING.md.

## 2026-10-27 — M3d durable external-effect intents accepted locally

This supersedes pending M3d checkpoints below. The old defect was reproduced in isolated workerd/D1/R2: a colliding project-mode UUID returned409 but left one R2 fence and local certificate with quota held. The fixed probe now rejects that collision before any R2/local-certificate write. The same probe also passes claim-audit rollback, unknown committed R2 result with no guessed certificate, final-audit rollback/exact retry, safe expiry of pending failed cancellation, deterministic competing D1 insertion between claim and R2, uppercase UUID compatibility, and adapter-identity mismatch denial while preserving MULTI_NODE_DISABLED.

Final full run58288 (.local/m3d-cloudflare-fourth.log) terminated successfully:198 local workerd/D1/R2/Chromium checks passed. New runtime cases cover namespace collisions in both directions, current Owner denial, exact UUID coalescing, distinct UUID same-target receipts with one finalizer/release, lost post-fence result, audit failure/expiry recovery, immutable claim snapshots, processing output-key certificates, processing lost physical result and forged-key certificate rollback before exact recovery. The prior full runs188/198 also passed; the final run includes the adapter node binding correction.202 unit tests/32files, final strict Worker/shared/Web types (55113), full lint (70534), targeted formatting and diff checks passed. Worker builds ran in the suite. Reference integration/E2E and Next production build were not rerun for this Worker-only slice; hosted OAuth/R2/CORS/edge remains not_checked.

0039 applied ONLY to local development D1:26 commands, after ignored backup apps/worker/.local/d1-before-0039-20261027.sql (392650bytes). Follow-up has no pending migrations, foreign_key_check empty, receipt table and claim audit events empty. Upgrade tests compare every prior table snapshot; no legacy ledger/alias/audit backfill or rewrite. No remote/customer migration, deploy, commit or push. All hosted feature flags remain OFF/hard-local; automatic deletion OFF/dry-run.

Architecture: owner_external_intents fixes actor/request/op/payload/scope/node/immutable keys/epoch before external effects. Existing D1 ledgers remain namespace witnesses; symmetric transactional guards cover every current Owner writer. Receipts are append-only attempt identities, not resource locks: multiple UUIDs may target one immutable key, while idempotent fences and existing finalizer guards enforce one state/quota transition. System expiry still resolves a physically fenced pending cancellation safely; it is not blocked forever by a receipt. Processing certificates now bind each declared physical observation to the captured output key. Existing completed operations replay without fabricating a new claim. R2 adapters declare storageNodeId; cancellation checks it and authorized expiry only inspects that adapter's node. This does not enable multiple accounts.

Recovery: stop serving cancel/abandon mutations before application rollback; retain claim-compatible handlers, receipts, physical fences, certificates and audit, then repair forward. Do not downgrade to pre-0039 R2 handlers merely because flags are OFF: old cleanup endpoints may still be callable. Never clear receipts/held quota to hide an unknown result. Restore backups only into an isolated verified recovery copy. Any new Owner writer must participate in the namespace guards before activation. Production contains no interleave/drop-result test hooks; those live only in the storage-test entry.

Next: wire the scoped deterministic matcher into automatic/assisted upload resolution with usable confirmation and recovery, then Guest version history/comparison. FullM1–M5 remains active; comments/annotations, full Owner history, delivery/notifications/retention, multi-node routing and hosted deployment/acceptance remain required. Different invitations remain isolated for comments; same-invitation sharing is the confirmed user decision.

## M3d external-effect intent claims underway

Read docs/OWNER_INTENT_CLAIMS.md. M3c1 remains accepted locally (188checks); fullM1–M5 stays active. Root selected external-only immutable claims plus symmetric transactional guards on all legacy Owner writers, retaining old ledgers/intentional aliases without risky backfill.0039 SQL, store and namespace inventory are isolated drafts; no active migration or persistent application. Root owns cancellation/review integration and deterministic R2-interleaving verification. Claim must commit before storage effects; unknown effects retain claim/quota; default-OFF/hard-local/deletion-dry-run safeguards stay intact.

## 2026-10-27 — M3c1 project version configuration accepted locally

This supersedes pending M3c1 checkpoints below. Run36156 (.local/m3c-cloudflare-fourth.log) terminated successfully:188 local workerd/D1/R2/Chromium checks passed. New acceptance covers local/default-OFF capability, confirmed Off/Manual settings, shared project CAS with rename, no-op/history replay/current-state reconciliation, strict body/origin/actor, audit-failure full rollback and exact retry, symmetric request-ID conflicts, immutable command/results, provenance clone/predecessor denial, disabled/expired Owner and archived-project replay denial, and375px confirmation cancellation/stale-conflict refresh/lost200 exact retry followed by a fresh current read. Existing M3a/M3b and other regressions passed in the same run.

202 unit tests/32files, strict Worker/shared/Web types (24608), full lint (65362), Next production build (73127), focused formatting and git diff checks passed.14 of the new unit cases exercise the pure matcher: exact scope, NFC/trim/UTF-16 bounds, opt-in suffix/JPG-JPEG/case rules, logical-photo ambiguity, duplicate hashes, truncation and oriented aspect/scale review. This classifier is not yet wired to an adapter/API/upload flow. Only Off/Manual settings are available; automatic/assisted modes remain unavailable. Reference integration/E2E were not rerun for this slice; previous M3b reference integration61 remains a baseline, not new hosted evidence.

0038 applied ONLY to local development D1:33 commands, after backup apps/worker/.local/d1-before-0038-20261027.sql (git-ignored,372860bytes). Follow-up migration list has none pending; foreign_key_check is empty; new command/result tables and existing-project provenance pointers are empty/null. Recovery disables configuration writes, preserves mode provenance/commands/results/audit and repairs forward; restore backups only into an isolated verified recovery copy. No remote/customer migration, deploy, commit or push. All feature gates remain OFF/hard-local; deletion OFF/dry-run.

The expiry test uses a separately issued synthetic OAuth session and preserves its revocation audit; it never recreates an old signed-in session or bypasses append-only guards. Historical intermediate test failures are retained below as evidence, not current acceptance status.

Required next work: docs/OWNER_INTENT_CLAIMS.md describes the confirmed existing cancellation/abandonment ordering risk. Implement durable actor/request claims before R2 effects and prove collisions/races/unknown outcomes without premature quota release; expanding a read-only preflight is insufficient. Then integrate scoped automatic/assisted filename resolution and Guest version comparison. Hosted OAuth/R2/CORS/edge and the full M1–M5 goal remain incomplete. Comments/annotations, complete history, delivery/notifications/retention and deployment gates remain required.

## 2026-10-27 — M3c integration and external-effect intent risk

M3c config contracts/capability,0038 SQL, service/routes and Owner UI are in active source behind default-OFF/hard-local gates.202 unit tests and final strict types passed; full lint passed. Isolated Miniflare D1 proves populated preservation, change/no-op/replay, CAS race, failed-audit rollback/exact retry, immutable history and provenance-clone denial. No0038 persistent migration or final M3c acceptance yet.

Full run99197 stopped because a CSRF test incorrectly parsed the existing outer middleware's plain-text403 as JSON; it now verifies403 and retained state. Run85751 then passed basic APIs and audit rollback/rename-CAS/namespace/immutability, but expired the main fixture session and attempted to recreate it, correctly hitting APPEND_ONLY_AUDIT for the old sign-in event. The expiry fixture is being changed to a separate signed synthetic OAuth session; never bypass/drop the audit guards or recreate a revoked session ID. No suite is currently live; next launch follows the frozen fixture fix.

Source review identified an existing actor-scoped external-effect ordering risk in uploads.cancel and processing-review.abandon: R2 fences precede final command insert; a cross-ledger request-ID conflict can leave a fence and held quota without finalizing the command. This does not expose/delete another tenant's photos. Read-only preflight cannot close the concurrent claim gap. Before hosted activation, implement a durable actor/request intent claim (fixed operation/payload/target, current authority, all Owner writers) before R2 effects, and test deterministic collision, concurrent claim, lost R2/DB result and recovery. Do not claim this risk fixed by0038's D1 namespace triggers. Source ordering was reviewed; this specific R2 collision has not yet been fault-injected at runtime.

FullM1–M5 remains active. Keep flagsOFF/deletionOFF/dry-run; no deployment/customer data/commit/push. After M3c1 acceptance, prioritize durable external-effect intent claims, then wire the scoped matcher/auto-assisted upload resolver and Guest comparisons. The pure matcher14 focused cases passed but is not an API/product feature yet.

## M3c implementation underway

Read docs/PROJECT_VERSIONING.md. M3b remains accepted locally (179checks); fullM1–M5 stays active. Root added strict mode configuration contracts and default-OFF/hard-local capability;14 focused tests passed. SQL/service drafts are isolated under .local/m3c-draft, no0038 application or runtime acceptance. Parallel work owns configuration backend, confirmation/recovery UI and deterministic filename matcher. Only off/manual configuration will be available until automatic/assisted matching is actually integrated. Existing versions/head/selection/audit must be preserved.

## 2026-10-27 — M3b manual version uploads accepted locally

This supersedes the pending M3b checkpoints below. Full run30293 (.local/m3b-api-eighth.log) terminated successfully:179 local workerd/D1/R2/Chromium checks passed. New cases prove fixed immutable reservation targets, current Owner/tenant/photo authorization before replay, head/mode-shift preservation, private same-photo versions, unique concurrent numbering, canonical audit/results, audit-failure rollback with exact retry, quota accounting, cancellation fences, stale new-init CAS denial, default-OFF bypass denial, immutable target/completion primary/alternate/null/UPDATE/DELETE defenses, and375px explicit replacement/file selection/SigV4-checked local R2 upload/lost-completion/reload/reselect recovery with the V1 head unchanged. Existing M3a current-head and other feature regressions passed in the same run.

Also passed:174 unit tests/30 files,61 reference integration/10 files, strict Worker/shared/Web typechecks, final full lint (48177), Next production build, targeted format and git diff checks.38-file documentation presence check passed. Reference-app Playwright was not rerun in this session; Worker-target Chromium is included in179 checks. Hosted OAuth, real R2 CORS/S3/edge and deployment are not verified. The browser R2 bridge uses synthetic credentials and local Miniflare storage.

0037 applied ONLY to local development D1:34 commands. Follow-up migration list has none pending; foreign_key_check returned empty; new targets/completions are empty. Pre-migration backup is apps/worker/.local/d1-before-0037-20261027.sql (git-ignored). No remote/customer migration, commit, push or deployment. Keep all feature flags OFF/hard-local and automatic deletion OFF/dry-run.

Recovery: disable version writes and keep immutable targets, completion ledgers, assets, processing jobs and audit. Repair forward with a new migration. Restore the local backup only into a verified isolated recovery copy; do not drop0037 tables beneath code whose generic upload queries now reference both completion ledgers. Do not remove history to roll back application behavior.

Full M1–M5 remains active. Next required slices: project version-mode controls and enabled filename/assisted matching, Guest scoped version history/comparison slider/side-by-side/overlay, followed by comments/annotations, full operation history, delivery/notifications/retention and hosted acceptance. Same-invitation comments may be shared; different invitations remain isolated. Completion still leaves the original current head; exposing a ready version requires a separate explicit CAS switch.

## 2026-10-27 — M3b security probes passed; browser final assertions rerun

Run27180 (.local/m3b-api-seventh.log) passed all new version API cases, including head/mode-shift frozen targets, concurrent unique version allocation, injected photo.version.created audit rollback/same-ID retry, immutable target/completion update/delete/null/primary/alternate REPLACE guards and disabled-Owner replay denial. Chromium reached file selection, explicit replacement confirmation, signed local R2 upload, lost successful completion response and reload/reselect/exact completion replay; the helper then failed its final D1 check because its fixture return and assertion call omitted photoId. Those two fixture properties are restored, with targeted lint/format passing. No product guard was relaxed.

Run30293 is LIVE at .local/m3b-api-eighth.log; poll before launching a duplicate. Full M3b acceptance, final browser D1 assertions and remaining M3a regression checks are pending.174 unit,61 reference integration, strict types, UI lint, full lint and Next build previously passed in this session.0037 remains unapplied persistently; flags remain OFF and deletion dry-run. No remote deployment or customer data changes. Full M1–M5 remains active.

## 2026-10-27 — M3b V2 runtime evidence; final regression in progress

Run21660 (.local/m3b-api-sixth.log) passed canonical V1 API setup, upload-disabled bypass denial, V2 fixed target/recovery/exact init replay, wrong-photo/tenant isolation, and real local R2 V2 completion with immutable private version/audit and unchanged head. It then failed a test that compared the richer recovery response to the init response. The expected shape now verifies the exact recovery metadata, authorization and original target/session; no authorization requirement changed.

Additional fixes from integration review: version uploader accepts the existing UPLOAD_OBJECT_NOT_FOUND409 before PUT; it had incorrectly expected404. The completion success notice now lives in the parent panel so list refresh cannot discard it. The Chromium fixture uses the canonical V1 authorization and joins upload_specs for MIME/hash. Browser expectations mirror these contracts. Latest Web strict typecheck and targeted UI lint passed. Full strict types, Next build,174 unit and61 reference integration passed earlier in this session.

Run27180 is LIVE at .local/m3b-api-seventh.log. Poll that handle before starting another full suite. It includes V2 audit rollback/same-ID retry, stale new-init CAS, target/completion UPDATE/DELETE/REPLACE/null guards and375px file upload/lost-completion/reload recovery via a synthetic SigV4-checked Miniflare R2 bridge. No final browser or full M3b acceptance is claimed until terminal results are inspected.0037 is not applied persistently; no remote/customer data, commit, push or deployment. All flags OFF/dry-run. Full M1–M5 remains active.

## 2026-10-27 — M3b API contract and manual intent UI

Current verification:174 unit tests/30 files and61 reference integration tests/10 files passed. Full lint passed after removing an unused fixture variable and an unused UI suppression. Web strict typecheck and targeted UI lint passed after the flat completion-response fix and manual intent selector. Documentation checker verified38 files; this is presence only.

The Owner uploader now explicitly offers new_retouch or replace_current in enabled modes. Off mode forces replace_current; any replacement requires confirmation. Both preserve immutable history and leave the current head unchanged until a separate ready-version CAS switch. These new UI paths still require Chromium acceptance.

Fifth full local Worker run4554 terminated at .local/m3b-api-fifth.log: existing Guest history and the canonical public V1 setup passed, then new version reservation returned200 where creation expects201. The version init router now returns201 consistently with ordinary creation; no security assertion was relaxed. The next full run is pending expanded V2 rollback/integrity/stale-CAS tests and a self-contained browser fixture.0037 is not applied persistently. Hosted OAuth/R2/edge, deployment and full M1–M5 remain incomplete; flags remain OFF and retention dry-run.

## 2026-10-27 — M3b regression and completion response correction

Current source includes the manual version upload router/service/migration and Owner UI behind default-OFF local-only gates. The UI now parses the dedicated completion endpoint's flat versionUploadCompletionSchema response, matching the API rather than an invented completion envelope. Browser verification is being added; do not claim acceptance yet.

Run .local/m3b-api-third.log terminated at a missing fixture-helper import. All five consumers now import the canonical authorized-version fixture; targeted ESLint, node syntax and formatting checks passed. Fourth run .local/m3b-api-fourth.log advanced through Guest history and version capabilities, then terminated at its new ordinary-V1 setup: the test PUT/completed without first authorizing the upload and received INVALID_STATE_TRANSITION. Repair the fixture with the normal authorization call; preserve the guard. No full M3b pass is claimed. Earlier full unit run:174 tests; latest pre-response-fix web typecheck passed. Post-response-fix typecheck log .local/m3b-web-types-response.log shows successful type generation, but the interrupted process handle is missing, so terminal exit is not proven and must be rerun.

0037 remains unapplied to persistent local/remote D1. All deletion flags remain OFF/dry-run. No hosted test, deployment, commit, push or customer data change. Next: canonical V1 setup, complete full HTTP/R2 regression, integrate isolated Chromium file-upload/recovery checks, then integrity/rollback gaps and final checks. Full M1–M5 remains active.

## 2026-10-27 — M3b UI promotion and regression fixture compatibility

The live Owner version panel now mounts the promoted version uploader with full project/album/photo context and OR-combined switch/upload pending gates. Upload completion refreshes only the version list, never the current head or gallery. New uploader context is omitted for archived/noneditable parents. Web strict typecheck passed after promotion;174 unit tests/30files passed (.local/m3b-unit-first.log). HTTP/browser upload acceptance is still pending.

Sessions10421 and22558 are terminal.10421 stopped at unused Node imports of Worker classes with unsupported strip-only parameter properties; those imports were removed.22558 stopped at another legacy direct-V2 metadata fixture, before the new API helper. A shared authorized SQL fixture helper and affected Guest selection/feedback/history/shared-review fixtures are being updated without bypassing0037. No runtime suite is currently live. The version-upload API helper is frozen with mode/head replay, private sibling completion, concurrent numbering, cancellation fencing/quota and Owner-disable cases; wait for legacy fixture updates before rerun.

0037 is active source but NOT applied persistently. No remote/customer data, deploy, commit or push. Full M1–M5 remains active.

## M3b first integrated HTTP/R2 run live

The version-upload API helper is now wired before the current-head regression helper. Session10421 is live at .local/m3b-api-first.log; poll it before any duplicate run. It exercises isolated manual-project V1/V2 public API flow, local Miniflare R2 fixture objects, scoped recovery, feature-gate bypass denial, target isolation, private completion/audit and quota conversion. These results are pending; do not infer remote R2 or production E2E.

M3a fixture versions2–27 now use authorized version uploads; only V2 is processed and the other siblings stay queued for readiness checks. Direct V1 and neighbor V1 seed setup remains. Existing immutable/scope/dimension guards retain priority, and valid V2 still requires its upload workflow. The isolated SQL behavior probe passed after this adjustment. Draft UI and journal validations passed focused5 journal tests, strict TS/lint/format, but UI is not mounted and has no browser acceptance yet.0037 remains unapplied to persistent local/remote D1.

## M3b active integration and first regression feedback

Reviewed0037 SQL, common upload service and strict version router are now integrated into active source behind all default-OFF local gates; current TypeScript check passed. Original service backup is .local/m3b-draft/live-uploads-before-integration.ts.0037 is in active migrations but is NOT applied to persistent local/remote D1. The dedicated HTTP/R2 helper is being written; existing full regression run75668 stopped at guard-priority compatibility before version API cases.

The new valid-V2 workflow gate masked established invalid scope/dimension/identity errors. Its WHEN filter now delegates malformed basic records to the existing0011/0012/0033 guards, retaining the upload-workflow requirement for valid new V2. Isolated behavioral probe passed again after this change. The probe was pinned to baseline0001–0036 after promotion to avoid accidentally applying0037 twice. Old M3a V2 fixtures are being changed to authorized version uploads rather than bypassing the new guard; initial non-current versions will be captured-parent siblings and queued targets remain unready. No security assertions are removed.

Journal module/tests passed focused5 cases; draft UI remains unwired. M3b HTTP/R2/processing/browser/full regression acceptance remains pending. Full M1–M5 stays active; no deployment or new persistent migration.

## M3b reviewed service/routes and isolated D1 checkpoint

Root virtual TypeScript validation passes for the frozen common upload service plus isolated version-upload router at their intended source paths, without replacing live code. Init replay/post-insert and completion replay/post-insert now read results and current Owner/active photo/parent scope in the same SQL query. Root also scoped target-type detection to current Owner/session before feature-gate errors and bound dedicated completion's route photo to the immutable target.

Root tightened SQL completion timestamp to its workflow witness and required exact canonical completion result JSON (including status/field set); a fresh isolated Miniflare D1 probe applied baseline0001–0036 plus draft0037, found both new tables and no FK violations. Probe setup initially needed Worker-scoped dependency resolution, the repository's v5 compatibility adapter and existing SQL normalization; these were corrected. This proves DDL application only. Separate behavioral probe has passed atomic V2 reservation and exact init replay with no new photo/head changes; completion/V1 parity/denials remain under test.

The version-aware browser journal is being implemented as a distinct module, with structured-field privacy and full Owner/workspace/project/album/photo scope; legitimate user notes/URLs/hash filenames must remain valid. UI and API drafts remain unwired, no0037 persistent migration or deployment. Full M1–M5 stays active.

## M3b fixed-target recovery and draft review checkpoint

Strict versionUploadRecoverySchema is implemented with legacy recovery fields plus immutable target metadata; it rejects storage paths, signed URLs, session identifiers and unknown fields.23 focused contract/config tests passed. Three scoped workers own isolated SQL, common upload service, and single-photo upload UI drafts under .local/m3b-draft; none is wired into live routes. SQL captures the reservation-time project mode from D1, and old exact init retries must recover the same target despite later head/mode changes after current ACL passes. Remaining completion-aware cancel/expiry/archive/accounting paths and runtime probes are still pending. No M3b migration is applied or feature enabled; M3a remains locally accepted.

## M3b version upload implementation underway

Read docs/VERSION_UPLOADS.md. SQL and service drafts are isolated in .local/m3b-draft; contracts are implemented but not exported into API routes. Root capability helper requires direct-upload/current-version/version-upload flags together and hard local-only activation;22 focused contract/config tests passed. Target photo/parent/intent metadata is fixed at reservation, completion must preserve photo_id and allocate an immutable next version without switching the head. Both completion ledgers must be recognized by recovery/cancel/expiry/archive/quota paths. No M3b runtime acceptance or migration application yet; M3a remains accepted locally and full M1–M5 stays active.

## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison slider/side-by-side/overlay, delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

## M3a browser response synchronization; isolated M3b preparation

Sixth run96001 passed version API/integrity and progressed through actual Owner switching/lost-response retries, then failed because the helper asserted replay status before the response completed (request-start record still had status0). Root added explicit completed-status polling for replay200 and definitive-conflict409, preserving all original result/body assertions. Seventh run89861 is live at .local/m3a-cloudflare-seventh.log; poll it before a duplicate run. Mobile screenshot apps/worker/.local/photo-version-heads-mobile.png was inspected; synthetic preview and version panel fit the viewport without horizontal overflow. Final runtime acceptance remains pending.

In parallel, M3b SQL is being drafted only under .local/m3b-draft (not active migrations); strict new upload contracts/tests are separate new files and are not exported into current APIs yet. Root added PHOTO_VERSION_UPLOADS_ENABLED defaultfalse/hard-local;7 focused config tests passed. This does not implement or enable manual V2 upload. No persistent0036/0037 migration or hosted deployment.

## M3a corrected Owner browser run live

UI and browser files are frozen after the definitive-conflict and direct-project-navigation corrections. Focused web typecheck, scoped lint/format and Node syntax checks passed. The browser helper now distinguishes a dropped request before Worker execution from a committed response lost in transit; it holds the fresh reconciliation GET to verify the navigation gate and confirms eventual release. Sixth full session96001 is live in .local/m3a-cloudflare-sixth.log. Poll it before starting another run. No final M3a acceptance or persistent0036 application yet.

## M3a definitive-conflict correction checkpoint

The Owner UI now recognizes only PHOTO_VERSION_REVISION_CONFLICT and PHOTO_VERSION_NOT_READY as definitive non-commit results after an ambiguous exact retry. It clears the intent, keeps the parent navigation gate during fresh-state reconciliation, and refreshes the gallery afterward. Other ambiguous codes retain the original intent. Web strict typecheck passed after this correction. Browser navigation and a pre-commit-drop/intervening-change regression remain in progress; no runtime suite is currently live. Last runtime84980 passed version API/integrity but failed the helper's project navigation. Wait for the updated browser helper freeze before launching another full run.

## M3a backend acceptance evidence; Owner browser corrections pending

Fifth full run84980 is terminal. Real ready-V2 processing, paged version metadata, CAS race/replay, Owner/Guest current and restored galleries, independent old-version comparison ACL, state/version/asset preservation, audit-failure rollback/exact retry, archived/foreign denial and direct immutable head/command/result/alternate/null/predecessor checks passed. The run then failed in the Owner browser helper because it started at the workspace homepage and searched for a project link that belongs on the workspace/projects page. The helper will navigate directly to the authenticated project route using its fixture project_id.

Independent review also found that an ambiguous request receiving definitive PHOTO_VERSION_REVISION_CONFLICT or PHOTO_VERSION_NOT_READY can remain locked forever. SQL exact replay precedes those checks, so those two codes prove that exact intent did not commit. UI correction and a pre-commit dropped-request/intervening-change regression are underway; committed lost200/retry401 must still retain intent. No final M3a browser acceptance or persistent0036 application is claimed. Log: .local/m3a-cloudflare-fifth.log. Full M1–M5 remains active.

## M3a ready-V2 evidence and gallery fixture order correction

Fourth run34588 reached and passed real V1/V2 processing, version24+3 pagination, no-op/replay, not-ready denial and two-concurrent-command CAS with exactly one200/one409. It then failed a gallery assertion because the test had restored V1 before expecting V2. Root moved the restore after V2 Owner/Guest gallery and comparison-right assertions and added both Owner/Guest V1 restoration reads. No production code or expected security boundary was weakened. Fifth run84980 is live at .local/m3a-cloudflare-fifth.log; poll it before rerun. Successful switching now has actual evidence, but remaining gallery/integrity/browser acceptance is not yet claimed.

## M3a runtime verification update

Root fixed the authenticated session fixture using /api/auth/get-session and exact D1 session ID/user/expiry. Third full run91193 then reached Owner capability assertions and failed because the helper omitted authentication; /api/v1 is correctly Owner-protected. Both OFF/ON capability checks now include Owner cookies and explicitly assert anonymous401. Fourth run34588 is live at .local/m3a-cloudflare-fourth.log; poll it before another run. These are fixture corrections; ready-V2/CAS acceptance remains unproven until that path runs.61 integration tests passed in run48063; full typecheck76265 and Next build13487 passed. Owner browser helper is now wired. No persistent0036 migration or hosted change.

## M3a interrupted-run recovery and runtime fixture correction

Root confirmed first run57801 was terminal before helper execution due an undefined cookies caller; caller now passes googleCookies. Second run6780 is also terminal: fixture incorrectly compared the signed Owner cookie string to owner_sessions.token, so no current session row was found. Correct fixture resolution through the authenticated session endpoint, then recheck exact session ID/user/expiry in D1. These failures do not validate or disprove ready-V2 switching; that path has not yet executed. Logs: .local/m3a-cloudflare-first.log and .local/m3a-cloudflare-second.log.

Full Worker/web typecheck76265 and Next build13487 passed. Owner browser helper is written and syntax/lint/format checked; it has not run. Isolated neighbor photo and immutable-guard tests are prepared. No active runtime suite remains at this checkpoint; await the corrected helper freeze before rerun. User's same-invitation comment visibility decision is recorded in DECISIONS/GUEST_ACCESS_AUDIT; different invitations remain isolated.

## Confirmed comment visibility decision — 2026-10-26

The user chose: Guests on the same invitation may read each other's comments; Guests on different invitations remain isolated. Treat invite_id as the discussion boundary in addition to workspace/project/album/photo scope. An Owner reply must target that exact invitation thread; possession of another invitation for the same project/photo grants no access to its comments. Do not merge Guest identities by nickname, email or shared photo. can_comment stays independent of can_view, selection and other permissions. This decision resolves earlier pending visibility notes; other comment lifecycle/status/retention details still need an explicit implementation contract and tests. No comments feature is implemented or enabled by this documentation update.

## M3a first runtime acceptance running

Backend0036 and head repository are frozen. Agent isolated real Miniflare/D1 probe passed V1 backfill/preservation, no-op/replay, stale/changed intent denial, head rollback/REPLACE rejection and FK integrity; successful ready-V2 switching is being verified by the main harness, not inferred from that probe. Root integrated TypeScript and full lint27752 passed; unit146/27files remains passed.

First full runtime session57801 is live at .local/m3a-cloudflare-first.log. The new helper creates an independent album/photo, processes real V1/V2 through the existing image pipeline, and exercises CAS/current galleries/Guest comparison rights/preservation/audit rollback. Poll this handle rather than starting a duplicate run. Direct immutable command/result/alternate/null/predecessor cases and the Owner browser helper are next after runtime feedback.0036 has not been persistently applied, all flags remain OFF, and manual V2 upload is still a required next vertical slice.

## M3a strict verification checkpoint

Root integrated TypeScript check now passes after correcting nullable unit fixture inference with the actual PhotoVersionItem contract type. Full unit suite passed146 tests/27files. Owner version test worker/caller is wired with explicit cookies; acceptance fixture will use a new synthetic album/photo and real processing pipeline, preserving the shared gallery fixture. Review requested safe-integer revision exhaustion rejection, explicit final version-page ordering, exact returned revision matching, and removal of an arbitrary96-item UI history cutoff. Scoped workers are completing those corrections and the runtime/browser helper. No full M3a runtime acceptance or persistent0036 application is claimed.

## M3a Owner integration checkpoint

Root connected PhotoVersionsPanel to the Owner Lightbox and added synchronous pending-operation guards on close/previous/next plus keyboard navigation. The panel must retain exact uncertain intent and report onPendingChange until the result is known; onCurrentChanged refreshes gallery only after successful reconciliation. Default-OFF panel leaves no empty visual block. Dedicated photo-versions-test Worker is wired with enabled flags for synthetic acceptance. The helper will receive existing Owner cookies explicitly; no shared fixture mutation is needed. Backend/service/0036 and UI remain in progress, so no full build or runtime acceptance is claimed for this checkpoint. Prior12 focused contract/config tests remain the current test evidence.

## M3a integration checkpoint

Root wired default-OFF Owner capability/list/set-current routes with strict UUID/query/body validation and Origin checks. Owner and Guest gallery SQL now reads the tenant/photo-scoped photo_version_heads record rather than hardcoded V1; Guest non-current derivatives additionally require can_compare_versions2048 alongside can_view. This code depends on the pending0036 migration and is not yet runtime accepted or applied to local D1. Scoped workers continue the migration/service, Owner panel and real D1 acceptance helper.12 focused contract/config tests passed (root-run); full type/runtime/browser verification remains pending. No manual V2 upload or comparison completion is claimed. Full M1–M5 stays active.

## M3a photo versions implementation underway

Read docs/PHOTO_VERSION_HEADS.md and PHOTO_VERSIONS.md. Existing uploads and gallery queries hardcode V1; immutable rows cannot safely act as mutable current-state. Scoped workers own new0036/head service, version contracts/tests, and Owner panel respectively; root owns existing integration. PHOTO_VERSIONS_ENABLED is defaultfalse/hard-local;7 config tests passed. No new version workflow or migration acceptance is claimed. Next complete atomic head switching and gallery/current/non-current access integration, then explicit manual V2 upload and comparisons. Full M1–M5 remains active; comment visibility decision is pending independently.

## M2p final local verification — supersedes earlier pending status

Final full Worker run54253 passed157 local checks (.local/m2p-cloudflare-lifecycle.log), including history API privacy/current ACL/cursor scope, three-page fixed lifetime, deleted-photo witnesses, real Chromium pagination and explicit lifecycle-event identity clearing.134 unit/25files,61 integration/10files,14 reference Chromium, final generated Worker/web strict typecheck, lint/format, Next build and36-file documentation checks passed.375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected.

0035 was applied to local development D1 only (4 commands), and follow-up migration list is empty. Existing history was preserved. Recovery is forward-only; disable history on application rollback and retain indexes/audit. All feature flags remain OFF/hard-local and retention deletion remains OFF/dry-run. No remote/customer data, deploy, commit or push occurred.

Limit: headless Chromium did not emit native blur/visibility on bringToFront or the isolated CDP probes. The passing browser test explicitly dispatches FocusEvent blur/focus and checks current-cookie/D1 reload plus old-data clearing. Native headed desktop tab delivery and hosted E2E remain not_checked. This does not complete the full product goal. Earlier status/failure notes below are retained as historical evidence, not the current acceptance status.

Next work: immutable explicit Owner photo versions with a separately audited CAS current-version pointer; current uploads/galleries hardcode V1. Add independent non-current Guest comparison authorization before V2 exposure. Comment visibility choice remains pending; do not broaden disclosure. Filename tombstones, full history/Owner views, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 goal stays active.

## M2p headless lifecycle validation boundary

Run13832 failed the real-tab transition assertion: after a second tab was opened, the first tab stayed visible/focused and no blur/visibility event arrived. Independent minimal Chromium probes reproduced events=[] / visible / hasFocus=true, including CDP focus-emulation and freeze/active probes. This is an observed headless behavior, not evidence that the application handler failed. The helper now explicitly dispatches browser FocusEvent blur/focus around the cookie switch and retains zero-old-rows/new-Guest-only assertions. It does NOT prove native desktop tab event delivery; that remains not_checked. No application safeguard or assertion was removed. Full rerun54253 is live in .local/m2p-cloudflare-lifecycle.log; poll it before another run. Final Next build93578 passed after the focus changes. Persistent0035 application remains pending.

## M2p cross-tab verification in progress

The focus/visibility fix is written: background transitions invalidate request generations, abort reads and clear the rendered snapshot; foreground reloads capabilities and page one with the current cookie. Manual refresh also invalidates older requests. Web strict typecheck and scoped formatting/lint checks passed. The real second-tab regression initially failed in run54594 because visibleGuest had zero events while the new test required one. Root added one valid favorite event to that synthetic Guest; no production logic or assertions were relaxed. Rerun13832 is live in .local/m2p-cloudflare-focus-fixed.log. Poll that handle before starting another suite. Do not claim final acceptance or apply0035 persistently until the result is known.

## M2p follow-up security gate

Integrated Worker run50575 passed157 local checks including the actual Guest history Chromium helper, cursor privacy/three-page lifetime, and existing regressions (.local/m2p-cloudflare-browser.log). The375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected without horizontal overflow. This is not final slice acceptance: independent review found that an already-loaded history tab with no next page does not clear/revalidate after another tab changes the shared Guest cookie. Add blur/hidden invalidation and focus/visibility revalidation plus a one-page cross-tab browser regression before acceptance or persistent0035 application. Gallery entry requiring can_view is intentional because it appears within the gallery; standalone1024-only history passed independently. Reference application Chromium run30695 passed14 tests in26.8s (.local/m2p-reference-e2e.log); this is separate from Worker history UI acceptance. No hosted deployment, customer data or flags changed.

## M2p — Guest own-history implementation in progress

Current slice adds an independent can_view_own_history (1024) timeline. GUEST_HISTORY_ENABLED defaults OFF in all environments and rejects non-local activation. Root added capability/activity routes with strict query keys and duplicate rejection; backend, UI and acceptance helper are being implemented by scoped workers. This is NOT accepted end-to-end yet; no migration0035 has been applied and no hosted service has been changed.

The contract allowlists 14 own Guest selection/submission/rating/favorite/tag/shared-selection actions, exposes only projected before/after details, and excludes raw audit JSON, session/request IDs, storage data and other identities. Read scope derives from the current cookie and sealed invitation albums. Pagination must use signed scope/filter-bound cursors, recheck current authorization on every page, and exclude later appends with a snapshot watermark. Missing photos show a generic unavailable marker; retained safe filename tombstones remain a separate unfinished requirement.

Verified this pass: root independently ran13 focused Guest history contract/config tests, then the full134 unit tests in25 files; all passed. Documentation presence36files and diff whitespace checks passed. Integrated TypeScript rerun passed after the scopeHash refactor. First full local Worker run68699 failed at new history fixture setup with WORKSPACE_LIMIT_REACHED; earlier regressions including Guest tags browser passed, but history API acceptance was not reached. Correct the isolated fixture without weakening quota constraints, then rerun. A misplaced gallery client directive was corrected and its focused lint passed. Subsequent full lint and61 integration tests in10files passed; current integrated TypeScript also passed. Second full local Worker run82029 passed156 checks (.local/m2p-cloudflare-second.log), including history API scope/cursor/tombstone/current-session tests; history-specific Chromium integration remains pending. Next build initially failed exactOptionalPropertyTypes in the new UI; explicit optional types were corrected without weakening settings and fixed build80479 passed (.local/m2p-next-build-fixed.log). First failed run log: .local/m2p-cloudflare-first.log. Next: finish backend/UI, inspect authorization/cursor sanitizer, run real local D1/workerd/Chromium acceptance, and only then update acceptance status. Preserve all existing dirty work and always use explicit KINO Pic workdir. Full M1–M5 goal remains active.

## M2o — independent Guest tags accepted locally

Read docs/GUEST_TAGS.md.0034 implements immutable project label catalog, per-invite/Guest/photo membership and canonical command/result/state/audit. can_tag is independent; Grid/Lightbox also require can_view. Labels NFC/trim/case-sensitive,40codepoints,20active/photo,1000catalog/project. No Guest catalog enumeration; removing unknown membership hides another Guest catalog ID. Tags remain editable after selection submission without changing snapshots. Exact expectedGuestId/UUID/body survive uncertain responses and cookie switches; only first definite cap409 may refresh/recover. All feature flags remain OFF/hard-local.

Final full Worker run58214 passed148 local checks (`.local/m2o-all-acceptance3.log`), including actual375px Chromium tag controls, Grid/Lightbox sharing, private images, lost-response exact retry, switched-Guest denial/isolation, beforeunload warning, stale-cap refresh/removal, immutable PK/alternate/null guards, predecessor rollback, catalog1000cap/isolation/reuse, currentACL/replay and populated upgrade preservation.121 unit/23files,61 integration/10files, strict types/lint, Next build,14 reference Chromium, format and35-file spec presence checks passed. Worker UI acceptance is in the148-check suite. Screenshot `.local/guest-tags-mobile.png` inspected.

0034 applied to local development D1 only:28 commands; follow-up list has none pending. No remote/customer data, deployment, commit/push or flag activation. Recovery is forward-only: retain catalog/membership provenance/command/result/audit; disable tag writes before application rollback and repair with new migrations. Broader tags filtering/Owner history, own-history timeline, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 remains active; next assess independent Guest own-history timeline.

Intermediate failures were test/code issues and were fixed before acceptance: nullable UI context, unused fixture workers, wrong Owner session_id audit assertion (Guest uses guest_session_id), image-helper argument mismatch, dialog.type method comparison and reload hydration race. The final suite includes those corrected paths. Isolated workerd catalog/integrity probes also passed; they are additional evidence, not hosted acceptance.

Execution incident retained for handoff: a subagent accidentally invoked a pnpm Prettier check in unrelated `C:\Users\Aaron\Documents\奇諾影像形象網站`, emitting dependency move/install warnings. Observed child processes ended; read-only status showed untracked pnpm-lock.yaml and node_modules/.ignored exists, without a clean before-snapshot to prove all provenance. No automatic cleanup/repair was performed there; preserve unrelated user work. All further commands use explicit KINO Pic workdir.

## M2n2 — immutable photo insertion accepted locally

0033 prevents REPLACE across version id/photo-version number, asset id/object key/version-kind and processing output job-kind/asset ID/object key; null photo version/asset IDs are rejected. Existing rows, scope checks and mutable job transitions are preserved. Isolated baseline0001–0032 reproduced queued-slot identity replacement, same-ID version hash/size replacement and original-to-delivery replacement with valid FKs;0033 rejected all with unchanged snapshots.

Final frozen-helper Worker suite passed135 checks (session59049, `.local/m2n2-final-cloudflare.log`), including populated upgrade preservation and immutable table/audit/FK comparisons.108 unit,61 integration,14 reference Chromium, strict types, lint, Next build, format and specification checks passed. Intermediate lint unused-variable warning was fixed; the old cross-tenant asset fixture now uses an unused delivery kind so it tests scope rather than colliding with the new duplicate guard.

0033 applied locally only:4 commands, then no pending migrations. No remote/customer data, deploy, commit/push or flag activation. Recovery: preserve guards/history, disable writes before code rollback and repair forward. Broader command/snapshot integrity, independent tags/comments/annotations/history, version workflows/comparison, delivery/retention and hosted gates remain incomplete. Next product slice: independent Guest tags; specification assessment underway. Full M1–M5 remains active.

## M2n1 — immutable result integrity accepted locally

Migration0032 rejects primary/alternate event-key replacement in seven immutable result tables and rejects null result keys/null or empty audit IDs;0031 duplicate-audit protection remains. Tests isolate a fresh non-null key with an existing event ID, duplicate primary key, null key, duplicate audit REPLACE, unchanged history, foreign keys and populated upgrades. Existing authorization and exact retry tests remain green.

Final strengthened Cloudflare suite passed134 local checks (session54580, `.local/m2n1-final2-cloudflare.log`).108 unit,61 integration,14 reference Chromium, typecheck, lint, Next build, format and34-file specification presence checks passed. Intermediate rerun failed on deferred Response.clone; immediate per-response parsing preserves24 concurrent attempts and20 allowed and passed the final suite.

0032 applied locally only:10 commands; no pending local migrations. No remote/customer data, deployment, commit/push or flag changes. Recovery: preserve guards/history, disable affected mutations before code rollback and repair forward. Remaining command-ledger, version/asset and snapshot/seal defenses still need audit. Full M1–M5 and hosted acceptance remain active.

## 2026-10-26 — M2m3 project defaults and album inheritance (accepted locally)

- Implemented strict contracts,0031, services/API, Owner project/album controls and Guest effective policy reads/refresh. Explicit album overrides win as a whole, including unlimited maximum; inherit mode retains its durable epoch. Cursors bind source/album epoch plus inherited project epoch. Existing shared review rounds keep their confirmed fixed bounds.
- Atomic current authorization/CAS/cap checks, immutable command/result/audit, symmetric request namespaces and safe legacy replay are enforced. Project cap lowering checks inheriting open drafts; album reset checks its own drafts. Owner confirmation shows actual proposed bounds, retains exact unknown intent across401/403 and reads current state after historical replay. Old0028 results/history remain untouched; new legacy API writes use explicit overrides and a stable original-payload commitment.
- Root review fixed UPSERT INSERT witnesses, effective-vs-stored inherit witnesses, NULL CHECK fallthrough, same-query replay authorization and legacy-seed replacement. New/old policy results and audit_events reject INSERT OR REPLACE. Cron preserves the first same-day dry-run event through insert-if-absent; deletion remainsOFF.
- Actual final checks: pnpm test:cloudflare133 local workerd/D1/R2/Chromium checks; test:unit108/21 files; test:integration61/10 files (27.81s); typecheck; lint; Next build; test:e2e14 reference Chromium (25.9s). Worker browser coverage is in test:cloudflare. Final format:check,34-file specification checker and git diff --check passed. Populated0004→0031 compares every old table, seeds a real0028 override and rejects legacy-result/seed replacement. Concurrent Cron observations preserve one unchanged audit event.
- Local list showed only0031 pending; db:migrate:local applied41 commands; follow-up list has none pending. No remote resources, real provider credentials, customer data, commit/push/deploy or flag activation. Shared Owner mobile screenshot shows both new policy panels at375px; visually inspected alongside automated overflow checks.
- Recovery: disable Guest selection before code rollback, retain0031 plus old history and repair forward or restore a separately verified consistent backup. Do not restore an enabled0028 issuer against its now read-only command table.
- Three gpt-6-luna/max workers used isolated worktrees; root integrated, reviewed and ran acceptance. Remaining: broader historical ledger replacement audit, tags/comments/annotations/full activity/versions/BeforeAfter/delivery/notifications/retention and hosted OAuth/KDF/edge/R2/CORS/import/backup/CI/deployment gates. Full M1–M5 goal remains active.

## 2026-10-26 — M2m2 shared reviews accepted locally

- Implemented explicit Owner-confirmed shared subjects with sealed invitation membership, independent rights, per-round bounds, immutable submissions/history, streamed exports and confirmed reopen. Private picks and feedback remain separate. Cookie-switched uncertain retries retain expectedGuestId and are denied without new writes.
- Actual final pnpm test:cloudflare:127 checks PASSED, including populated0004→0030 preservation, two-distinct-Guest29→30 race, Owner native CSV/TXT/JSON downloads and two-Guest Chromium flows with real private processed-thumbnail loading. Latest typecheck, lint, format:check, Next build,34-file documentation checker and git diff --check passed. Earlier same-slice unit98, integration61 and reference Chromium14 passed; these do not prove hosted services.
- Local migration list contained only0030; db:migrate:local executed75 commands successfully; follow-up list has no pending migrations. No remote migration/customer data/credentials/commit/push/deploy. All feature defaults remain OFF/hard-local; retention dry-run stays ON.
- Browser test bridge uses real loopback HTTP for native attachments. Hard-navigation cancellation is tested; successful preflight completion after React-only unmount remains code-reviewed rather than independently browser-proven. No live collaboration push: participants explicitly refresh.
- Recovery: disable shared access, preserve0030 and all immutable history, repair forward or restore a separately verified consistent backup; no destructive down migration. Next M2m3: project inherited selection defaults. Tags/comments/annotations/full history/versions/BeforeAfter/delivery/notifications/retention and hosted OAuth/KDF/edge/R2/CORS/backup/CI/deployment remain required. Full M1–M5 goal stays active.

# KINO Pic — AI Agent 交接紀錄

## 2026-10-26 — M2m1 private selection bounds and reopen repair (complete locally)

- Branch/worktree: codex/kino-pic-foundation, repository root. Task: album minimum/maximum, atomic private selection/submit constraints, Owner/Guest UI and0029 unchanged-reopen repair. Read SELECTION_POLICY.md before changing policy, cursors, submit or reopen. Preserve all earlier dirty/untracked work; no commit/push/deployment.
- Three tables in0028 hold private album min/max/revision and immutable Owner commands/results. Defaults1/unlimited/revision0 preserve existing behavior. Current Owner/session/tenant is checked within policy GET/result queries and at write. Confirmation/CAS, predecessor guards, no-op/exact replay, symmetric request namespaces and audit rollback are enforced. A max below any open private draft is rejected; Guest counts are never aggregated/shared.
- Guest selection snapshots include current selectionPolicy and independent canSubmit; cursors/hydration bind policyRevision. Grid/Lightbox cap only new picks, keep selected picks removable, clip page batch to remaining capacity, and disable submit outside bounds. can_select without can_submit has no invalid submit action. Owner form remains mounted on collapse, locks synchronous duplicate intent, retries exact UUID/body across unknown response/401, and always GETs current policy after confirmed replay. A separate-device update regression proves an old result cannot present itself as current.
- Root review found preexisting reopen revision0 contradicted the positive-revision submission constraint.0029 initializes new retained drafts at1 with exact audit evidence and repairs only legacy open round>1 revision0 using one system selection.round_initialized event. Old snapshots, selected items, feedback and reopen metadata stay intact; historical exact replay can still return original0. New tests preserve three submitted rounds while allowing unchanged retained picks to submit and enforcing current min/max409.
- Actual passed: pnpm test:cloudflare123 workerd/D1/R2/Chromium checks; pnpm test:unit95/18 files; pnpm test:integration61/10 files (19.79s, alone); pnpm typecheck; pnpm lint; pnpm build; pnpm test:e2e14 reference Chromium (25.3s); format check,33-file specification checker and git diff check. Worker UI coverage belongs to test:cloudflare, not the reference suite. Screenshots apps/worker/.local/selection-policy-mobile.png and selection-limit-guest-mobile.png visually inspected at375px with synthetic data.
- Local migration list showed only0028/0029 pending; db:migrate:local applied28 and6 commands successfully and follow-up list reported none pending. No remote SQL/R2, provider credentials/customer data, deployment or flag enablement. All existing feature defaults remain OFF; retention dry-run remains ON. Code rollback requires selection disabled; retain schema/guards/history and repair forward or restore a separately verified consistent snapshot. Never restore an enabled zero-revision reopen issuer.
- Three gpt-6-luna/max workers produced only assigned new backend/UI/test files in separate worktrees; root integrated/reviewed all existing-file changes, fixed coherence/error/UX/test issues and ran acceptance. Read-only review found no remaining concrete ACL/atomicity/snapshot issue in the bounded slice.
- Next M2m2: explicit opted-in shared review subjects and the two-distinct-Guest29→30 race, plus project-level inherited defaults. Same-Guest/two-session29→30 proves only private concurrency. Tags/comments/annotations/full activity/versions/BeforeAfter/delivery/notifications/retention and hosted OAuth/KDF/edge/R2/CORS/import/backup/CI/deployment gates remain required; M1–M5 remain incomplete.

## 2026-10-26 — M2l independent rating/favorite slice (complete locally)

- Authoritative worktree: codex/kino-pic-foundation, repository root. Preserve all unrelated preexisting dirty/untracked work. Two gpt-6-luna/max workers owned only new backend/UI/test files in independent worktrees; a third performed read-only security review. Parent integrated routes/contracts/config, reviewed state/replay/UI races and ran checks.
- Added strict rating/favorite APIs, independent can_rate16/can_favorite32 reads/writes,24-ID scoped batches, and shared Grid/Lightbox controls. Photo state remains per invite/Guest/logical photo with an exact last-change version witness. No-op keeps original state/time/version, while clear/unfavorite retain witnessed null/false rows. Selection submit freezes its own snapshot only.
- Additive migration0027 adds four feedback tables, immutable command/result witnesses, predecessor-linked state guards, atomic audit and symmetric conflicts with selection/submission/logout/exchange request IDs. Audit failure rolls the entire statement back. Populated0026→0027 test preserves all preexisting table rows; historical-witness rollback is rejected.
- UI preserves exact UUID/payload after unknown responses, synchronously locks each photo/action, reconciles current state after replay and protects against A→B→A stale hydration. Owner invite capabilities identify feedback availability without implying rights.
- Actual passed: pnpm test:cloudflare117 local workerd/D1/R2/Chromium checks, unit91/17 files, integration61/10 files, strict typecheck/lint, Next build,14 reference Chromium E2E (26.8s), format check,32-spec presence checker and diff check. Worker UI acceptance includes independent rights, exact lost-response retry, Grid/Lightbox/reload/paging, A→B→A held response with stale hydration, and375px no overflow. Synthetic screenshot apps/worker/.local/guest-feedback-mobile.png visually inspected.
- Local migration list showed only0027 pending; db:migrate:local applied28 commands successfully and a follow-up list had none pending. No remote SQL, R2 object change, customer data, OAuth/R2 credentials, commit, push or deployment. All existing feature defaults remain OFF; retention dry-run remains ON. Recovery is forward-only: disable feedback, retain0027 schema/guards/history and repair forward or restore a verified consistent snapshot.
- Initial integrated failures were strict Hono dynamic-route inference (fixed literal type), fixture duplicate version2 (now selects next version), and test attempts to update immutable expiry (now uses real short-lived grants). Browser helper scope/column/count issues were fixed before final run. See VERIFICATION for final outcomes.
- Next required M2m: configurable selection limits and atomic concurrency checks (including the specified29→30 race), Owner/Guest UI and deterministic tests. Tags/comments/annotations/full history/selection limits/versions/BeforeAfter/delivery/notifications/retention remain required; M1–M5 and hosted OAuth/KDF/edge/R2/CORS/import/backup/CI/deployment acceptance remain incomplete.

## 2026-10-26 — M2k Owner creation/share and Guest invitation entry

- Branch/worktree: codex/kino-pic-foundation / repository root. Task: close the local create-share-enter-pick workflow using existing issuer/exchange services.
- Owner composer supports three modes, exact custom password bounds, active album cursor pages with up to24 selected albums, UTC expiry from local-time input, optional maxUses and12 independent rights. It only offers usable creation when issuer+exchange capabilities are available; reserved actions are labelled. Collapsing the manager preserves transient intent/results.
- One-time credentials remain in component memory; per-album share links use fragment-only tokens. Exact retry/recovery keeps the original request payload/UUID; after an unknown result even retry401 preserves the operation. Metadata-only recovery cannot restore secrets or silently create a replacement.
- Guest entry consumes/scrubs the fragment once before render, bypasses Owner auth, checks availability, submits nickname/optional exact password, and navigates to authorized gallery. Same-tick submits produce one session. Unknown response with/without Cookie does not auto-repeat; explicit current-cookie access checks recover navigation only when authorized.
- Added non-secret read-only Owner/Guest capability endpoints and a browser-safe shared password validator. No migration/schema change, remote SQL, customer data, credential config, flag enablement, commit, push or deployment.
- Actual pnpm test:cloudflare passed112 local workerd/D1/R2/Chromium checks; unit88, integration61 and Next production build passed. Final strict typecheck/lint and14 reference-app Chromium E2E passed. pnpm format:check, python tools/check_handoff.py (31 specification files) and git diff --check passed.
- Root review fixed StrictMode fragment handling, synchronous duplicate locks, UTC/local input conversion, unknown retry authorization semantics and lazy composer state retention. Two gpt-6-luna/max workers produced only four new files in separate worktrees; parent integrated/reviewed all existing-file changes and ran acceptance.
- Boundaries: synthetic OAuth/address/R2 fixtures do not prove hosted providers, trusted edge metadata, KDF resources/cancellation, live R2/CORS, backup/restore, CI or deployment. Ratings/favorites/tags/comments/annotations/history/limits/versions/delivery/retention remain required.
- Recovery: hide UI/leave flags OFF; retain0019/0022/0026 commands, sessions, scope/seals, snapshots and audit. Next: M2l independent rating/favorite action state, atomic audit/replay, API/UI and permission acceptance; retain the full M1–M5 backlog.

## 2026-10-26 — M2j Guest selection and Owner submission review (complete locally)

- Branch/worktree: codex/kino-pic-foundation / repository root.
- Task: M2j Guest selection submission and Owner review/export/audited reopen.
- Added Owner submission list/detail contracts and the D1 repository/API for submission history, immutable snapshot detail, CSV/TXT/JSON export, and explicit round reopening.
- Reopen is an atomic audited transition. It validates current Owner/workspace/album scope and expected round, preserves sealed earlier snapshots, and advances the Guest to a new open round under Migration 0026 guards.
- Hardened replay: a reused request ID returns the original result only when actor, workspace, project, album, invite, Guest, expected round, and deterministic selection.reopened event all match. Reuse against a changed target returns 409 without mutating that target.
- Hardened CSV filename cells against spreadsheet formulas beginning with =, +, - or @, including leading whitespace/control characters. Dangerous CSV cells are apostrophe-prefixed and then normally CSV-escaped. TXT and JSON filenames remain unchanged.
- Guest UI now pages the gallery at 24 photos, hydrates selection across all cursor pages, batches only the visible page sequentially, refreshes after stale/partial writes, and retries logout with the original request ID.
- Owner UI in apps/web/target-ui/owner-submissions.tsx lists submission rounds, displays immutable detail and downloads exports. Reopen is offered only for the latest submitted round; historical cards show the current later-round state. The dialog focuses its first action, traps Tab, closes on Escape while idle, and restores focus after dismissal or completion.
- Browser coverage exercises reopen dialog keyboard focus, Escape and focus restoration, and verifies after round 2 submission that only round 2 offers reopening. Worker regression coverage includes exact versus changed-target request replay and formula-like CSV filenames.
- Successful Owner CSV/TXT/JSON exports append a scoped download.generated event before returning the attachment. The event stores only submission ID, format and selected count; it records server-side generation, not client receipt. Audit failure fails the request. No schema change was required.
- Migration 0026 adds snapshot sealing/immutability and audited round-transition guards. Local populated migration acceptance reaches 0026; local-only migrations and tests did not touch remote/customer data.
- Verified by root for this milestone: pnpm test:cloudflare — 109 local checks; pnpm test:unit — 88 tests; pnpm test:integration — 61 tests after the native-image timeout fix; pnpm typecheck; pnpm lint; pnpm build; pnpm test:e2e — 14 reference-app Chromium tests; pnpm format:check; python tools/check_handoff.py — 30 specification files; git diff --check. Worker UI/browser acceptance is covered by test:cloudflare, not the retained Next/reference E2E suite.
- Boundaries: GUEST_SELECTION_ENABLED remains default-off and hard local-only. Real Google/GitHub OAuth, hosted Supabase/PostgREST, remote edge behavior, live R2/CORS, restore and deployment remain unchecked.
- Next: Guest UI/browser E2E beyond the tested selection/reopen paths; selection limits; remaining independent Guest ratings, favorites, tags, annotations and comments; complete event history for remaining actions; versions and delivery; then hosted service gates.
- Recovery: forward-only. Disable GUEST_SELECTION_ENABLED if needed; never remove submission snapshots, seals or audit events.

## 2026-10-25 — M2j Guest selection customer UI and browser acceptance (historical)

- Applied additive migration `apps/worker/migrations/0026_guest_selection_snapshot_guards.sql` to local Wrangler D1 (`--local`). Migration 0026 establishes immutable `guest_selection_submission_seals` and strict snapshot item/status transition guards (including foundation for `selection.reopened`). Populated isolated migration tests through 0026 pass.
- Implemented Guest selection customer UI in `apps/web/target-ui/guest-selection.tsx`:
  - `GuestAlbumPage`: Responsive grid layout (mobile 2 columns, desktop 3-5 columns) with private same-origin thumbnail paths and Lightbox preview with keyboard navigation (Escape, arrow keys).
  - Independent permission awareness: enforces `can_view`, `can_select`, `can_submit`. If guest lacks `can_select`, gallery renders read-only without checkboxes.
  - Interactive selection: toggles selection via `PUT /api/guest/albums/:albumId/photos/:photoId/selection` with idempotent UUID `requestId` and version pinning.
  - Sticky selection status bar: displays real-time selected photo count, round number, and round status.
  - Empty selection guard: submit button disabled when `selectedCount === 0` (preventing client empty submit and matching 422 `EMPTY_SELECTION` server guard).
  - Submission flow: explicit confirmation modal explaining round freezing; on confirmation sends `POST /api/guest/albums/:albumId/selection/submit` with paired `expectedRoundNo` and `expectedRevision`. Upon 200 success, locks selection controls, displays submission time badge and success alert.
  - Self-logout: header button executes `POST /api/guest/logout` with single-use requestId, clearing session.
- Added Playwright Chromium mobile E2E test `runGuestSelectionBrowserChecks` in `apps/worker/tests/guest-selection-browser.mjs`, integrated into `local-smoke.mjs`:
  - Executes against real local workerd + D1 + synthetic R2 on 375px mobile viewport.
  - Tests photo selection toggle (add/remove/re-add), empty submission guard, confirmation modal, round freeze, and verifies D1 `guest_selection_submissions`, `guest_selection_submission_items`, `guest_selection_round_state.status = 'submitted'`, and `audit_events` `selection.submitted`.
  - Verifies no horizontal scroll overflow on 375px viewport and captures screenshot at `.local/guest-selection-mobile.png`.
- Resolved prior test discrepancies in Codex worktree:
  - Scoped `guest_selection_commands` and `guest_selection_state` count assertions in `apps/worker/tests/guest-access.mjs` by `guestId`, preventing cross-guest row pollution from cursor pagination test fixtures.
  - Fixed unconsumed Undici stream in `apps/worker/tests/guest-exchange.mjs` rate-limit loop by consuming response immediately.
- Verification passed:
  - `pnpm test:cloudflare`: 104 checks passed.
  - `pnpm test:unit`: 88 tests passed (16 files).
  - `pnpm test:integration`: 61 tests passed (10 files).
  - `playwright test` (Next.js E2E): 14 tests passed.
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `python tools/check_handoff.py`, `git diff --check`: all passed.
- Not implemented in this slice: Owner review/export API and UI, authorized/audited reopen API and UI, selection limits (min/max), ratings, favorites, tags, annotations, comments, and hosted production gates.
- Next smallest task: Owner submission review/export plus authorized, audited round reopen flow (`selection.reopened`).
- Recovery: Forward-only. Disable `GUEST_SELECTION_ENABLED` flag if needed. Never delete submission snapshots, seals or audit events.

## 2026-10-24 — M2j Guest selection read and submission backend (historical)

- Added additive migrations 0024 and 0025. They maintain a per-invite/Guest/album round and revision, immutable submission header/items/result rows, exact selected version IDs, and atomic submitted state plus selection.submitted audit. Migration 0025 orders the empty-selection guard after current authorization and request replay/conflict checks so an authorized empty draft returns 422. Existing selection history is preserved.
- Added GET /api/guest/albums/:albumId/selection. It requires the independent can_select permission (bit 8), returns only the current Guest's photo ID, version ID and selected time with a keyset cursor and round summary; it does not expose filenames, object keys or image assets. Reads recheck the hash-only session, exact sealed album, current Owner/parent state, expiry and revocation. Reads do not create audit events or refresh retention activity.
- Added POST /api/guest/albums/:albumId/selection/submit. It requires can_submit (bit 512), independent of can_select. The client sends a request ID and optionally a paired expected round/revision; the server reads selected rows and commits the exact photo/version snapshot, immutable result, round freeze and append-only audit in D1. Empty selections return 422; stale revisions, reused request IDs and already submitted rounds return conflicts. A committed submission blocks later Guest selection writes.
- Existing PUT selection mutation remains. All routes stay behind GUEST_SELECTION_ENABLED, false by default and hard local-only. D1 migrations through 0025 have been applied locally only; no remote/customer database was touched.
- Actual acceptance for this milestone: pnpm test:cloudflare passed 103 local Worker/D1/R2/Chromium checks. The populated isolated migration fixture from 0004 through 0025 preserved existing assets, Guest selection state/results and audit. Migration 0025 was applied to local Wrangler D1 after the suite. This does not establish hosted behavior or a user-facing flow.
- Not implemented: Guest selection screen/browser flow, Owner review/export/reopen API or UI, selection-limit policy, ratings/favorites/tags/comments/annotations, full history and delivery. Hosted OAuth, Cloudflare edge metadata, real R2/CORS, backup/restore and deployment remain unchecked.
- Next: build the Guest selection UI and browser acceptance, then implement Owner review/export and an explicitly authorized, audited reopen flow. Keep all action permissions independent and preserve each submitted snapshot.
- Recovery is forward-only. On Worker rollback, disable the selection routes/flag, retain migrations 0023–0025 tables, triggers and immutable rows, and repair forward or restore a separately verified backup. Never drop selection or audit history; no remote migration was run.

## 2026-10-24 — M2i Guest selection write backend (historical)

- Added additive `apps/worker/migrations/0023_guest_selection.sql`: selection state is scoped by invite, guest, album and logical photo; immutable selection commands and results retain request/payload, exact before/after snapshots and UTC time. Composite foreign keys preserve tenant, invite, album, photo and version boundaries. A `BEFORE INSERT` trigger rechecks current hash-backed session, identity, sealed album, `can_select`, enabled Owner, active project/album, expiry and revocation using D1 time; the transaction applies state and appends `selection.added`, `selection.removed` or `selection.version_changed` audit together. No-op deselection is idempotent and adds no state-change event; selecting another version of an already selected logical photo updates the pinned selected version and appends `selection.version_changed`.
- Added strict `PUT /api/guest/albums/:albumId/photos/:photoId/selection`, `D1GuestSelectionRepository`, request/result contracts and `GUEST_SELECTION_ENABLED`. All Wrangler envs and `.dev.vars.example` default false; configuration rejects hosted enablement. Selection-only permission does not imply gallery view. Raw session secrets are never written by this flow; command rows retain only the session hash.
- Exact request retry returns the immutable original result while the same Guest remains currently authorized; reusing a request ID with a changed body/target is 409. Foreign scope, stale/revoked session, invalid photo/version or missing `can_select` fail closed. Audit failure rolls back command, result and selection state. `selectedCount` is album-scoped.
- Actual verification: `pnpm test:cloudflare` passed103 local Worker/D1/R2/Chromium checks, including default-off/no-write, can_select-only, concurrent exact retry, request conflict, cross-album and photo/version denial, deselect/no-op, audit rollback/retry, revocation and immutable command. Populated 0004→0023 isolated upgrade preserves existing rows/FKs. `pnpm test:unit`87, `pnpm test:integration`61, strict `pnpm typecheck`, `pnpm lint` also passed. Full current validation and corrected first-run test flake are in VERIFICATION.
- Migration 0023 was applied only to local Wrangler D1 (`--local`); no remote/customer DB was touched. Forward-only recovery: disable the API/Worker flag before rolling back Worker code; retain migration tables, indexes, triggers and audit history. Repair forward or restore a separate verified snapshot; do not drop selection/audit rows.
- Scope boundary: no GET selection state, selection-round snapshot/submit/lock, Owner export, Guest UI, ratings/favorites/tags/comments/annotations, full cross-project history, or hosted enablement. M2h remains read-only gallery; user-facing product slice is not complete.
- Next: design a read/submit round contract that respects per-album permission and version pinning, then implement D1 schema/service/API, Owner review/export and a real Guest selection UI. Preserve append-only audit and current ACL in every write. Do not treat the write-only API as a complete selection flow.

## 2026-10-24 — M2h Guest read-only gallery (historical)

# KINO Pic — AI Agent 交接紀錄

## 2026-10-24 — M2h Guest read-only gallery (complete locally)

- Added `D1GuestGalleryRepository` plus `GET /api/guest/albums/:albumId/photos` and `GET /api/guest/photos/:photoId/versions/:versionId/assets/:kind`. Each read repeats the current hash-only Guest session, invitation, sealed exact album scope, independent `can_view`, enabled Owner, album/project state, UTC expirations and revocations. There is no migration.
- Album pages use a 25-row query to return at most24 photos plus a keyset cursor. A CTE sentinel distinguishes authorized empty albums from denied scope in one D1 statement. The test found that the first sentinel implementation could treat a foreign album as empty when another album was granted; the sentinel now binds the requested album, with a regression test.
- Only successfully processed private thumbnail/preview outputs are eligible. The gateway verifies output slot, JPEG MIME, exact stored size and SHA-256, enforces an8MiB maximum, streams inline, and uses global private/no-store plus same-origin CORP/Vary Cookie. No originals or download endpoint. Read routes append no audit event and do not count as a retention heartbeat.
- Actual acceptance: `pnpm test:cloudflare` 102 local checks passed after the ACL fix; unit86/16, integration61/10, browser E2E14 and Next production build passed. Corrected Worker source was rebuilt by the Cloudflare dry build. Final strict typecheck, lint, format:check,29-document handoff checker and git diff --check all passed.
- No remote migration/data, OAuth or R2 credential, deployment, push, commit or flag enablement. Hosted OAuth, R2/CORS, CF client metadata, KDF resource/cancellation and edge response behavior remain unchecked. No customer UI, actions, history, browse event or view-retention heartbeat is claimed.
- Next: implement the Guest mutation command spine for selection/rating/favorite with independent rights, current ACL in the same atomic write, stable request replay, version scope and append-only audit. Keep cross-project history closed without a stronger grant.

## 2026-10-24 — M2g Guest session exchange (historical, complete locally)

- Added additive migration0022: Guest KDF permits/releases/audit share the existing one-slot D1 KDF capacity with Owner issuance. guest_exchange_commands stores a keyed request commitment and session hash; Guest session-created audit carries the client request ID. Existing invite/session/revocation/audit rows are preserved. Forward-only recovery is in GUEST_EXCHANGE.md.
- Added strict same-origin POST /api/guest/exchange; pre-KDF M2f admission, current invite/Owner/sealed-active-album/expiry/revocation/max-use checks, fixed scrypt verifier, random hash-only session bearer, atomic identity/command/session/audit, uniform credential/scope/rate denials, and first-primary commit proof before setting HttpOnly cookie. Every Wrangler environment defaults the flag off, and non-local activation is rejected.
- Lost committed HTTP responses cannot recover or reissue the cookie; max-use remains consumed. For maxUses=1, Owner must revoke and issue a new invite. Guest UI/gallery/actions are not claimed.
- Actual acceptance: pnpm test:cloudflare 101 local checks; unit 86/16 files; integration 61/10 files; E2E 14; build, strict typecheck, lint and format passed. Migration0022 was applied to local D1 only (22 commands). See VERIFICATION.md for migration, failure/fix and hosted-service limits.
- No remote migration, provider/R2 credentials, deployment, push or flag enablement. Local tests do not establish Cloudflare edge metadata or hosted KDF capacity/cancellation.
- M2h later completed the scoped Guest read-only gallery and private derivative gateway. Next smallest vertical slice is the Guest mutation command spine with per-action permission enforcement and atomic append-only audit. Keep cross-project history closed absent an explicit stronger grant. CF-02 parity, processing/live/restore and remaining M1–M5 gates stay open.

## 2026-10-24 — M2f Guest admission buckets (historical)

- Added0021 transient D1 fixed-window network/invite-network/invite buckets. One SQLite upsert statement uses a single materialized D1 time snapshot and counts every denied attempt without saturation. Domain-separated HMAC keys hide IP/invite identifiers; unknown or malformed bearer inputs allocate no invite-specific rows. Address parsing normalizes IPv4/IPv6 and mapped aliases; missing/malformed trusted address fails closed.
- Default private thresholds are20 per source IP,5 per source-IP/invite,50 per invite per five minutes; a transactional capacity ledger caps all bucket dimensions at100000 rows; Cron removes the1000 oldest rows older than24h each invocation. Test-only harness exercises D1 thresholds/reset/capacity/privacy/prune; no production exchange route/session exists. Read GUEST_ADMISSION.md for caller trust contract, key rotation and rollback.
- M2g later completed the planned exchange route; this M2f next-step note is historical.
- Final validation:93 Cloudflare local workerd/D1 groups,83 unit,61 integration,14 reference Chromium,Next build,strict types/lint,format,29-doc checker and diff checks passed.0021 local apply succeeded(7 commands). Initial E2E raced with Next build and then passed on rerun. Test harness-only missing synthetic secret binding was corrected. No live CF address/hosted abuse evidence or Guest route. Details in VERIFICATION.

## 2026-10-24 — M2e Owner KDF admission (historical)

- Added0020 immutable KDF permits/releases and a bounded single-row active slot, current Owner/session acquisition guard and atomic resource audit. Local issuer now acquires before native password hashing, awaits original callback promise and releases in finally. Unknown acquisition never runs KDF; unconfirmed release prevents invite commit. Link-only/recovery bypass KDF safely. All flags remain OFF; no public Guest exchange or new UI.
- Read KDF_ADMISSION.md for no-TTL semantics and exact quiesced operator repair/rollback. A crash may deliberately block capacity until all work is proven stopped; older issuer code must not be enabled after rollback. No history/photo/R2/quota mutation, backfill, remote migration, push or deploy.
- Review by the existing GPT6 Luna Max agent found historical-scan cost and missing repair instructions; fixed with bounded active slot and documented audited release after quiescence. Initial test expected201 instead of existing200; corrected and actual90-group local regression passed before bounded-slot refinement. Final validation is recorded in VERIFICATION.
- Next: M2g later completed local-only Guest exchange; hosted native-KDF CPU/memory/cancellation, live provider/R2/restore and all remaining M1–M5 gates stay open.
- Final current-source acceptance:90 Cloudflare groups,81 unit,61 integration,14 reference Chromium(25.3s), Next build, strict types/lint passed.0020 applied project-local only(11 commands). Simulated ambiguous-result tests prove no work on unconfirmed acquire and no result on unconfirmed release. See VERIFICATION for final hygiene and exact limitations.

## 2026-10-24 — M2d local Owner invitation issuance/recovery (historical)

- Final format/docs(29 required specs)/diff checks passed; only existing CRLF notices. All test sessions complete. No new creation/share UI/screenshot or hosted rollout claim; final evidence in VERIFICATION.
- Added0019 immutable creation command/atomic invite+exact scope+seal+request audit, all-five-prior-ledger guards rebuilt before replay. Added strict POST /api/v1/projects/:projectId/invites and metadata-only GET /api/v1/invites/creation/:requestId. New issuance default-OFF in every env and hard local-only; no creation/share UI or Guest exchange is claimed. See INVITE_ISSUANCE.md.
- Three modes/12 independent rights; random token/password, fixed salted scrypt, sanitized config and HMAC password commitment. Positive D1 changes plus exact candidate/token/verifier match required for one-time credential response; concurrent losers/replays never expose credentials. Lost-response Chromium retries same ID, recovers metadata and explicitly revokes. BETTER_AUTH_SECRET rotation breaks old POST commitment equality; renewed Owner uses recovery GET. No plaintext persistence.
- Main implemented/tested; gpt-6-luna/max reviewed read-only. Review prompted positive insert/winner proof, metadata replay while gate off, constant-time private comparisons and nested expiry409 mapping. Final current-source87 local Cloudflare groups,78 unit/61 integration(20.17s), Next build,14 reference Chromium(31.0s), strict typecheck/lint pass.0019 applied locally,20 commands; final hygiene in VERIFICATION. No remote/customer data/push/deploy or production flag enabled.
- Next: M2f/M2g later added local-only throttling/exchange backends. Guest login/gallery/actions UI and hosted resource acceptance remain open. Keep six Owner command namespaces and one-time-secret recovery; no automatic replacement after unknown result. All M1–M5/live/restore/runner/retention gates remain open.

## 2026-10-24 — M2c Guest credential primitives/self-logout (historical)

- Final formatting,29-file handoff checker and diff check passed; only existing CRLF notices. All actual checks complete, no running test session or new UI/screenshot claim. Next issuer/throttle/exchange scope remains open.
- Added fixed native scrypt N32768/r8/p3 verifier, bounded exact Unicode/no trim, random salt/bearers and domain-separated token hash; unsupported/native failure never downgrades. No deployable KDF/issuance/exchange caller. Added0018 strict NEW verifier guard and Guest self-logout command/proof/atomic request audit, preserved historical rows. Read GUEST_CREDENTIALS.md before continuation.
- POST /api/guest/logout requires same-origin strict JSON and targets only cookie-owned session; accepts expired/Owner-disabled self-withdrawal. Success confirms revocation then clears only Guest HttpOnly cookie; failures retain proof for retry. Unknown cookie200 without writes; conflicting same Guest/request across sessions409. Real Chromium drops a committed response then retries and preserves Owner login. No Guest UI was added.
- Main implemented/tested; gpt-6-luna/max reviewed read-only and found SQLite NUL length gap. Added explicit NUL rejection; main also hardened JS final-newline/exact lengths. Actual78 unit,81 final local Cloudflare groups,61 integration(18.92s), Next build,14 reference Chromium(25.2s), strict typecheck/lint pass.0018 applied local only,9 commands. Non-loopback HTTPS fixture was rejected by Miniflare proxy; corrected to loopback HTTPS without application CSRF changes, final pass. KDF marker absent in actual deployable Worker/UI artifacts. Final hygiene in VERIFICATION. No remote data/push/deploy/flag changes.
- Next: M2d/M2f/M2g later added local-only issuance/throttling/exchange backends. Guest UI/private gallery/actions and hosted KDF/concurrency validation remain open. Local scrypt wall timing is not Worker CPU acceptance. Never persist/recover plaintext to fix a lost response or clear revocations on rollback. All M1–M5/live/restore/runner/retention gates remain open.

## 2026-10-24 — M2b Owner invitation inspection/revocation (historical)

- Final current-source75-group harness passed including extra-field/body-size/current-other-session/expired-session checks;74 unit/61 integration/14 reference Chromium/build and final strict types/lint/format/29-file docs/diff all pass. Both375px screenshots viewed. See VERIFICATION for local fixture boundaries; no remote/deploy acceptance.
- Implemented0017 immutable invite_revocation_commands, atomic command/revocation/share.revoked client-request audit and all-four-ledger symmetric namespace guards before local replay. Existing0016 revocations/audit preserved exactly. Owner list24/keyset and strict same-origin confirmed revoke APIs plus real project UI, disabled confirmation, refresh/paging and same-ID lost-success retry. Immediate Guest denial, no photo/session/history deletion. Read OWNER_INVITATIONS.md for contract/trust/recovery.
- Actual75 local Cloudflare groups pass including new real D1/Chromium375px acceptance and populated0016 upgrade;74 unit/61 integration(20.98s),14 reference Chromium(31.7s), Next build, strict typecheck/lint pass. Final service/negative-case/hygiene checks in VERIFICATION.0017 applied local only,16 commands; no remote data/push/deploy or flag changes. Main implemented/tested; gpt-6-luna/max reviewed read-only. Initial lint caught render Date.now; replaced with truthful scope-sealed status and explicit UTC expiry. Python SQLite cannot parse older dynamic RAISE; used statement segmentation only, actual migration verified in workerd/D1. Reviewer prompted unknown-result503 and authorized-workspace indexed filtering fixes; no remaining confirmed ACL finding.
- Next: Owner invite create/secret-delivery and request replay design, validated salted KDF/workerd cost, invite/IP throttling and Guest exchange/logout; then private Guest gallery/actions/history/round limits. New distinct revoke after prior revocation409; exact request replay200 under current authorization including archived parent. Do not remove canonical guards or clear immutable ledger/revocations on rollback. Full M1–M5 and all live/restore/runner gates remain open.

## 2026-10-24 — M2a Guest authorization foundation (historical)

- Final whole-repo formatting,29-file handoff checker and diff check passed; only existing CRLF notices. No new Guest UI or screenshot; existing Owner/reference browser regression passed. See VERIFICATION for actual command evidence.
- Added additive0016 immutable invite/album scope/identity/session/revocation model, hashes only, twelve independent rights, current-Owner issuance guards and atomic audit/session max-use checks. Added D1 read-only ACL and GET /api/guest/albums/:albumId/access outside Owner middleware; it grants no photo/download/action API. No public issuer/exchange/logout or UI is claimed. See GUEST_ACCESS_FOUNDATION.md for exact contract, trust boundary and recovery.
- Main implemented; gpt-6-luna/max performed read-only design/security review without editing/testing. Review found scope widening before first redemption and missing revocation witness; immutable sealing/exact-scope audit and matching hash guard fix both, statically rechecked. Actual74 unit,61 integration(19.40s),70 local Cloudflare groups,14 reference Chromium(22.7s), Next build, strict typecheck and lint passed.0016 applied to operational local D1 successfully(36 commands), populated upgrade/FKs preserved. Final hygiene in VERIFICATION. No remote/customer data, push/deploy or safety flag changes.
- Next: Owner invitation lifecycle with shared actor/request namespace and safe secret/lost-response design; validated salted password KDF + measured workerd runtime, invite/IP throttling, exchange/logout with Secure/HttpOnly/SameSite cookie; then Guest private gallery and action/history/round guards. Do not use read snapshots as write authority. M2 and full M1–M5 remain open; all prior live/restore/processing/upload gates remain.

## 2026-10-24 — CF-03c5 bounded upload reload recovery (historical)

- Final checks completed:62 local Cloudflare groups,70 unit,61 integration,14 reference Chromium, Next build, strict typecheck/lint/format,29-file handoff checker and diff check passed. Restored375px upload screenshot was visually inspected. Live credentials/deployment remain unverified.
- Implemented actor/full-scope versioned20-item/64KiB journal and read-only recovery by original init ID. Only metadata/workflow IDs/dimensions are persisted; no image/File/preview/signed URL/cookie/credentials.7-day window is since last metadata write; physical expired records need explicit local clearing, not silent deletion. Storage failure blocks new mutations. No new migration;0015 remains latest.
- Real UI restores work, reads canonical server status first, resolves completed/expired/review without a file, and requires explicit reselection/hash/type/size/dimension/name match for PUT. Pending cancellation is preserved and its recovery does not complete the photo. Confirmed terminal entries leave the journal. Existing authorization cannot be renewed after expiry; UI states cancel/resolve before explicitly creating another work item. This is not multipart or byte-range resume.
- Full-scope Web Lock prevents competing tabs, collapse releases it, generation/scope guards stop stale callbacks. Browser mutation headers bind the intent to the checked actor; Worker rejects actor mismatch403 before any write. No header goes to R2. Main implemented all files; gpt-6-luna/max read-only reviewer identified/rechecked lifecycle and actor races, durable-ID/secret handling and expiry semantics. Reviewer did not run tests.
- Actual70 unit tests pass including new journal scope/size/duplicate IDs/expiry/unknown secret fields. Actual62 Cloudflare groups pass: no-side-effect scoped recovery API, expected-actor rejection, Chromium reload after lost init/PUT/completion, valid same-size PNG hash mismatch, one original/quota conversion/event, second-tab exclusion, storage failure, corrupt-local-record clearing without server changes, expiry reconciliation and delayed-init collapse/reopen with no stale follow-up mutations. Current complete regressions and screenshots recorded in VERIFICATION.
- Initial strict/lint check found a cleanup-ref warning; captured generation invalidation fixes it without suppression. Existing standalone localhost/browser S3 bridge limitations remain; no actual external provider or paid resource acceptance. All prior worktrees/dirty changes/original attachment preserved; no commit/push/deploy or flag enablement.
- Next: M2 D1 invitation/guest-session vertical slice, link/password/expiry/revocation, independent view/select/rate/favorite/tag/annotate/comment/download rights, scoped private gallery and cross-project denial. Preserve all full M1–M5 requirements. Multipart/auth renewal/server pending-work discovery, CF-02 parity/import, fresh provider link/unlink, occupied-output reconciliation, production runner/live/backup gates remain open. Read UPLOAD_RECOVERY plus Guest/Auth/Security specs before work.

## 2026-10-24 — CF-03c4b confirmed review abandonment (historical)

- Final verification passed:61 Cloudflare,65 unit,61 integration,14 reference Chromium(25.7s), Next build, strict typecheck/lint/format,29-file docs checker and diff check. Confirmation and abandoned mobile screenshots in apps/worker/.local were visually inspected. These are actual local fixtures, not external provider/production acceptance.
- Implemented0015 terminal abandoned/reserved0 plus immutable Owner/session/request command ledger, symmetric global request conflicts and atomic workspace/node release plus append-only user audit. Both fixed derivative keys must be permanently fenced first. Original/used bytes are untouched; occupied/unknown/readonly state retains capacity. Local migration applied53 commands; no remote/customer data.
- Real UI first inspects Dry Run, requires unchecked explicit confirmation and refreshes to abandoned after success. Unknown/lost successful responses retry the same operation ID/epoch. GET inspection preserves pending intent. Reload-resume is still pending. Exact committed replay tolerates archived parents while new mutations require active scope. Read PROCESSING_REVIEW.md before any processing/storage change.
- Main owns all changes. gpt-6-luna/max read-only reviewer identified archived replay and split-trigger auth ordering, then confirmed their fixes and no new concrete blocker; it ran no tests. Initial checksum-string concern was withdrawn after checking Workers binding semantics; raw digest buffers are now used for consistency, not a claimed hex bug.
- Actual61 Cloudflare groups pass, including exact populated job/slot/quota/audit migration snapshots and FK check, no-command transition rejection, audit rollback, exact concurrent retries, occupied partial-fence preservation, readonly denial, global namespace/current-session SQL checks and375px lost-response browser retry. Initial parent-only rebuild failed in local populated D1; fixed by copying/dropping child before parent. Initial legacy browser assertion expected no release button, then a network error surfaced raw Failed to fetch; confirmation acceptance and actionable retry message now pass. Two direct harness invocations used wrong cwd; no fixture/schema change came from the failed edit, corrected scoped runs passed.
- Recovery:0015 is forward-only. Do not roll back to pre0015 writer/UI after abandonment; old status schemas and command guards are incompatible. Stop runners/writes, retain both permanent fences forever and all immutable assets/commands/audit/counters. Forward repair or verified consistent DB/R2 restoration only. Full remote representative restore remains a release gate.
- Next: upload reload-resume with bounded persisted metadata/stable operation IDs and explicit file reselection/hash verification; then guest/picking. Occupied-output reconciliation, production processing, fresh auth link/unlink, CF-02 parity/import and all live/restore/M1–M5 gates remain open. Automatic deletion/cross-account/direct-upload flags remain OFF, retention dry-run ON. No commit/push/deploy; prior work/attachment preserved.

## 2026-10-24 — CF-03c4a review dry-run and fence prerequisites (historical)

- Final mobile/primary-scope rerun:60 Cloudflare,65 unit,61 integration,14 reference Chromium(24.9s), strict typecheck and Next build passed. Final review screenshot was visually checked after widening the review tile. No new schema/migration or persistent bucket mutation. Final hygiene results in VERIFICATION.
- Added actual Owner-only photo/version processing-review GET and gallery inspection UI. D1 derives two fixed output keys, private R2 reports missing/fenced/occupied/unknown, and the query rechecks current authorization and job epoch after storage reads. No keys or credentials returned; preview changes no objects/audit/job/quota. Potential release is advisory, not a permission or guarantee.
- Added trusted conditional two-key fence helper, currently invoked only by disposable local tests. Empty checksum/MIME/job/kind readback is required. Occupied/unknown keys retain all16MiB; partial fences remain permanent; never delete them through lifecycle/cleanup. It is not connected to a public mutation, local CLI or Cron.
- Main implemented all files; gpt-6-luna/max read-only agent reviewed the design and recommended an explicit abandoned terminal state plus atomic resolution ledger. Its subsequent source-review turn failed due to usage limit, so that review is not counted as complete. Main ran actual integrated checks. Existing worktrees/changes and original attachment preserved; no commit/push/deploy.
- Actual pnpm test:cloudflare passed60 local groups, including unchanged quota/job/audit/object inventory after GET, auth/scope/private response, forged/occupied/unknown states, ambiguous PUT adoption, stale late PUT rejection, native-runner race after lease assertion and375px actual preview UI. Initial new browser test omitted the harness route and got connection refused; corrected it to route through actual workerd. One formatter command initially used repo-root paths from worker cwd and matched no files; root-scoped rerun corrected that. No app failure is hidden.
- No new migration or real bucket writes;0014 remains latest. Native source decoding, original retention and all flags remain unchanged. Next: implement forward terminal-state rebuild and immutable Owner-confirmed request ledger before capacity release. Read PROCESSING_REVIEW.md for invariants, migration tests and recovery. Reload-resume/guest/full M1–M5 and all live/restore/deploy gates remain open.

## 當前專案狀態

- Repo：本文件所在專案根目錄；產品正式命名 KINO Pic。
- Branch：`codex/kino-pic-foundation`；基礎提交見 `git log -1`，若尚無 log 則仍為待提交檔案。
- Last agent：Codex；Last updated：2026-10-24（Asia/Taipei）。
- Current phase: CF-03c5 adds bounded upload reload recovery; CF-03c4b adds confirmed abandoned/fencing/atomic release; M0 complete; CF-03c3 locally integrates trusted native D1/R2 processing and private Owner Grid/Lightbox. Full M1–M5, CF-02 parity/import, production runner and live/restore gates remain open.
- Worktree ownership: gpt-6-luna/max workers completed scoped files in .local/worktrees/cf03c-durable-runner and cf03c-private-gallery; three files integrated after editing stopped. Third agent reviewed SQL/API/cache read-only. Main owns migration/repositories/CLI/API/tests/docs. Older worktrees and original attachment remain preserved; official-site repo is separate.
- Next smallest Task: M2 D1 invitation/guest-session + independent permissions + cross-project deny vertical slice; retain upload renewal/multipart/pending-discovery and occupied-output reconciliation gates. Read PROCESSING_PIPELINE.md and STORAGE_RETENTION first; no destructive cleanup or production flag enablement. Retain CF-02 parity/import/runner/live/restore gates.
- Next command：`pnpm test:cloudflare`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`python tools/check_handoff.py`、`git diff --check`。

## 2026-10-24 — CF-03c3 durable processing and private Owner gallery (latest)

- Integrated the existing real native decoder with D1/R2 via a finite explicit local runner. Migration0013 enqueues new original/job/slots/audit in the same completion transaction; no legacy backfill or immutable source changes. Claim reserves16MiB against workspace and primary node. Token/epoch leases use D1 time and retain budgets across expiry/retry/review; fixed create-once output keys prevent attempt orphans. Complete verifies both readbacks and atomically commits private assets, actual used bytes and append-only audit. See PROCESSING_PIPELINE.md.
- Added Owner-only24-row keyset photo query and exact successful-job thumbnail/preview gateway. Every read checks current session/Owner/scope and gateway validates R2 size/MIME/provider checksum; no original or R2 key/credential is returned. Grid has real refresh/load-more, processing/review tiles and Lightbox with Escape/arrows/focus trap/return. No guest/selection/rating/download/valid-view heartbeat is implied. Version1 projection only until M3 current-version semantics.
- Actual final checks passed:65 unit,61 integration,54 local Cloudflare groups,14 reference Chromium E2E(26.2s), lint/typecheck/Next build. Native pipeline cases exercise true workerd/D1/R2 plus Sharp, enqueue/claim/final audit rollback, concurrent budgets, lost PUT/adoption, lease takeover/Owner disable, corrupt raster review, private gateway denial and25-photo paging.375px Grid/Lightbox screenshots in apps/worker/.local were viewed; keyboard/focus/no-overflow checks passed. Synthetic OAuth/intercepted S3 are not live cloud evidence.
- Local migration command applied0013 successfully(15 commands) and forward repair0014(5 commands), no --remote. `pnpm image:process:pending:local --run 1` returned no_pending_jobs through local bindings; this is a CLI connection smoke, while full actual processing was proved in isolated harness. The CLI fixes config/state to local, sets remoteBindings:false and returns nonzero for failed/review outcomes. Native Sharp remains outside Worker/browser entry imports; no paid service/binding or credentials added.
- Initial unit event-order expectations needed updating after early lease assertions; tests now check required safety ordering rather than exact call counts. Initial typecheck found an unchecked test-array index; explicit fixture narrowing fixed it. Initial lint rejected render-time refs/effect-driven synchronous state; keyed state and asynchronous subscriptions fixed it without disabling rules. All integrated reruns passed. Worktree-only tests initially lacked parent uncommitted dependencies; main executed real integrated checks.
- Independent review found missing /assets/* could receive SPA HTML cached immutable for a year. Fixed immutable policy to require actual fingerprinted JS/CSS,200 and correct MIME; missing/HTML asset paths return404/no-store. Actual bundle/missing/hash-looking-path tests pass and reviewer rechecked resolution. Reviewer found no further confirmed auth/checksum/lease/quota/audit issue; this is not a full production audit.
- Earlier automatic approval review failed because its usage allowance was exhausted, so the requested test did not execute. After the stated reset time passed, the same authorized test was reapproved and ran successfully. No approval check was bypassed. The unavailable interval is not test evidence or a safety rejection.
- Recovery: stop runners before code rollback; retain0013/0014 schema/jobs/assets/audit and held reservations, repair forward or restore a separately verified consistent DB/R2 snapshot. An older bundle can still enqueue through triggers but must not clear counters. No down migration, remote/customer data change, push or deployment. Latest local snapshot is discoverable via git log/status; original docs/docsCODEX_ARCHITECTURE_ADDENDUM.md remains untouched.
- Pending: review fencing/remediation, reload-resume/multipart, production processing runner, CF-02 parity/import, fresh link/unlink/session controls, true OAuth/R2/CORS/HTTPS/backup restore/CI and M2–M5 guest/picking/version/delivery/retention. Upload/multi-account/autodelete flags remain OFF and retention dry-run ON. Current build measurements and final hygiene checks are in VERIFICATION.

- Forward migration0014 fixes archive busy guards that incorrectly rejected historical replay after restore/new work, and scopes checks to current Owner/session. Real D1 regression verifies preserved snapshot, unchanged current revision/state, invalid-session denial, conflicting request payload rejection and new busy command denial. First test fixture used POST instead of PATCH and was corrected; the subsequent409 exposed the actual guard bug. Local0014 applied successfully(5 commands), no remote data change.

## 2026-10-23 — CF-03c2 local trusted native processing (historical)

- Final frozen install/format/document checker(29 required specs)/diff/lint/typecheck passed; production dependency audit reported0 vulnerabilities. Native processor markers were absent from actual Worker/UI build artifacts. Main full typecheck resolves the isolated worker's missing-workspace/global-type limitation. Detailed evidence remains in VERIFICATION.

- Main agent planned/integrated; three explicitly configured `gpt-6-luna`/`max` agents handled decoder implementation in an isolated worktree, read-only job/quota design and independent security review. Decoder's three new files were copied only after it stopped editing. No commit, push or deployment; all older dirty work preserved.
- Added `ImageProcessingAdapter`, strict local metadata/manifest schemas, `packages/image-processing` and `pnpm image:process:local`. Node24/sharp0.35.5 performs real full decode before deriving stripped JPEG thumbnail<=320/preview<=2048. Source UUID/hash/size/MIME/raw dimensions are verified; input64MiB,32768/side,80M pixels,8MiB/output,16MiB total. Reject decoder warnings and animated/multiple-image inputs; normalize EXIF direction/sRGB/white alpha background. Reopen/full-decode output bytes and hash them. Snapshots prevent caller mutation across awaits.
- CLI uses bounded local reads and creates scoped intent/artifacts/manifest in an operator-selected local directory. Unique staging files are flushed before atomic create-only hard-link publication. Manifest publishes last; identical retries reuse bytes, conflicting/corrupt finals and foreign links reject. Interrupted partial staging files are retained for operator review; recognized exact inode publication links can be recovered. Hostile local filesystem races and cross-file/filesystem backup durability are not claimed.
- Independent review found direct final-file writes could leave truncated finals after interruption. Fixed staged publication and added deterministic partial-write failure/retry evidence. Review then found simultaneous cleanup could throw ENOENT; idempotent staging cleanup plus12 concurrent publishers fixes it. Reviewer confirmed both findings resolved and no further proven writer issue; reviewer did not run tests, main did.
- Actual checks:56 unit,61 integration,44 local Cloudflare groups,14 reference Chromium E2E(22.9s), full typecheck/lint/Next build passed. Native tests cover real JPEG/PNG/WebP, expected-metadata rejection, metadata-only fake PNG, orientation/stripping, animation, output bounds and mutation snapshots. Real subprocess CLI decodes/reopens local persisted files, checks retry/conflict and sanitized failures. Writer tests cover hash/identity, corruption, junction/hardlink, interrupted staging, concurrent publishers and snapshots. Final formatting/document/diff and dependency audit are recorded in VERIFICATION.
- No new D1 migration or schema change;0012 stays latest. No DB recovery required for this code-only adapter increment; retain generated local files on rollback and preserve existing migration/audit/quota history. No remote/customer data or credentials were used. Native package is not imported into Worker/browser bundles; no new paid service/binding.
- Local manifests are not client processing proof. Worker upload completion remains header-only; the adapter is not yet connected to trusted D1/R2 jobs. No R2 derivative/quota write or gallery was added. Next: implement D1 outbox/output slots/lease+epoch, atomic workspace/node reservation before writes, fixed create-once output keys, unknown-outcome reservation retention and transactional asset/audit/usage completion. Then private paginated gallery/lightbox. See LOCAL_IMAGE_PROCESSING.md; existing unique version/asset-kind requires an explicit generation design before changing a successful recipe.
- Remaining full-scope work: actual processing integration, reload-resume/multipart, CF-02 parity/import, live OAuth/R2/CORS/HTTPS/backup restore/CI and all guest/picking/version/delivery/retention milestones. Upload/multi-account/autodelete stay OFF, retention dry-run ON. Nothing here proves production readiness.

## 2026-10-23 — Phase 0

- 盤點：使用者指定目錄原只有 ZIP 與合併規格，沒有 Git / app / 遠端。開啟的 KINO 官網是另一個有 dirty changes 的 repo，未對它寫入。
- 按使用者指定位置展開規格於同一目錄，初始化 Git，保留原始附件（不納入活躍 source），全數活躍文件改名 KINO Pic。無遠端、無推送、無部署。
- Task IDs finished：M0-01～M0-04（僅初始 foundation 範圍，詳 TASKS）。
- Files：apps/web、apps/worker 預留說明、packages/domain/contracts/storage/db/ui、tests、tools/migrate.mjs、pnpm / lint / strict TS / formatter / Playwright / CI、env 範本與文件。
- Core interfaces：StorageAdapter、StorageQuotaService、RetentionPolicyEngine、AuditEventWriter、VersionMatcher、ImageDiffService。僅 memory storage 有本機實作，其他服務未實作。Retention interface 只提供規劃，沒有破壞性執行入口。
- DB：202610230001，profiles/workspaces/workspace_members/projects/albums/photos；read-only tenant RLS、跨租戶 composite FK、retention OFF/dry-run constraints。完整後續 schema 未建立；沒有版本、guest、審計事件資料表，勿宣稱已完成。
- Recovery：migration runner 使用 transaction/advisory lock/checksum；備份/forward fix/還原程序見 packages/db/README.md。沒有連接或變更真實 Supabase。
- API：只有 `/api/health` 存活與 env 驗證；不會探測 OAuth/DB/R2。錯誤設定回 503；非正式 readiness。
- UI：只有實際 Phase 0 狀態頁與 health link，沒有假 project/gallery 或無效功能按鈕。

## Commands actually executed

| Command                            | Result             | Evidence / scope                                                                                             |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| pnpm install                       | passed             | lockfile + explicit allowBuilds；Node 24.18.0 / pnpm 11.25.0                                                 |
| pnpm lint                          | passed             | 0 errors/warnings after config correction                                                                    |
| pnpm typecheck                     | passed             | root packages + Next.js strict TS                                                                            |
| pnpm test:unit                     | passed             | 9 tests: env safe defaults/rejections, scope isolation, immutable bytes/keys, idempotent delete              |
| pnpm test:integration              | passed             | 1 embedded PostgreSQL test: migration execution, tenant RLS, anon/write deny, FK isolation, suspended member |
| pnpm build                         | passed             | Next.js 16.4.2 optimized local build, `/` and `/api/health`                                                  |
| pnpm test:e2e                      | passed             | 1 Chromium test: real local server, status UI, health link/API/headers, 375px no horizontal overflow         |
| pnpm dev --port 3102               | passed             | server ready; GET / and /api/health returned 200; stopped after smoke test                                   |
| pnpm audit --prod --json           | passed             | 0 reported info/low/moderate/high/critical; local report .local/audit.json                                   |
| pnpm db:migrate (no DATABASE_URL)  | expected rejection | exit 1 before connection, no database changed                                                                |
| real Supabase runner / RLS         | not_checked        | no DB URL, psql or Docker in this environment                                                                |
| real Google OAuth + private R2 E2E | not_checked        | credentials not supplied; M1/M5 release gates remain                                                         |
| GitHub CI                          | not_checked        | workflow defined locally; no remote/push                                                                     |

Final format/document checks recorded in docs/VERIFICATION.md. Screenshots `.local/phase0-desktop.png` and `.local/phase0-mobile.png` are local QA outputs, ignored by Git.

## Problems / risks / next task

- Initial install rejected unapproved native builds; resolved with pnpm 11 allowBuilds for explicit dependencies only. Initial TS7/ESLint10 failed compatibility; pinned TS6 and ESLint9. Initial lint accidentally scanned generated .next; fixed global ignores. Generated next-env.d.ts excluded from formatting. No failed check is being represented as a pass.
- ESLint 9.39.5 is registry-deprecated/unsupported; upstream Next plugin compatibility needs revisiting before release. See ADR-0002.
- No credentials were created or requested. Production adapters, Auth, API mutations, workspace provisioning, event transaction/idempotency, quota/retention algorithms and full gallery remain unimplemented.
- Safe retention defaults are enforced, but actual owner opt-in preview, locks/rechecks/retries/audit need future implementation. Do not enable autodeletion.
- Embedded PostgreSQL with auth shims is not hosted Supabase validation. Before M1 acceptance, test real authenticated claims, roles, provisioning and tenant isolation in disposable local/staging Supabase.
- Next M1-01：Supabase SSR Google OAuth callback + transactional workspace creation/role writes with API authorization and real RLS negative tests. Read AGENTS, SECURITY, STORAGE_RETENTION, DATA_MODEL and TEST_ACCEPTANCE first.

## Portability follow-up

- `next typegen` precedes web typecheck; next-env.d.ts is generated/ignored. Migration checksum normalizes CRLF to LF for cross-platform replay. Clean checkout verification is recorded in VERIFICATION.

## 2026-10-23 — M1-01 本機身分與 workspace

- 實作 Supabase SSR Google PKCE、getUser 驗證、Google identity、HttpOnly/Lax cookie、固定 callback、canonical Origin/Fetch Metadata CSRF 防護。AUTH_DRIVER 預設 disabled；fixture 只在 tests。
- Workspace 建立、24 筆 cursor 分頁、owner 成員角色 API；migration 202610230002 建立管理 audit_logs 與私有重送 ledger。RPC 在同交易寫入資料/審計/去重；audit 拒絕修改/刪除，角色停用即失去 RLS 可見性。
- API 限制真實串流 body 16KiB、嚴格 Zod、generic errors、private/no-store。登入/工作台為真實 API，沒有假專案/照片功能。
- 已執行通過：typecheck、lint、17 unit、6 integration、build、4 Playwright、format:check、check_handoff.py（24 files）、production dependency audit（0）。完整結果見 VERIFICATION。
- 修正測試中發現的 native form Origin:null（僅可信 same-origin Fetch Metadata 允許）、route announcer locator、fixture 第二個 actor 切換及微秒 cursor。桌面/375px 截圖已檢視，存放 .local/m1-dashboard-*.png。
- 真實 Google/Supabase/PostgREST、PG 多連線鎖競態、R2 仍 not_checked。PGlite/auth fixture 不是雲端 E2E，沒有部署或推送。
- Schema recovery：見 packages/db/README.md；撤銷 RPC EXECUTE 以停止 mutation、備份後 forward fix，保留 audit/ledger，禁止直接刪表回滾。
- 未完成：team 管理 UI、專案/相簿、R2 上傳、完整 photo/guest activity_events、quota/retention 執行。自動刪除持續 OFF/dry-run。
- 使用者要求優先高難度：下一切片先建立 DB 授權與交易不變量、重送一致性、樂觀鎖及負面測試，再交付可操作 API/UI。完整功能清單不省略。

## 2026-10-23 — M1-02 子集合與高難度修正（最新）

- 使用者要求優先處理高難度問題、授權子智慧體平行工作。DB 與 Web 各自在獨立 worktree 提交，再由主代理 cherry-pick 整合。功能提交 e68dfa8 / 69cdf6b / 875ea0b / 2e35302；整合回歸提交見 git log -1。
- 可實際操作：登入後工作空間 → 專案建立/分頁/改名 → 相簿建立/分頁/改名，重新載入保留資料。retoucher 僅讀，owner/editor/photographer 管理內容。沒有照片或上傳假按鈕。
- 高難度保障：固定 request→workspace→resource 鎖順序；角色檢查先於重送；tenant/parent 不可變；expectedRevision 防止遺失更新；資料/審計/ledger 同交易。撤權後同一成功請求重送也拒絕。
- Migration 0003：審計 TRUNCATE 防誤清、首次 provisioning NO KEY UPDATE；0004：revision/parent guards、四項內容 RPC；0005：workspace Unicode trim/code-point 長度與 API 一致。皆為 additive/forward fix，沒有刪資料；復原及撤銷寫入權限指引見 packages/db/README.md。歷史異常名稱沒有自動改寫。
- 新測試涵蓋：撤權兩次讀取快照、audit failure rollback、歷史重送不還原新狀態、跨租戶/唯讀/停權、stale revision、不可變父項、Unicode 邊界、cursor 微秒與 24+2 分頁。瀏覽器驗證同時改名、409 草稿保留/重載、編輯中撤權、提交後遺失回應再重試無重複/額外 revision。
- Session fixture 改為 session_id/token family 關聯；過期多段 cookie refresh、兩個同時請求、HttpOnly 寫回、登出舊/新 cookie 重放皆通過。十秒 refresh reuse 僅測試子集合，不是完整 GoTrue。
- 已實際執行並通過：pnpm lint、typecheck、27 unit、21 integration、build、7 Playwright。production audit 0；報告 .local/m1-projects-audit.json。桌面/375px 相簿畫面已檢視，.local/m1-project-desktop.png 與 m1-project-mobile.png。
- 真實 Google/Supabase/PostgREST、實際 PG 多連線鎖等待/死鎖壓測、R2、CI/部署仍 not_checked。瀏覽器同時 HTTP 請求進入序列化 PGlite，只驗證 API/CAS 結果，不證明真實 PostgreSQL contention。
- 未完成：封存/狀態/保護控制、team UI、照片/上傳/版本/guest/完整 activity_events/配額/retention job。自動刪除仍 OFF、dry-run ON；完整 M1-02/M1–M5 不勾完成。ESLint9 上游支援風險保留。
- 下一個最小任務：先設計專案/相簿狀態轉換與保護的 transactional invariants，再 API/UI/負面測試；之後 M1-03 預留配額與 private immutable upload。工作皆本機提交，未推送或部署。

- 收尾檢查：frozen install 通過；首次 format:check 指出 sessions.spec.ts 格式差異，已格式化後重跑。最終結果見下列命令輸出及 VERIFICATION。

- 最終收尾通過：pnpm install --frozen-lockfile、pnpm format:check、python tools/check_handoff.py（24 files）、git diff --check。

## 2026-10-23 — Google / GitHub 單一或雙來源同身分（最新）

- 使用者明確確認：同一帳號可只綁一個來源，或綁兩個來源作同一身分。保留 Next/Supabase 現有 stack，以原 user.id 連 workspace/profile/role；不在應用比對 Email 合併不同平台 user。
- Web 子代理在獨立 oauth-web worktree 完成登入/綁定介面與回呼（整合提交 1847e0d）；主代理完成 contracts、migration0006、repo、fixture、單元/SQL/瀏覽器測試及文件。oauth-backend worktree 保留空白基線。無遠端推送/部署。
- 功能：Google/GitHub 登入 allowlist；工作台 → 帳號與登入方式；已登入者新增另一來源、雙來源重登入保留同一 ID/原 workspace。來源未設定不顯示按鈕，manual linking 預設 OFF，須 app/Supabase 同時開啟。沒有解除綁定/合併兩個既有 platform users 的入口。
- 安全：SDK PKCE；短效 intent 以 256-bit raw token 放 HttpOnly/Lax cookie、DB 只存 SHA256，10 分鐘、同 actor、最多五筆 pending；交換前後 verified getUser/user.id 與 provider 檢查；另個既有帳號綁定衝突拒絕。正常登入 URL 限 Supabase，manual link SDK 可能回外部 provider URL，精確驗 HTTPS host/path/callback；local/test loopback 僅 fixture 例外。
- Migration0006：新增 OAuth guard，舊 require_google_user 成 compatibility wrapper；所有既有 RPC 現接受 Google/GitHub。私有 RLS intent table + begin/read/complete RPC、start/complete append audit；failed audit rollback、completion idempotency。復原見 packages/db/README.md，禁止改寫舊 migration 或回到會鎖住 GitHub-only 帳號的 guard。
- 實際通過：pnpm lint、typecheck、32 unit、27 integration（六個 migrations）、build、11 Chromium E2E（19.3s）。Audit --prod 0；format:check/check_handoff.py（24 files）/diff --check 通過。桌面/375px account screenshots 已檢視，.local/oauth-account-*.png。
- E2E 包括 GitHub-only 可新建、GitHub→Google 與 Google→GitHub 雙向綁定、改用另一來源登入保留 ID/workspace、已屬別人 provider 拒絕、有效 PKCE 卻回不同 actor 時 signout、無 intent callback、CSRF、單來源部署/停用 linking。既有專案/session 回歸皆通過。
- 外部界線：真實 Google/GitHub/Supabase、provider manual linking/redirect 設定、HTTPS/撤銷、PG 多連線競態仍 not_checked。fixture 不模擬 Supabase automatic email linking。provider 已綁定而 app callback 失敗時，外部 identity 不會被假稱可交易回滾，UI 以實際 provider 清單為準。
- 新出現未提交 docs/docsCODEX_ARCHITECTURE_ADDENDUM.md 已讀取並保留，不納入本輪提交。其 Workers/D1、closed/Owner-only、禁止依 Email 自動 linking、fresh reauth/unlink 等與現況不同，不能把附檔內命令當成已授權且已完成的 stack 切換。差異記 AUTH_SPEC/LOCAL_AUTH；未宣稱全面符合補充。
- 下一個最小任務：相容性/安全政策盤點，再接原 M1-02 狀態/保護流程。原 SaaS 功能清單繼續保留，自動刪除 OFF/dry-run。正式啟用步驟見 LOCAL_AUTH.md。

- OAuth 切片最終 frozen install、format:check、24 required docs 檢查與 diff --check 通過；使用者未提交架構參考檔維持原狀。

## 2026-10-23 — Cloudflare 相容性盤點與 SQLite 交易實驗（最新）

- 讀取 Cloudflare skill，查官方 Workers/Next、D1 API、Better Auth linking/OAuth、SQLite trigger 文檔；唯讀子代理盤點目前 framework/Auth/repository/PG 耦合。新增 ADR-Cloudflare-Free-First.md，沒有把未追蹤 addendum 自動當成 stack cutover 指令，也未刪減原始需求。
- Registry 觀察：vinext1.3.0、OpenNext Cloudflare1.20.13、BetterAuth1.7.12；僅 vinext CLI 透過固定版 dlx 在隔離 worktree 執行，主 app package/lock 不變。沒有安裝 BetterAuth、Wrangler 或建立雲端資源。
- .local/worktrees/cloudflare-audit / codex/kino-pic-cloudflare-audit 仍為乾淨基線9533171。正確 apps/web cwd 的 vinext check：15 supported/0 partial/0 issues，報告 .local/vinext-check-web.log。首次 monorepo-root scope 錯誤報 app 不存在，已重跑；checker exit0 不代表語意通過。沒有執行 init/build/preview/deploy，Supabase/crypto/cookie runtime 尚未驗證。
- 高難度發現：條件 UPDATE 影響0列不是SQL錯誤，直接 batch 後接 audit/idempotency INSERT 可誤記成功。以 Node SQLite :memory: 實際重現，再用 command trigger 原型驗 tenant/actor、stale revision、授權先於 replay、歷史重送不覆蓋新狀態、audit/write失敗完整回滾。八項新測試通過。
- 實驗檔 experiments/sqlite-portability/schema.sql 只由新 integration test 載入記憶體，**不是應用 migration 或 D1 adapter**。不驗 OAuth/完整角色/RLS，也不限制有 DB binding 者發任意 SQL。結束 connection 即丟棄實驗資料；未修改正式 schema，沒有 schema restore 要執行。沒有假 D1/Worker 測試宣稱。
- 通過：pnpm lint、typecheck、32 unit、35 integration、build。App runtime 未改，既有11個browser測試本輪未重跑，歷史證據9533171保留；需要在下一個 workerd PoC 真正重跑才可聲稱hosting相容。格式/文件收尾見 VERIFICATION。
- 既有六個 PG migrations、Auth/providers/workspace/UI 不變；自動刪除 OFF/dry-run。未推送、未部署。使用者未追蹤 addendum 保留原狀且不納入本輪提交。
- 下一個最小任務：先在隔離 worktree 驗 vinext runtime/build+workerd cookie/PKCE/redirect；若通過才評估採用。Auth implicit-linking/closed/Owner/fresh reauth 與 D1 port 各自有獨立 gates；M1-02 狀態/保護與全部未完成產品需求仍在 TASKS。

## 2026-10-23 — Isolated workerd runtime PoC (latest)

- Isolated branch `codex/kino-pic-cloudflare-runtime`, worktree `.local/worktrees/cloudflare-runtime`, based on 4d20028. Actual vinext production build + Wrangler local workerd preview passed; default foundation app still uses Next/Supabase/PostgreSQL, with no experimental dependency/config changes merged. No cloud resources, push or deployment. Reproduction and pinned toolchain are in that branch's `experiments/cloudflare-runtime/README.md`.
- All existing 11 browser cases passed on workerd. Added direct expired/chunked-cookie dashboard navigation before any writable API, proving proxy cookie rotation, HttpOnly/Lax, no JS access, authenticated SSR and private/no-store. Same regression integrated to main (3b83975 plus follow-up); Next's complete 12 browser cases passed (18.9s). Auth fixture/PGlite are still test doubles, not actual providers/GoTrue/hosted PG.
- Important observed difference: Next replaces proxy Vary with its RSC header list; workerd retained Cookie. The initial shared Vary: Cookie assertion failed on Next; corrected to require private + no-store and actual session rotation. Do not claim Next preserves that proxy header or depend on Vary for private response security.
- Experimental setup failures were fixed: workerd native-build approval, pnpm generated duplicate policy placeholder, lint accidentally scanning dist output, and cp950 test-file write. Vite build still emits upstream sourcemap/dynamic import warnings and unknown static classification for `/`; successful local build is not production approval. Full commands/evidence/limits in VERIFICATION.
- No schema migration or data mutation outside ephemeral fixtures. Recovery: stop local preview and use unchanged default Next branch; no DB rollback required. User's untracked docsCODEX_ARCHITECTURE_ADDENDUM.md remains untouched/unstaged. Autodeletion OFF/dry-run.
- Remaining gates: real OAuth/Supabase/HTTPS, CDN/private caching, cloud startup/CPU/memory/bundle limits, genuine PG multi-connection contention, R2. D1/Better Auth/Owner-only/closed/manual-only policy adoption remains separate; original SaaS requirements retained. Next product task: M1-02 project/album state/protection transaction invariants before API/UI; hosting adoption can proceed only after its external gates.

- Final local evidence: isolated runtime commit **8845867**, clean experimental worktree; restricted-launcher workerd12browser passed21.1s. Main Next12browser passed18.9s; main lint/typecheck/32unit/35integration/build passed. Frozen install/format/docs/diff final checks recorded after execution. No push/deploy; user addendum remains untracked.

## 2026-10-23 — Owner-controlled album protection (latest)

- Complete a scoped vertical slice: migration0007 → strict contract/repository → PATCH /api/v1/albums/:id/protection → real owner UI → SQL/browser regressions. Reuses existing is_pinned/legal_hold; no table/data rewrite. Only current workspace owner may change flags; other active roles read only. Clearing either true flag needs explicit confirmation in API and UI.
- Request→workspace→album locks, current authorization before idempotent replay, shared revision CAS with rename, and flags/before-after audit/ledger in the same transaction. Old success retries return history without restoring current flags; changed payload conflicts. Audit failure rolls back flags/revision/ledger. New writes to deleting/deleted denied; archived can retain protection. Does not reset human-view clocks or change album/project state.
- Real local commands passed: pnpm lint/typecheck,33unit,42integration (seven PG migrations plus isolated SQLite probe), pnpm build,13Chromium E2E19.9s. UI desktop/375px screenshots inspected at .local/album-protection-*.png; no overflow. Final fixture/helper edits receive lint/type/format checks below.
- Tests cover non-owner direct API and revoked access, CSRF/scope override, explicit unprotect confirmation, conflict retains choices/reload/reconfirm, commit-response loss retry identical ID/body with one revision, parallel expectedRevision gives one200/one409, permission after owner loss, direct writes/unsupported/anon denial, audit failure retry, terminal deletion guard.
- Corrected failed attempts: initial SQL test referenced audit created_at instead of occurred_at (41passed/1failed); new browser test initially used common actor A and polluted existing 24+2 workspace expectation (12passed/1failed). Assigned isolated fixture actor E, then fixed its authorization-cookie selector allowlist; first E attempt correctly failed identity assertion. Full13passed after fixes; application Auth has no fixture bypass.
- Full E2E emitted three SDK warnings about invalid mixed chunked-cookie JSON during session tests; session rotation/concurrent refresh/logout-replay assertions passed. This is not claimed warning-free; a focused follow-up is recorded below. Actual Supabase/HTTPS/Secure-cookie/PG contention and R2 remain not_checked.
- Migration recovery: packages/db/README.md exact REVOKE signature, transactional migration failure recovery, forward fix/backup restore into separate DB. Preserve protection flags/audit/ledger; no hosted migration/restore run. Auto-delete stays OFF/dry-run; no retention executor/delete/archive/state transition functionality implied.
- User untracked architecture addendum remains untouched/unstaged. No dependency/stack change, no push/deploy. Full M1–M5 requirements still open. Next minimum task: define project/album archive/restore transition invariants and interaction with active review/upload/retention locks before exposing state controls; project protection and upload quota reservation follow separately.

- Focused follow-up: `pnpm exec playwright test sessions.spec.ts` passed2/2 (9.2s), no mixed-cookie warning observed in that run. This does not establish the full-suite warning cannot recur; retain real Supabase concurrent-refresh acceptance gate. Final lint/typecheck/frozen install/format:check/check_handoff.py24files/diff checks passed.

- Final formatting correction: adding fixture actor E changed a regex that Prettier wraps differently; initial final-format attempt failed. Formatted supabase-server.mjs, then actually reran format:check (passed), check_handoff.py24files (passed), and diff --check (passed). No behavior change. Feature commit f924195; formatting/document correction follows.

## 2026-10-23 — Reversible empty-content archive (latest)

- Delivered migration0008 → contract/repository → owner-only project/album archive API → confirmation/conflict/retry UI → SQL/browser regression. Only empty/idle content: project draft/delivered, album draft under draft/delivered parent. Store original state in nullable archived_from_status/archived_from_state and clear on restore. Existing archived rows keep null origin and fail closed rather than guess draft. No data backfill or physical deletion.
- Shared request→workspace→project/album locking, current owner authorization before replay, revision CAS and state/origin/audit/ledger transaction. Project archive freezes names/new albums; album archive freezes names. Parent must be restored before child transition; children are not cascaded. Protection remains editable by owner and flags/human-view timestamps unchanged. Identical historical retry returns history without altering current state; new same-state requests reject.
- Passed actual commands: pnpm lint/typecheck;34unit;49integration (eight PG migrations, plus eight isolated SQLite tests); pnpm build;14Chromium E2E22.9s. Added explicit workspace filters to candidate checks, then reran49integration and complete14E2E on final migration. No failing test attempt this slice; no hosted acceptance implied.
- SQL covers original draft/delivered restore, immutable child state/protection/times, unsupported/busy/nonempty/legacy origins, edit freeze, owner/current roles, unsupported/anon/direct write denial, shared CAS/replay/request namespace, audit failure rollback of state/origin/revision/ledger and retry. Browser covers confirmation, lost response identical request retry, conflict reload/reconfirm, edit UI freeze, parent-before-child restore, protection after archive, non-owner/revoked/CSRF/unknown-field denial, parallel expectedRevision one200/one409.
- Desktop/375px .local/archive-desktop.png and archive-mobile.png inspected, no overflow. .local/archive-build.log and archive-e2e.log preserve local command output. PGlite is serialized and Auth HTTP fixture is a limited fake; simultaneous HTTP cases do not establish real PG lock contention or actual OAuth/Supabase/PostgREST behavior. HTTPS, R2, cloud CI/deploy remain not_checked.
- Recovery and exact REVOKE signature in packages/db/README.md. Runner transaction/checksum handles failed migration. After success keep origins/name guards/audit/ledger, prefer forward fix/backup restore in separate DB; do not drop origin columns or revert to unguarded name/create functions while archived rows exist. No hosted migration/restore performed.
- Future uploads/reservations/reviews/jobs must join the same archive-state locks/idle guards before widening support. Full workflow submission snapshots, photos/version/guest/delivery, project protection and deletion remain pending. Auto-delete OFF/dry-run ON, no paid/free plan assumption or stack switch, no push/deploy. User's untracked architecture addendum remains untouched and unstaged.
- Next minimum task: M1-03 upload-session/quota reservation transaction core (scope, idempotency, expiry, archived-parent exclusion, exhausted quota rejection), then private R2 adapter/verified completion. Full M1-02 CRUD/review-state lifecycle is not marked complete by this archive subset.

- Final checks passed: frozen install, format:check, check_handoff.py24files, diff --check. Initial final-format check flagged content-archive.spec.ts; formatted it and actually reran format/docs/diff checks successfully. No logic change; this formatting attempt is not counted as an initially clean check.

## 2026-10-23 — CF-01 explicit architecture integration (latest)

- Branch: codex/kino-pic-foundation; base b782d61. Task: user now explicitly adopts Workers/D1/R2/Cron/GitHub/closed Owner target; prior non-adoption notes are historical. Canonical docs/CODEX_ARCHITECTURE_ADDENDUM.md created from the supplied docs/docsCODEX_ARCHITECTURE_ADDENDUM.md, original source untouched/unstaged. Updated shared AGENTS/GEMINI, architecture/Auth/storage/deployment/roadmap/tasks/security/data/API/acceptance. No repository reinitialization or old feature removal.
- Existing apps/worker is now a real Hono4.13.13/Drizzle0.45.4/Better Auth1.7.12 Worker with Static Assets, D1 and private R2 bindings. New D1 migrations0001/0002 (nine foundation tables) are separate from the unchanged eight PG migrations. Existing Next/Supabase/PG business flows remain reference, not silently routed to an incomplete target. New root commands dev:cloudflare/build:cloudflare/test:cloudflare and generated Wrangler types integrated.
- Closed Owner security: fixed internal UUID with verified-subject operator bootstrap (one/both providers, no first-login owner or email merge), atomic bootstrap/user/accounts/owner/audit trigger with failure rollback, one-time lockout; mature SDK Google/GitHub sessions, provider signup disabled, create/link hooks deny, implicit linking off, current Owner check on new management APIs, logout/current session revocation. Google code-flow profile override calls SDK verifyGoogleIdToken for signature/issuer/audience/time (nonce when SDK supplies one). Cookie HttpOnly/Lax, HTTPS Secure configuration, exact canonical Origin and16KiB body limit. SDK raw-error logging disabled. Published example secret rejected, synthetic prefix local-only. Link/unlink remains404 until fresh-reauth/last-provider protections; no fake controls.
- New /api/v1/me and /api/v1/storage/nodes are Owner-only; node response omits credentials/account/endpoint. D1 storage_nodes supports credential references/provider/node metadata, defaults one binding-backed private node/9GB internal quota; old PG8GB unchanged, no free-plan claim. R2StorageAdapter scope prefix validation, actual conditional no-overwrite put, scoped HEAD/stream/read, bounded buffered IO; presign explicitly unavailable and delete rejects. No photo upload endpoint, quota reservation, complete validator or cross-node routing/move yet. Test-only storage-harness entry is never the production main; its tiny PNG-signature fixture is binary storage evidence, not valid image processing.
- Actual local validation: pnpm test:cloudflare dry-builds production + isolated storage harness and runs12 checks on real workerd/D1/R2 with synthetic provider HTTP responses. Covers first visitor rejection; CLI/bootstrap rollback and closure; both OAuth sources same UUID; Google S256 PKCE; RSA signature accepted/invalid denied; same-email outsiders cannot register/link; CSRF/state/callback/body rejection; current Owner disable, forged/revoked cookie denial; session/audit rollback; single node/credential response bounds; R2 immutable/cross-scope/no-delete. Fixture RSA keys are ephemeral, test secrets synthetic only. No production mock mode or external OAuth connectivity proof.
- Actual Wrangler local D1 migrations applied successfully (2/2). Wrangler dev --local --test-scheduled triggered /__scheduled200 and local D1 audit read back retention.dry_run_observed with deleted0/eligibility not_implemented. Stopped preview afterwards. This is observation only, not full retention preview/planning/reconcile/delete. Auto-delete remains OFF/dry-run ON, no destructive R2 method available.
- Original app regression actually passed: pnpm lint/typecheck,34unit,49integration,Next build,14Chromium E2E26.8s. Production dependency audit0 vulnerabilities (.local/cloudflare-dependency-audit.json). No hosted CI/provider/Cloudflare deployment, HTTPS behavior, real PG contention, customer-data import or backup restore exercised. Pinned local Miniflare5.20261019.1-beta is a tooling risk; converter/router flags are covered by tests. Build bundle measured about457.38KiB gzip, not a free-tier/startup/CPU acceptance claim.
- Failed attempts corrected: initial new Cron SQL JSON quoting; Miniflare5 constructor requires its published V4 converter; D1 exec rejected comments/multiline trigger; local Static Assets router needed has_user_worker. Added invalid Google signature test failed against the initial default code-flow mapping, then SDK verification override fixed it. Tight SDK types required provider subject in profile (never user.id) and typed profile mapping. A JSON parser failed on formatted JSONC trailing commas during an unaffected batch, then corrected; no cloud mutation happened. Expected negative OAuth errors are not live provider failures; SDK logs now disabled. No failure is represented as an initially passing test.
- Auto-review rejected the proposed direct disabling of old production Supabase login due possible service interruption/preservation conflict; that batch did not execute. Safer path leaves old Auth code unchanged and introduces a controlled deploy workflow + intentionally closed readiness guard. `node tools/check-cloudflare-deployment.mjs production` actually rejected as expected. It remains closed even if JSON flags are changed: replace guard only in reviewed cutover with actual resource/provider/data/restore checks. No approval is needed to continue unaffected local migration work; actual service cutover not performed.
- CI adds local Cloudflare verification. Manual environment-scoped CD skeleton uses least-privilege environment secrets and serialization but cannot deploy in foundation. GitHub environment required reviewers and actual remote run/resources remain not configured/checked. No API keys/OAuth secrets/R2 credentials committed; .dev.vars/.wrangler/generated/bundled outputs ignored. No push or customer-data write. Exact local commands/bootstrap/config/recovery and fee/terms verification links in DEPLOYMENT.md.
- Next: CF-02 D1 workspace/project/album/protection/archive repositories + existing UI ports, original business equivalence with explicitly revised Owner policy and stable ID/audit/CAS/replay/tenant tests. Then fresh reauth/link/unlink/session controls, reservation/direct upload/verified complete, guest/gallery/history/version/BeforeAfter/delivery and real retention previews/jobs. All M1–M5 original requirements remain; current D1 foundation does not complete the product migration. Public legacy policy differences remain documented until controlled replacement.

- Final checks passed: frozen install, format:check, 29 required docs via check_handoff.py, diff --check, final lint/typecheck. Initial format check flagged Worker public HTML/workspace YAML; formatted and reran successfully. Latest Cloudflare dry-build gzip457.38KiB and12 local checks passed with SDK raw logs disabled. Original untracked supplied addendum remains unstaged.

## 2026-10-23 — CF-02a D1 workspace backend

- Implemented apps/worker/migrations/0003_workspaces.sql, D1WorkspaceRepository and GET/POST /api/v1/workspaces using existing strict contracts/cursor envelope. Canonical normalized names, Owner-only authorization, exact mutation Origin/JSON/16KiB body limit,24-row keyset pages,100-workspace limit and internal9GB workspace ceiling. No target UI change; legacy Next/Supabase routes remain untouched.
- Single SQL command trigger validates current enabled Owner AND unexpired matching session before replay/conflict/cap. Workspace/original immutable result/audit commit atomically; injected audit failure leaves none. Successful retry returns original snapshot even at limit. Audit includes UTC, actor/session/workspace/request. Other operations must join a shared command namespace before being mounted; this does not prove cross-operation replay/CAS/project/album equivalence.
- Actual verification: pnpm test:cloudflare passed17 check groups on real isolated workerd/D1/R2 with provider HTTP fixtures (previous12 + new5). New groups exercise four concurrent same-request writes, strict fields/CSRF/invalid JSON/body/cursor, SQL audit failure rollback+retry, disabled Owner/expired or forged session even before replay, immutable command guards,100 tied timestamps across all pages/no duplicates, cap and original-response retry. Production dry-build459.75KiB gzip is a build measurement, not free-tier acceptance.
- Actual pnpm --filter @kino-pic/worker db:migrate:local applied only0003 successfully; original0001/0002 remain. No remote SQL/customer writes. Additive migration recovery is documented in DEPLOYMENT: application rollback preserves new data/history; use a forward corrective schema migration, not destructive down migration. Staging snapshot/restore rehearsal remains not_checked.
- Actual original regression: lint/typecheck passed,34unit/49integration passed,Next build passed,14Chromium fixture E2E passed29.7s. These browsers exercise the retained reference, not a new D1 UI; new D1 evidence is API/workerd/SQL tests. Real Google/GitHub connectivity, HTTPS cloud resources, hosted CI/deployment and backup restoration remain not_checked. Auto-delete OFF/dry-run ON; no readiness gate lifted.
- Next smallest delivery CF-02b: shared operation request namespace + D1 project create/read/rename CAS, then album/protection/archive equivalents and existing React UI adapter/browser acceptance. Keep all original M1–M5 upload/guest/version/delivery/retention backlog. Original untracked supplied addendum preserved. No push/deployment.

## 2026-10-23 — CF-02b D1 content backend

- Current HEAD includes CF-02a and this uncommitted CF-02b slice. New `apps/worker/migrations/0004_projects_albums.sql` creates tenant-bound project/album/photo-catalog metadata and a global `(actor_id,request_id)` command ledger. Existing 0003 workspace command records are copied with exact response snapshot and timestamp, while old command/audit rows remain.
- `D1ContentRepository` plus Worker routes now implement project read/list/create/rename, album read/list/create/rename, album pin/legal-hold confirmation, and empty-only project/album archive/restore. Current enabled Owner/session and resource tenant are SQL guarded before replay; CAS, result snapshot, before/after audit and content update are atomic. Photos catalog is metadata-only. No photo upload/version/delivery, UI route switch, or member administration is implemented on target.
- Actual `pnpm test:cloudflare` passed24 groups on isolated workerd/D1/R2 including live 0003→0004 workspace-ledger upgrade, concurrent workspace/project retries, request collision, unauthorized tenant, failure rollback, rename CAS/replay/audit, album protection and empty/nonempty archive. Actual typecheck passed. Wrangler local 0004 application is running/record below after command completion; no remote D1. Real OAuth/Cloudflare resources not checked.
- Next: run existing Next/E2E, docs checker/format/diff, then port existing React workspace/project/album routes through a same-origin authenticated Cloudflare UI/API path. CF-02 stays unchecked until browser acceptance. All guest/gallery/photo/version/delivery/retention requirements remain.

## CF-02b final verification addendum

- Added migration0005 hardening: immutable project/album parent IDs plus a photo-catalog insert guard that enforces the same album/project/workspace triple. Applied locally with Wrangler (7 statements). No existing catalog rows required conversion.
- Final `pnpm test:cloudflare`: 25 passed check groups on local workerd/D1/R2 including0003→0004 upgrade, schema parent guard, same-request parallel create, cross-operation conflict, audit rollback, CAS/replay, tenant denial, protections and archive guards. `pnpm typecheck`, `pnpm lint`, `pnpm build`,34 unit,49 integration and14 legacy Chromium E2E (25.4s) all passed. E2E is reference app only; target Worker UI is still unported.
- D1 API/content schema remains local. No remote D1, OAuth credentials/provider connectivity, cloud deploy, backup/restore drill or customer data access. Continue CF-02c target UI same-origin integration and Worker browser acceptance.

### Migration0006 audit multi-tenant fix

Removed the foundation's global `(action,request_id)` uniqueness, which could let one tenant's chosen UUID collide with another tenant's event. Migration0006 copies existing event fields and stable IDs, then restores append-only triggers using event_id as the sole unique event key. The isolated migration rehearsal preserves all legacy events and admits same request/action under two actors. It has only been applied to local/test D1; remote snapshot/restore at scale remains untested.

### Audit rebuild follow-up: migration0007

An initial0006 upgrade rehearsal failed after SQLite left old writer triggers bound to the renamed audit table. Migration0006 was corrected to drop dependent triggers before renaming/copying; migration0007 now rebinds all bootstrap/session/workspace/content audit writers and also repairs the local database already migrated through the earlier draft. Verified: isolated upgrade applies0004-0007, all prior audit rows compare equal, a new session after rebind logs, two actors with the same action/request both succeed. The Wrangler local DB also applied0007 successfully (31 statements). The intermediate migration attempt did not change or delete customer data; no remote database was touched.

## 2026-10-23 — CF-02c first same-origin Worker React UI slice

- Worker root now serves a Vite/React UI built from apps/web/target-ui into ignored apps/worker/.static. It reuses the existing WorkspacePanel, project/album create/rename forms, album protection and archive forms. Small next/link and next/navigation shims keep the forms shared; apps/web Next/Supabase reference remains intact. Vite 8.3.5 and @vitejs/plugin-react 6.1.2 are pinned in the web workspace.
- The UI gates on GET /api/v1/me and uses Better Auth Google/GitHub sign-in and sign-out endpoints at the same origin. Owner session, D1 scope, idempotent command ledger, revision CAS, and before/after audit continue to be checked in the Worker APIs. UI covers workspace list/create, project list/create/rename/archive/restore, album list/create/rename/protection/archive/restore. It presents no unimplemented gallery or upload actions.
- Wrangler Static Assets points to .static with SPA history fallback. Worker also resolves missing GET pages to the root shell for the explicit Miniflare harness; unknown /api paths return JSON 404. HTML/API stay private/no-store; hash-named public assets get immutable cache. No secrets are bundled.
- No D1 migration/schema change. Rollback is code-only; no database recovery is required. Existing user-supplied docs/docsCODEX_ARCHITECTURE_ADDENDUM.md remains unmodified/untracked.
- Actual pnpm test:cloudflare passed26 groups. The new Chromium case drives the built Worker bundle through local workerd, uses an HttpOnly Better Auth fixture cookie, creates a workspace/project/album, enables pin protection, archives the album, reloads a deep route and checks the final D1 rows. Synthetic Google/GitHub endpoints are test-only; no true browser provider login or remote Cloudflare proof.
- Final post-UI checks passed: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `python tools/check_handoff.py` (29 files), `pnpm test:unit` (34), `pnpm test:integration` (49), `pnpm build`, `pnpm test:e2e` (14 Chromium, 22.9s), and `pnpm test:cloudflare` (26 local groups). `git diff --check` is the final repository check below.
- Initial bundle/browser failures and fixes are recorded in VERIFICATION. No customer/remote data was used. Real OAuth credentials/connectivity, HTTPS, remote D1/R2, CDN behavior, deployment, backup/restore, guest/photo/version/delivery/retention, Owner account-link UI, full endpoint/status equivalence and sanitized legacy-ID import rehearsal remain not_checked.
- Next hard slice: CF-03 D1 upload quota reservation and expiring upload-session transactions with concurrency, replay, expiry/cancel, archive exclusion and quota exhaustion tests before any R2 presigning. Keep CF-02 data-ID mapping/semantic parity as a cutover gate.

- Final CF-02c verification rerun: `pnpm test:cloudflare` passed 26 local workerd/D1/R2 checks; built UI bundle measured 362.48 KiB JavaScript (109.91 KiB gzip). `pnpm build` and all 14 existing Chromium reference-app tests passed, along with 34 unit and 49 integration tests, lint, typecheck, format check and 29-file handoff checker. No schema migration, remote service, provider credential, or customer data changed. Wrangler emitted only its existing ambiguous environment warning during dry-run; nothing was deployed.

## 2026-10-23 — CF-03a D1 upload reservation/session core

- Additive `apps/worker/migrations/0008_upload_reservations.sql` adds per-workspace used/reserved counters, immutable reservation history, scoped 15-minute upload sessions and a separate request/result ledger. It rebuilds the D1 request guard so actor/request IDs conflict across upload and existing content commands. No existing PG migration or source data is rewritten.
- Owner-only Worker API now supports `POST /api/v1/uploads/init`, `GET /api/v1/uploads/:id` and `POST /:id/cancel`. D1 checks current Owner/session before replay, exact tenant/parent/state, active single node and both workspace/node quota. Reservation creation, counters, immutable result snapshot and UTC audit are atomic; cancellation and expiry release only reserved counters and append audit. Active sessions block project/album archive. Five-minute Cron expires pending sessions; retention observation is once per UTC day, and physical auto-delete remains OFF/dry-run ON.
- No R2 URL/signer or object transfer is exposed. There is no image verification, photo/asset/version creation, or upload UI. **Do not carry the current TTL-only release into a signed-upload phase:** CF-03b must account for URL and in-flight lifetime, verify R2 HEAD/object ownership or confirmed cleanup, then atomically convert reserved bytes to used bytes.
- Actual local migration command `pnpm --filter @kino-pic/worker db:migrate:local` applied migration0008 to Wrangler's local D1 (25 statements; no `--remote`). `pnpm test:cloudflare` passed34 local workerd/D1/R2 groups, including0004→0008 audit preservation, request collisions, concurrency/quota edges, audit rollback, archive race, cancel and Cron expiry. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `python tools/check_handoff.py` (29 docs), `git diff --check`, `pnpm test:unit` (34), `pnpm test:integration` (49), `pnpm build`, and `pnpm test:e2e` (14 Chromium, 26.3s) passed.
- The local Wrangler migration was only applied to the development DB. No remote D1/R2, real OAuth provider, customer data, backup/restore, or deployment was used. Dry-build emitted Wrangler's existing multi-environment/no-`--env` warning and made no deployment. Preserve migration0008 and reservation/audit history on code rollback; repair schema forward. Before remote migration rehearse a private snapshot/restore on a representative clone. Existing workspaces are backfilled with zero used bytes; imported assets/usage still require a separately reviewed migration.
- Original user attachment `docs/docsCODEX_ARCHITECTURE_ADDENDUM.md` remains unmodified. Latest specs/handoff are updated in DATA_MODEL, API_CONTRACT, ARCHITECTURE, SECURITY, DEPLOYMENT, TASKS, CHANGELOG, DECISIONS, AGENTS, GEMINI and README. No commit, push or deployment.
- Next: CF-03b R2 signer and verified object completion, including in-flight expiry grace, key/size/MIME/magic/hash/ownership validation and usage conversion/reconciliation. CF-02 API/state parity and sanitized ID-import rehearsal remain cutover gates; gallery/guest/version/delivery/retention are still unimplemented on D1.
- CF-03b research against current Cloudflare docs: presigned PUT URLs are bearer credentials and reusable until expiry; R2 PutObject supports atomic `If-None-Match: *`, browser uploads require bucket CORS, and a single upload is currently capped at 5 GiB. Bind the exact content length/type/checksum where supported and verify it with real browser/provider tests; add references and implications in DEPLOYMENT.md. This is a design gate only, not implemented or live-tested.

## 2026-10-23 — CF-03b local signed upload and tenant-scope guards

- CF-03b backend slice is implemented locally: owner-scoped single-part signing binds exact key, content length, MIME and SHA-256; completion inspects the private R2 object before atomically recording immutable original/version/asset metadata and converting reserved bytes to used quota. Direct upload flags remain false in local, staging and production; only synthetic Miniflare tests enable them.
- Fence-marker identity requires the matching session metadata, zero-byte size and dedicated fence MIME. Regression cases prove forged metadata on an image cannot pass completion, release quota on cancel/expiry, or race into duplicate fence records. Invalid or suspicious objects remain `needs_review` and retain reserved quota.
- D1 migration0011 adds composite scope guards across photo/version/asset/completion/audit relationships. The Wrangler local D1 was migrated through early0009, repair0010 and0011; isolated Miniflare upgrade fixtures also cover0011. A deterministic reconstructed 0010 compatibility fixture preserves synthetic quota/audit snapshots and verifies payload-backed specs after repair. The original early-0009 SQL is not tracked, so the fixture is not byte-for-byte historical recovery proof. No remote migration occurred. Keep these migrations forward-only; no down migration. Before remote use, rehearse backup/restore through0011 on representative sanitized records and a separate recovery database.
- Passed actual local checks: `pnpm test:cloudflare` (41 local Cloudflare check groups), `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (34), `pnpm test:integration` (49), `pnpm build`, `pnpm test:e2e` (14 Chromium), `pnpm format:check`, `python tools/check_handoff.py` (29 docs), `git diff --check`. See VERIFICATION for boundaries. No customer data, remote D1/R2, OAuth credentials, deployment or push was used.
- Not implemented: full image decoding/dimension and pixel limits, decompression-bomb controls, preview/thumbnail job, retrying upload client, photo grid/private gallery, guest flow, real R2/CORS browser transfer and resumable/multipart upload. CF-02 parity/import and all M2–M5 product features remain open; retention deletion remains OFF.
- Next: CF-03c secure image decode/thumbnail pipeline plus usable upload/retry UI and paginated private gallery, while preserving the live-R2/backup-restore and CF-02 parity gates.

## 2026-10-23 — CF-03c1 image dimensions and browser uploader (latest)

- Final format/document/diff checks passed: pnpm format:check, python tools/check_handoff.py (29 portable specs), git diff --check and final lint. All prior dirty changes and original attachment remain preserved; no commit/push/deploy.

- Final browser follow-up: real JPEG/WebP multi-file selection uploads sequentially and aggregate byte accounting matches; a valid-IHDR/nondecodable PNG is rejected before reserve. The final Cloudflare suite rerun passed44 groups with these cases included.

- Two explicitly configured gpt-6-luna/max workers owned new parser/tests and browser helper/component in separate cf03c-image-metadata/cf03c-upload-browser worktrees. Parent integrated five reviewed files, schema/API, browser S3 bridge, security fixes and docs. Third agent performed read-only review. No concurrent same-file edits, commit/push or deployment.
- Pure parser reads JPEG SOF segments, PNG IHDR/CRC and WebP VP8X/VP8/VP8L within262144 bytes. Server complete enforces encoded dimensions <=32768 per side/80M pixels plus R2 length/MIME/checksum, then atomically stores dimensions in immutable version/completion/result/audit. Invalid headers remain needs_review and retain quota. This is not full server raster decoding, malware/decompression-bomb control or EXIF display normalization.
- Migration0012 adds nullable workflow/completion columns, new-write dimension guards and completion trigger. Isolated0004→0012 test preserves legacy version/asset fields including NULL dimensions, quotas and all audit rows. Wrangler listed only0012 pending, then applied it locally (11 commands). No remote/customer data. Recovery is forward-only: keep schema/history; disable uploads before old-bundle rollback, as a pre0012 completion writer lacks required dimensions. Never drop guards/backfill guesses; remote representative snapshot/restore remains pending.
- Real album uploader:20 sequential files,64MiB each, browser decode/SHA-256/transient320px JPEG preview; signed File PUT omits app credentials/referrer/redirects. Init/authorize/complete/cancel retain stable IDs; unknown PUT confirms first, only UPLOAD_OBJECT_NOT_FOUND permits retransmission. Expired/cancelled states reconcile from GET and become removable. Queue is memory-only with navigation warning; no reload-resume or persisted thumbnail.
- Owner capabilities endpoint reports enabled and browser limits without secrets. Independent review found disabled init still reserved quota and expired rows could become unremovable. Both fixes are covered by an actual disabled Worker (no session/quota write) and Chromium+scheduled expiry/cancel/reconcile/remove. Reviewer rechecked both as resolved.
- Actual final checks:44 local Cloudflare groups;46 unit;49 integration;14 reference Chromium E2E (28.5s); Next build/typecheck/lint passed. New browser test decodes a real PNG, verifies signed request bytes/headers into Miniflare R2, drops init/PUT/complete responses, and proves one original/completion/audit/quota conversion. It also rejects an8-byte PNG before reservation, checks disabled UI and375px no overflow. Screenshot .local/upload-mobile.png visually inspected.
- Initial lint/typecheck failed on nullable cancel ID and Next's img rule on a Vite blob preview; explicit narrowing and target-scoped lint rule fixed them, actual reruns passed. Worker isolated checks lacked linked dependencies/formatter write permission; parent formatted and ran integrated checks. Wrangler dry-run retains its existing multi-environment warning; no deployment.
- Next: trusted decoder/processing adapter, persistent quota-counted preview/thumbnail jobs and authorized gallery/lightbox, plus reload-resume/multipart. True OAuth/R2/CORS/HTTPS, data import/backup restore/CI, guest/version/selection/delivery/retention remain open. Every direct-upload/multi-account/autodelete flag stays OFF; dry-run ON.

## 2026-10-29 — CURRENT: human-photo heartbeat accepted locally; one-client approval confirmed

This appended entry supersedes earlier same-day statements that no heartbeat endpoint exists or that the one-versus-all question is pending. Owner/Guest visible-photo heartbeat is implemented through0053 native append-only witnesses/monotonic album activity/audit,scoped repositories/APIs and existing Gallery grid/Lightbox image wrappers. Default HUMAN_VIEW_TRACKING_ENABLED=false/hard-local.0053 SOURCE ONLY;default persistent D1 stays0052. Auto-deleteOFF/dry-run;no R2/quota mutation or deployment.

Final isolated `apps/worker/.local/human-views-focused-final.log` exited0:3 API groups +2 controlled375px Owner/Guest browser flows using the real existing upload/R2/Sharp fixture. Exact immediate rolling dedupe/deadline,authority/origin/visibility denials,forged actor/audit/projection/log guards and injected audit rollback pass. Management list/unloaded/hidden/subsecond/blur do not count;continuous visible images count;preview shares cooldown. Headless focus/visibility is controlled,not native headed or actual five-minute wall-clock recapture proof.11 scoped contract tests,13 retention safety tests,final Worker/UI build,generated bindings,root/Web strict and scoped lint pass. Acceptance:worker .local/human-views-acceptance.json. Failed DDL parentheses/test-JS-hold/Web-regex strict logs remain preserved. No broad suite was repeated.

New safety requirement: activityEvidenceVerified is mandatory in pure retention input;unknown legacy/offline/untracked periods exclude with activity_unverified. Missing last-view data must not imply never viewed. Heartbeat alone does not provide continuous coverage,state-change/policy/reference completeness or deletion authority. See docs/HUMAN_PHOTO_VIEWS.md for exact files,evidence,recovery and gaps.

User confirmed「其中一人代表確認即可」:any one authorized client may confirm a fixed version. This resolves the prior question;do not ask again or require every anonymous visitor. Next implement explicit Owner-authorized immutable request/invitation/Guest confirmation and fixed delivery manifests;retain full retention policy UI/preview/persistence/locks/recheck/retry and remaining M1-M5/hosted scope. Before0053 persistent adoption use fresh backup/isolated upgrade/live parity. Preserve unrelated dirty edits;no commit,push or deploy.

## 2026-10-29 — CURRENT follow-up: append-only REPLACE and equal-clock safety accepted

This extends/supersedes the earlier three-group human-view checkpoint:the final focused native run `apps/worker/.local/human-views-replace-safety.log` exited0 with4 API groups +2 controlled375px Owner/Guest browser flows.0053 now rejects duplicate event_id OR request_id before INSERT,so SQLite REPLACE cannot bypass append-only delete guards. Projection upsert is attempted only for an advancing frontier;two valid same-millisecond events both remain in log/audit while the maximal timestamp/UUID witness stays canonical. Native replacement/event/request/projection and equal-clock cases pass. Final test fixture selects the known non-frontier witness for timing stability;scoped lint passes. Evidence `apps/worker/.local/human-views-replace-acceptance.json` preserves the earlier checkpoint and its log rather than rewriting evidence.

0053 still SOURCE ONLY;default D1 stays0052,tracking OFF/hard-local,automatic deletionOFF/dry-run. activityEvidenceVerified must cover the policy's decision window;missing legacy/offline data is never proof of inactivity. Future deletion must separately protect in-flight authorized reads/downloads and the first1s visibility qualification window,without renewing the30-day timestamp for preloads. No physical deletion/hosted acceptance claim. User's one-authorized-client representative version approval rule is confirmed and next for implementation;fullM1-M5 remains active/incomplete. All existing document history and unrelated dirty changes are preserved.

## 2026-10-29 — Gump interface reference

User supplied Gump album/photo URLs and three screenshots as architecture/interaction reference. Observed create, edit advanced settings, share modal and photo change history in the user's existing browser without saving or sending. Reference and explicit observation limits: docs/GUMP_INTERFACE_REFERENCE.md. No KINO Pic code, migration or deployment was changed for this research. Preserve independent invite permissions/private opaque tokens; freehand drawing and Owner comparison remain unfinished. Continue the active M1–M5 work and the confirmed one-authorized-client approval rule.

## 2026-10-29 — Version confirmation implementation in progress

User confirmed one authorized Guest can approve as representative; never ask this again. Owner explicitly selects sealed invite membership and fixes photo/version/head revision; independent viewing/selection rights do not themselves grant approval. Guest must have current view access to the exact target; historical target also needs the existing comparison/published-version checks. One receipt confirms the request; new head never inherits approval. Revalidate session/scope before replay and commit, preserve exact request body/ID, and use immutable ledgers/audit with symmetric namespace guards.

VERSION_APPROVALS_ENABLED was added default false to local/staging/production and hosted activation is rejected. Focused feature-flag tests passed4/4. Contracts and source-only migration0054 are under construction; no approval API/UI is complete or enabled, no migration applied, no production data touched. `isCurrent` is dynamic read metadata and must not be baked into an immutable replay result. Continue implementation, native D1/API/browser verification and documentation before any activation. Preserve dirty worktree; auto-delete remainsOFF/dry-run.

## 2026-10-29 — Version approval checkpoint and Gump reference

Gump create/share/photo interaction observations are in `docs/GUMP_INTERFACE_REFERENCE.md`; the available browser view does not reveal server code and no external setting was saved. Version approval is NOT complete or enabled. `VERSION_APPROVALS_ENABLED` defaults false and is local-only; 0054 is source-only, not applied to persistent D1. Migration isolated SQLite 3.40 DDL/trigger parse passed with stubs (8 tables, 57 triggers); full chain on that old SQLite stopped at existing 0004 syntax, so native workerd/D1 migration and trigger acceptance remain required. No customer data, remote service, deployment, commit or push.

Contracts and guest/owner history projection were drafted; the unmounted route draft is `apps/worker/.local/version-approval-routes.draft.ts`. The Worker service does not exist: Windows command length prevented its creation. Complete service and native isolated tests before mounting routes or UI. Revalidate session before replay, pin the original session on replay, use immutable versionNo/headRevision, enforce explicit authorized invite and live view permissions; one authorized Guest confirms a fixed version and a new head never inherits confirmation. `isCurrent` is dynamic. Preserve append-only audit and historical version visibility.

Scoped tests: guest-downloads-contracts + version-approvals-config + version-approvals-contracts passed 18/18; root `tsc --noEmit -p tsconfig.json` passed. Additional existing history suites had 2 failures: guest action fixture omits newer download/approval variants; owner legacy download fixture expects stripping an extra `signedUrl` while the current download contract intentionally rejects extra fields. Reconcile those fixtures deliberately and rerun; do not count them as passed. Before persistent migration: backup, isolated upgrade/restore, native D1/API/browser tests, and documented forward repair; never drop audit/history or enable automatic deletion. All unrelated dirty changes remain.

UI checkpoint: `apps/web/target-ui/version-approvals.tsx` is a draft and is not mounted in Owner or Guest screens. Its scoped ESLint and Web TypeScript passed; root separately reran `pnpm --filter @kino-pic/web typecheck` successfully. No browser/E2E or service integration has been tested. Review the draft and mount only after API and authorization acceptance.

## 2026-10-29 — Version confirmation local integration

This supersedes the earlier in-progress checkpoint. The local-only, default-OFF capability now has mounted Owner/Guest API routes, service and Lightbox panels. Owner selects explicitly authorized sealed invitations with can_view and pins photo/version/head revision. One authorized Guest receipt confirms that request; newer head does not inherit approval. Active session/scope and target visibility are rechecked, exact retries are session-bound, immutable results/audit remain. UI distinguishes invitations by short identifier and never displays the token. 0054 remains source only; default persistent local D1 is still through 0052, so do not enable this feature there before separate 0053/0054 migration/backup/restore/parity acceptance. Hosted enablement remains rejected.

Isolated native migration test `pnpm exec node tests/version-approvals-migration.mjs` (cwd apps/worker) passed 11 checks: replay/session conflict, revocation, V1/V2 isolation, atomic audit rollback and append-only/REPLACE guards. Isolated API test `pnpm exec node tests/version-approvals-api.mjs` passed 7 checks for Owner/Guest create/list/replay, invite isolation and revocation. Earlier API attempts failed: Owner capability test lacked cookie, then Guest SQL missed a parenthesis; both were corrected before the passing run. Targeted 41 unit/contract tests passed, Worker/UI dry-run build passed, root and Web types and scoped lint passed. The earlier `pnpm test:cloudflare` failed on an extensionless Node import; two imports were fixed, but the full smoke has not yet been rerun. Browser acceptance is pending. No production E2E, customer data, remote service, deployment, commit or push.

Migration/recovery: do not drop immutable requests, receipts, versions or audit. Before persistent adoption take a fresh backup and rehearse isolated restore/upgrade and live parity; on rollback keep 0054 data, disable capability and prefer forward repair. Review all 0053/0054 gates first. Delivery manifests, real provider acceptance, notifications and safe retention remain unfinished. Existing unrelated dirty work preserved.

Browser acceptance update: `pnpm exec node tests/version-approvals-browser.mjs` (cwd apps/worker) passed 4 isolated Chromium checks: Owner selects an eligible invite and pins version/head; Guest loads the fixed preview and confirms; Owner sees confirmed; OFF hides both panels. The separate focused API runner passed 7/7 again with PHOTO_VERSIONS_ENABLED=true. Capability now requires both PHOTO_VERSIONS_ENABLED and VERSION_APPROVALS_ENABLED in local; all default OFF. Browser uses synthetic isolated Miniflare D1/R2, not hosted/real provider acceptance. The early browser fixture failures (missing photo-version flag, selector and cross-instance fixture assumptions) were corrected before the successful run. Prior HANDOFF statement that browser acceptance was pending is superseded.

Full Cloudflare smoke follow-up: after fixing Node `.ts` import resolution, the first rerun stopped at an obsolete Guest annotation 401 assertion. The assertion was updated to the existing download-only fallback status without removing privacy/recovery checks. The second rerun passed that browser group and many subsequent groups, but exited 1 later at `tests/guest-feedback-browser.mjs:387`: expected one Guest access read, observed two. This remains under diagnosis; do not claim the full suite passed. The focused approval native/API/Chromium checks above remain passed, not a substitute for the broader smoke. See test output for exact failing assertion.

Third full `pnpm test:cloudflare` rerun passed the previously failing Guest annotations browser case and Guest rating/favorite browser group after their stale expectations were updated. It later exited 1 at `tests/shared-review-guest-browser.mjs:1823`, which expects the old 401 `存取受限` UI while actual render shows the download-only fallback status. The run also emitted the intentionally injected `TEST_SHARED_DOWNLOAD_AUDIT_FAILURE` during a passing audit-failure scenario; final exit 1 is due to the later browser assertion. Full smoke remains not passed; reconcile remaining 401 expectations and rerun as appropriate. Focused version approval D1/API/browser results are separate and remain passed.

The shared-review 401 assertion was subsequently updated to the existing fallback status; its no-submit and private-filename assertions remain intact. Node syntax and Prettier checks passed, but the full Cloudflare suite was not rerun after this last correction, so its final result remains unverified. Next run the relevant browser scenario or full required suite before acceptance.

## 2026-10-29 — Cloudflare full regression restored

After updating the shared-review 401 fallback expectation while retaining no-submit and filename privacy checks, `pnpm test:cloudflare` completed exit 0: 367 local Cloudflare checks passed, including the shared-review Guest browser group. TEST_SHARED_DOWNLOAD_AUDIT_FAILURE and OWNER_HISTORY_EXPORT_FAILED log lines were deliberate injected-failure cases whose fail-closed checks passed. This supersedes the immediately preceding failed/pending full-smoke status; the run used its built bundle before the later Owner history-version warning text change. Hosted OAuth, remote R2/D1 and production E2E remain not checked. Default gates remain OFF and 0053/0054 remain source-only.

## 2026-10-29 — Fixed delivery groundwork and version visibility

`docs/DELIVERY_MANIFEST.md` records proposed delivery boundaries. Shared `packages/contracts/src/deliveries.ts` and six focused tests define 1–64 same-album immutable item references, 1–24 scoped invite IDs, optional exact approval witness, public Owner/Guest DTOs without object keys or bearer secrets, and independent Guest download permission. Original and delivery kinds are represented in the contract; only original currently has an existing verified upload producer, so any new schema/service must fail closed for unverified delivery-kind assets. No delivery service/API/UI/download or persistent 0055 migration is complete; ZIP, notification, retention integration and hosted provider acceptance remain open. The contract is a starting ABI, not evidence of actual publication.

The Owner approval panel now labels whether each eligible invite may view historical versions and warns when a selected current-only invite would lose access to a fixed request after head changes. Existing permission policy remains unchanged. Web typecheck and scoped lint passed; a focused real V1→V2 browser/API fixture is under construction and is not yet an acceptance pass. Full Cloudflare smoke 367 passed before this warning change.

Focused permission follow-up: latest dry-run Worker/UI bundle passed `pnpm exec node tests/version-approvals-head-switch.mjs` (cwd apps/worker). It used a real processed V1/V2 fixture: before confirmation head changed to V2; view-only invite could not list, preview or confirm historical V1; view+compare invite could view and confirm pinned V1; Owner saw the warning for view-only. Earlier test-fixture attempts failed first because unprocessed V2 was not eligible to become current, then due a wrong receipt column; both were fixed before the passing run. These are isolated local checks only; permissions remain independent and hosted/provider acceptance remains open.

Delivery schema checkpoint: auto-review rejected appending unfinished 0055 SQL in the auto-applied migrations directory because it could be applied before native validation; the review explicitly disallowed indirect workarounds. The incomplete file has been moved out of that directory to `apps/worker/.local/0055-delivery-manifests.draft.sql`; `migrations/0055_delivery_manifests.sql` is absent. The draft is NOT usable: SQLite CHECK contains an invalid subquery and it lacks item/invite/seal/result insert guards, atomic apply/audit, reverse namespace/REPLACE guards, active-reference deletion guard and native tests. Do not apply or trust it. Deliveries contracts/tests are groundwork only, and no real delivery service/UI exists. No D1/R2/customer state changed.

Delivery contract security review: a Guest read DTO now rejects both can_view_delivery and can_download_delivery false while allowing download-only; focused 6 tests passed. This validates a shape, not authorization. Existing permission mask has can_download_original/preview but no delivery bit: a future original-file delivery must recheck can_download_original plus scoped recipient/session, and must not reuse current-head download logic as a pinned manifest. Explicit request byte limit enforcement, delivery event contracts, verified delivery-kind producer, schema/API/UI and native acceptance remain pending. No rejected migration was touched.

## 2026-10-29 — Invitation permission grouping and delivery contract review

The existing Owner invitation creation form now groups its five basic view/download/select/submit permissions separately from seven advanced feedback/comment/history/compare permissions, with the advanced details initially collapsed. All 12 remain individually controlled, initial only-view default is unchanged, and starting a new invite resets/collapses advanced. No new share token or permission semantics were introduced. Focused 375px Chromium invite creation group passed, including advanced default/expand, independent can_rate request, reset, one-time secrets and recovery. Scoped formatting/lint and target UI build passed; complete Cloudflare smoke is still running at this checkpoint.

The delivery read contract now rejects a successful manifest response if both view and download access are false, but allows download-only. Six delivery unit tests and root TypeScript passed; this is not a substitute for current-session and invitation checks in the unimplemented delivery service. Original delivery must use independent can_download_original. The 0055 draft remains incomplete/outside auto-applied migrations after auto-review rejection; no rejected action was retried, no database/remote deployment touched. See DELIVERY_MANIFEST.md.

Full Cloudflare smoke after invite grouping: target 375px invite creation browser group passed, including independent permissions, collapsed advanced group, reset and one-time credential/recovery checks. The full run exited 1 later at `tests/assisted-candidate-catalog-browser.mjs:444` (`All 1,001 candidates must require bounded pages`). This is a separate existing catalog browser assertion; cause remains under investigation and no full-suite pass is claimed for this run. The earlier pre-grouping full suite passed 367 checks. The delivery contract rejects Guest reads with neither view nor download rights while preserving download-only, with six focused tests passing. Delivery backend/schema remains incomplete and no rejected migration was retried.

Catalog regression follow-up: the full smoke failure at `assisted-candidate-catalog-browser.mjs:444` was traced to the helper waiting for request observation and retained old rows, not for the newly rendered page; the Next control is intentionally disabled while loading. The test now waits for page number to advance before checking row count/Next, retaining 1001 eligible IDs, 24-row bounds and final ID/filename checks. Existing `.local/m3i3-focused-runner.mjs` passed 7 isolated actual workerd/D1/API/Chromium checks including the corrected 375px pagination/selection/retry flow; synthetic metadata and Miniflare R2 are not 1001 real R2 uploads. This does not turn the prior full run's exit 1 into a full-suite pass. Invite creation browser group separately passed. No remote/persistent data changed.

## 2026-10-29 — Album share entry

Owner active album cards now offer `分享相簿` and open the existing ProjectInvites composer with that exact album preselected. Parent project/workspace scope is checked, inactive/archived scope does not enable entry, and the server still revalidates authority and active scope on issuance. A selected album outside the composer's first page uses the already-authorized project-list snapshot with a removable summary; it is not a credential. Existing selected scope, pending/retry intent, or an unresolved one-time result is never overwritten/remounted by a new entry; the UI provides a status message. The entry opens the existing section, not a completed standalone share popup.

Focused isolated 375px Chromium/Miniflare `node .local/invite-create-focused-runner.mjs` (cwd apps/worker) passed: target/decoy scope and exact POST albumIds, single retained form after entry changes, dropped response/retry with identical request/body, metadata-only recovery and no secret in text/storage/URL. First fixture run captured an obsolete preselection node after resetting the previous invite; corrected fixture then exposed two visible forms. Distinct stable React sibling keys fixed a real collision; the same strict single-form runner passed after the fix. Worker/UI dry-run build, Web typecheck, scoped lint and Prettier passed. No full smoke rerun after this change. Tests used ephemeral D1 through 0054 and synthetic identities, not hosted OAuth/R2 or production. No persistent migration, commit, push or deploy.

The unfinished delivery 0055 draft remains outside auto-applied migrations. Auto-review previously rejected appending unfinished SQL to the migrations directory because it may be applied before validation, explicitly disallowing workarounds; no such action was repeated. Fixed delivery service, actual download, notifications, retention integration and persistent migration/hosted acceptance remain open.

## 2026-10-29 — Guest Before/After direct slider

Guest version comparison now adds direct pointer dragging on the image, same-boundary clipped After/right and Before/left, vertical divider, circular arrow handle and BEFORE/AFTER labels. Pointer capture tracks drag outside the canvas, touch-action pan-y preserves vertical scrolling, and the existing accessible range/1% arrows/Shift 10% keyboard controls remain. Idle CSS wiggles the divider and clipping together by 1.2%; the first slider interaction stops the hint, and prefers-reduced-motion disables it. Existing version access, private asset, side-by-side/overlay and revocation paths remain.

Latest Worker/UI dry-run build passed; scoped ESLint and Web typecheck passed. `node .local/guest-version-comparison-focused-runner.mjs` from apps/worker exited 0 with seven isolated actual workerd/D1/R2 API groups plus Chromium checks, including actual left/right rendered pixel distinction, capture outside frame, touch-action, reduced motion, hint stop, keyboard and authorization/revocation. Evidence `.local/guest-version-comparison-focused-run.log`; test uses synthetic isolated Miniflare data, not hosted OAuth/remote R2 or physical touchscreen acceptance. Guest feature remains default OFF/local-only, requiring PHOTO_VERSIONS_ENABLED, GUEST_EXCHANGE_ENABLED and GUEST_VERSION_COMPARISON_ENABLED. Owner comparison remains unimplemented: its API pagination does not pin complete current-version metadata; future work needs a separate Owner-authorized adapter and pinned current head without weakening Guest publication rules. Full suite was not rerun after this UI change. No migration, persistent/customer data, commit, push or deploy.

## 2026-10-29 — Owner Before/After comparison

Owner Lightbox now offers a read-only version comparison using the shared slider/side/overlay canvas; Guest and Owner retain separate API/auth wrappers. Owner uses only same-origin Owner private ready previews; comparison never switches current head. Owner version list adds `currentVersion` metadata from the same authorized D1 query as `current`; its ID must match head, preview/thumbnail may be null. New cursors pin head/revision and stale head returns 409; legacy cursors remain accepted, with UI rechecking head/revision before merging pages. This fixes current heads outside the newest 24 rows. An empty first page with later cursors remains navigable; no inert comparison button appears when no candidate/cursor exists. Unauthorized read clears compare and Gallery private state; image failures clear comparison. Stable selection generation is held with the selected-photo state for stale callbacks.

Validation: root independently ran `node .local/owner-comparison-focused-runner.mjs` from apps/worker: exit0, 13 isolated Miniflare D1/R2 API/browser checks including 27 versions, V1 current outside first24, processed V1/V2/V4 bytes, legacy/new cursor, tenant/Guest ACL, slider/keyboard/modes/Escape/focus, unchanged head/command/audit, and comparison-triggered 401 clearing Gallery/compare. Guest shared-canvas regression `node .local/guest-version-comparison-focused-runner.mjs` exited0 with 7 API groups + Chromium slider/security checks. 33 relevant unit tests, scoped lint, Web/root strict typechecks and Worker/UI dry-run build passed. Initial test runs failed on fixture variable/project/cookie/permissions, an old test's positional version request assumption, pointer test targeting outer container and a no-cursor fixture; corrected before the passing run. Existing Owner history browser now locates the real cursor request instead of assuming the second GET. No full smoke after this change, no physical touchscreen/hosted OAuth/remote R2 or deployment validation. Existing PHOTO_VERSIONS_ENABLED gate remains default OFF/local-only; no migration or persistent/customer data changes.

Delivery manifest and retention policies/execution remain incomplete; 0055 delivery draft is outside auto-applied migrations following the earlier auto-review rejection, which prohibited appending unfinished SQL there and indirect workarounds. Do not use that draft as a migration.

## 2026-10-29 — Freehand annotation foundation

Freehand drawing is NOT yet usable. Added an independent strict geometry schema (normalized_1e6 integer points, version1, 2–256 points, distinct adjacent samples, max 8192 compact JSON bytes), existing amber/red/blue style composed separately; shared coordinate scale/style were separated into independent modules while preserving existing exports to prevent a future import cycle. Added a pure client sampler using existing oriented-image/viewport mapping: max 16384 raw samples, invalid/out-of-image samples reject the whole stroke, adjacent duplicates removed, deterministic bounded simplification retaining endpoints, final schema validation. A separate canonical JSON helper preserves ordered points and strict keys. No new UI button or server write path was enabled.

Relevant freehand + existing Guest/Owner annotation tests passed 35/35; root strict TypeScript passed. Future integration must extend BOTH Guest 0045 and Owner 0046 canonical command guards using a reviewed forward migration, retain all existing scope, authorization, same-invite visibility, version binding, audit, CAS, replay, namespace and append-only semantics, and update every old point/rectangle-only serializer and renderer before enabling writes. Old clients unable to parse freehand need an explicit compatibility strategy. Client pointer capture must cancel clipped/outside/invalid paths and preserve same request body on retry; no images stored in journal. Database proposal is under investigation in an isolated scope; no annotation migration has been added to auto-apply or applied to persistent data. The unrelated delivery 0055 draft remains outside migrations after prior auto-review rejection; do not use it. Full M1–M5, freehand UI/service/native/browser and hosted provider acceptance remain open.

Freehand schema proposal update: `apps/worker/migration-proposals/annotation_freehand_geometry_v1.sql` is explicitly REVIEW ONLY / DO NOT APPLY and outside Wrangler auto-applied migrations. Root ran `node apps/worker/tools/freehand-annotation-migration-native.test.mjs` exit0: Node SQLite 3.53.1 in-memory, existing 0001–0046 only, Guest 5/Owner 4 accepted writes, 12 invalid geometry cases per writer rejected, replay/auth/audit witnesses and FK0. This is not Cloudflare workerd/D1, remote, production, or persistent adoption evidence. Both original trigger authorization, point/rectangle, namespace and audit requirements must be preserved; proposed guard replacement and rollback must receive review, including fresh backup/isolated upgrade/populated parity before any actual migration. Freehand schema/sampler/canonical helpers remain UNWIRED; no brush UI or service enabled. Prior rejected delivery 0055 remains separate and untouched.

## 2026-10-29 — Freehand safety gate checkpoint

Added `FREEHAND_ANNOTATIONS_ENABLED`, default false in local/staging/production and .dev.vars example, local-only when true. `freehandAnnotationsCapability` additionally requires the existing Guest annotation and Owner authoring capability chains; this conservative gate is not connected to any route, geometry union, serializer or UI, and does not mean freehand is available. Regenerated Worker bindings; focused four freehand config/contract/sampling/canonical test files passed 20 tests. Initial root tsc failed after type generation because generated `GUEST_EXCHANGE_ENABLED` was literal false; WorkerEnv now omits that binding and reuses the already-defined optional runtime string override; agent reran root strict and gate tests successfully. No schema migration was added or applied.

The annotation proposal remains REVIEW ONLY outside auto-applied migrations. Its Node SQLite in-memory behavior checks are recorded above. Miniflare/workerd D1 atomicity and behavior remain NOT CHECKED: an inline eval probe failed with `require is not defined` before SQL, and a later long Windows command failed with OS error 206 before execution. No persistent DB was used; do not infer D1 transaction behavior from those failed probes. Existing annotation read/serializers/journals and UI still only support point/rectangle, and old-client handling remains unresolved; no freehand button or writer is enabled. Future work should extend the shared canvas rather than duplicate coordinate/permission logic. The unrelated rejected delivery 0055 draft remains untouched.

## 2026-10-29 — Freehand client compatibility analysis

Existing Guest own/shared and Owner read paths validate only point/rectangle and paginate 24+1; an old client can receive earlier pages before hitting an unknown freehand row on a later page. Silently omitting strokes is prohibited. Before enabling writes, implement and validate a client geometry capability/version protocol: recheck existing authorization before any scope-wide upgrade preflight; an unsupported client whose _authorized feed_ contains a freehand row must receive an explicit upgrade-required error with no items/cursor, including when the row would be on a later page. Guest checks stay within the same authorized invitation and Owner checks within the selected scope; targeted reads, cursors, journal replay, existing commands and ACLs must remain correct. New readers may advertise freehand only after all parser/renderer/journal paths are supported. Preserve pending journals and immutable events. An already open idle old page cannot be immediately invalidated without an explicit refresh/notification mechanism; document and test behavior on next read/focus, do not claim instant removal.

New `apps/web/target-ui/freehand-render.ts` is an unwired pure render model with strict geometry validation and existing oriented image/viewport math; it returns numeric points/image bounds only and performs no clipping or image storage. Its 5 focused unit tests passed. UI/API/DB still do not accept freehand; the gate stays OFF. Native D1 atomicity remains under isolated test; no auto migration applied. See latest TASKS for remaining acceptance.

## 2026-10-29 — Freehand workerd D1 proposal test

Root ran `node tools/freehand-annotation-workerd.test.mjs` from apps/worker, exit0: isolated Miniflare workerd D1, baseline migrations0001–0046 only; four injected failures at each DROP/CREATE step of one D1Database.batch restored both original guard definitions and annotation/audit row counts; successful four-statement batch then accepted Guest5/Owner4 valid commands, rejected 12 invalid cases per writer, preserved point/rectangle, replay/conflict, authority, history/result/audit witnesses and FK0. Temporary D1/R2 is cleaned after checked tmpdir target validation. This proves the isolated D1 binding batch behavior only, not Wrangler migrations apply, persistent adoption, remote or production. Proposal remains REVIEW ONLY outside auto migrations; freehand union/routes/serializers/UI/client upgrade compatibility remain unwired and gate OFF. Prior delivery 0055 draft was not touched.

Client compatibility review: legacy strict clients may have already rendered earlier pages before encountering a new freehand item. Future work needs authorized-scope capability/preflight and explicit upgrade-required without hiding rows, preserving cross-invite isolation and exact journal recovery. Idle old tabs cannot be guaranteed immediate invalidation without another mechanism. The new pure freehand render model validates normalized geometry and uses existing viewport/image bounds; its five unit tests passed, but it performs no clipping or UI display.

## 2026-10-29 — Freehand compatibility and canvas preparation

Added an unwired strict canonical helper handling existing point/rectangle and bounded freehand; scoped tests assert exact legacy JSON and deterministic freehand ordering. Added an unwired capability parser and authorized-scope preflight for Guest own/shared, Owner guest-list and Owner own; unsupported clients cannot be treated as authorized, and the full scope is checked rather than one page. Its SQLite unit/native tests passed, but it is not connected to API readers, is not verified in workerd, and preflight/read are separate SQL statements: future integration must compare appropriate feed watermarks and reject/retry on races. Already-open idle old tabs cannot be instantly invalidated without a separate mechanism.

`AnnotationCanvas` has opt-in freehand pointer/keyboard/render groundwork with optional props default OFF; Guest/Owner editors do not pass those props, and no brush control/service write is active. Scope/preview/capability changes, clipped/outside input, cancel and lost capture must discard drafts. Pure unit tests pass but do not prove actual pointer, touch or browser behavior. A focused existing Guest point/rectangle browser regression is pending; Worker/UI dry-run build passed. Unvalidated freehand must not be surfaced. The proposed D1 guard update remains REVIEW ONLY outside auto migrations, and previous delivery draft rejection remains separate and untouched. Full compatibility, migration adoption, serializers, two-role UI and hosted acceptance remain incomplete.

Freehand canvas regression follow-up: `node .local/guest-annotations-focused-runner.mjs` from apps/worker exited0 with 19 isolated API/fixture groups + existing 375x812 Guest annotation browser flow: point, reverse rectangle, zoom/pan and controlled 401/recovery. Earlier attempt lacked the guest-history-test Worker binding and stopped before browser; corrected runner then passed. Screenshot `.local/guest-annotations-mobile.png` was inspected for mobile canvas/mark visibility and overflow. Miniflare ephemeral D1/R2 through0054; this does NOT test opt-in freehand pointer/keyboard or Owner canvas, and no freehand UI/service is enabled. Worker/UI dry-run build passed. The freehand read compatibility helper was tested only in Node SQLite and is NOT connected; preflight vs page read requires watermark validation to avoid race and old idle tabs cannot be made instantly current by this alone. Delivery draft remains untouched after prior auto-review rejection.

## 2026-10-29 — Freehand canvas isolated browser verification

A test-only Vite fixture and Playwright configuration exercise the opt-in AnnotationCanvas without connecting product editors or services. Root independently ran `pnpm.cmd exec playwright test --config playwright.freehand.config.ts --reporter=line`: 4 Chromium tests passed. They cover default omission, actual mouse-drag stroke, scope change and permission loss cancelling a draft, and Enter/arrows/Escape keyboard use. The fixture uses synthetic local data; it does not establish Guest/Owner persistence, mobile touch, hosted services or production E2E. Freehand remains unwired and default OFF. Next integrate authorized full-feed read compatibility and compare the read snapshot watermarks before parsing or returning any items; then complete schemas, serializers, journal, both editors, reviewed forward migration and isolated end-to-end acceptance. No production/customer data or delivery draft was touched.

## 2026-10-29 — Read compatibility draft and prototype inventory

Four annotation read repositories and three route modules now contain a preliminary freehand capability/preflight integration with scope watermarks and 426 handling; freehand remains OFF and no client advertises support. This is an UNACCEPTED DRAFT: root strict TypeScript and the five existing preflight unit tests pass, and the existing isolated Guest point/rectangle runner passed 19 fixture/API groups plus its 375px browser flow after the change. Those tests do not prove the new 426 behavior, deleted-row handling, races, all four scopes, or cross-invite isolation. Do not enable freehand until dedicated actual D1/route tests and review are complete. Existing separate delivery rejection remains unchanged.

Prototype inventory: Worker target UI has Owner workspace/project/album and Guest album flows, but many capabilities default OFF and no general interactive mock login/demo fixture exists. Local Worker interactive use requires configured OAuth and Owner bootstrap. The Next reference homepage/login can run without credentials but is not the full Worker product prototype. `pnpm.cmd dev` started local Next at 127.0.0.1:3000; HTTP root returned 200. Synthetic browser screenshots document only isolated test states. Delivery, cleanup management and freehand end-to-end remain incomplete; no hosted acceptance claimed.

## 2026-10-29 — Isolated interactive prototype

Added `experiments/gump-demo/` as an independent local-only interface prototype, not a product route. Launch from root: `pnpm.cmd exec vite --config experiments/gump-demo/vite.config.js` and open http://127.0.0.1:4174/. It uses CSS synthetic images and per-tab memory; album creation, share option summary, selection/filter and before/after slider are demonstrable without API, credentials or customer data. It explicitly does not generate real links or persist data; nonfunctional controls were removed or made noninteractive. The demonstration is not connected to actual Worker UI or evidence of MVP/hosted completion.

HTTP root returned 200. Chromium desktop 1440x900 and mobile 390x844 tests in `tests/e2e/gump-demo-preview.spec.ts` passed 2/2 after the final wording change, covering create, share settings reflecting selected 14-day/download values, selection, slider keyboard/drag/touch, mobile overflow, and no /api/ calls. An intermediate rerun failed because the previous expected share message changed; the updated assertion was rerun and passed. Screenshots in OS Temp are local synthetic test artifacts. No production/customer data, migrations or feature gates changed. Freehand compatibility remains an unaccepted draft as described in the previous entry; delivery/retention/hosted acceptance and full M1-M5 remain incomplete.

## 2026-10-29 — Freehand compatibility read and full-chain safety checks

Fixed a concrete regression in the preliminary compatibility integration: three annotation route error handlers had dangling `if` statements, which suppressed existing Guest 401 and Owner WorkspaceFailure status mappings and returned generic 503. Each now explicitly returns 426/ANNOTATION_CLIENT_UPGRADE_REQUIRED; existing error branches are reachable again. Root strict TypeScript and scoped route ESLint passed (only the existing React detection warning).

Root independently ran `pnpm.cmd exec vitest run tests/unit/freehand-read-compat-workerd.test.ts`: 6/6 passed using isolated Miniflare D1 fixtures. All four repository scopes exercised legacy 426, Guest own targeted old rectangle plus freehand beyond first 24 still requires upgrade, shared invite isolation, and Guest own preflight/page race returns 409 without items/cursor. Guest 401/400 and Owner route error mapping were checked; Owner 409 was injected, not an actual Owner race. Supported freehand parser/UI/journal recovery remains unimplemented, so this is not freehand feature acceptance. In particular old pending journals must remain intact until upgraded recovery is implemented; idle tabs have no instant invalidation guarantee.

Root independently ran `node tools/freehand-annotation-chain-workerd.test.mjs` from apps/worker, exit 0: fresh isolated workerd D1 applied 0001-0054; both empty and seeded Guest/Owner annotation/audit snapshots survived each of four injected proposal-batch failures; successful batch preserved existing data; accepted freehand and old geometry, replay/conflict, invalid geometry and authorization guards were exercised with FK0. The proposal remains REVIEW ONLY, outside auto migrations, and was not applied to persistent/hosted data. These tests do not establish Wrangler migration application or production parity. The feature remains default OFF; complete new-reader schema, canonical writers, journal, both UI editors, reviewed migration/adoption and end-to-end/hosted tests remain required. Earlier delivery 0055 rejection is separate and untouched.

## 2026-10-29 — Freehand contract and guarded writer preparation

Extended the existing strict annotation geometry union with the bounded freehand variant, retaining point/rectangle schemas. The Worker canonical serializer now handles all three while preserving legacy canonical byte order. Guest and Owner writers have a default-false freehand gate; routes inject the existing local-only capability. A new freehand request with the gate OFF is rejected, while an authorized existing request ID can reach the existing immutable replay/conflict guard; Guest expected identity is checked. This policy and exact writer behavior have focused fake-D1 tests, NOT actual workerd writer/trigger/audit acceptance. No feature flag or migration was enabled, and the proposal remains review-only.

Existing Guest/Owner annotation canvas renderers now draw freehand geometry as polylines and label it correctly, rather than treating it as a rectangle. Editors do not yet expose freehand creation, advertise read capability, or connect recovery; no complete product flow exists. Do not advertise `freehand-v1` until all Guest/Owner reads, processing, UI and journal recovery are verified. Unsupported old clients remain protected by the prior 426 compatibility path; already-open idle tabs have no instant invalidation guarantee.

Root independently ran writer/canonical/config Vitest 18/18, read-compat workerd Vitest 6/6, full root strict TypeScript and Web typecheck, scoped UI/test lint, and freehand isolated Chromium canvas 4/4. Agent ran existing Guest annotation isolated workerd/D1/R2 regression: 19 API/fixture groups and 375px browser passed, freehand not exercised. Initial scoped lint exposed existing explicit-any fixture declarations; added narrow documented exceptions for its partial D1 race wrapper, then lint and typecheck passed. No full suite, physical touch, production OAuth/R2, persistent migration or actual freehand writer/D1 E2E was verified. Next implement and test actual D1 writer and exact replay with proposal in isolation, then both editors/journals and supported-client headers, before considering a reviewed forward migration. Delivery and retention remain incomplete; prior delivery 0055 rejection is separate and untouched.

## 2026-10-29 — Freehand writer D1 and opt-in editors

Root independently ran `pnpm.cmd exec vitest run tests/unit/freehand-annotation-writers-workerd.test.ts`: 1/1 passed against real Guest/Owner routes and a fresh isolated Miniflare workerd D1 with migrations 0001-0054 plus the review-only proposal applied only in the temporary fixture. It exercises new writes with gate OFF, writes with gate ON, exact replay after closing, changed-body conflicts, wrong identity, immutable command/change/result/audit witnesses, unchanged failure snapshots and FK0. `PRAGMA integrity_check` is not supported by D1 (SQLITE_AUTH); it was removed from this test, not claimed as passed. This does not adopt a migration or prove hosted/cloud behavior.

Guest and Owner editors now have opt-in props `freehandCapability` and `allowFreehand`, each default false, mapping drawn strokes to their existing draft/journal commands and preserving exact request body/id on retry. Revoking the prop blocks saving and clears unsent brush drafts; re-enabling does not restore them, while existing journaled commands remain. No product caller enables these props, no trusted server capability endpoint is connected and no `freehand-v1` read header is advertised. The UI is not production-ready or an end-to-end enabled feature.

Root independently ran Guest Chromium fixture 3/3 and Owner Chromium fixture 2/2 (sequentially; concurrent first Owner attempt failed because both test configs use port 3116). Fixtures use mocked API, not integrated Worker. Cases include pointer drawing, identical-body retry and revoke/re-enable behavior. Root strict TypeScript passed; agent reports complete typecheck, focused Guest journal/editor Vitest 5/5, Owner journal Vitest 7/7, scoped lint/format passed. First Guest fixture run failed from incorrect mock URL, corrected before success; Owner initial fixture path was corrected before success. No real photos, persistent or hosted data, migration, deployment or feature activation. Next complete new-client read capability/upgrade messaging across ALL geometry read paths and recovery, integrate trusted capability without breaking legacy capability JSON, perform actual Guest/Owner end-to-end browser+D1 test, and only then review forward migration and local adoption. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Freehand reader and journal recovery opt-ins

Guest and Owner UI now have independent, default-false read-capability opt-ins, separate from brush/write flags. Guest own/shared pages, cursor and targeted recovery use the opted-in header; Owner authored pages/recovery, guest-list and processing targeted reads do likewise. Existing production callers do not pass opt-ins; no server write capability endpoint or feature activation is included. On authorized read 426, UIs show upgrade guidance and clear partial/stale visible rows while retaining persistent journals; Processing 426 also clears the Owner parent list. FREEHAND_ANNOTATIONS_DISABLED 409 remains uncertain/retryable instead of a revision conflict, keeping original request/body for gate reopening. Actual authorization remains server-side, and read support must remain independent of write gate when integrated.

Root independently ran Guest Chromium 8/8 and Owner Chromium 4/4 using mock API fixtures, plus root strict TypeScript. Agent ran Guest focused Vitest 33/33 including isolated workerd read-compat and repaired legacy fake D1 preflight fixture, Owner helper 3/3 and workerd compatibility 6/6, scoped lint/format. An initial Web typecheck failed because the new Owner processing fixture omitted coordinateSpace; agent corrected it and reran Web typecheck and 4/4 browser successfully. Initial test-fixture selector/config failures were corrected before passing runs. Browser tests are mocked, separate from workerd tests; hosted OAuth/R2, physical touch and end-to-end UI/Worker/D1 remain unverified.

Next integrate new-client read capability in all real product call sites independently of write gate, add a separate trusted write-capability endpoint without altering existing strict JSON, wire UI only after full authorization/recovery checks, and exercise real browser/Worker/D1 end-to-end before reviewed migration and local adoption. Freehand remains OFF; no migration or persistent/production changes. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Freehand read integration and guarded capability

Guest selection/comparison and Owner annotation panel/editor/processing now advertise supported `freehand-v1` reads independently of write permissions. Added separate strict `{enabled:boolean}` Guest and Owner freehand write capability endpoints; existing capability JSON remains unchanged. Capability requires the local-only feature gate AND exact SHA-256 fingerprints of both full annotation guard definitions in D1 sqlite_master; missing/mismatched/unavailable guards fail closed. This fingerprint check passed isolated workerd tests but hosted behavior remains unverified. The capability does not grant authority; command routes continue existing checks. Existing production callers can read supported geometry; brush remains hidden under default OFF and against existing 0054 guards. No migration was adopted.

Guest and Owner refresh write capability on focus, fail closed for new drafts, preserve independent reads and pending journals. Exact already-journaled requests remain retryable even when write capability becomes false so committed requests can recover; server rejects uncommitted ones with 409 uncertain. Root independently ran Guest mock-API Chromium 11/11, Owner mock-API Chromium 5/5, capability route unit 6/6, isolated workerd writer/schema 2/2, root strict and Web TypeScript. Owner unit 21/21 after updating stale preflight fakeD1, per agent. These are not hosted OAuth/R2 or complete E2E acceptance.

An added test-only `apps/worker/tools/freehand-browser-workerd-e2e.test.mjs` with Vite fixtures attempted real browser→Worker/D1. It FAILED before any annotation write: capability/me/annotation reads returned 200; actual image `/api/v1/photos/.../assets/preview` enters Playwright bridge but Worker.fetch does not return. D1 preview row and ephemeral R2 JPEG match size/checksum. No root cause established; retain test/diagnostics, investigate bridge and streamed asset behavior, rerun before any claim of UI→Worker→D1 acceptance. No persistent/customer DB, migration, deployment or flag activation. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Interactive prototype multi-page navigation

Extended `experiments/gump-demo` with working local-memory overview, projects, project albums, album studio, recent items, favorites, guest selection preview and photo detail/Before-After navigation. Create/share/selection and favorites are connected across the demo pages; all visuals are synthetic, state resets on reload, no real invitation or delivery is created and no product API is used. The demo remains separate from the actual Worker application; it is not proof of MVP completion.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 2/2 Chromium flows passed at desktop and 390x844, covering navigation round trips, create/share, selection/favorites state, guest preview, detail/compare, pointer/touch/keyboard slider, no horizontal mobile overflow, zero /api/ or external-origin requests. Root also used the existing in-app browser to open the actual overview. During implementation a failed stdin file-write attempt temporarily truncated two untracked demo source files; the worker restored them from validated temporary files, checked hashes/JS syntax and completed the passing browser checks. No customer data or production service changed. Prior freehand browser→Worker/D1 E2E failure remains unresolved; delivery and retention remain incomplete; no migration, deployment or 0055 draft changes.

## 2026-10-29 — Prototype single-photo collaboration

The isolated local demo now opens single-photo detail when the thumbnail itself is clicked or tapped. It includes previous/next, return, selection/favorite, Before/After, photographer 1–5 star rating, local per-photo comments, point annotations and colored freehand with show/hide and clear draft controls. Demo ratings, comments and marks are scoped by album/photo and held only in the current tab; no API or external request, real sharing, persistent data or production capability is implied. The UI is a prototype separate from actual Worker application.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: desktop and mobile Chromium 2/2 passed, covering thumbnail entry, previous/next/back, comments and ratings isolation/clear, selection and rating independence, favorites, point and colored freehand (mobile touch emulation), draft controls, comparison, no horizontal overflow and zero API/external-origin requests. Agent additionally reports scoped ESLint/Prettier passing. Initial fixture selector ambiguity was corrected before final pass. Physical phone, real user media, server integration and hosted acceptance were not tested. Modified untracked prototype files were backed up to temp and staged/hash-checked before replacement. No migration/production data/deploy or delivery 0055 changes. Prior freehand browser-to-Worker D1 preview bridge failure remains unresolved; full SaaS goal remains active.

## 2026-10-29 — Prototype responsive image proportions

Fixed the local-only synthetic prototype responsive scenes and icons to maintain proportions rather than stretching independently. Gallery and detail generated visuals use a consistent 3:2 frame; project/album covers retain their own aspect ratios and icon containers do not flex-shrink. The photo annotation SVG uses a matching 150x100 viewBox with normalized X mapping; point/freehand positions remain aligned to the frame and points remain circular on resize. This is CSS synthetic demo art, not proof of real-photo aspect-ratio handling in the actual product.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 4/4 Chromium desktop/mobile flow and geometry tests passed, including viewport resize, photo frame ratio, actual pixel circle shape and point/freehand relative alignment. Agent reports Prettier check and `node --check` passed. Initial new geometry assertion used separately normalized axes incorrectly and was corrected before final acceptance. Mobile uses browser emulation, not physical device. Prototype only, no production/customer data or migration changed; formal image/R2 and prior integration test limitations remain.

## 2026-10-29 — Photographer recommendation prototype and metadata foundation

The isolated gump-demo now has per-album photographer recommendation visibility, optional minimum 1–5 star and red/yellow/green/blue/purple label criteria, selectable any/all rule, live per-photo rating and color editing/clearing, and a Guest recommendation list/count. Customer selection remains independent. Default any-mode is a demonstration default; both modes are selectable. This uses synthetic initial labels and in-memory data, not uploaded metadata or the Worker application. Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 6/6 desktop/mobile Chromium tests pass, including threshold/color/mode/live edit/hide/selection independence and no API/external requests. Physical device not checked.

Added isolated `packages/image-processing/src/photographer-metadata.ts` and unit tests as an UNWIRED foundation. It extracts only selected embedded XMP Rating/Label from bounded JPEG/PNG/WebP via Sharp, reports missing/cleared/rejected/invalid/unknown states and never outputs unrelated metadata/raw label text. It is a deliberately limited strict XML/RDF subset, not standards-complete or production-ready; extended XMP, sidecars and custom/localized label-set mapping are unverified. Exact English color names only are interpreted, which cannot establish arbitrary custom Lightroom label colors. Root independently ran focused Vitest 23/23 and root strict TypeScript successfully; a prior root Vitest run failed 15 tests due to a real root-marker initialization bug, subsequently fixed before the passing rerun. Synthetic encoded images are not real customer upload acceptance. No migration/schema/API/upload pipeline hookup or persistent data change. Next design version-bound source evidence, safe imported-vs-manual precedence/clearing, durable recommendation policy, audited tenant-scoped services/routes/UI, and true bounded upload/processor integration with real format fixtures before claiming the requested feature complete.

Backup caveat: an agent accidentally overwrote the exact temp backup of the task-start untracked demo main.js while staging; a reconstructed pre-feature copy does not match the original hash and must not be represented as exact. Installed current demo remains intact/tested; an older responsive snapshot and exact task-start CSS backup remain in Temp. Delivery/retention and actual freehand browser→Worker/D1 integration remain incomplete; no 0055 draft touched.

## 2026-10-30 — Prototype navigation and processing preferences

Local demo now includes connected Owner/Guest navigation and processing preference UI: Cloudflare first (default), Oracle first, or either alone. This is in-memory prototype state only; R2 storage is distinct from image processing. Neither Oracle nor Cloudflare Images is connected, no fallback is executed, and no service status is probed. The existing private R2 adapter and direct-upload code have local test coverage but real account, bucket, CORS and live end-to-end upload are not verified. Wrangler can list R2 buckets on its current default account; the user must identify the intended account before remote changes. Do not enable hosted upload flags or bypass deployment gates. Automatic deletion stays OFF. Preserve unrelated dirty changes.

Next: confirm intended Cloudflare account; provision or select an isolated staging bucket, configure exact-origin CORS and narrowly scoped credentials, then verify signed uploads, checksums and recovery before production enablement. Complete real persistence, provider implementation and production acceptance for processing settings. See CHANGELOG and TASKS for current scope.

Verification: existing prototype Playwright suite 6/6 passed before the final small account-entry/stacking fix; the 390px navigation focused test passed after the navigation fix. The new end-to-end smoke reached settings after invitation, selection, history, delivery and account interactions, but its final automated radio check failed because the styled card intercepted the direct input click; do not mark this full smoke passed. Processing settings were independently exercised in a browser. Live R2 and CORS are not checked in this run; the existing full Cloudflare smoke was not rerun because it overwrites existing artifacts. Preview server manually started on 127.0.0.1:4174.

## 2026-10-31 — Kino Pick naming

Formal product name: Kino Pick（奇諾選圖）. Display names and current documentation updated; existing internal identifiers and historical evidence remain unchanged for compatibility. Directory rename pending if Windows reports an active process. No cloud, migration or customer data changes.

## 2026-10-31 — Prototype photo lightbox

Local synthetic photo detail opens a modal lightbox when clicked in view mode; Escape and close control dismiss it. Point/freehand modes retain annotation behavior, and the lightbox shows the current markup. Browser checked click-to-open, Escape and point-mode non-opening; mobile/real media/production integration not checked. This remains a local in-memory demo. Project directory rename is still blocked by Windows access denied, including a user-run PowerShell attempt; root cause unconfirmed. No cloud or customer data changed.

## 2026-10-31 — R2 staging bucket provisioned

Account kinoaaron2026@gmail.com first Cloudflare account: created Standard R2 bucket `kino-pick-staging-d3e93046`; staging PRIMARY_STORAGE and R2_BUCKET_NAME now reference this same bucket. Hosted upload and other deployment gates remain OFF. A synthetic text object `connectivity/358f9053-9c4e-4611-9284-10c5c966a269.txt` was written remotely and read back; both SHA256 hashes equal 323CE13DF099BE4E86EB3E57C70E8BCA843894EE464F044DE168451EB003A38D. Object retained for traceability; no customer data. Test-bucket CORS readback: origin http://127.0.0.1:8787, PUT, headers Content-Type/If-None-Match/x-amz-checksum-sha256, exposed ETag, max-age 300. This is only a local development origin, not a staging website origin. No live browser signed PUT, real S3 signer credentials, D1/OAuth integration, deployment or derivative processing verified. Next create suitably scoped test-only R2 signer credentials outside Git, verify live CORS/preflight and actual signed upload including immutability/checksum, then assess isolated D1/OAuth staging and deployment readiness. Do not bypass gates or enable automatic deletion.

## 2026-10-31 — Real R2 browser signed PUT acceptance

Using the isolated staging bucket `kino-pick-staging-d3e93046`, Chromium from `http://127.0.0.1:8787` used the actual `presignR2Put` signer and a synthetic PNG: CORS preflight HTTP 204, browser signed PUT HTTP 200, replay HTTP 412 (expected create-once protection), remote Wrangler readback SHA-256 matched. Final isolated test exited 0. The expected 412 appears as a browser console error. Prior attempts failed: initial wrong access-key format (R2 InvalidArgument); then Windows test harness readback command quoting failed after successful PUT/replay; fixed before final pass. Separate diagnostic synthetic objects remain in the test bucket. This validates real signed R2 upload/CORS and readback, not the complete product UI/API/D1/OAuth pipeline, production, or hosted origin. All deployment and automatic deletion gates remain OFF. Next integrate and validate the full isolated application workflow with scoped credentials; do not bypass readiness gates. Test-only browser runner is in the conversation visualization directory.

## 2026-10-31 — Cloudflare B staging isolation and deployment guard

User selected one kinostudio GitHub account, GitHub Actions deployment to Cloudflare B; existing A repositories/deployments must remain untouched. GitHub connector can list kinostudio repositories, but no Kino Pick repository is listed; this local repo has no Git remote and kinostudio gh authentication is invalid. User is completing gh login. No GitHub repo, secret, branch, commit, push or deployment was created in this step. Avoid publishing 51 modified tracked files and extensive untracked work indiscriminately; inspect intended snapshot, secrets and 0055 boundary first.

Created empty remote D1 `kino-pick-staging-d3e93046` (cdee0ac7-bf91-4852-9c17-a996c0b84f8d) in Cloudflare account d3e930465c0df7e89b35de3ca65ea36a and configured staging binding. Remote SELECT 1 passed with zero rows changed; no migrations applied. Existing staging R2 binding remains in same B account. Workflow .github/workflows/deploy-cloudflare.yml now verifies deployment account matches B; tested Bash guard correct=0/wrong=1; Prettier check passed. Existing deployment-readiness check remains intentionally closed (staging check exited 1 as designed); no live product deployment or hosted E2E. Python YAML check unavailable because PyYAML is not installed; Prettier validated parsing. All feature flags/automatic deletion remain OFF; no production customer changes. Next authenticate kinostudio, inventory intended repo, choose safe private snapshot and review before publishing; then provision scoped Actions token and complete migration/restore, OAuth and hosted acceptance before opening deployment gates.

## 2026-10-31 — Private GitHub repository created

Created kinostudio/kino-pick through the GitHub website and independently verified visibility=private and admin/push access through the GitHub connector. User-level gh now authenticates as kinostudio. Kino Pick source is being published as a complete scoped snapshot on a separate codex deployment branch while preserving the original working-tree branch/index. Exclude apps/worker/migration-proposals/ from the snapshot. Static candidate secret scan found no private-key/GitHub-token patterns across 682 candidate files (not a complete secret audit). Updated deployment workflow installs Chromium before Cloudflare browser checks and verifies account B; existing cutover guard remains closed. No A account repository/integration/deployment changes. CI/hosted deployment results must be recorded after actual execution.

## 2026-10-31 — First private CI and local verification

Remote main 626f8ad4e9340eb2e7cc6981272188d500ad67a2 is the first complete scoped snapshot. GitHub run 41112350689 failed at zero-warning lint with five warnings. Fixed unused helper/counters, anonymous Vite config export and side-effect ternary; no lint threshold relaxation. Fixed stale annotation-history assertion to filter annotation actions rather than assuming last-five enum ordering. Local latest unit 820/820, integration 61/61, and complete typecheck passed. First concurrent integration run had one 5s timeout; sequential full rerun passed without changing timeout. Handoff checker passed. Token draft is B-only, 30 days, Workers Scripts Write + D1 Read + R2 Storage Read + Account Settings Read, awaiting user's action-time approval before creation or storage. New repository staging environment created and CLOUDFLARE_ACCOUNT_ID secret set only in kinostudio/kino-pick. Actual deploy remains gated/unfinished; no A changes.

## 2026-10-31 — B deployment token stored and connection workflow

User explicitly selected no expiry and approved creation/storage. Created account-owned B-only token: Workers Scripts Write, D1 Read, Workers R2 Storage Read, Account Settings Read; saved only as CLOUDFLARE_API_TOKEN in kinostudio/kino-pick repository secrets. Browser confirmed secret added; token not printed or committed, clipboard and runtime secret variables cleared. Account ID secret already matches B. No A changes. Added manual read-only connection workflow to validate GitHub Actions credentials against B staging R2 metadata and D1 SELECT 1; it does not deploy or apply SQL migrations.

CI run 41113315272 failed because the initial publishing filter omitted apps/worker/migration-proposals/annotation_freehand_geometry_v1.sql, required by isolated workerd tests. Include that exact review-only fixture in the private repository under migration-proposals; never move it into automatic migrations or apply remotely. This corrects the earlier overly broad proposal exclusion. File SHA256 BB6FB62F7C8C12688689700DEDEDC0E3E13A1F4782CC115C44CC928C9BF78AC4. Other unfinished delivery draft boundaries remain unchanged. Next rerun CI and actual B connection workflow; product deployment gate remains closed pending its original acceptance requirements.

## 2026-10-31 — GitHub Actions B connection passed

Actual workflow 41114135793 completed SUCCESS (44 seconds): GitHub runner used the repository secrets, verified expected B account, read staging R2 metadata and executed SELECT 1 on remote staging D1. No deploy/migration/data mutation in that workflow. Token is no-expiry by explicit user confirmation, scoped only to B and stored in the new Kino Pick repository. Repo remains private; remote main d138ddc2d97007fcd81d8e0a6b4c823791a0e7bd before this follow-up.

CI browser orchestration corrected after test discovery showed 40 tests incorrectly sharing the Next reference server: reference config now runs its 14 cases; CI explicitly executes the four existing dedicated freehand/Guest/Owner/prototype configs, retaining all 40 cases with their own servers. Prototype Vite command now uses the web package's declared Vite dependency and platform-neutral pnpm rather than Windows-only pnpm.cmd. Discovery of reference14 passed; full amended CI pending. Product cutover guard remains closed; OAuth/schema/restore/hosted product acceptance and website deployment remain unfinished.

## 2026-10-31 — Full CI reached Cloudflare smoke; final branding assertion

Run 41115227851 passed documentation/format/lint/types,820 unit,61 integration,Next build and all40 reference/dedicated Chromium cases. The final Cloudflare smoke failed at its static HTML /KINO Pic/ assertion against the renamed Kino Pick page; updated only that expected brand. Existing product gates remain closed. Separate Actions B resource connection remains SUCCESS in run41114135793. Dedicated local browser tests passed4+11+5+6. Full CI needs rerun after the final assertion change; no actual website deployment claimed.

## 2026-10-31 — Deployment handoff clarification

GitHub B connectivity is complete: private kinostudio/kino-pick; repository-only B account ID/API token secrets; no-expiry token explicitly approved. Actual read-only connection workflow41114135793 is SUCCESS. R2 browser signed PUT200/create-once replay412/hash readback also passed separately. These results do not establish real-provider OAuth, a deployed product, hosted signed uploads or complete backup/restore. No FILM.KINOSTUDIO resources or integrations were modified.

CI41116402851 was manually canceled for diagnostics; its retained complete log shows it was still progressing through matching-rule checks. The live browser log had only loaded a portion of its output, so the apparent assisted-upload stall was not a confirmed product failure. Current CI41118459908 (5d425ec) adds running-case messages and bounded120s per-case failures; full result is pending until a later checkpoint below. Do not report the canceled run as passed or failed.

Next cutover order: establish a real staging HTTPS origin and private OAuth secrets/allowlisted Owner bootstrap; rehearse staged schema migration plus consistent D1/R2 backup/restore (keep review-only SQL out); verify hosted authentication/session, private upload/processing, Guest access and abuse/runtime limits; then replace the deliberately closed guard with verified acceptance in a reviewed cutover. Existing hard-local/default-OFF feature gates require implementation review; merely setting readiness booleans true cannot deploy. Automatic deletion remains OFF/dry-run.

## 2026-10-31 — Complete local Cloudflare regression passed

The final local pnpm test:cloudflare completed exit0:368 checks passed on the5d425ec executable tree. Evidence is ignored apps/worker/.local/cloudflare-ci-2026-10-31.log. This includes Worker/UI build, native temporary D1/R2, controlled Chromium375px flows, private uploads/derivatives, immutable versions/matching, invitations/selection/feedback, comments/annotations, history/export and dry-run/Cron guards. Expected injected OWNER_HISTORY_EXPORT_FAILED errors occur in the fail-closed export tests and those checks passed. This is local fixture acceptance, not real OAuth, hosted product acceptance or remote schema adoption. Do not repeat the passed suite for documentation-only closeout. GitHub run41118459908 terminal status is recorded separately below when complete.

## 2026-10-31 — GitHub test steps passed; metadata finalization pending

Run41118459908 on5d425ec0730d8ad642ade896b82b50489e1db4db has all23 job steps completed/success, including Complete job, per fresh job API. All19 setup/build/test steps and three post steps passed:820 unit,61 integration,40 Chromium cases and368 local Cloudflare checks. The live job log also shows the368-check final line. At closeout the run and job top-level API status still says in_progress with null conclusion despite every step being completed/success; do not claim a finalized green workflow until GitHub publishes that state. No code/test changes are pending after this executable snapshot; following commit is documentation-only and skips a duplicate CI run.

Read-only actual Actions→B resource connection remains finalized SUCCESS in41114135793. Actual private R2 signed upload/hash/create-once test passed independently. Website deployment has NOT occurred: real OAuth/Owner bootstrap, staged migration and backup/restore, hosted product/security/runtime acceptance and reviewed cutover remain open. No A/FILM.KINOSTUDIO changes or customer data mutation.

## 2026-10-31 — Photo native-save interaction restriction

Added shared apps/web/photo-interaction-guard.ts and CSS to the Worker React entry, Next Providers and prototype. Capturing contextmenu/dragstart handlers prevent native save/drag on img,canvas and explicitly marked synthetic photo surfaces, including dynamic grid/detail/Lightbox/comparison content. Text fields retain context menus; normal button/link clicks, drawing and pointer sliders are untouched. Existing download APIs/permissions and audit remain authoritative; this UI restriction cannot prevent screenshots, developer tools or a user saving bytes already delivered to their browser. Safari touch-callout suppression is declared in CSS; actual iOS long-press behavior was not checked.

Validation: scoped ESLint0 warnings, web typecheck and target UI build passed; existing six desktop/mobile prototype Playwright cases passed. Isolated Chromium checks confirmed canceled photo/image contextmenu and dragstart, preserved input contextmenu/button click, and opening the Lightbox. No schema/API/credential/deploy changes; no broad regression rerun. Target build still reports its existing >500kB chunk warning. Hosted browser acceptance was not performed.

## 2026-10-31 — CURRENT: online MVP release objective and automatic continuation

User requested review of development planning and automatic continuation toward publishing a usable online MVP. docs/MVP_RELEASE_PLAN.md is the current execution/acceptance order R0→R6; original product/security requirements remain. Existing kino-pic heartbeat was PAUSED and has been updated through the app tool to ACTIVE at the existing61-minute interval in the same thread, with progress-only notification intent and a concrete release objective. No duplicate automation created. Legacy goal object was observed paused; its status is controlled by the user, not changed or marked complete by this work.

Implemented read-only tools/release-inventory.mjs and pnpm release:inventory, with4 node:test cases. It inventories configured origin/bindings/default security, seven acceptance records, local-only guards, migration filenames and source hashes without reading secrets/remote data. --check exit1 is the expected current release-blocked result, not a test failure; it never authorizes deploy. Actual current inventory: placeholder staging origin,seven incomplete acceptance records,28 local-only errors,54 source migrations through0054. Disabled features remain OFF.

Four tests and scoped ESLint pass (existing React auto-detect informational warning). Isolation-safe Wrangler secret list --env staging returned Worker kino-pic-staging not found, so runtime Secret presence is unverified; no remote writes. gh API call returned no active CLI login in this execution context; do not assume older auth remains current or request repeated login while the connected GitHub/browser fallback is available. Prior CI top-level finalization was not reverified. Current next task R1-01: determine exact B HTTPS staging origin/callbacks, real OAuth/Owner bootstrap; proceed independently with isolated restore/processing work when external credentials are missing. No gate bypass, schema application, production deployment, customer data change or A/FILM.KINOSTUDIO mutation. Latest photo native-save restriction remains in the local tree.

## 2026-10-31 — R1-01 HTTPS namespace prepared; OAuth confirmation pending

Advanced beyond inventory: isolated existing Wrangler OAuth credentials were used only in memory for the official B account API. Account GET200 confirmed exact B ID; Workers list count0; subdomain GET404/error10007 confirmed missing namespace. Created kino-pick-aaron2026 with PUT and read back GET success. No Worker code, routes, photos, A account settings or credentials were published. Source staging APP_URL is now https://kino-pic-staging.kino-pick-aaron2026.workers.dev; workers_dev remains false and the Worker does not exist yet. Both OAuth callback paths are fixed in MVP_RELEASE_PLAN. Source inventory now has no configuration blockers but still seven incomplete acceptance records and28 informational local-only errors; never interpret that as deployment acceptance. Worker types regenerated, scoped lint passes; existing4 inventory tests pass and added to CI. No full suite repeated.

Current browser Cloudflare login can only access A, so it was left unchanged. A new read-only B dashboard lookup showed not-found/access denied; used the existing isolated CLI credentials instead of disrupting A login. GitHub browser account is confirmed kinostudio; only existing OAuth App is KINO Studio CMS (Weebly), untouched. Kino Pick Staging new OAuth form is filled with exact callback, no wildcard/device flow, expiring user tokens default; not submitted. One action-time confirmation to create app/Client Secret and save only in ignored local settings/B staging Secrets is pending; do not submit before reply and do not repeat the question. Retained OAuth form tab for handoff.

Independent R2 preparation: actual remote staging D1 table-name query returned only _cf_KV, changes0/rows_written0; no product schema has been applied. No remote SQL writes or migrations. Initial Python metadata helper failed because installed Python lacks tomllib; no request or mutation occurred, Node fallback completed the verified API operations. gh CLI auth remains unavailable in this invocation; browser/connector remain the fallback. Next continue OAuth when confirmed and fresh isolated backup/restore/schema rehearsal without modifying customer data.

## 2026-10-31 — GitHub OAuth approved, created and safely stored

User approved the exact staged OAuth app/Client Secret creation and local/B Secret storage. Created kinostudio Kino Pick Staging App3979161; fixed callback/no wildcard/no Device Flow. Existing CMS App untouched. Generated one Client Secret, transferred only via one-time loopback UI form to ignored .local/staging-auth-secrets.json, generated random BETTER_AUTH_SECRET, cleared one-time browser Secret view/variables and stopped receiver. Local file ACL protected to current user/SYSTEM/Administrators; Git-ignore checked; all691 Git candidates had no new Secret value.

B kino-pic-staging now exists as an infrastructure-only closed503 container because a new Worker cannot store runtime Secrets before its first version. Dedicated config fixes B account, workers_dev=false,preview_urls=false,routes=[]; no product code/D1/R2/assets/Cron. Preflight verified account and Worker404 before upload. Remote settings/subdomain confirm exactly3 secret_text bindings and both public entry flagsfalse. Proof .local/staging-auth-provision-proof.json; successful sanitized log .local/staging-auth-provision.log. This is not product deployment or real OAuth acceptance; original cutover guard/readiness/all feature gates remain unchanged. Never rerun provisioning config against an initialized product app. See docs/STAGING_AUTH_PROVISIONING.md.

Validation:12 local fail-closed route/method checks,scoped lint,Wrangler dry-run,root strict TypeScript and real remote Secret/type/routing metadata passed. First Cloudflare attempt rejected future compatibility date10021 (clientTaipei10/31 vs providerUTC); retained first failure log then used existing2026-10-23 date and succeeded. JSONC parse and diagnostic Python cp950 issues were corrected before acceptance. Protected-file sandbox denial was expected after ACL,authorized scan passed. No broad suites repeated,no database migration/customer data/A changes.

Authenticated GitHub profile confirms kinostudio stable provider subject255123716; one-time Owner bootstrap SQL/proposal prepared via existingCLI under ignored.local,remoteApplied=false. Do not regenerate internalUUID or apply before schema/restore rehearsal. Next R2 schema backup/restore/parity then staged Owner bootstrap/auth validation. Google credentials and real-provider login/link/unlink/session proof remain unfinished. No repeat confirmation or Secret request is needed for the approved GitHub app.

## 2026-10-31 — CURRENT: cloud D1 restore + real GitHub Owner auth passed

Read docs/STAGING_DATABASE_AUTH_ACCEPTANCE.md for complete current scope/evidence/recovery. Applied existing54 migrations through0054 to previously empty B staging DBcdee0ac7-bf91-4852-9c17-a996c0b84f8d after fresh backup and isolated native D1 restore/upgrade/parity. Initialized exactly one previously verified kinostudio Owner using the prepared immutable UUID proposal. Independent cloud restore DBkino-pick-restore-6b279dee/ef13f9cd-69fa-4a48-9ecd-546bb2964b68 has134 tables, identical schema/data hashes and identical exported SQLSHA,FK0. Original persistent local D1 untouched; no A/customer/draft SQL changes.

Implemented narrow staging-auth-validation entry/config/gate reusing Better Auth and current Owner authorization,without product routes/Assets/R2/Cron.10 native denials pass (Miniflarev5 compatibility startup error fixed using existing convertV4 helper). After proof-gated temporary staging publication, browser completed REAL GitHub OAuth App3979161,read:user/user:email,PKCES256 and Owner callback. Remote counts1user/1Owner/1fresh prepared-owner session/1signin audit/provider token present.6 real hosted negative checks pass. Browser logout produced0sessions,1signin+1revoke audits,user/Owner remain1. Final post-logout CDP snapshot timed out,not counted as browser evidence;backend state verified.

Publicworkers.dev andVersion URL then disabled and read back false;config defaultfalse too. Version6578710d-76ee-4d8c-aeea-f5cf48f26fe1 remains auth-only,not product/MVP. real_oauth_and_owner_bootstrap_verified nowtrue specifically for GitHub/Owner baseline;Google/dual-link/fullsession controls and R2-inclusive restore remain pending,other readinessfalse and original product/production guard still exit1. Scopedlint/rootstrict/dry-run and detailed native/remote evidence passed;no broad rerun.

NextR3: staging has only3OAuthSecrets and lacks S3 signing credentials. Read-only accounttoken metadata403/code9109 with currentCLI; prior local R2test key file was deleted as promised. One user request to log into B in an isolated IAB tab6 is pending;EdgeA untouched. Do not ask again or print keys. While waiting, implement real Cloudflare Images adapter/new recipe+compatible migration (existing local-sharp recipe must stay immutable),durable priority/quotas and tests;do not claim prototype settings are real integration. R2CORS needs actualstagingHTTPS origin,then100-photo privateupload→derivatives→gallery acceptance. Do not rerunOwnerbootstrap/migrations or the closed provisioning config.

## 2026-10-31 — R3: private R2 credentials and real Images capability

The user completed isolated B login and explicitly approved creation/safe storage of the new `Kino Pick staging direct upload` credential. It is Object Read & Write for only `kino-pick-staging-d3e93046`. The browser's existing broad `R2 Account Token` was not reused or modified. New signing credentials are stored in ignored ACL-protected `.local/staging-r2-secrets.json` and B staging encrypted Secrets; never print their values. Token verification returned active/200; expiry was not reported by that API, so absence of an expiry field is not independent expiry proof. No further login/key approval is pending.

Real existing S3 signer checks passed: PUT200, create-once replay412, authenticated GET200 with identical SHA256, account-wide ListBuckets403. Six expected runtime Secret names/types were verified without printing values. Bucket CORS now permits PUT only from localhost8787 and the exact staging HTTPS origin, with Content-Type/If-None-Match/checksum headers. Fresh signed-URL OPTIONS passed204 for staging and denied403 for a foreign origin. The first unsigned/immediate preflight lacked allow-origin and is preserved as a failed diagnostic, not acceptance. Evidence: worker `.local/staging-r3-s3-proof.json`, `staging-r3-secrets-proof.json`, `staging-r3-cors-proof.json`. A scan of698 Git candidate files found zero new key-value matches.

Implemented operator-only `apps/worker/tools/probe-cloudflare-images.ts`. With an ignored fixed-B config, `wrangler dev --remote` actually read a private synthetic2x2 PNG from staging R2, ran the native Images binding, generated both JPEG variants, conditionally stored them in a distinct `__capability-tests/` prefix and verified readback SHA. HTTP200/status cloudflare_images_binding_passed; each output269 bytes/2x2 because scale-down never enlarges this source. Evidence `.local/cloudflare-images-probe-result.json` and sanitized run log. Scoped lint/Prettier and root strict TypeScript passed. Remote development was stopped after the probe. No zone/domain, paid plan, customer image or A/FILM.KINOSTUDIO resource was modified.

This proves Cloudflare remote-development processing capability, not the durable product pipeline, normal-size orientation/animation validation, production entitlement/quotas,100-photo upload or hosted Grid/Lightbox acceptance. `private_direct_upload_verified` remains false. Public staging/preview entry flags remain false; original product cutover guard, single-node default and automatic-deletion OFF/dry-run remain intact.

Next concrete slice: implement a separate Cloudflare recipe/adapter compatible with immutable existing local-sharp jobs; safely migrate recipe constraints/outbox and canonical output paths; preserve source checksum/size/decode, leases, bounded outputs, quota reservations and create-once writes. Do not relabel Cloudflare output as local-sharp-0.35.5-v1, globally remove local-only gates or apply the unfinished delivery draft. Then integrate actual upload-init/complete, processing and private gallery before100-photo hosted acceptance and R2-inclusive backup/restore. Oracle remains a candidate, not an assumed running service.

GitHub CLI works as kinostudio when not inheriting Wrangler's isolated XDG_CONFIG_HOME. Apply XDG isolation only to Wrangler processes; do not repeat GitHub login requests. Current remote main6e1d333fe92ec11270607629412c4affc6260542 was verified, and earlier CI41118459908 is now completed/success. This prior CI is not acceptance for the current unpushed source additions.

## 2026-10-31 — R3 source publication checkpoint

Snapshot21fa48431659dcd0ae1224d7eb68c54feb399314 was pushed to private kinostudio/kino-pick main and remote SHA was verified. Thirty changed files preserve the original foundation worktree/index;699 candidate files passed OAuth/R2 credential-value scanning with zero matches. No customer migration or product deployment ran. CI checks41135636903 is in_progress at this checkpoint; do not call it passed until final status is verified. Newly added isolated auth dry-run/native10 checks, whole-tree Prettier and54-file handoff presence checks passed locally; prior lint/type/provider evidence retains its stated scope. Next execution must check this single CI run, fix any real failure, then implement the Cloudflare adapter/recipe/durable-job slice. No repeated login/key approval is needed.

## 2026-10-31 — R3 actual Cloudflare Images adapter implemented

Previous source21fa484 CI41135636903 completed/success (all steps including isolated auth validation). Implemented the existing image-processing interface with distinct cloudflare-images-jpeg-82-v1 recipe; extracted/reused animation checks without changing Sharp behavior. Strict snapshot/hash/raw dimensions,16MiB internal source cap, sequential bounded output streams/cancellation, progressive-scan metadata stripping and provider-error sanitization are implemented. New7+old10 focused tests pass; scoped lint/rootstrict pass. Real B remote-development now invokes this adapter and returned200 with two private checked derivatives; proof worker.local/cloudflare-images-adapter-result.json. Probe stopped; no product/DB/A changes. See docs/CLOUDFLARE_IMAGE_PROCESSING.md for limits and exact next migration/recipe integration. It is not registered in the product: existing64MiB upload ceiling and immutable Sharp job recipe must be reconciled explicitly before activation. No normal-size hosted/100-photo/MVP claim; product gate and auto-delete remainOFF. This slice contains no migration to apply or customer-data change.

## 2026-10-31 — Adapter publication checkpoint

Published and verified private main cdddc19f75ca99180e0bb1c85dc616b97b413862, preserving original HEAD/index.703 Git candidate files scanned for approved OAuth/R2 secret values:0matches. New CI is pending completion; verify the run for this SHA next, without rerunning the already-green prior CI41135636903. Actual adapter probe passed at worker.local/cloudflare-images-adapter-result.json; remote-dev session22258 stopped. Next highest-priority slice is compatible processing-recipe migration/durable integration and the16MiB-versus64MiB admission decision, then hosted upload/derivative/gallery acceptance. No new login/credential approval needed; no D1 migration or product cutover occurred this slice.

## 2026-10-31 — R3 compatible processing migration adopted in B staging

Read docs/STAGING_PROCESSING_ACCEPTANCE.md.0055 now exists and was applied ONLY to B staging after fresh backup, isolated native populated8-group acceptance and an independent cloud restore+upgrade. Remote staging ledger55;133 original product tables unchanged,FK0,schema equals independent upgraded cloud DB66bba5de-c020-40a5-b8a0-f2431bc8f781. Public entryfalse;default local persistent D1 still0052. Never regenerate/overwrite applied0055 or run the old54-only rehearsal against the55 source tree.

New persisted per-workspace Owner policy API/UI, exact-recipe claims/review keys,16MiB Cloudflare admission and bounded durable upload-wake/Cron integration are implemented; cloud runtime defaultsOFF/production activation guarded.20 scoped unit tests,8 native/API/mobile groups,rootstrict/scopedlint and Worker/UI build passed; real cloud full upload/Images/gallery100-photo flow remains pending. Fresh protected exports and proof paths/recovery/failed diagnostics are in the acceptance doc. Main product gate and unfulfilled readiness remainclosed;auto-deleteOFF/dry-run,single-node. Previous cdddc19 CI41139959773 passed;new source requires one CI run. User selected pick.kinostudio.tw and confirmed DNS in A;no A/DNS change has been made. Next gated hostedOwner upload/Images/gallery acceptance and D1/R2-consistent restore; do not rerunOwnerbootstrap or request keys already saved.

## 2026-10-31 — CURRENT: B staging56; upload/processing/gallery integration accepted in isolation

Supersedes prior55-only checkpoint:0055 remains immutable;0056 adds reciprocal Owner request namespace and bounded Cloudflare IO-review guards. Actual B staging AND independent rehearsal DB now have56 migrations; fresh private backup/parity/FK0 passed,135 existing product tables unchanged and public/preview entryfalse. Details/recovery: docs/STAGING_PROCESSING_ACCEPTANCE.md; protected `.local/staging-0056-apply-proof.json`. No A/DNS/customer/default-local mutation.

Final focused20 unit checks and10 isolated native/API/mobile groups pass, including atomic migration rollback, old job preservation, Owner policy persistence/replay/collisions/tenant denial,16MiB quota-safe refusal, V1/V2 completion-aware busy lock, Cloudflare recipe claims and review fences, three transient failures→IO review with reservation retained, private derivative/gallery finalization and375px save/reload. The integration uses a Sharp-backed Images double; earlier real Cloudflare adapter probe is separate. Worker/UI build,root/Web strict and scopedlint pass; full-chain test harnesses now use official split+atomicbatch for the larger migration. Production/cloud flag defaultsOFF and release gate remainsclosed.

Next concrete task: push this source, verify its single CI run, then create a narrowly gated hostedOwner B upload validation with native Images/private R2/gallery/100 test photos and D1/R2-consistent restore. The updated product Worker itself has NOT been deployed; remote schema success is not hosted product acceptance. Preserve missing Google/link/session/Guest/version/delivery/security requirements and do not mark MVP released. User-selected production hostname is pick.kinostudio.tw in A; existing staging callbacks stay unchanged. Prepare hostname-only entry routing without root/NS/existing A deployment changes and resolve exact permissions before applying. No repeated credential/login request needed.

## 2026-10-31 — Published processing integration checkpoint

Private main6709d0bdab307f9ddb7b76ce47f0b5e0a91f2ae2 was pushed and remoteSHA verified.714 Git candidate files had zero approved OAuth/R2 credential-value matches;original HEAD/index preserved. CI41147833540 is running (last observed typecheck,no failures);do not claim a pass before finalization. Next read that one run and fix any actual failure,then perform narrowly gated hostedOwner R2/Images/gallery acceptance. B staging schema56 is already adopted with verified backups and independent cloud parity;the updated product Worker is still not deployed. No A/domain/public-entry change. Currentselecteddomainpick.kinostudio.tw remains a future release hostname,not a live-site acceptance URL.

## 2026-10-31 — Owner hosted-upload validation prepared; CI hold enforced

Added a closed-by-default B-only staging upload validation entry/config, reusing actual product Owner auth/API/UI with only direct upload/Cloudflare processing enabled. Guest routes/registration/production/foreign host+Origin are rejected;no original feature guard is removed. Actual dry-run/rootstrict/scopedlint pass and14 isolated route/static/denial checks pass. Images is a presence double here;not a provider/hosted upload result. Read docs/STAGING_UPLOAD_VALIDATION.md.

Added scoped tools/check-staging-upload-validation.mjs coupling adopted56/independent restore,Secret names,exact tested bundle and successful core CI plus unchanged backend/UI via temporary index. Actually ran it: CI41147833540 at6709d0b is stillin_progress,so gate correctly refused. No deploy/public-entry/DB/R2/A/DNS change this heartbeat. Prepared source is local/unpushed pending the existing CI outcome;preserve it. Next check only that run,fix any actualfailure,then refresh safe CI metadata and proceed with exact scoped preflight/publication/controlled hosted Owner validation. No new credential/login/useroperation is required now. Do not claim MVP release or private_direct_upload_verified.

## 2026-10-31 — Core CI finalized; restricted Owner upload preflight passed

CI41147833540 completed/success for6709d0b with no failed steps. Refreshed actual safe CI metadata and ran scoped tools/check-staging-upload-validation.mjs:passed_owner_upload_staging_preflight. Backend/UI inputs match accepted CI through a temporary index;config/source/bundle match the14-check native validation and adopted56/independent-restore proof. No production deployment is authorized by this gate. The new Owner-only entry/config/checker are ready for exact source publication and CLOSED B deployment,then metadata/denial checks before controlled public staging validation. Do not call this hosted product or100-photo acceptance yet;existing main product/production guard and readiness remainunchanged. A/DNS unchanged. Native Owner boundary check added to CI without rerunning broad suites locally.

## 2026-10-31 — CURRENT: 真實 hosted Owner／100 張 R2＋Images 圖庫驗收通過

B 的 Owner-only staging 已實際部署，來源 `7be9f78496103076f110a4f9e58e96788265f1da`，Worker version `1441d058-27f1-44e8-9440-4861f88d7f47`；CI41154235653 completed/success。真實 GitHub Owner 登入後，以產品介面建立測試 workspace/project/album，五批各20張合成JPEG經瀏覽器私人R2直傳及原生Cloudflare Images完成。100 jobs succeeded、300 assets、reserved0；全部300個物件GET/byte/SHA檢查通過，200衍生JPEG完整解碼、320/2048尺寸及比例、metadata移除與10張EXIF6方向通過。實際Edge圖庫24→48→72→96→100、100個唯一檔名／全部縮圖載入；直式1000×1600與下一張橫式1600×1000燈箱、關閉操作通過。匿名私人縮圖401，原7項hosted邊界通過。

這是受限 staging Owner 流程，非完整MVP。`private_direct_upload_verified`仍不提升為完整發佈就緒：跨租戶／配額故障hosted、含R2的備份復原及Guest等要求仍需完成。詳細scope/證據/復原下一步見 docs/HOSTED_100_PHOTO_ACCEPTANCE.md。D1已有新受ACL保護的匯出，尚未獨立restore，R2物件尚未備份。public staging目前enabled、previewfalse；其他產品feature仍OFF，無Cron／production／A／DNS改動。既有production gate保持closed，自動刪除OFF/dry-run，單R2節點。

下一切片：先完成這100張資料的D1＋R2一致備份與獨立復原，再修正Cloudflare政策16MiB但UI顯示64MiB／未設定Google仍顯示可點登入的能力宣告，依序完成真實雙OAuth綁定與Guest/版本/交付hosted驗收。不要重傳100張、重建Owner、重套0055/0056或重問憑證。保留原worktree/index與未提交變更。

## 2026-10-31 — 100-photo acceptance source publication checkpoint

Private main `1fc914edf79dcba41434f5ab69792222581beb7e` was pushed and remote SHA verified;9 intended files,721 candidate-file credential scan with0matches;original HEAD/index preserved. CI41162510021 is in_progress at handoff,not yet accepted. Actual deployed pilot remains7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47;no redeploy was needed for operator-tool/docs-only changes. Next check only this CI run,then complete fresh D1/R2 consistent backup/independent restore using the protected100-photo snapshot. Do not re-upload100 files or repeat the passed300 GET verification without a new backup/restore purpose. Edge validation tab1650468828 is retained for continuation. No user operation is pending.

## 2026-10-31 — CURRENT: 100-photo snapshot 獨立D1＋R2資料復原通過

B 新D1 bcf68fb8-0079-4c8d-b2a0-745c1aa97a26 與新私人桶kino-pick-restore100-20261031已真正還原完整snapshot。136表／2782列／726triggers／56migrations的schema、逐表hash、sequence與FK0通過；300物件自本機受保護備份還原並讀回SHA全吻合，共8,913,629bytes。原DB／原桶無寫入刪除，無A/DNS/Worker部署變更。已解決真實export的表／唯一索引／trigger載入順序問題，正常app guards及0055/0056保留。詳見docs/HOSTED_SNAPSHOT_RESTORE.md；以private consistent-restore-proof.json為準，不修改原匯出checkpoint的false狀態。

此為資料復原，不是恢復站runtime切換、新桶上傳簽名設定或完整MVP。CI41162510021真實failure：Guest測試helper未捕捉Miniflare socket rejection；新修正CI未通過前不能標green。先完成此最小CI route lifecycle修正，再接Cloudflare16MiB/登入能力UI與Google/Guest/版本/交付hosted驗收；不要重傳100張、重跑已過的復原、重建Owner或重問既有憑證。production gate及自動刪除仍OFF/dry-run，正式預設單R2節點。

## CI helper 最小修正已實作，等待新CI

`apps/worker/tests/guest-entry-ui-browser.mjs` 現追蹤所有route tasks，捕捉dispatch/route rejection，六個情境先page.unrouteAll(wait)並drain再關context，最後以AggregateError保留失敗；沒有POST retry，也沒有忽略真正transport failure。原53個assert呼叫經AST比對逐一相同。helper node syntax／scoped ESLint／Prettier通過，兩個復原工具scoped lint/format通過；未另跑全套本機smoke，新CI尚待。這處理未捕捉Promise及teardown邊界，不宣稱底層UND_ERR_SOCKET成因已完全修好。

## 2026-10-31 — Restore source publication checkpoint

Published and remote-verified private main `0de1d3ccc376dc779a1723001927aaca752a47d0`. Ten intended files;724 source candidates scanned,0 credential matches;original HEAD/index preserved. New CI41164775708 is in_progress,not yet passed. Prior41162510021 remains failure,with local evidence retained;do not relabel or rerun it. Next check only41164775708 and fix any actualremaining failure before the next UI/hosted slice. Both actualrestore commands exit0 and consistent-restore-proof.json is passed;do not repeat the100 uploads or restore. Existing deployedpilot7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47 unchanged;no production/A/DNS cutover. Edge tab1650468828 was marked handoff for continuation. No user action/credential request pending.

## 2026-10-31 — Workspace upload capability slice accepted in isolation

Previous0de1d3c CI41164775708 completed/success. Implemented Owner-scoped upload capability by workspace policy: Cloudflare16MiB/Sharp64MiB,private no-store,closed when CF processing disabled;foreign/anonymous/query guards retained. All4uploadUI paths pass workspace;copy and preparation errors use effective size with64MiBbrowsercap,originaljournals/intentsemantics retained. Four focused unit tests,root/Webstrict,scopedlint,Worker/UI build and processing-recipes10 native/API/mobile groups passed. Fixed newbatch effect workspace dependency. No schema/cloud/customer/A change;NOT hosted acceptance of new UI. See docs/WORKSPACE_UPLOAD_LIMITS.md.

Next publish/verify newsource CI,refresh exact restrictedOwner entry bundle/native boundary/preflight with that successfulCI,then controlledB staging UI/API acceptance (not another100-photo upload/restore). Existing7be9f78 pilot unchanged,production gate/otherunmetflags andautomaticdeleteOFF/dry-run/single-node preserved. Google capability/identity andGuest/version/delivery hosted work remains;no new credential request pending.

## 2026-10-31 — Upload limits source publication checkpoint

Published/remote-verified private main `de22a36c16557871a9bb24edefc095df15b32d2b`;16 intended files,726 source candidates scanned with0credentialmatches,originalHEAD/index preserved. Exact newCI41167613971 is in_progress;do not treat earlier0de1d3c/CI41164775708 success as acceptance of this newbackend/UI. Next check only41167613971,then refresh restrictedOwner native-boundary/bundle/input preflight before controlledB staging deployment and real16MiB UI acceptance. Existing7be9f78 deployedpilot remains unchanged;noA/DNS/clouddata/schema changes. Keep actual100-photo and independentconsistentrestore evidence;do not repeat them. No newcredentials/useroperation pending;Edge1650468828 markedhandoff.

## 2026-10-31 — CURRENT: query-free upload capability and evidence-based staging gate

CI41167613971/de22a36失敗原因為新增Owner query string違反既有resolved browser安全assert；改成GET /api/v1/workspaces/:workspaceId/upload-capabilities，保留無scope舊endpoint並拒絕query，原安全assert未改。修正後unit4/rootstrict/scopedlint/build/native10及fresh restrictedOwner bundle14邊界通過。詳見docs/WORKSPACE_UPLOAD_LIMITS.md。

Scoped staging checker已改為本repo/main push/指定workflow/實際successCI+精確工作檔（含untracked新source）匹配，非固定舊6709。其餘B/schema/restore/flags/Secret名/bundle/14-check限制與productDeploymentAuthorized:false保留。實際failedCI及stale-success-source兩個negative各exit1正確拒絕。CanonicalCI metadata現為失敗de22，下一輪只從真實新CI API刷新，不改success或bypass。No deploy/A/DNS/customer/schema changes;existing7be9pilot及OFF/dry-run單節點保留。新CI成功後再真實hosted16MiB驗收，不能用本機結果代替。

## 2026-10-31 — Query-free fix publication checkpoint

Published/remote-verified private main `7ee40f309add1aae08b34e3a7e5afebc0db16e7f`;10 intended files,726 source candidates scanned with0credentialmatches;originalHEAD/index retained. NewCI41171466586 is in_progress,not yet passed. de22/CI41167613971 remains actualfailure,not rerun/relabelled. Next check only41171466586;on success fetch gh API metadata {id,head_sha,status,conclusion,event,head_branch,path,repository:.repository.full_name} for this exact run into worker.local/processing-integration-ci.json,then run scoped checker against existingfresh14-check/bundle proof (rebuild only if source changes). Verify allsafe staging bindings/Secret names before B-only controlled deployment and hosted16MiB check. No deploy thisslice,existing7be9pilot unchanged;noA/DNS/customer/schema mutation. Do not repeat100photos/consistentrestore;no credentials/userinput pending. Edge1650468828 markedhandoff.

## 2026-10-31 — CURRENT: Guest entry CI transport blocker reproduced and fixed locally

CI41171466586/7ee40f3 failed in Guest入口120s timeout,not deploymentready。Focused六情境真正重現context106 pending route cleanup hang。改用既有native loopback HTTP橋、先消耗全部response body後再注入丟棄/毀損、完整關閉server/ctx及收斂錯誤；不延長CI、不重試POST。故障注入採headers後body截斷避免Chromium透明重送；Entry驗權精確1次計數限定Entry文件，Gallery合法額外GET不混算。原53assert條件保留+2loopbackguards。六情境exit0，scopedlint/format/syntax通過；只是本機，不是全CI或hosted。詳見docs/GUEST_ENTRY_TRANSPORT.md與worker.local/guest-entry-focused-proof.json/fourth.log；所有失敗保留。

僅兩個test檔與交接變更，產品7ee backend/UI未改；B/A/DNS/客戶/schema/flags全未動。下一步新source CI真正成功後才刷新staging metadata及精確preflight，部署原受限Owner pilot，驗hosted16MiB。不要重跑100圖/restore，不relabel既有failure；無憑證或使用者操作需求。

## 2026-10-31 — Guest transport source publication checkpoint

Published/remote-verified private main `6e9426297f6bc074fa6400c6f1604e0ff4fa87d5`;9 intended files,728 candidates scanned with0credentialmatches;originalHEAD/index preserved. NewCI41176275152 is in_progress,not yet passed. 7ee/CI41171466586 remains truefailure;do not rerun/relabel it. Next check only41176275152;on success refresh exactgh runmetadata into worker.local/processing-integration-ci.json and run B-only scopedpreflight against existing14-check/bundle proof,then actual controlledOwner staging deployment/16MiB acceptance. Productbackend/UI unchanged in thispatch,so do not rebuild/reupload100photos/restore without newreason. Actual deployedpilot still7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47;noA/DNS/schema/customer/flag change. Edge1650468828 markedhandoff. No credential/user operation pending.

## 2026-10-31 — CURRENT: B Owner staging refreshed; hosted16MiB acceptance passed

CI41176275152/6e942629 completed/success。真正部署B Owner-only staging新version c673b93a-401f-4c57-bfca-d0438e076031；CF下載bundle與預檢ebb9afa4...完全吻合，前後安全綁定/6Secret名/flags核對及7hosted邊界通過。當前public enabled/previewfalse，Guest等仍OFF，不是完整MVP。

真實Edge Owner session保留，介面16MiB；17MiB合成檔選取即拒、Startdisabled，remote D1前後upload/session/asset/quota帳務全同，sessions100/assets300/used8913629/reserved0。首24張縮圖decode與1000×1600直式燈箱、匿名私人thumbnail401回歸通過。只移除本機rejected項目，未傳新照片/重做100圖或restore。完整證據與回復：docs/HOSTED_UPLOAD_LIMIT_ACCEPTANCE.md，worker.local/hosted-upload-limit-proof.json；原7be9deploy/boundary另存歷史副本。

下一切片：受控Guest協作hosted promotion（先盤點hard-local/gates，限定B合成project，保留真實授權/備份/rollback條件；不能APP_ENV=local或globallyremoveguard），逐項Owner invite/Guest exchange/view/select驗收，及未配置Google登入能力顯示。所有原產品需求保留；production/private_direct_upload等未滿足readiness不改true，auto-deleteOFF/dry-run/single-node，無A/DNS/customer/schema更動。無憑證/使用者操作待辦。

## 2026-10-31 — Hosted acceptance closeout (no redundant docs-only CI)

Current remote main and actually deployed app source both remain `6e9426297f6bc074fa6400c6f1604e0ff4fa87d5`,fullCI41176275152 success;new deployedversion c673b93a-401f-4c57-bfca-d0438e076031 is verified live. This heartbeat changed only7handoff/acceptance MD files (729candidate-file scan0credentialmatches,temporaryindex preserved);keep these local changes and include them with the next realcode slice rather than trigger anotherfullCI for unchangedruntime. No newCI is pending or needed for thisdoc-only closeout. Prepared snapshot review did NOT update deploymentbranch or push. Latest sourcepub helper parent for nextcode should remain6e94262.

Next work can start directly on boundedGuest-hosted promotion/Google availability,using docs/HOSTED_UPLOAD_LIMIT_ACCEPTANCE.md and currentpassedpreflight/currentresourceproof. Do not wait for a nonexistent docsCI,repeat100uploads/restore,or deployolder7be9. PublicOwnerpilot enabled/previewfalse,Gueststillclosed,productionnotreleased. Edge1650468828 retained;no useroperation pending.

## 2026-10-31 — OAuth availability vertical slice accepted locally

Implemented the current Worker React login provider capability: GET /api/oauth/providers returns names only, using the same complete nonblank ID+Secret predicate as createAuth. Partial/unconfigured providers are absent; UI loading/error/empty states expose no sign-in buttons. Owner identity/closed registration/implicit-link denial remain unchanged. Added only this read-only path to the existing Owner-only staging wrapper;Guest stays closed.

Actual checks: focused unit3 passed;root strict and Web strict passed;Worker/UI dry-run build passed;scoped ESLint/Prettier passed. Refreshed staging entry build plus native20 checks passed (all original14 boundary checks retained,3newAPI checks,3Chromium UI checks including actual GitHub-only response and explicitly injected loading/failure). This is local workerd/D1/R2/Chromium;Images is still a presence double here,not new hosted OAuth/provider/MVP acceptance. First agent build failed from a duplicate declaration introduced while patching LoginPanel;fixed,subsequent build passed. No schema/customer/cloud/A/DNS changes this slice.

See docs/OAUTH_PROVIDER_CAPABILITIES.md and docs/GUEST_HOSTED_PROMOTION.md. Guest inventory confirms config+service+capability local guards and missing synthetic-scope allowlist;do not open flags alone. Next publish this exact code snapshot together with previously unpushed hosted-limit docs,verify its one new CI,then refresh exact source/bundle/preflight before B-only deployment and anonymous real UI verification. Existing deployedOwnerpilot remains6e94262/versionc673b93a-401f-4c57-bfca-d0438e076031 until that occurs. All production/unmet readiness,auto-deleteOFF/dry-run,single-node retained. No credential/user action pending. Native proof now has20 checks;old14-check proof is historical,not acceptance of changed source.

## OAuth publication correction

First snapshot851154e was pushed before a trailing index.ts formatting failure stopped the PowerShell batch;no deployment occurred. Formatted only that endpoint and verified Prettier success. Superseded CI41184204862 was cancelled to avoid redundant broad checks;do not report it as success. The corrected snapshot must obtain its own actual successfulCI before any B deployment. OriginalHEAD/index remain preserved.

## OAuth CI format failure (actual evidence)

CI41184244943/6f93018 completed/failure at pnpm format:check:the6updatedhandoff Markdown files had excess blank lines. Runtime/security tests were not reached in thatrun. Formatting those6files and checking all changedsource+docs before the next push;no deployment occurred. Failure log retained worker.local/ci-41184244943-failure.log. Do not relabel thisfailure or treat previous6eCI as newsource acceptance.

## 2026-10-31 — CURRENT: OAuth availability deployed and accepted on B

Corrected source `5e5ac8b751401967809902efd06b64c997a82e6a` fullCI41184396089 completed/success (all steps). Refreshed actualCI metadata,exact-source scopedpreflight and B resource checks passed;final native20 bundle SHA `3b2fd10896f2adc89a10b04a49ac43c6ddb0e25177e76e27b506190fbb3dd7f7`. Formatting changed the earlier emitted bundle hash,so the final bundle was actually rerun through20native checks before acceptance;not silently relabelled.

Actually deployed B Owner-only staging version `6ab7a8fc-247e-46f3-8858-7a5ec914c768`;downloaded bundle matches,DB/R2/Images/6Secret names and closed flags unchanged. Closed deployment was verified before restoring the existing publicOwnerpilot;previewfalse. Ten hosted boundaries passed (old7 + configuredGitHub-only providers/query400/write404). New independent IAB tab8 visibly changed from Google+GitHub to only enabledGitHub;no login click/token/newOAuth performed. Existing realEdgeOwner session reload still reads the same syntheticproject;no new upload or schema/customer/A/DNS changes. Proof worker.local/hosted-oauth-availability-proof.json and current deploy/boundary proof;old6eproof preserved with suffix-6e94262.

This is an actual hosted availability fix,not fullMVP or newGoogle/link acceptance. Guest/production and unmetreadiness stayclosed,auto-deleteOFF/dry-run,single-node. PreviousCI41184204862 was superseded/cancelled;41184244943 remains actualformatfailure,not a success. No new CI is pending. Originalworktree branch/HEAD/index preserved;734candidate scan0credentialmatches. Current remote main and runtime both5e5ac8b. These post-acceptance docs (plus Guest asset-scope/fixture detail) are local and should accompany the next realcode slice;do not trigger redundantdocs-only fullCI.

Next: implement boundedGuest staging promotion using docs/GUEST_HOSTED_PROMOTION.md. Reuse existing focusedfixture;enforce precise syntheticinvite scope in issuance/exchange plus photo+version asset lookups (asset URLs lack albumId),retain trustedIP/admission/KDF/Securecookies and all currentACL. Native staging context and real independentGuest browser acceptance precede activation;never APP_ENV=local or globallyremoveguards. Do not reupload100/restore/bootstrap or request already-savedkeys. Edge1650468828 retained for continuation;anonymousIAB8 is routine acceptance and mayclose. No useroperation pending.

## 2026-10-31 — Closed synthetic Guest flow implemented; native accepted

Implemented strict B-only STAGING_GUEST_VALIDATION (defaultOFF),exact project/singlealbum service and API/photo-version boundaries,limited link-only/view/select/submit capability+Owner UI,and separate closed Guest entry/config. Existing local behavior and disabled safe metadata recovery retained;all other local/production guards remain. Actual focused10unit,root/Webstrict,scopedlint/format,UI+Workerentrybuild,nativeGuest19groups/full56migrations and oldOwner-only20boundary pass. Native flow creates actual session/privateR2+localSharp derivatives,picks/submits,Ownerexports the same immutable submission with audit,and validates scope/revoke/logout. See docs/GUEST_HOSTED_PROMOTION.md/private localproof. No realCloudflare/OAuth/browserGuest/publicTLS/expired-entry/trustedIP-edge acceptance;Images presence double/nativeSharp are explicit. Fixture403 transport failure fixed using dispatchFetch;injected-IP limitation recorded,not silently passed.

Highest-priority next task is now audited Owner album activation:actual product has no draft→active API/UI/command,and live synthetic album is draft. No remoteSQL bypass or activation has occurred;existing active-state guards preserved. Implement compatible nextmigration+atomic activation ledger/revision/confirmation/API/UI/tests/recovery,then independent backup/restore and B adoption before activating ONLY synthetic album and opening Guest. Three password modes/otherpermissions/Google+link/versions/delivery remain MVP requirements,not removed by the bounded firstslice.

No schema/cloud/customer/A/DNS mutation thisslice;runtime remains5e5ac8b/version6ab7a8fc-247e-46f3-8858-7a5ec914c768 Owner-only. Guest entry config public/previewfalse,noCron;production unmetreadiness,OFF/dry-run,single-node unchanged. Newnative check added toCI;exactcode publication/newCI required,not previous5e success. Preserve originalworktree/index and protected backups. No credential/useraction pending.

## 2026-10-31 — Closed Guest source publication checkpoint

Published and remote-verified private main `c1c8a92f8363ab9a561535cc39747cc0fe3bdc13`;21 intended files,740 candidate-file credential scan0matches,originalHEAD/index preserved. NewCI41188887091 is in_progress,not yet accepted. Finalnative proof19checks/full56migrations and source/config/bundle hashes are current;earlier22-check run is historical. No Guestdeploy/cloud/schema/A/customer change;actual runtime still5e5ac8b/version6ab7a8fc Owner-only.

Next command: `gh run view 41188887091 --repo kinostudio/kino-pick --json status,conclusion` (outside Wrangler-isolated XDG). Fix any actualfailure;on success start the auditedOwner draft→active migration/service/API/UI slice described in GUEST_HOSTED_PROMOTION.md. Do not deploy/open Guest just because thisCI passes:live fixture is draft and there is no auditedactivation API yet. Preserve remaining password/permissions/versions/delivery/Google/link requirements;OFF/dry-run,single-node. No useroperation or credential request pending. NativeGuest config remains workers_devfalse/previewfalse/noCron. OriginalbranchHEADb14d505/index remainunchanged;publicationbranchparent for next realcode is c1c8a92. Post-publication checkpoint docs are local;include with nextcode rather than repeat docs-only CI. Edge1650468828 markedhandoff.

## 2026-10-31 — Audited album activation implemented; native13 accepted

Prior c1c8a92 CI41188887091 completed/success (allsteps). Added additive0057 album_activation_commands,atomic Owner draft→active/revision+1/fullbefore-after audit,immutable historicalreceipt/retry and reciprocal casefoldnamespace/REPLACE guards;new service/strict contract/API/defaultOFF flag and Owner confirmationUI. Capability failsclosed on OLD56/missingledger;GEToldtables remainscompatible. Separate closedOwner-onlyactivationprofile keeps allGuestflagsOFF and exactBsyntheticscope;productionnotadmitted. See docs/ALBUM_ACTIVATION.md.

Actual focused contract3+scope/flag7,root/Webstrict,scopedlint/format/UI+Workerbuild pass. Finalnativeactivation13groups pass,includingOLD56populatedparity/latefailure rollback/currentauth/CAS/replay/namespace/auditfailure andrealD1fixturehelper;oldOwnerboundary20 andclosedGuest19 on57chain pass. Legacy7fixturefiles nowactivate usingactualcommand+audit andpreserveassertions;no fake meta.changes. Earlier12proof/history andhelper/parity/UIpatch failures retained;no newrealOAuth/provider/browser/hostedactivationclaim. DefaultpersistentlocalD1 notmigrated.

B readonly actualbaseline confirmed4DB/source56/1syntheticworkspace/100photos/300assets/fixedalbumdraft/noactivationledger;existingisolatedOAuthrefresh worked,no key/useraction needed. NO cloudDDL/data/deploy/A/DNS/customer changes. LiveOwnerpilot still5e5ac8b/version6ab7a8fc;Guest/publicproduction andglobalunmetreadiness stayclosed,OFF/dry-run,singleR2. NewsourceCI stillrequired before adopting/deploying;oldc1success is not newactivationCI.

Next highestpriority:publish exactsource+verifyoneCI,thenfreshprotected56snapshot/newindependentBrestore+0057upgrade/oldrow-schema-sequence-FKparity,thenB-only57adoption andcontrolledOwner-onlyactivationdeployment/realUIaudit acceptance beforeGuestopening. Do notrerunOwnerbootstrap/100uploads/oldrestore or rawUPDATE. Appliedmigrationfiles0001–0056remainimmutable;0057notremoteadopted yet. Rollback/recovery is documentedforwardfix/auditretention,notdroporrewind newerdata.

## 2026-10-31 — Activation source publication checkpoint

Published and remote-verified private main `aa8b74368f88060897f0c586e4316fe314e28286`;32 intended files,749candidate-file credential scan0matches,originalHEAD/index preserved. NewCI41194080987 is in_progress,not yet accepted. Priorc1/CI41188887091 success stayshistorical. Finalnativeactivation13/Owner20/Guest19-on57 proofs and focusedtype/lint/build checks are local,not cloudadoption. No newcloudrestore/export/DDL/data/deploy/A/DNS mutation;liveOwnerpilot remains5e5ac8b/version6ab7a8fc andBsource56/draft.

Next command: `gh run view 41194080987 --repo kinostudio/kino-pick --json status,conclusion` outside Wrangler-isolated XDG. Fix anyactualfailure before adoption;then follow ALBUM_ACTIVATION.md for freshprotected56snapshot,newindependentBrestore+0057upgrade/parity/sourceadoption andOwner-onlyactivationpreflight/realUI. Do notapply0057withoutfreshbackup+independentrestore oropenGuestbasedonlyonnativeactivefixtures. Current0057SHA c6990971ce5110afb902e8d7187c40f52983f2c8a5c17b91e5da28e38ef3b28c;notremoteadopted. No credential/useraction pending;isolatedexistingOAuthwasroutinelyrefreshedonceafter403 andBbaselinequerypassed. Keep allprotected100photo/restore evidence;do notredo themwithoutnewmigrationbackup purpose. DefaultpersistentlocalD1 staysold;OFF/dry-run/single-node retained. Newpublicationparent is aa8b743;post-publicationcheckpointdocs local,include withnextrealwork rather than redundantdocs-only CI.

## 2026-10-31 — Hosted Owner activation and UI parity gap

Actual CI41194080987 for aa8b74368f88060897f0c586e4316fe314e28286 completed/success. Fresh protected source56 backup restored into independent B D1 24788788-7bbc-4947-b781-c858c0d4f8c1, upgraded57 and readback verified. Source0057 adoption preserved135 old product tables, old schema objects and data; FK0. Source now57 migrations;0057 is applied/immutable. Proof apps/worker/.local/staging-0057-apply-proof.json. Initial raw dump local inspection failed on table creation order before cloud mutation; corrected strict normalization/transaction/deferred-FK rehearsal succeeded. No destructive rollback or restore over customer data.

B Worker activation profile deployed version0ff58553-e642-47f5-93dc-cbd2ae36ccd7, exact aa8 bundle d2313198240bc155cc74bcf4c4600ece7f3102b2f1eba6d349b11db43b3e4cc0; actual six Secret names, sourceD1/privateR2/Images bindings, noCron and10 hosted boundary checks passed. Existing Owner-only pilot publicly reachable, previewOFF; all Guest flagsOFF, product release not authorized. New local tools/check-staging-album-activation.mjs validates CI/source/native13/cloudrestore/backuphashes/resource config; no readiness bypass. Narrow empty0057 normalizer is not suitable for post-activation backups; inspect actual new shape before any future restore rehearsal.

Real existing Edge Owner UI opened fixed synthetic album confirmation and submitted once. Actual D1 draft/revision1 -> active/revision2, command1/audit1, before/after and request/session/actor joins verified;100photos/300assets unchanged. UI shows 使用中 and removes activation button. Proof apps/worker/.local/activation-ui-before.json and activation-ui-after.json; screenshot in visualization artifacts kino-pick-owner-activation-20261031.png. This is real hosted activation, not hosted Guest acceptance or full MVP release. No new credentials/user action pending; A/DNS/customer data unchanged, automatic deletionOFF/dry-run, singleR2.

User identified visual mismatch. Confirmed independent4174 prototype experiments/gump-demo (memory-only synthetic data, no API) and deployed React apps/web/target-ui are separate frontends. Production UI has not adopted prototype shell/sidebar/theme/layout; functional acceptance is not visual parity acceptance. Preserve prototype as visual reference and migrate its presentation into existing target-ui components with real API/auth/error semantics; do not replace functional frontend with memory-only demo. Track UI parity explicitly before declaring MVP accepted. Next bounded slice: reconcile Owner workbench shell/project/album visuals against prototype, retain real upload/gallery/activation; Guest hosted scope remains separately gated. Full Google/link/Guest/collaboration/version/download/delivery/custom-domain release acceptance remains incomplete.

## 2026-10-31 — 正式前端整合原型視覺，待使用者確認

已在現有 apps/web/target-ui 整合 prototype 的深色側欄、米白主題、工作台摘要、專案卡片、全寬相簿與照片工具區；新增 studio-shell.tsx，原 API、Owner 授權、上傳、啟用、分享、保護及其他既有元件保留。摘要只使用 API 已載入本頁數量，不冒充跨分頁總計。相簿索引工具收進「進階相簿整理」。單張照片改為桌面左圖右資訊／既有工具、手機上下排列；私人 TrackedPhotoImage、scope／失效處理、pending guard、鍵盤／焦點與上一張下一張邏輯保留。沒有加入模擬評等、留言或假操作。

實際通過：最終 target-ui build、root strict TypeScript、四個 JS/TS 檔案 scoped ESLint、相關 Prettier；本機瀏覽器工作台→專案→相簿8圖→單張、下一張1→2、Escape關閉／焦點恢復、手機選單、375px無水平溢出及圖片比例檢查。1600×1200 fixture JPEG 實際渲染318.0556×238.5417，比例不變。既有 bundle >500kB 警告仍存在，這次未擴大至效能重構或全量測試。不是本輪雲端 OAuth／R2 重驗。

確認網址 http://127.0.0.1:4180/dashboard ，執行工具 tools/prototype-integration-preview.mjs；serve 真正正式前端 .static build，但 API 資料為隔離 fixtures、Sharp合成8張JPEG；明顯標示「介面確認預覽・隔離展示資料・不寫入雲端」。僅loopback，所有非GET/HEAD回403，未知API404；5個HTTP邊界檢查通過，無外部API／憑證。此預覽不能冒充真正登入／上傳驗收，也不能取代正式Worker。首次手機檢查發現預覽標示遮住燈箱header，僅修正host注入CSS後重啟並重驗，未污染production樣式。

證據 apps/worker/.local/studio-visual-integration-proof.json 含6個來源SHA256、檢查與截圖清單；visualization目錄有 kino-pick-integrated-workbench.png / album.png / photo.png / mobile.png（後三者完整檔名皆有kino-pick-integrated-前綴）。已在IAB保留可操作確認頁。沒有commit/push/deploy、DB或R2寫入；B仍aa8b743/version0ff58553-e642-47f5-93dc-cbd2ae36ccd7，A/DNS/customerdata未改。下一步依使用者版型回饋修正，再走新來源CI與既有B部署閘門，不以預覽代替MVP或解除Guest限制。自動刪除OFF/dry-run、單R2不變。

## 2026-10-31 — 統一正式前端、透明 Logo 與真實 API 介面驗收

本節取代先前「4180 fixtures 介面預覽」的目前狀態，歷史測試保留。產品唯一預設入口為 apps/web/target-ui + apps/worker；根 pnpm dev/build/start 已指向 Worker。Next/Supabase 只保留明確 reference 指令與相容測試；experiments/gump-demo 為封存設計參考，不再作產品入口。tools/prototype-integration-preview.mjs 已移除假 API，4174 只轉址到 http://127.0.0.1:4180/__review/login 。

採用使用者指定 v11 Kino Pick SVG，移除外框實心底，明暗兩版邊緣 alpha 實測為0；工作台／登入／帳號／Guest 共用 KinoLogo。工作台、專案／相簿、單張、分享 modal、Guest 入口／圖庫／單張、歷史／處理設定／帳號已使用同套主題及既有真實 API。建立專案／相簿與分享保留 pending/idempotency/recovery；新增四項 invite capabilities 投影既有下載／留言／標註／比較能力，缺值預設 false，沒有放寬 hosted flags。

可操作本機驗收：pnpm review:local（先 build；避免與已開4180重複啟動）。工具 apps/worker/tools/studio-review-server.mjs 使用實際 Worker bundle、57 migrations、隔離 Miniflare D1/R2、Sharp；8張合成照片、27 assets、9個完成處理工作及2個 ready versions。只限 loopback、外連拒絕、不讀外部憑證；Owner 為本機合成 session，非真實 OAuth。瀏覽器 S3 上傳刻意關閉，不能把 seed 原生 R2 寫入當 hosted 直傳驗收。重啟會清除這份隔離資料；不影響 persistent local 或 cloud DB。當前程序資訊見 apps/worker/.local/studio-review-process.json。

真實本機瀏覽器已通過：建立專案／相簿、獨立12權限邀請、Guest exchange、挑片／5星／收藏／版本留言／點註記與重載保留、提交1張封存快照／Owner重開第2輪保留第1輪、歷史事件、私人預覽下載27119 bytes、Owner發布V2／Guest滑桿並排疊圖；375px無水平溢出且圖片4:3不變。完整手動證據 apps/worker/.local/studio-ui-manual-acceptance-before-standard-port.json 是舊4190隔離dataset；4190屬瀏覽器限制埠，最終已切4180新dataset並重驗入口／工作台／專案圖庫。匿名API401、外站Origin登入403、舊入口302、前端200均通過。下載工具曾異常延遲約59分鐘才返回已下載檔案，不代表效能通過，不重跑下載。初始modal樣式／能力未投影／本機banner遮頁首問題均已修正。

最終已執行產品 build；scoped lint、strict TypeScript、能力映射3個單元測試及透明度檢查。既有大bundle警告仍在，沒有執行新全量CI或雲端部署。完整逐頁表見 docs/FRONTEND_INTEGRATION_ACCEPTANCE.md。近期／全域收藏、固定交付／通知、攝影師metadata與推薦服務、OAuth綁定、freehand正式schema仍未完成，不以假頁或無效按鈕宣稱可用。Google／Guest hosted驗收與MVP仍未完成。

B 基線保持 aa8b74368f88060897f0c586e4316fe314e28286 / version0ff58553-e642-47f5-93dc-cbd2ae36ccd7 / schema57；本輪沒有commit/push/deploy/cloud DDL、A/FILM.KINOSTUDIO/DNS或客戶資料變更。自動刪除OFF/dry-run、單R2保留。下一步先確認本輪統一外觀，再接正式攝影師推薦metadata／權限服務與freehand migration復原驗收；補齊交付及帳號綁定，通過精確來源CI及既有B部署閘門後才發佈並做hosted驗收。不能移除原產品需求或跳過備份復原。

最終補驗：4180工作台→專案→相簿8張→單張／兩ready版本已讀回；版本卡片改窄面板單欄，避免viewport兩欄擠字。最終root strict、scopedlint／format與target-ui build通過。曾誤用不存在build:ui腳本失敗，改用既有build:target-ui成功；失敗不計為通過。入口證據 apps/worker/.local/studio-ui-final-entry-proof.json。

## 2026-10-31 — 統一分享彈窗原生回歸已通過

補上本輪前端整合尚未執行的 invite-create 原生瀏覽器驗收。新增 apps/worker/tests/invite-create-focused.mjs，沿用既有57 migrations／guestDownloadChecks fixture／真實Worker與隔離D1/R2，外連一律拒絕、不讀外部憑證；執行 `cd apps/worker; node tests/invite-create-focused.mjs`。既有 runInviteCreateUiChecks 全組完成，包含375px相簿預選與僅view預設、12項權限不隱式連動、三種密碼模式、一次性secret不進storage／當前URL、未知結果關閉再開維持mounted form／原request/body、401重試後metadata recovery且DB命令不重複、capability關閉不發POST，最後FK check空。Proof apps/worker/.local/invite-create-focused-proof.json。這是本機原生測試，不是hosted Guest驗收或新雲端部署。

第一輪因page.goto等待networkidle逾時失敗；改為domcontentloaded並保留既有可見／可用控制項就緒斷言，第二輪exit0。沒有縮減既有業務／授權／復原斷言。未重跑全量套件，沒有變更migration／業務flags／客戶資料／A／B部署。下一步仍是原handoff中的正式metadata推薦／freehand／交付／帳號綁定與hosted驗收；MVP未完成。

## 2026-11-01 — 攝影師推薦與手繪正式接線；B 發佈進行中

使用者明確要求繼續整合／必要驗證後部署 B，不再等待舊版型確認。唯一產品入口仍為 Worker + target-ui；A／FILM.KINOSTUDIO／DNS不得改動。

已依指定 Cocoon-AI architecture-diagram-generator 的實際 SKILL.md 與 template.html 產出中文 HTML/SVG，含頁面／部署／資料流、來源revision與MIT授權，repo副本 docs/diagrams/kino-pick-architecture.html。靜態SVG轉PNG／結構／匯出script語法已驗證；瀏覽器file協定遭工具安全規則拒絕，未改走HTTP或其他瀏覽器繞過；匯出按鈕實際點擊仍not_checked。

新增0058 freehand guard migration（不新增表／command），既有資料與點／矩形保持，原生四次DDL失敗rollback／Guest與Owner valid-invalid geometry／FK0、實際Chromium→Worker→D1/R2畫筆寫入與邀請隔離通過；詳見FREEHAND_ANNOTATIONS_MIGRATION.md。0059加入獨立版本綁定攝影師metadata／policy／command／result及append-only audit，不混用客戶feedback；符合任一星等／色標條件，手動set／clear／inherit保留原始證據。欄位更新即儲存，未知結果維持原request重試與照片導覽pending防護。

Worker原圖metadata讀取器重用既有嚴格XML子集，透過有界R2 range與ETag／SHA／size／mime見證，支援JPEG／PNG（含有界壓縮XMP）／WebP，無Sharp runtime依賴，不回傳原始XMP或其他私人metadata。Sharp原有facade保留。32項解析測試、6組native D1 guard、10組真實API/R2／Guest布林投影／權限／審計失敗rollback通過。Proof .local/photographer-recommendations-d1-guards-proof.json 及 photographer-routes-focused-proof.json。首次policy快照順序不符、projection UPSERT誤觸insertguard及自動匯入錯查immutable upload_sessions.status等實際失敗均已修正，不計為通過；完成後改查不可變completion見證。自動import失敗不回滾已完成上傳，可由同上傳重試或原圖重讀復原。

正式UI本機已實際儲存相簿顯示／三星與紅色OR門檻、手動五星、讀取原圖XMP三星紅色、清除後不推薦、inherit還原。不是本輪雲端驗收。新的精確B協作profile／完整CI／fresh57 backup→獨立restore→58/59 upgrade／source adoption與部署尚在進行；舊B仍aa8b743/version0ff58553/schema57，Guest仍關閉。自動刪除OFF/dry-run、單R2不變。剩餘固定交付／通知、帳號綁定及完整hosted驗收保留，不宣稱MVP完成。

## 2026-11-01 — 協作發佈候選來源

完成攝影師推薦正式API／0059、私有原圖JPEG/PNG/WebP bounded XMP讀取及手動清除／還原；推薦條件ANY/OR，與Guest星等分離。自動import曾因immutable upload_sessions狀態查錯而未喚醒，已改以completion witness確認；native重放completion已驗證。0058手繪schema、雙端writer／UI主圖portal已整合；實際CUA Guest鍵盤畫線→儲存→重載保留annotation，畫布位於mainstage且只有一個image；合成測試圖，不是客戶資料或hosted證據。截圖kino-pick-main-photo-freehand-reloaded.png。

本輪最終local證據：metadata32、D1推薦六組、推薦R2/API十組、scoped協作24組、freehand既有E2E20、invite相容四測試、root/Webstrict/scopedlint/build通過；release checker self-test通過。所有通過均有實際執行；未重跑全量local suite。架構圖採指定Cocoon-AI skill/template、保留MIT，中文HTML與PNG已產生。

B獨立restore/upgrade實際通過：drill049e766a-76b0-4f5c-9c56-33e3cf565c6e，fresh source57還原後parity、升級59舊資料/schema/sequence/FK0通過，sourceWrites0。portable manifest docs/releases/collaboration-0059-restore.json；protected詳細證據apps/worker/.local/collaboration-0059-current.json。來源DB仍57、Worker仍aa8/0ff58553；下一步精確新來源CI成功後source0058/59採用，再使用新Actions scoped協作workflow部署、閉鎖readback核對、開B workers.dev及真實hosted驗收。不得將候選或local結果當完整MVP。

正式前端已統一prototype主題／透明Logo／工作台／專案相簿／單張／分享／處理設定／帳號；Next與gump-demo是歷史參考，4174轉4180。仍待hostedGuest全流程、固定核准交付／通知、Google及同身分綁定、其餘roadmap需求。scopedprofile只允許固定合成workspace/project/album，link_only及12獨立rights，不能宣稱全正式產品。A/DNS/customerdata未改，自動刪除OFF/dry-run、單R2、無Cron。

CI41221476573（7db0e21）失敗已保留：866測試通過，新增推薦D1測試依賴尚未產生的.build/index.js而ENOENT。已修為自足的native D1 minimal Worker（不需要產品bundle/assets），所有六組原DB授權/CAS/namespace/integer/append-only/audit-rollback斷言保留並focused實跑通過。另GitHub讀取失敗log helper新增安全logs模式；沒有繞過CI或改雲端schema。新的精確來源CI成功前不採用／部署。

發佈檢查補修：.gitattributes 將0058從Windows CRLF正規為Git LF，導致原始byte-hash portable manifest在Linux不一致。已逐byte驗證只差CRLF→LF、SQL完全相同；manifest分開保存rehearsedMigrationByteHashes（實際雲端演練原始值）與明示UTF-8/LF的migrationHashes，checker採同一正規化，本機self-test通過。未改0058/59 SQL、未重跑雲端演練、source仍57。新來源仍須成功CI才採用。

## 2026-11-01 — 真正的工作台重讀循環與 native UI 相容修正

CI069eac0/41221910807的unit、integration、build及既有瀏覽器步驟通過，nativeCloudflare在舊ui-browser networkidle失敗。查到產品root cause：OwnerWorkspaceShell每次render傳入新的z.union schema，useResource effect以schema為dependency造成反覆fetch/abort。已hoist為module-level stable schema，產品build/scopedlint通過；新增native基本UI斷言，初始shell＋workspace page恰好兩次GET且networksettles，避免迴歸成D1請求洪流。

測試亦已適配真實prototype操作：專案／相簿建立modal、Owner「相片詳情」與filename h3、主圖portal canvas。保留所有建立／釘選／封存／重載、pointer/geometry、privacy、CAS及未知結果重試斷言；未改產品以逃過斷言、未停用測試。九個受影響Owner/Guest browser harness及ui-browser scopedlint/format/syntax通過。

本機full native執行已通過新的workspace/project/album建立／釘選／封存與大量D1/R2/Guest版本業務；該程序在patch之前已cache舊Guestannotations module，於舊panel內找不到已移至主圖的canvas而失敗，未當成整體通過。該selector已在新來源修正，仍須新精確來源CI及fresh native結果。另loopback review-server的focused reuse因devshim cache-control為no-store而非產品private,no-store在初始headers斷言停止；未改弱產品assert、未當成功。兩次本地工具相對cwd路徑錯誤已修正，沒有產品/雲端變更。

B仍schema57／aa8 Owner pilot，獨立restore59證據保留有效；沒有採用、部署、A/DNS/customerdata操作。來源freeze後只在實際新失敗時修正，避免重複無關全量測試。

Native最終整合已實際通過321組（包括主圖portal Guest/Owner authoring／processing、comments、版本、挑片與基本UI兩次GET），末段因舊測試未展開「進階相簿整理」而找不到indexpanel停止；CI41223881336同native步驟失敗，未當成功。已更新matching-filename-index／matching-rules兩測試先展開同一gallery的真實summary；OwnerHistory測試導航更新至獨立/history頁。所有原業務斷言保留，scopedlint/format/syntax通過，等待新CI。

預先核對另一受影響路徑：processing-recipes原生政策UI改走獨立/settings、使用「新照片處理配方」精確region；focused實際10組全過，含375px政策儲存與重載。未重跑本機整套，當前所有產品程式與d274bc1相同；此批只更正四個測試路徑／disclosure及交接。B仍57/aa8，無採用或部署，A/DNS/customerdata不動。

## 2026-11-01 — 最後手機歷史頁 RWD 修正（已單獨原生通過）

CI41225377434已走到最後一個OwnerHistory browser group，其餘原生業務均通過，但375px overflow519而失敗。以同一原生D1/R2＋Chromium helper縮小重現：新增合法長無空白專案名稱後overflow643，診斷確定是ProjectDirectory list的auto grid track/min-content把li/a撐寬，非照片伸縮或時間欄位。

僅修studio-pages.css：project-list使用minmax(0,1fr)單欄、li及project-name min-width0，保留既有ellipsis且不以overflow:hidden遮住整頁。產品UI build通過；單獨focused完整OwnerHistory mobile流程在長名稱資料下通過（篩選／分頁／CSV/JSON下載／未知結果重試／撤銷等原斷言保留）。expected OWNER_HISTORY_EXPORT_FAILED是注入失敗的拒絕證據，不是成功匯出或未處理產品錯誤；整個focused退出0。詳細.local/history-mobile-focused-long-fixed.log與history-mobile-long-project-proof.json，該focused使用58schema，59完整source由新CI覆蓋。test helper加入只在失敗時列超寬元素的診斷，未放寬assert。

B source仍57、aa8 Owner-only pilot；沒有雲端遷移／部署／A/DNS/customerdata改動。此CSS修正需新精確來源CI成功後採用／部署；不重跑本機20分鐘全量。

## 2026-11-01 — B59 與 Actions 部署完成；真實 OAuth session hotfix 候選

精確source ccb118994220feb903ef5335b284dba757030bee CI41227529424全部通過。B來源0058/0059實際採用59，136既有產品表資料／schema／sequence保持、FK0；protected.local/staging-0059-apply-proof.json。Actions41229338948實際成功，Worker version a5a6451e-f1b7-42fd-b707-a6822e9b97ac／deployment4eae396f-5bc2-409d-92b2-46689e002fde。私人R2、六個Secret名稱、無Cron、OFF/dry-run/singleR2與公開workers.dev enabled/previewsfalse均核對；A/DNS/customerdata未改。

真實Edge Owner既有OAuth session在新前端繼續有效；實際從產品介面直傳一張21,409-byte、900x600合成JPEG，原生Cloudflare處理完成且圖庫可開啟。攝影師標記卻SERVICE_NOT_READY，查到新Repository誤把sessionId當UUID且lowercase；真正BetterAuth session是32碼且含大寫（僅查shape，不記錄值）。這是hosted失敗，不當成推薦功能通過。

已修為與既有album activation／image policy一致的z.string.min1.max512、不改大小寫；actor UUID處理保持。native6/API10/受限profile24全部改用mixed-case opaque session並通過；case-folded session確實拒絕。Worker build/rootstrict/scopedlint/format及release self-test通過；沒有migration變更。原已失敗的V1 metadata import可在hotfix後透過正式「重新讀取原圖資訊」恢復，新完成事件將用正確session；尚未宣稱這項已hosted驗收。

前進發佈不再硬鎖最初Owner版：docs/releases/collaboration-prior-deployment.json保存實際成功Actions收據、hash、source及version。新preflight另核對該舊Actions真正completed/success、live B精確profile／version／message匹配，然後才允許新的相同scope程式版。歷史restore57→59manifest不改、不重套migration，仍驗證59ledger/FK/私有R2/關閉入口。待新精確CI成功後close B→dispatch同workflow→收據核對→再開入口；不能拿ccb CI代替hotfix CI。

一次Cua AX輸出意外包含合成測試邀請URL，已立即透過真實Owner UI撤銷invite6ea64206-8c1e-4103-816c-e8ff38d3bcdd並讀回「已撤銷」；該invite從未建立Guest session。永久CF/R2/OAuth憑證未出現。後續避免dump分享結果AX，僅持有URL在記憶體／先隱藏結果，紀錄id與狀態。UI嘗試選24hr日期未改變實際7day值，未宣稱hosted自訂期限已驗；其餘8次限制與12獨立權限確實由回應讀回。仍須Guest真實協作／新metadata／版本與下載驗收，再接連結解除、三密碼模式、固定交付通知與其餘MVP條件。

## 2026-11-01 — Opaque session hotfix CI and Owner annotation render readiness

Source cafb2d8d0566eb089511f21983f3a1e7d3cb41d3 passed format/lint/strict/unit/integration/product build and all three freehand browser suites in CI41230619544. Native D1/R2 failed in owner-annotations-browser.mjs after switching back to the retained version: the response observation settled before React rendered either the target item or pagination control. This is a failed CI, not deploy acceptance; B remains ccb1189/a5a6451e/schema59 and public entry is unchanged. The scoped metadata native6/API10/profile24 remain locally passed; no migration/restore rerun.

Test-only stabilization waits for actual target row or pagination readiness before the existing bounded paging loop; original scope/body/privacy assertions are preserved. A new exact CI is required before code-only forward deployment. No A/DNS/customer changes.

## 2026-11-01 — Real hosted Guest collaboration and two presentation regressions

Live source ccb1189/a5a6451e: created fresh synthetic-only invitation 9046b0ff-e4e3-4844-8b9a-d9b1b7e21d41 with 12 independent rights and 8-session cap. Secret remained in memory and was removed from the Guest URL before reading the page. Separate IAB Guest session entered without a platform account. Synthetic JPEG V1 freehand, comment, four-star feedback, favorite and selected state were saved through real APIs and survived reload. Real Edge Owner read the exact invitation/version comment and annotation record. Partial proof .local/hosted-collaboration-proof.json and screenshot kino-pick-hosted-guest-freehand.png distinguish successes, failures and not_checked items.

Hosted testing found Guest lightbox horizontal arrows still navigate photos while drawing in the portal canvas: its global handler lacks the defaultPrevented guard used by Owner. Also Owner history labels freehand as deleted because its point/rectangle ternary omits the freehand label, while SVG rendering already supports the polyline. Both are being corrected without altering stored geometry or deletion semantics. CI41231888573 for ca3d752 was explicitly canceled as superseded to avoid wasting the remaining full native run. Neither canceled CI nor these partial hosted checks justify deploying unverified source. B/A/schema unchanged.

## 2026-11-01 — B hotfix deployed and real recommendation/freehand accepted; version wake gap found

Source 56288cb9ac3da6f7abaaa81efb710427181a587a passed exact full CI41233234187. Actions41234844192 succeeded; Worker version3e9c8a69-dfb2-4f74-b391-67213c9b7ccf, deploymentd7b65620-6777-47a2-8c10-f2e0aa6ae4af. Postdeploy receipt checked59/FK0/privateR2/noCron/OFF-dry-run-single; public B entry read back enabled=true/previews=false. The initial standalone entry read helper stopped before a request because its explicit B environment variable was absent; rerun with the required fixed account succeeded. No migration/restore/A/DNS/customer changes.

Actual Edge Owner OAuth now reads/writes recommendations: private R2 V1 metadata imported3stars/Red; show=true with4star threshold OR red recommends it; manual5stars, clear, restore all work while independent Guest4stars/favorite/selected persist. Owner history now labels Guest freehand correctly. Fresh hosted Guest horizontal keyboard creates a draft without changing photo. Owner freehand also saved through real API and Guest reload sees both authors; Guest cannot edit Owner row. Native preview download produced requested/generated audit pair with38286bytes; browser file persistence remains not_checked. CLI audit first failed7403, read-onlywhoami refreshed correct B OAuth, one retry succeeded; no new credentials or accountA changes.

A real manual V2 upload (21527bytes,900x600,XMP3/Red) completed original transfer but remained queued. Found missing processing wake in version-upload-routes complete: normal upload invokes processCloudflareImages while manual version only imports metadata. No Cron exists by design. This is a real hosted failure and Before/After has not yet passed. Next patch reuses the bounded existing durable processor for trusted completed normal/version upload jobs, retaining privateR2/current-head/auth/audit; no direct SQL ready-state mutation. Also ensure an older pending workspace job cannot consume the only wake intended for the just-completed photo. Retain existing V1 and queued V2; test next actual version normally after exactCI and forward deployment. Prior-deployment receipt is advanced to this actual successful56288cb release for the next code-only release.

Completion wake patch is now frozen and locally accepted: normal/V2 completion use the same waitUntil helper. Flag OFF creates no background task/DB lookup. ON resolves immutable completion witness by actor/upload (plus V2 path photo) and passes trusted workspace/asset ID to the existing processor; pending adds an optional exact-job filter and scheduled default behavior is unchanged. It cannot consume an older pending job instead of the just-completed photo. Failed/replayed writes preserve their original receipts; no schema change or new service.

Focused native D1/R2 routes13 passed (original10 retained plus3 wake groups): OFF queued; enabled V2 exact ready outputs while backlog untouched; completion replay no duplicate processing audit; wrong-photo replay404; normal V1 exact ready with both backlogs untouched. Images binding is a deterministic local fake, not real provider evidence. Worker dry-run/rootstrict/scopedlint/format pass. Root rebuilt B scoped profile and native24 passed; release self-test passed after increasing strict required photographer proof count10→13. Actual prior successful56288cb receipt is pinned. A new exact source CI and code-only B forward deployment are still required before real V3/BeforeAfter acceptance. Old synthetic V2 is retained queued; never mark it ready with direct SQL.

Additional hosted page check: Owner activity page works and shows actual metadata/policy/version/Guest rating/favorite/selection/annotation/comment/download events with UTC timestamps. Guest history link navigated to Validation unavailable: wrapper allowed the capability/data API but omitted its /guest/history HTML document. Added only that exact read-only page path; API auth and fixed-album boundary remain unchanged. Existing native24 group now also asserts HTML200/root, POST404 and /guest/history/other404; rebuilt profile and24 passed, release self-test passed. CI41236382208 for1d349f8 canceled as superseded before the final combined source, not counted as acceptance. No hosted fix yet; new exactCI/forwarddeploy still required. Do not broaden static routing to other Guest paths.

## 2026-11-01 — 最終受限 hosted 協作／版本切片已通過；完整 MVP 仍未完成

正式 source10b0b7b82a89a2e0fc041d401ac7b53c898475ab、CI41236744712 success、Actions41238436526 success、Worker526e3f16-f4dd-4567-9551-7ac7b05b8bd9／deployment066270a3-e12c-44f7-b2d6-c0445276cac4。公開入口true、previewsfalse、59/FK0/私人R2/無Cron/OFF-dry-run-single均核對。B entry首次OAuth過期失敗，whoami刷新既有B授權後一次重試成功，未建立新憑證。

真正V3 UI直傳、精確Cloudflare processing成功：original21527／preview13885／thumbnail4266 bytes，全private；自動讀回三星Red、明確切current-head revision1。Owner/Guest已比較V1與V3，Owner實際拖把手60→20、Guest鍵盤40。V1留言／雙端筆畫仍保留，V3不混入。Guest自己的history document/API已讀回7個實際事件；Ownerhistory包含所有本輪實際活動。Guest1張提交凍結，Owner封存明細仍指向原選V1而不被目前V3覆寫；CSV UI請求無錯誤，瀏覽器落地檔not_checked。舊V2仍queued，無直接SQL狀態修補。版本列表目前需重開／reload更新ready狀態，待補正式重試／就緒更新。

完整範圍與證據見 docs/HOSTED_COLLABORATION_ACCEPTANCE.md、docs/releases/hosted-collaboration-2026-11-01.json。下一個最高優先slice是既有workspace中的Owner新建project＋album與明確managed scope，保留foreign/tenant/invite拒絕，再走真實上傳啟用分享。不要重新做已通過的OAuth/bootstrap/100張/59restore/推薦/手繪/BeforeAfter；不要直接放寬所有routes或關掉guard。Google link/unlink、三種密碼模式、核准固定交付通知、保留政策UI等原需求仍未完成，不能標完整MVP。

最後交接與圖表更新保留在工作目錄，不為純文件再跑全量CI；main產品source仍10b0b7b，原HEAD b14d505與index未改。後續snapshot使用 refs/heads/codex/cloudflare-b-deployment（目前10b0b7b），先確認parent/ref與完整diff，再沿用ARTIFACTS中的kino-pick-publish-collaboration.py；不要reset/checkout清掉dirty工作。A/DNS/customerdata不動。

## 2026-11-01 — 相片滿版燈箱與網址同步（本機前端）

正式 `target-ui` 的相片詳情已改為滿版深色燈箱；照片開啟時網址帶 `albumId`／`photoId`，可用直接連結還原目前相片，切換照片會同步網址，瀏覽器返回／關閉會回到相簿清單。底部縮圖列使用既有私有縮圖路徑與 `TrackedPhotoImage`，點擊可切換目前照片；既有鍵盤前後張、私有預覽、版本、攝影師推薦、評論與註記面板仍留在同一燈箱。

驗證：`pnpm.cmd --filter @kino-pic/web typecheck` 通過；Worker 實際使用的 Vite target-ui bundle 建置通過（輸出到 `%TEMP%\kino-pick-lightbox-target-ui-check`，未覆蓋 `.static`）。Vite 回報既有大型 bundle 警告。尚未做瀏覽器視覺驗收或部署 B；此項不代表本次使用者要求的瀑布流／清單／推薦徽章／置頂整合已完成。下一步在同一相簿頁完成這些項目，置頂須使用正式可審計的 API／資料儲存，再對合併後 UI 做一次必要驗收與 B staging 發佈。A／DNS／客戶資料未修改。

## 2026-11-01 — 相簿瀑布流／清單、推薦徽章與置頂接線（本機驗收）

在同一正式 `apps/web/target-ui` 相簿頁完成 Gump 參考的瀑布流／圖片清單切換、攝影師推薦 badge/count 與 Owner 置頂控制；保留既有真實上傳、私有縮圖、分頁、燈箱 `albumId/photoId` URL、底部縮圖列、留言／註記／推薦編輯等現有接線。瀑布流使用原始長寬比；清單縮圖等比縮放。推薦標記由 `/api/v1/albums/:albumId/photos` 的 `photographerRecommended` 讀取，不從客戶評等推導。

新增 migration 0060 與 `GET /api/v1/photo-pins/capabilities`、`PUT /api/v1/photos/:photoId/pin`。置頂只顯示在 Owner gallery 且回應同時有 `isPinned`／`pinRevision` 時；透過穩定 request ID、revision CAS、Owner scope／Origin／session 檢查和 append-only `photo.pinned`／`photo.unpinned` 稽核。置頂中的照片若正開在燈箱，重排等關閉後才刷新，保留目前照片與網址。0060 前不顯示無效置頂按鈕。

實際定向驗證：`pnpm.cmd exec tsc --noEmit -p tsconfig.json` 通過；`pnpm.cmd --filter @kino-pic/web exec tsc --noEmit --incremental false` 通過；使用 30 秒 timeout 的 isolated native D1/Vitest `photo-pins-api.test.ts` 通過（1 file／1 test；含完整 0001–0060 migration、Owner/tenant/photo scope、CAS/replay、pin/unpin history、append-only、rollback 與 pinned-first cursor）。前端子代理另實際通過 TypeScript、Prettier、Vite target-ui build 與隔離 Playwright：清單／瀑布流、badge、503 同 request ID 重試、燈箱 URL／縮圖及燈箱內置頂。該瀏覽器測試用合成資料與 API mock，沒有驗證 hosted Worker/R2。

部署界線：Cloudflare B 仍為 schema 0059、Worker `526e3f16-f4dd-4567-9551-7ac7b05b8bd9`；0060 未做遠端 migration、部署或 hosted 驗收。推薦欄位可與 0059 相容；置頂欄位/API 在 0060 前維持隱藏／不可用。下一步須先對精確來源跑 CI，再取得 fresh 0059 backup、獨立 restore、升級 0060 並驗證舊表／schema／sequence parity 與 FK；之後才走既有 B 發佈閘門。A／FILM.KINOSTUDIO、DNS、客戶資料未改；自動刪除仍 OFF/dry-run，正式預設單一 R2。

下一步可在既有 `http://127.0.0.1:4180` 正式前端相簿頁檢視互動；若預覽服務仍使用舊記憶體程序，需由本機 dev server 重載最新 target-ui。此次未部署，不可視為線上 MVP 完成。

## 2026-11-01 — 本機真實前端刷新接線補正與圖庫驗收

找到並修正推薦狀態保存後不刷新圖庫的缺口：推薦 policy/photo editor 成功保存會送出 `kino-pick:photographer-changed`，但 Owner album gallery 原本沒有 listener，導致 badge/count 留在舊值。現在 gallery 監聽事件後重讀第一頁，保留燈箱中的 photoId 與網址。Web typecheck、target-ui Vite production build、Prettier 均通過；Vite 有既有單一 JS chunk >500 kB 警告。

在 4180 隔離本機 review Worker／D1／R2 的正式 target-ui 實際操作：設定 3 星門檻及顯示後，推薦 count 由 0 即時更新為 8，八張合成照片均顯示推薦 badge；圖片清單／瀑布流切換可用；透過 pin API 置頂 `KINO_REVIEW_004.jpg` 後讀回置頂狀態並排序至第一；打開照片後網址包含 albumId/photoId，底部八張縮圖可切換且 photoId 隨之更新，關閉回到 albumId 相簿網址。未置頂項目仍依拍攝時間排序。以上資料僅為隔離記憶體 D1/R2 合成測試資料，不是 Cloudflare B hosted 驗收。

排序驗收：已置頂優先，未置頂項目依拍攝時間新到舊。0059 的推薦 badge 與 0060 前隱藏 pin 行為維持原設計。Cloudflare B 仍為 schema 0059，未跑 migration 0060、未部署；必須先完成精確來源 CI、fresh 0059 backup→獨立 restore→0060 parity/FK，再進既有 B release gate。A／FILM.KINOSTUDIO、DNS、客戶資料不動。

## 2026-11-01 — 置頂圖示重繪

Owner 圖庫與相片燈箱共用的 `PhotoPinButton` 改成斜角 pushpin SVG；瀑布流使用照片上的白色線框圖示與陰影，已置頂時填入 Kino 金色；清單使用無方框圖示，已置頂同樣以金色填滿。保留 40px 點擊範圍、焦點外框及置頂／取消置頂可存取名稱。隔離 4180 預覽重新建置並目視確認清單、瀑布流未置頂／已置頂狀態；Web typecheck、Prettier 與 Vite target-ui build 通過。只改 UI 外觀，沒有新 API／schema；B 尚未部署，A 不變。

## 2026-11-11 — Kino Review reuse paths (planning only)

For Review's first share/comment slice, use `apps/worker/src/invite-issuance.ts` for Owner-scoped invite creation, `packages/contracts/src/guest-access.ts` for stable permission bits, and `apps/worker/src/guest-access.ts` for current-session authorization. Its access result is a read snapshot, not a mutation/download grant. Use `apps/worker/src/guest-comments.ts` and `apps/worker/migrations/0042_guest_comments.sql` as references for invite/photo/version-bound threads and database guards. Port the contract and checks into Review's own accounts, database, secrets, and storage; translate photo versions/coordinates to video versions/timecodes/segments. First verify create share → guest comment on a version → creator read-back before broader reuse.

## 2026-11-13 公開倉庫發布相容

倉庫已依使用者要求公開。production 共用 CI 守門改成核對精確 kinostudio/kino-pick 與實際可見度布林值，公開與歷史私人收據皆可驗證；新收據記錄 GitHub 回傳的 private 值。main push、來源 SHA、完整綠燈、來源倉庫與 Cloudflare B／D1／R2 的檢查仍生效。node --test tools/check-production-bootstrap.test.mjs tools/check-production-release.test.mjs 三項通過，含公開／私人、錯倉庫、外部來源、失敗 CI、錯 SHA 負例；格式與 diff 檢查通過。此項不更改產品權限或資料庫。

## 2026-11-14 Google 正式接線準備

最新 main d540717 已核對，現有程式支援明確綁定 Google，公開註冊保持關閉。Google Cloud OAuth 回呼必須精確為 https://pick.kinostudio.tw/api/auth/callback/google。瀏覽器工具因 Work settings 關閉 local browser use，無法建立用戶端；Google 憑證尚未建立或安裝，正式綁定／登入尚未驗收。

部署候選改用既有 Wrangler deploy --secrets-file，將 GitHub Actions 的 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET 與程式同次發布，保留精確 prior version 守門，避免單獨 secret put 改變版本。兩者皆空時沿舊流程，只提供一個時在部署前拒絕；臨時檔權限 0600 並由 EXIT trap 移除，不輸出值或加入 artifact。官方依據 https://developers.cloudflare.com/workers/configuration/secrets/ 。本機 Wrangler help 確認參數支援；YAML 格式、bash -n 與三項發布守門測試通過。待開啟瀏覽器後，建立正式 OAuth 用戶端與安全保存須依實際表單確認；安裝 Actions Secrets 後走精確 main CI→自動 B→Owner 帳號頁明確綁定及 Google 登入驗收。未改 A、D1 或產品角色權限。
