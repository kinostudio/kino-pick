# Kino Pick 線上 MVP 發佈與接續計畫

更新：2026-10-31。此文件是目前執行順序；原 PRD／ROADMAP 的產品需求與安全條件保留，不因 MVP 分期被刪除。既有歷史紀錄不等同當前完成狀態。

## 驗收終點

在 Cloudflare B 發佈 Kino Pick 的實際 Worker 前端及 API，提供可存取的 HTTPS 網址，使用真實授權帳號與獨立客戶瀏覽器完成以下流程，保存版本、網址、時間與驗收證據。4174 prototype、合成 OAuth、本機 workerd、R2 單次 PUT 或 CI 綠燈各自都不足以宣告線上 MVP。

1. Google／GitHub 任一或雙來源綁定同一內部身分；僅預先授權 Owner 能進後台，不以第一個登入者或相同 Email 自動授權／合併。連結、解除及 session 撤銷可用。
2. 建立 workspace／專案／相簿，真實批次上傳至少100張測試圖到私人 R2；產生可用縮圖／預覽、分頁 Grid、單張燈箱。容量不足拒絕上傳，跨 scope 拒絕讀取。攝影師推薦的 metadata／門檻／手動調整需接正式服務，不能只有 demo。
3. Owner 建立三種密碼模式及期限的邀請，客戶免註冊進入；逐項 view/select/rate/favorite/tag/annotate/comment/download 等權限由 API 驗證。挑片張數上限、即時評等／收藏／標籤、提交與後台匯出可用。
4. 留言、圈選及手繪綁定固定照片版本；同邀請共用、跨邀請隔離。immutable 版本、可選同檔名判定、手動版本、Before/After 滑桿／並排／疊圖與歷史可實際操作。
5. 其中一位明確授權客戶代表核准固定版本，使用固定交付清單完成成品下載、基本通知與原規格要求的交付／ZIP；完整 append-only 操作歷史可追蹤。下載走正式按鈕／連結及權限／審計，右鍵限制僅是 UI 行為，不能宣稱防止截圖或擷取已送達的圖片。
6. 儲存政策／有效人類瀏覽／配額可檢視，保護／最低保留／使用中相簿及歷史版本不誤刪；先完成 dry-run 與政策確認流程。自動刪除保持 OFF，清理重試與實刪另在明確允許的隔離測試資源驗收，未完成不得宣稱自動清理可用。
7. 代表性 D1/R2 備份復原、跨租戶與邀請拒絕、撤銷／到期、Cookie／Origin、濫用限流、費用與設定邊界有真實證據；手機與桌機主要流程可用。正式 D1/R2 與 staging 分離，不把測試資料混入正式服務。

## 盤點結論與流程修正

- 可用基礎：既有 React/Vite Worker 目標、Hono、Better Auth、D1、私人 R2 adapter 與大量本機測試；GitHub 私人倉庫及 B 專屬 Actions Secret 已有交接證據。保留 Next 參考端，不另建專案。
- 目前未上線：2026-10-31 使用隔離 Wrangler 帳戶唯讀查詢 staging Secret 名稱，回覆 Worker kino-pic-staging 不存在；這不能證明帳戶沒有其他 Worker，也不能證明已有 runtime Secrets。
- 本輪起初 staging APP_URL 是 configure-staging.invalid；隨後已核實 B 帳戶並建立 kino-pick-aaron2026.workers.dev 子網域，設定預定 origin：https://kino-pic-staging.kino-pick-aaron2026.workers.dev 。workers_dev與版本入口仍false；Worker隨後已建立封閉503憑證容器，網址不是已上線產品服務。54份來源 migration 不是54份已套用遠端 migration；production 綁定仍是 placeholder。
- 原 readiness 七項全部 false；config.ts 掃描到28種 LOCAL_ONLY 拒絕。每個功能須經 hosted 相容性審查／驗收再轉正，禁止全域移除 APP_ENV 檢查或一鍵全開。
- tools/check-cloudflare-deployment.mjs 永遠拒絕，即使所有 boolean 為 true；它是原本刻意關閉的 foundation guard，不是可執行的最終驗收。只可在有 scope、版本、schema、provider、restore 與安全證據的 cutover 中替換，不能為綠燈繞過。
- 圖片處理目前可信任的 Sharp runner 是本機能力；後台處理順序控制是 prototype。上線必須交付真正 Cloudflare 優先的處理 adapter／失敗與配額策略，Oracle 維持候選，不假設 VM 已開機或 Workers 能直接跑 native Sharp。
- 修正先前流程：不繼續無限擴充本機細節；每輪只處理最高優先的一個上線缺口，以 Schema→Service→API→UI→必要 Tests→Docs 閉環交付。文件改動不重跑20分鐘全量測試；合併可執行變更後再跑適當 CI。

## 執行順序與通過條件

