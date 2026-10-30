# Staging OAuth 憑證與封閉容器

2026-10-31：使用者已明確確認建立 kinostudio 的 Kino Pick Staging OAuth App／Client Secret，僅保存本機忽略設定與 Cloudflare B staging Secrets。

## 已完成

- GitHub OAuth App：Kino Pick Staging，App ID3979161，擁有者kinostudio。管理頁：https://github.com/settings/applications/3979161 。原 KINO Studio CMS (Weebly) App3716583 未修改。
- Homepage：https://kino-pic-staging.kino-pick-aaron2026.workers.dev；唯一 callback 加上 /api/auth/callback/github，wildcard／Device Flow 關閉。既有 user access token 到期選項保持預設開啟。
- Client ID／Client Secret 透過一次性127.0.0.1表單保存到 apps/worker/.local/staging-auth-secrets.json；同時產生48 bytes 隨機 session signing secret。未使用剪貼簿、未將憑證值輸出聊天／命令列。表單成功後自動停止，GitHub 單次 Secret 顯示已透過 reload 清除。
- 本機 JSON 包含 GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、BETTER_AUTH_SECRET，Git 已忽略，NTFS ACL 關閉繼承，僅目前操作使用者／SYSTEM／Administrators FullControl。它是受 ACL 保護的本機明文設定，不要誤稱本機磁碟檔案已加密。
- B 帳戶 d3e930465c0df7e89b35de3ca65ea36a，kino-pic-staging 已有初始封閉容器。上述三個名稱已由 wrangler secret list 與官方 settings API 讀回，全為 secret_text；只讀名稱／型別，不取值。

## 為何有初始 Worker 但沒有網站上線

實際 Wrangler4.151.3 原始碼與官方 Secrets 文件確認：不存在的 Worker 不能用 versions upload，也不能預先設定 runtime Secrets；初始建立可用 deploy --secrets-file。為完成本次已核准的保存，使用專用 wrangler.auth-provisioning.jsonc／tools/staging-auth-provisioning-worker.ts 初始化容器：

- 固定 B account_id、固定 kino-pic-staging；建立前再次核對帳戶ID並確認目標 Worker404，不覆蓋既有 Worker。
- workers_dev=false、preview_urls=false、routes=[]；讀回 subdomain enabled=false／previews_enabled=false。
- 無 D1/R2/Assets 綁定、無 Cron、無產品程式；任一路徑／方法回503、no-store、不設 Cookie、不讀環境 Secret。
- 這是憑證存放資源初始化，並非產品 cutover、可用網站或 OAuth 登入驗收。原 tools/check-cloudflare-deployment.mjs、readiness及產品全部OFF/dry-run原樣保留。
- **此設定只限首次初始化；不可在未確認狀態下重跑，也不可在正式 app 上線後用它覆寫 app。後續產品部署使用原 staging config 與經審查 cutover。**

官方參考：https://developers.cloudflare.com/workers/configuration/secrets/ 、https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/ 。版本入口也須關閉，不能只關 workers.dev。

## 實際驗證與失敗紀錄

- 12個本機路徑／方法檢查全部503、no-store、無Cookie／Secret；scoped ESLint與root TypeScript通過。
- Wrangler dry-run通過；初始上傳成功，metadata證據 apps/worker/.local/staging-auth-provision-proof.json（不含Secret值）。成功日誌 staging-auth-provision.log；dry-run日誌 staging-auth-provision-dry-run.log，皆在忽略目錄，寫入前比對已知值遮罩。
- 首次執行前置 Python JSON parser 不接受 Prettier 的 JSONC trailing comma，未發出上傳；修正後第一次 Cloudflare上傳被 code10021 拒絕（Taipei已10/31而provider仍按UTC判定未來相容日期）。保留 staging-auth-provision-first.log，改用專案原2026-10-23相容日期後成功，沒有升級Wrangler或放寬檢查。
- 一次診斷輸出遇到Python cp950無法輸出emoji，已改UTF-8；未顯示Secret。ACL設定後受限sandbox讀取被拒絕，改以授權使用者完成候選掃描，691個候選檔案中無任何新Secret值。
- 沒有重跑已通過的整套Cloudflare／prototype回歸；沒有新migration或遠端SQL寫入。

## Owner 與下一步

GitHub connector的authenticated profile id255123716／nickname kinostudio，與GitHub網頁登入帳號一致。已用既有bootstrap CLI產生一次性的 staging-owner-bootstrap.sql及proposal JSON（都在忽略.local）；新internal UUID固定在proposal，不重複生成。只是一份待套用提案，remoteApplied=false；未因email相同、第一位訪客或未驗證登入授權Owner。

下一步：先做隔離staging schema／代表性backup→restore→upgrade→parity，然後審核／套用一次性Owner bootstrap，再將真正auth程式以受控staging驗證部署接上此Secret，完成真實GitHub登入、陌生使用者拒絕、session與綁定。Google OAuth憑證尚未設定；現有雙provider支援與同一身分規則保留。不得因本頁保存完成把real_oauth_and_owner_bootstrap_verified設true。

不需要再要求使用者提供相同Client Secret，不要把Secret貼在聊天。需要讀本機設定時保持授權身分／ACL與不輸出值的界線；後續真正staging部署不得把Secrets改成明碼vars。A／FILM.KINOSTUDIO未變更。
