# Google / GitHub OAuth 與同身分綁定測試設定

本機程式已連接 Supabase SSR SDK；預設 AUTH_DRIVER=disabled。未設定時 `/login` 只顯示尚未設定，沒有假登入。沒有把 mock actor 或測試 bypass 編入應用程式。真正 Google/GitHub/Supabase 端到端尚未驗證。

## 使用獨立測試專案

1. 建立或選用專用 Supabase 測試專案；禁止用客戶正式資料。備份後由 shell 注入 DATABASE_URL，於專案根目錄執行 `pnpm db:migrate`。此步需要 DB 管理者身份，應用程式不需要 service-role key。
2. 在 Google Cloud 建立 Web OAuth client，在 Supabase 的 Google provider 輸入 client ID / client secret。Google 的 authorized redirect URI 是該 Supabase 專案的 `/auth/v1/callback`；不是 Kino Pick 的 callback。兩項 secret 留在 provider 後台，不要寫進 Git。
3. Supabase Auth redirect allowlist 加入完整 `http://localhost:3000/auth/callback`；正式/測試站分別使用確切 HTTPS callback，不使用任意 wildcard。
4. 將 `.env.example` 複製到 `apps/web/.env.local`。設定 AUTH_DRIVER=supabase、APP_URL=http://localhost:3000、SUPABASE_URL（專案 HTTPS origin）與 SUPABASE_PUBLISHABLE_KEY（publishable key，或 legacy anon JWT）。不要使用 service-role 或 sb_secret key。其他未用欄位保持空白。重新啟動 `pnpm dev`。
5. 開啟 `/login` → 使用 Google 登入 → `/dashboard` → 建立 workspace。回訪同 Google 身份應回到同 Supabase user.id 與同 profile；不依 email 或顯示名稱合併身份。
6. 在第二個真實 Google 測試帳號確認 workspace 隔離；owner 授權/停權後立即驗證可讀範圍。驗證重送相同 requestId 不重複建立。完成後記錄 staging 證據，才能勾選 M1-01 的外部驗收。

若改用本地 Supabase CLI，需要 Docker 及完整 Auth/DB/PostgREST 服務；目前執行環境未提供 Docker/psql，沒有執行此部署。不要將 E2E fixture 當作本地 Supabase 安裝。

## 本機自動測試