| 順序         | 交付                                                                                 | 通過才進下一步                                                                     |
| ------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| R0（本輪）   | 統一驗收清單、唯讀 release:inventory、恢復原 heartbeat                               | 可重現列出未完成條件；不洩漏 Secret；不把本機證據當 hosted                         |
| R1（下一個） | B staging HTTPS origin、Google/GitHub callback 與私密設定、固定 Owner bootstrap      | 真實 Owner 登入／雙來源身分及陌生使用者拒絕；不先開放其他 hosted 功能              |
| R2           | 隔離 staging schema 與代表性資料 backup→restore→migration→parity；原圖／版本引用一致 | 檢查 FK、審計、計數與物件校驗；復原到新 DB，不覆蓋客戶資料；草稿 SQL 不自動套用    |
| R3           | 真實私人直傳、Cloudflare 優先的縮圖／預覽處理、配額及圖庫                            | 真正100張上傳／縮圖／分頁／燈箱，重試不重複／不洩漏原圖，額度失敗有實際行為        |
| R4           | Guest 挑片與協作、版本對比、攝影師推薦正式接線                                       | 上述權限隔離、同邀請共享及固定版本行為通過 hosted 流程                             |
| R5           | 核准／固定交付／下載／通知、儲存後台 dry-run、安全拒絕                               | 完整客戶流程與稽核證據；未完成項目不可用無效按鈕假裝可用                           |
| R6           | 受控 cutover、production 獨立資源、GitHub Actions 發佈、fresh browser smoke          | 記錄 URL／Git SHA／部署版本／資料庫版本／復原點；真正線上驗收通過才標 MVP 發佈完成 |

R1-01 已完成子網域準備：B 帳戶 GET 驗證正確、現有 Workers 數0、原子網域 GET404/code10007，之後 PUT 建立及 GET 讀回 kino-pick-aaron2026 均成功。原瀏覽器是 A 登入，保持不動，使用隔離 Wrangler 憑證向官方 API 查詢／建立，未輸出 Token。下一步完成 OAuth 私密設定與 Owner bootstrap。

固定 callback：

- Google：https://kino-pic-staging.kino-pick-aaron2026.workers.dev/api/auth/callback/google
- GitHub：https://kino-pic-staging.kino-pick-aaron2026.workers.dev/api/auth/callback/github

GitHub OAuth 本次確認已收到並完成：Kino Pick Staging App3979161已建立，Client Secret及隨機session secret已保存本機忽略設定與B staging加密Secret；wildcard／Device Flow關閉，原CMS App未修改。B kino-pic-staging已初始化為無任何公開入口／產品綁定的503憑證容器；這不是可用網站或真實登入驗收。Owner bootstrap SQL僅已準備，尚未套用。詳見 [STAGING_AUTH_PROVISIONING.md](STAGING_AUTH_PROVISIONING.md)，勿重複建立憑證或覆寫容器。憑證值只放 Secret／忽略的本機檔案，不放聊天、Git 或日誌。建立新持續存取憑證若瀏覽器規則需要即時確認，先準備好具體權限與目的再請求。

缺外部條件時，記錄精確原因與一次使用者操作需求，繼續不依賴該條件的 schema restore／adapter／安全測試；不得重複呼叫不存在的 Worker 或要求無關帳戶重新登入。

## 可執行盤點與驗證

- pnpm release:inventory：唯讀 JSON 摘要，預設 staging；--stage production 可檢查正式設定。
- pnpm release:inventory --check：來源設定或記載的 acceptance 尚未完成時 exit1。這是預期阻擋，不是測試程式失敗；exit0 也只代表來源盤點通過，從不授權部署或宣稱 hosted 測試通過。
- node --test tools/release-inventory.test.mjs：四項防止誤報／敏感值輸出的檢查。
- 不讀 Secret 值、不連雲端、不寫資料庫、不移動 migration；localOnlyErrors 為待審查清單，未啟用的後續功能可繼續保留 hard-local，不要求為了盤點綠燈刪掉安全保護。
- 原部署 guard 與所有 OFF/dry-run 設定保留。付費與免費額度以正式配置前的官方當期資料核對，不預設免費一定足夠。

## 自動接續

既有 kino-pic heartbeat 已恢復 ACTIVE，維持61分鐘週期與同一個聊天，名稱更新為 Kino Pick 線上 MVP 接續研發。每輪讀本文件、AGENTS、GEMINI、最新 HANDOFF 及 Git；執行一個實際切片並交接。無變化／無可執行事項不重複通知；有完成、失敗、實質進展或需使用者操作才通知。最終完成後暫停 heartbeat，保留網址與驗收證據，不持續無限開發。

## 2026-10-31 — 目前已通過的基礎驗收

R1固定Owner與真實GitHub登入／登出、R2 staging54migration與獨立雲端D1復原已完成；精確證據與復原界線見 [STAGING_DATABASE_AUTH_ACCEPTANCE.md](STAGING_DATABASE_AUTH_ACCEPTANCE.md)。臨時公開驗收入口已關閉，尚非產品發佈；Google／同身分綁定完整驗收與含R2物件的復原仍待。下一個執行切片R3私人直傳及Cloudflare實際縮圖處理；B獨立登入需求已提出一次，等待回覆，不重問。

## 2026-10-31 — Current R3 handoff

