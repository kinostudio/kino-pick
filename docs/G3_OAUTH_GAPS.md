# G3 OAuth 實作與驗收缺口

2026-11-09只讀盤點，未切換目前G2優先序。正式Worker與Next/Supabase參考端必須分開驗收。

- `apps/worker/src/auth.ts` 只允許已核准provider subject對應enabled Owner，公開註冊關閉，`accountLinking.enabled=false`／`disableImplicitLinking=true`。這保留既有登入安全；目前沒有正式Worker的使用者手動link/unlink路由。
- Worker本機合成RSA/JWK、Google/GitHub profile回應與雙subject bootstrap證據存在於`apps/worker/tests/local-smoke.mjs`，不是兩個真provider的同身分驗收。
- `apps/web/app/auth/link/`及`tests/e2e/oauth.spec.ts`屬Next/Supabase參考流程，不能算正式Worker已接線。安全解除最後登入來源也尚無正式實作。
- 主代理本次無Cookie唯讀GET B `/api/oauth/providers`，HTTP200只回傳`github`。這只核對公開能力，不證明該版真實登入，也未讀取或判斷每一個secret的值／存在性。
- Google需由伺服器取得`GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`這一組設定；GitHub沿用既有`GITHUB_CLIENT_ID`／`GITHUB_CLIENT_SECRET`與`BETTER_AUTH_SECRET`。不將值放在前端、Git或交接檔。Provider callback須對應實際`APP_URL`及`/api/auth/callback/{provider}`；目前production origin仍待G4設定。

## 實作與驗收要求

正式Owner介面須明確新增另一個來源，綁定前後維持同一內部user／workspace；須有fresh reauthentication、OAuth state／nonce／callback scope及當前Owner/session守門。不可單純打開自動Email合併，不得因相同Email或客戶傳入userId轉移workspace。解除時不可移除最後一個可用登入來源。此段為後續實作要求，不是完成聲明。

依TEST_ACCEPTANCE A01及「同身分OAuth綁定驗收補充」，需真Google、真GitHub、兩來源各自重登後同一Owner/workspace、錯帳號拒絕、最後來源保護。G1已驗GitHub登入保留，不以新的合成測試覆蓋其證據或宣稱production通過。

可重用的focused測試（本次未重跑）：`pnpm exec vitest run tests/unit/oauth-provider-capabilities.test.ts tests/unit/oauth-providers.test.ts tests/unit/identity.test.ts tests/integration/oauth-providers.test.ts`；參考端`pnpm exec playwright test tests/e2e/oauth.spec.ts --project=chromium`仍只能標為reference fixture。現有Worker OAuth沒有單獨runner，不為本次盤點重跑整套smoke。