```powershell
pnpm install --frozen-lockfile
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright 啟動三個 loopback processes：54329 是獨立 TEST-ONLY Supabase HTTP fixture（PGlite + Auth/PKCE 替身），3100 是連接 fixture 的 app，3101 是登入停用的 app。測試結束自動停止，並拒絕重用已占用的 server。不要把 fixture 對外開放；它的 token 是刻意無效的測試 token，不能登入真正 Supabase。測試替身僅由測試設定啟動，正式應用沒有 mock 登入選項。測試檔 `fixture-user` cookie 只供 fixture 選擇第二個虛擬帳號，應用不讀取它。

已驗證：PKCE code/verifier 交換、server session HttpOnly/SameSite=Lax、同 user profile 保持、workspace reload 保存、雙帳號隔離、角色授權/停權、重送/衝突、偽造 token 拒絕、callback open redirect 拒絕、登出、26 個工作空間跨頁不重複/不遺漏、未設定登入時 fail closed。這些不是 Google/Supabase 雲端驗證。

## 安全界線與未驗證事項

- 每個 protected API / server page 呼叫 Supabase `getUser()` 驗證 user，必須有已啟用的 Google 或 GitHub identity；不以 cookie 內 user 或 getSession 當授權依據。DB RPC 再由 auth.uid()/auth.identities 決定 actor，不接受外部 actor override。
- OAuth callback 完成後只導向設定的 `/dashboard`；不採用 next/redirect/Host 參數。PKCE verifier 由 server-only cookie 保存。
- Session 使用 HttpOnly、SameSite=Lax；HTTPS origin 設 Secure。本機 HTTP loopback 才允許非 Secure。Proxy 僅刷新 session，API/DB 另驗權限；個人頁與 API no-store。
- 變更 API/表單驗證 canonical Origin。全站 no-referrer 可能讓原生 form 送 Origin:null，只有 browser-controlled Sec-Fetch-Site=same-origin 時才接受；same-site/cross-site/缺失 metadata 都拒絕此例外。
- 不記錄 raw OAuth codes、tokens、cookies 或 driver errors；部署平台 access logs 也必須為 `/auth/callback` query 做遮蔽。一般回應只含 generic errors + request ID。
- APP_ENV=production 仍因 R2/正式 storage 未完成而被 health guard 擋下；本機 optimized build 不代表可正式上線。
- 未驗證 hosted Supabase、實際 Google、真實 PostgREST、Supabase session refresh/revocation 行為、獨立 Postgres connections 的競態。分散式 rate limiting、CSP 及正式監控仍是 release gate。

參考：[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[Google provider](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)。實作亦讀取已安裝 Next.js 16.4.2 的 cookies/proxy/route-handler/authentication 文件。

## Session 回歸驗證範圍

測試 fixture 以 session_id 關聯 access/refresh token，登出撤銷該 fixture session 的所有舊/新 token。提供僅 fixture 存在的過期 session 入口，驗證 SDK 真正組裝多段 cookie、proxy refresh 後 HttpOnly cookie 持久化、同時兩個請求、以及登出後重放舊 cookie。fixture 只模擬十秒 refresh 重用窗口，並非完整 GoTrue token-family/rotation 實作；不得宣稱驗證了所有 hosted Supabase session 行為。此入口和 fixture 不進 app runtime。

Reference: https://supabase.com/docs/guides/auth/sessions and https://supabase.com/docs/guides/auth/server-side/advanced-guide .

## Google / GitHub 與同一身分（最新設定）

1. 執行 migration 202610230006；它保留既有 user IDs、profiles、workspace ownership，讓受控 RPC 接受 Google/GitHub。應用仍不需 service-role key。
2. 在 GitHub 建立獨立 Kino Pick OAuth App，Homepage URL 為應用網址，Authorization callback URL 為 Supabase 專案 `https://<project-ref>.supabase.co/auth/v1/callback`。把 Client ID/Secret 只設定在 Supabase GitHub provider。不要重用 KINO 官網 OAuth 應用，也不需 GitHub repo 權限；登入只請求 read:user / user:email。
3. Supabase app redirect allowlist 同時加入確切 APP_URL 下的 `/auth/callback` 與 `/auth/link/callback`。Google provider 的 OAuth callback 同樣指向 Supabase，不是這兩個 app callback。
4. `.env.local` 設定 `AUTH_DRIVER=supabase`、APP_URL、SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY，並將 `AUTH_PROVIDERS` 設為 `google`、`github` 或 `google,github`；僅列已在 Supabase 設定完成的來源。未指定時仍只啟用 Google 以相容既有部署。AUTH_DRIVER 預設 disabled。
5. 要新增第二種登入方式，必須在 Supabase Auth 明確開啟 manual linking，並設定 `AUTH_MANUAL_LINKING_ENABLED=true`；app 預設 false。兩個來源都啟用後，先登入原帳號，在工作台 → 帳號與登入方式 → 綁定另一來源，完成 provider OAuth。沒有解除綁定/合併兩個既有平台帳號的 UI。
6. 確認使用兩個來源分別重登入後，相同 Supabase user.id、原 workspace/專案與權限保留。再用另一個獨立測試帳號驗證綁定衝突不會轉移 ownership。真實供應商、HTTPS cookies、refresh/撤銷和實際 callback URL 均須 staging 驗證。

應用不比對 Email 或合併不同 user IDs。**Supabase Auth 本身有相同已驗證 Email 的 automatic identity linking 行為**，本 app 沒有關閉或覆寫它；fixture 沒有模擬這項行為。若採用新增架構補充要求的「絕不依 Email 自動合併」/closed registration/Owner-only，必須另行評估 Auth provider/政策並做真實驗證，不能把此切片宣稱符合該補充全部要求。

綁定入口使用 SDK linkIdentity PKCE。10 分鐘 intent 以 256-bit 隨機 token 放 HttpOnly/Lax cookie，DB 只存 SHA256 雜湊、actor、provider、requestId/期限。回呼先以 getUser 驗證既有 actor 並讀取同 actor intent，再交換 code；交換後再驗相同 user ID 與 intended identity。DB completion 再檢查 auth.identities、同交易標記完成/append audit；重送只完成一次。不同 user、無 intent、過期、來源停用、重複 code 與外站 Origin 均拒絕。

Auth provider 實際建立 identity 與 app completion audit 不屬於同一交易。若 provider 已綁定後 app callback/DB 失敗，綁定可能已存在；UI 要求重新確認實際登入方式，不會嘗試刪除 identity 回滾。沒有自動合併兩個原本不同的 platform user 或搬移 workspace。

一般登入 redirect 僅允許設定的 Supabase origin；manual link 的 SDK 回傳可能是 Google/GitHub 外部授權頁，驗證精確 HTTPS host/path 及 callback。loopback fixture 例外僅 local/test，production 不接受。

References: [GitHub provider](https://supabase.com/docs/guides/auth/social-login/auth-github), [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [linkIdentity SDK](https://supabase.com/docs/reference/javascript/auth-linkidentity)。