B login and bucket-only R2 credential creation/storage are completed with user approval. Real S3 PUT200/replay412/hash-matching GET200 and signed CORS allow204/foreign403 pass. Native Images binding also generated and verified two private synthetic derivatives via real remote development. See latest HANDOFF for exact proofs and limits. These are capability checks, not product/100-photo/hosted MVP acceptance; public entry remains closed and private_direct_upload_verified remains false. No further key/login request is pending. Next implement the genuine Cloudflare recipe/adapter plus compatible durable-job migration; retain immutable Sharp recipe, quota/source/output guards and draft-SQL exclusion. Keep A untouched, auto-delete OFF/dry-run. gh works outside Wrangler-isolated XDG; prior CI41118459908 completed/success.

## 2026-10-31 — Selected production domain

User selected `https://pick.kinostudio.tw`; DNS is in A/FILM.KINOSTUDIO. Do not transfer kinostudio.tw, change root nameservers or modify existing A deployments. Existing staging OAuth/CORS origin remains unchanged until the new hostname is actually configured and tested. A cross-account Workers custom domain cannot be treated as a same-account attachment or assumed to work with an ordinary CNAME. Prepare a narrowly scoped hostname-only entry plan and resolve its required A permissions before configuration; no A/domain change has occurred. Website/API/D1/R2 processing remains targeted to B.

## 2026-10-31 — CURRENT: B staging56; upload/processing/gallery integration accepted in isolation

Supersedes prior55-only checkpoint:0055 remains immutable;0056 adds reciprocal Owner request namespace and bounded Cloudflare IO-review guards. Actual B staging AND independent rehearsal DB now have56 migrations; fresh private backup/parity/FK0 passed,135 existing product tables unchanged and public/preview entryfalse. Details/recovery: docs/STAGING_PROCESSING_ACCEPTANCE.md; protected `.local/staging-0056-apply-proof.json`. No A/DNS/customer/default-local mutation.

Final focused20 unit checks and10 isolated native/API/mobile groups pass, including atomic migration rollback, old job preservation, Owner policy persistence/replay/collisions/tenant denial,16MiB quota-safe refusal, V1/V2 completion-aware busy lock, Cloudflare recipe claims and review fences, three transient failures→IO review with reservation retained, private derivative/gallery finalization and375px save/reload. The integration uses a Sharp-backed Images double; earlier real Cloudflare adapter probe is separate. Worker/UI build,root/Web strict and scopedlint pass; full-chain test harnesses now use official split+atomicbatch for the larger migration. Production/cloud flag defaultsOFF and release gate remainsclosed.

Next concrete task: push this source, verify its single CI run, then create a narrowly gated hostedOwner B upload validation with native Images/private R2/gallery/100 test photos and D1/R2-consistent restore. The updated product Worker itself has NOT been deployed; remote schema success is not hosted product acceptance. Preserve missing Google/link/session/Guest/version/delivery/security requirements and do not mark MVP released. User-selected production hostname is pick.kinostudio.tw in A; existing staging callbacks stay unchanged. Prepare hostname-only entry routing without root/NS/existing A deployment changes and resolve exact permissions before applying. No repeated credential/login request needed.

## 2026-10-31 — CURRENT: 真實 hosted Owner／100 張 R2＋Images 圖庫驗收通過

B 的 Owner-only staging 已實際部署，來源 `7be9f78496103076f110a4f9e58e96788265f1da`，Worker version `1441d058-27f1-44e8-9440-4861f88d7f47`；CI41154235653 completed/success。真實 GitHub Owner 登入後，以產品介面建立測試 workspace/project/album，五批各20張合成JPEG經瀏覽器私人R2直傳及原生Cloudflare Images完成。100 jobs succeeded、300 assets、reserved0；全部300個物件GET/byte/SHA檢查通過，200衍生JPEG完整解碼、320/2048尺寸及比例、metadata移除與10張EXIF6方向通過。實際Edge圖庫24→48→72→96→100、100個唯一檔名／全部縮圖載入；直式1000×1600與下一張橫式1600×1000燈箱、關閉操作通過。匿名私人縮圖401，原7項hosted邊界通過。

這是受限 staging Owner 流程，非完整MVP。`private_direct_upload_verified`仍不提升為完整發佈就緒：跨租戶／配額故障hosted、含R2的備份復原及Guest等要求仍需完成。詳細scope/證據/復原下一步見 docs/HOSTED_100_PHOTO_ACCEPTANCE.md。D1已有新受ACL保護的匯出，尚未獨立restore，R2物件尚未備份。public staging目前enabled、previewfalse；其他產品feature仍OFF，無Cron／production／A／DNS改動。既有production gate保持closed，自動刪除OFF/dry-run，單R2節點。

下一切片：先完成這100張資料的D1＋R2一致備份與獨立復原，再修正Cloudflare政策16MiB但UI顯示64MiB／未設定Google仍顯示可點登入的能力宣告，依序完成真實雙OAuth綁定與Guest/版本/交付hosted驗收。不要重傳100張、重建Owner、重套0055/0056或重問憑證。保留原worktree/index與未提交變更。
