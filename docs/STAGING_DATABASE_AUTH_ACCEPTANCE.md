# B staging 資料庫與真實 GitHub 登入驗收

更新：2026-10-31（Asia/Taipei）；原始證據時間採UTC。這是 R1／R2 基礎驗收，不是線上 MVP 完成。

## 固定範圍

- Cloudflare B：d3e930465c0df7e89b35de3ca65ea36a；A／FILM.KINOSTUDIO及原CMS未修改。
- staging D1：kino-pick-staging-d3e93046／cdee0ac7-bf91-4852-9c17-a996c0b84f8d。
- 獨立雲端復原 DB：kino-pick-restore-6b279dee／ef13f9cd-69fa-4a48-9ecd-546bb2964b68，保留作為本次復原點參考，不是正式DB。
- Owner：authenticated GitHub profile與瀏覽器均核實kinostudio、provider subject255123716；使用先前固定的internal UUID提案，沒有依Email合併或讓首位登入者成為Owner。

## 已實際通過

1. 新鮮遠端查詢確認只有_cf_KV系統表，產品資料表0，匯出32bytes初始SQL。固定帳戶／DB ID，不碰既有本機D1或客戶資料。
2. 新工具 tools/rehearse-staging-d1.mjs --local-only只允許本機CLI：還原初始備份、套用54份正式migration到0054、套用Owner提案、匯出、第二份本機D1還原。134表／schema／資料雜湊一致，foreign_key_check0。重複bootstrap與UPDATE審計原生拒絕後，資料完全不變。
3. 核對54份migration雜湊未變，再於原空白staging套用相同migration。審核並一次性執行Owner提案，確認Owner1、bootstrap1、owner.bootstrapped audit1。未讀取／套用未完成的delivery草稿或review-only freehand SQL。
4. 匯出含Owner的staging SQL，還原到上面的獨立遠端DB，再匯出。134表、schema與每表row hash完全一致，FK0；兩份SQL SHA256也相同。這證明目前staging基線D1雲端復原，不是R2照片／完整產品或最新登入後狀態的復原證據。
5. 以獨立auth-validation entry只重用既有Better Auth／Owner驗證，無產品路由／Assets／R2／Cron。10項native workerd安全檢查通過：匿名頁／session、偽造cookie、產品與註冊拒絕、Origin、method、provider、callback外部redirect、16KiB上限。
6. 經 tools/check-staging-auth-validation.mjs 的窄範圍檢查，暫時開啟B staging固定HTTPS網址。瀏覽器真正導向GitHub App3979161，scope只有read:user/user:email，PKCE S256；使用kinostudio完成授權回跳，畫面顯示已驗證Owner登入。
7. 真實遠端D1僅1 user／1 Owner，1個新鮮且屬於提案Owner的session，1筆登入audit，既有github subject對應provider token存在（只查boolean/count，未讀值）。6項真實線上拒絕檢查通過：匿名session、產品路由、註冊、錯Origin、外部redirect、超大body。
8. 瀏覽器操作登出，遠端session0，登入及撤銷audit各1，user／Owner仍各1。登出後的最後一次CDP畫面擷取逾時，未將逾時當成UI通過；撤銷結果由真實D1計數確認。未額外讀取或輸出HttpOnly cookie／Token。
9. 測試完成已以官方API關閉workers.dev及Version URL，並讀回兩者false；auth-validation設定也回到workers_dev=false。此網址不是公開產品，未保留無完整濫用驗收的公開測試入口。

## 證據（全在Git忽略的apps/worker/.local）

- staging-r2-current.json：原始空白備份路徑／SHA。
- staging-r2-rehearsal-current.json：54份migration SHA、純本機指令、134表及復原比對；run log含兩個預期拒絕，非測試失敗。
- staging-r2-remote-proof.json：遠端migration／Owner指令及含Owner備份SHA。
- staging-r2-cloud-restore-proof.json：獨立遠端DB、來源／復原SHA與canonical parity。
- staging-auth-validation-local-proof.json：10項native安全檢查。
- staging-auth-validation-gate.json、staging-auth-validation-deploy.log：只限auth的審查與版本6578710d-76ee-4d8c-aeea-f5cf48f26fe1。
- staging-real-github-login-proof.json：真實provider／Owner登入與登出計數、scope／PKCE及測後關閉入口。
- staging-auth-hosted-negative-proof.json：6項線上拒絕檢查。

未重跑舊820單元／61整合／40瀏覽器／368全量Cloudflare；那些是先前版本的證據。本次scoped lint/root strict/dry-run及上述native／remote檢查是真實執行。初次Miniflare啟動沿用了舊options，v5驗證拒絕、未跑測試；改用既有主測試相同的convertV4MiniflareOptions後，10項全部通過，沒有放寬assert或升級套件。正式產品deploy guard仍實際exit1。

## 不可誤報與復原方法

- real_oauth_and_owner_bootstrap_verified=true僅以已核實的GitHub／固定Owner基礎為依據；Google憑證／真實Google登入、雙來源新連結／解除、完整session管理與陌生真實帳號拒絕，仍須後續驗收。fresh_link_unlink_and_session_controls_verified不變。
- backup_restore_rehearsed仍false：目前僅D1基線雲端復原，尚無含真實R2照片／完整協作／版本的最新一致復原。其餘readiness未放行，原產品／production guard未替換。單項true不授權產品部署。
- 原持久本機D1未動；遠端staging為54。回復時先關入口／停止寫入，保留現有DB與audit，將驗證過的選定備份還原到另一個DB，比對後再受控切換binding。不要DROP表、覆寫現有DB或重跑已關閉bootstrap。
- 上面的Owner備份點在真實OAuth登入之前，不包含後續provider token及登入／撤銷audit；恢復前必須明確接受時間點，或對最新狀態另做私密、受保護的備份。備份含身分／session資料時必須限制讀取，不上傳Git／聊天。
- auth-validation是臨時驗收工具，不得用它或auth-provisioning config取代真正產品。兩者目前都預設不開公開入口；日後需要再次測試時，須明確受控開啟、驗收後關閉。

## 下一個最高優先任務：R3

1. B獨立瀏覽器登入已準備；目前隔離Wrangler對account token metadata GET403/code9109，沒有Token管理權限。staging目前只有3個OAuth相關Secrets，缺R2 S3簽名憑證，先前本機R2測試檔已依約刪除。已提出一次B登入需求，等待使用者回覆；不要登出／切換A的Edge，也不要重複問同一問題或要求Secret貼聊天。
2. 取得僅限kino-pick-staging-d3e93046桶的Object Read/Write服務憑證，確認後只存ACL保護本機與B runtime Secret；新增持續憑證需遵守動作時確認。更新R2 CORS只加入實際staging HTTPS origin並保留必要headers，不開公共原圖／wildcard。
3. 不依賴登入可先實作Cloudflare Images處理adapter：沿用ImageProcessingAdapter／既有D1 lease與配額、immutable輸出。現有durable-runner及D1 row schema綁local-sharp-0.35.5-v1；不能讓Cloudflare處理冒用Sharp recipe，須加新的明確recipe與相容migration／復原說明，保留舊job處理。Oracle維持候選，不能假設VM在線；處理優先序目前只有prototype，需正式持久化。
4. 真正100張私人直傳→縮圖／預覽→正式Grid／燈箱，包含quota、重試與恢復後，再逐項轉正Guest協作／版本／交付。Cloudflare Images實際可用性／費用／額度需當期官方資料與真實配置驗證，不承諾免費足夠。
