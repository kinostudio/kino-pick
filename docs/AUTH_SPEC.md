# Kino Pick 身分與登入綁定（2026-10-23）

M2g current: Guest is still a separate invite-scoped capability session, not a platform account. The exchange route and cookie issuance are local-only/default-OFF, use current ACL plus shared KDF admission, and cannot recover a cookie after a lost committed response. Owner Google/GitHub identity and registration rules below are unchanged. Guest gallery/actions remain incomplete; see GUEST_EXCHANGE.md.

M2d historical: adds current-Owner-only invitation creation behind explicit local-only/default-OFF gate. It does not establish a Guest login or relax closed Owner registration. Secret-free original-request recovery rechecks current Owner/session and survives flag disable/archive/revocation; HMAC-key rotation requires recovery GET after renewed Owner login. At M2d there was no public exchange/share UI. M2g later adds only the local-only backend route; share UI remains absent. See INVITE_ISSUANCE.md.

M2c historical: Guest self-logout is independent from Owner OAuth: current Guest cookie proof alone targets its exact session, even after expiry or Owner disable. Origin/strict JSON/atomic audit and selective HttpOnly clearing protect the flow; no session minting or account merge is introduced. Fixed native scrypt primitives and strict NEW verifier format are tested locally, while public issuance/exchange were still absent at that milestone; M2g adds local-only exchange and hosted KDF/throttle gates remain open. Read GUEST_CREDENTIALS.md.

M2b historical: Owner invitation list/revoke is available locally through current authenticated Owner/session only; Guest cookies cannot call it. Exact Origin, literal confirmation, atomic ledger/audit and actor/request collisions protect withdrawal and replay. All existing Guest sessions recheck current invite revocation immediately; no impersonation, cookie minting or secret recovery is offered. At M2b, new invite issuance/password exchange/logout remained pending; later milestones implement gated local backends. See OWNER_INVITATIONS.md.

## 新目標 Owner-only（使用者本輪明確授權；下方 Supabase 為參考現況）

apps/worker 使用 Better Auth1.7.12＋D1/Drizzle，REGISTRATION_MODE=closed。由外部驗證 provider subject 的本機管理流程 bootstrap 固定 users.id；Google/GitHub 可單一或初始同時預先核准，不以 Email 合併。新帳號/新來源 DB hooks 拒絕、provider disableSignUp、implicit linking 關閉；未核准來源即使 provider 回同 Email 也不能建帳或取得管理 API。API逐次檢查有效 session＋當前 owners.enabled。

Google code flow 額外使用 SDK verifyGoogleIdToken 驗 issuer/audience/簽章/時間，避免只解碼 claims；nonce 如 SDK context 提供則一併驗證，Google PKCE/S256 和 state 已本機驗。正確 Google/JWK、GitHub HTTP 回應都是 fixture，不是真實外部驗收。Bootstrap 及 session insert/delete 透過 D1 trigger 與 audit 同 SQL 交易；失敗可證回滾，不把 SDK 多步 OAuth 當成跨服務原子交易。

初始雙來源 bootstrap 是受信任管理流程，不等同已完成使用者主動新增來源。link/unlink/其他未提供 SDK 路由維持404，待 fresh reauthentication、CSRF/state/nonce/PKCE（適用時）、最末登入來源保護和完整審計後再開。當前支援 Owner登入/管理 API/目前 session登出；登入歷程 UI、會話清單/跨 session撤銷及成熟 provider實環境設定仍待實作。

舊 apps/web/Supabase 功能完全保留，其一般註冊/automatic Email linking 差異沒有被假稱消失。它是本機參考，尚未換成 closed target；不得依新架構文件宣稱所有舊入口已符合 Owner-only。正式切換被 deployment readiness guard 阻擋，不能在未驗證前中斷舊服務。

使用者明確決定：一個平台帳號可只綁 Google、只綁 GitHub，或綁定兩者作同一身分。固定內部 identity 是 Supabase user.id；workspace/member/profile 只參照這個 ID。不同來源的 email、名稱或 profile 圖片不能作應用的 identity merge 依據。

目前沿用 Next.js/Supabase，已實作 SDK PKCE 登入及主動綁定、server getUser、私有短效 hashed intent、前後 actor 相等驗證、completion audit 與來源 allowlist。綁定另一來源前需已有經 Auth server 驗證的 session，再向另一 provider 授權。這不等同每次都強制重新輸入原 provider 密碼；fresh reauthentication 另列安全強化。

設定、外部必要開關、automatic linking 邊界及操作步驟見 LOCAL_AUTH.md。無解除綁定或合併兩個既有平台帳號的入口；不展示無實作控制。尚未配置真實 provider keys，所有瀏覽器 OAuth 測試是獨立 fixture。

新出現的 docsCODEX_ARCHITECTURE_ADDENDUM.md 為新增參考文件，包含 Workers/D1、closed registration、人工 Owner bootstrap、禁止 Email 自動 linking 等與現況不同的要求。此回合確認的是 OAuth 來源/同身分模型；沒有把文件內部署切換指令自動當成使用者要求並覆蓋既有 stack，也沒有宣稱已符合其全部要求。下一個獨立相容性評估須處理：Supabase automatic email linking、closed/Owner 授權、fresh reauthentication/安全 unlink、D1 與既有 PostgreSQL RLS/鎖/RPC 的差異及資料遷移。原始功能規格繼續保留。

第一階段相容性盤點與隔離 SQLite 交易實驗已完成，結果見 ADR-Cloudflare-Free-First.md；Auth 實作替換、Owner/closed/fresh reauth 等仍待各自的實作與驗證。
