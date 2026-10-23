# Architectural / Product Decisions

## 已確定（2026-10-23）

- D-001 Web：Next.js + TS strict + Tailwind/shadcn；可調整但須 ADR。
- D-002 Auth：攝影師用 Google / GitHub OAuth（依 2026-10-23 使用者明確確認，可只綁一個或兩來源共用同一身分）；客戶有免註冊邀請模式，可選無密碼/系統產生密碼/自訂密碼。
- D-003 Storage：Cloudflare R2，originals/derivatives 私有分開；Postgres 管 metadata。
- D-004 Photo versions：可開關的 manual / auto_filename / assisted；新版本 immutability；Before/After 對照。
- D-005 Client history：append-only 含取消選取等反向行為與 UTC 時間。
- D-006 Retention：30 天未有效瀏覽、>80% 壓力最舊相簿回收、owner 可調整；預設 OFF+dry-run，保護重要相簿。
- D-007 Agent portability：AGENTS.md 單一權威，Git + HANDOFF + TASKS；不依賴對話或本地絕對路徑。

## 初始預設，可由 UI 改（不是規格未定）

- Storage soft quota 8,000,000,000 bytes，警告 70%，清理 80%，清到 65%，阻止上傳 95%。
- Inactivity 30 天、未曾有有效瀏覽的相簿基準從發佈時間/建立時間起算；bot/preload 不算；真實 owner & guest 看圖算。
- 版本模式預設 manual/assisted，避免同名誤覆寫。所有自動清理第一次需 owner 預覽 + opt-in。
- Invite 預設系統產生密碼，可選不加密或手動設定。
- 關於歷史：guest 只有自己的當前專案範圍；跨專案須經其他 grant/OTP。

## 等待商業決策（不阻礙開始開發）

- 收費方案、多租戶配額是否依訂閱自動分級（Phase 3+）。
- 30天刪除是否提供 24/72 小時通知與 grace（預設 grace=0，正式開啟時 UI 提醒不可逆）。
- 保留活動歷程/下載 log 的法律保存期限與個資刪除流程（初始預設活動事件 purge 後 365天，可調整）。
- 使用者是否需要繁體中文/英文切換、品牌白標、專屬網域。

任何設計決策變更新增 ADR，且同步修改 PRD/TEST/AGENTS（如屬全局規則）。

## 2026-10-23 Phase 0 實作決策

- 正式產品名 KINO Pic；原始附件保留，活躍文件全數更名。
- 見 `docs/adr/0002-phase0-local-boundary.md`：本機界線、工具相容性、RLS 測試範圍、Phase 1 未完成項目。

## M1-01 決策

- Server-only Supabase SSR、getUser 驗證、Google identity、HttpOnly cookie；不建立 production mock/bypass。
- 使用 publishable/legacy anon key + 使用者 session/RLS/RPC，應用不需 service-role。
- 工作空間/成員變更透過有鎖、idempotency 與 audit 的 DB RPC；私有重送 ledger 不公開。
- Auth HTTP/PGlite fixture 只放測試，真實 Google/Supabase 驗收留待設定。詳 LOCAL_AUTH.md。

## M1-02 資料一致性決策（2026-10-23）

- 先交付建立/讀取/改名，不暴露刪除、發佈或自動清理控制。狀態轉換/封存及完整 CRUD 驗收另列未完成。
- 改名使用 expectedRevision 樂觀鎖；相同名稱的新請求亦增加 revision 並保留事件。相同 requestId/payload 重送回原結果，不重寫目前狀態；不同內容回 409。
- request advisory → workspace → resource 固定鎖順序；workspace 鎖與成員變更互斥，取得鎖後才檢查現行角色，授權先於重送 ledger，防止撤權後取回舊結果。
- owner/editor/photographer 可管理內容，retoucher 僅讀。缺少/跨租戶/已撤權資源統一 NOT_FOUND，避免枚舉；現有可讀但唯讀角色修改回 FORBIDDEN_SCOPE。
- tenant/parent IDs 以 DB trigger 固定；只允許名稱修改，不接受客戶端改 workspace/project/保護/狀態。
- 審計新增 BEFORE TRUNCATE 防誤清；不宣稱可防止管理員刻意拆除保護。首次 provisioning 鎖改為 NO KEY UPDATE，保留序列化並相容 FK KEY SHARE。

## D-008 — Google / GitHub 可單一或雙來源同身分

2026-10-23 使用者明確確認，可只綁定一個或同時綁定兩者作為同一身分，取代 Google-only 產品限制。使用成熟 Supabase SDK，不自行實作 OAuth 協定，不以 Email/顯示名稱在應用合併帳號。Provider link 回呼前後 user.id 必須一致，workspace 權限不因新增來源而擴張。預設 manual link 關閉，須 app/Supabase 兩邊設定。外部 Auth 與 app 審計無跨服務 transaction，callback 失敗不嘗試刪除已綁身份。Supabase automatic linking 與新增補充文件的 closed/Owner-only/嚴格不依 Email linking 要求為待評估差異，詳 AUTH_SPEC/LOCAL_AUTH。

## D-009 — Hosting adaptation precedes any Auth/DB cutover

2026-10-23 compatibility assessment: retain the existing stack as reference. First evaluate a pinned vinext hosting PoC in an isolated worktree; do not equate static compatibility with runtime proof. D1/Auth replacement has separate identity/role/transaction and data migration gates. PostgreSQL RLS/locks/RPC cannot be mechanically replaced by a successful SQLite UPDATE/batch: zero affected rows need explicit conflict semantics before audit/idempotency. The isolated SQLite model is test-only, not a production authorization substitute. Details and official sources: ADR-Cloudflare-Free-First.md. No requirement for photography/guest/version/retention was removed.

## D-010 — Album protection precedes state/deletion execution

2026-10-23: first deliver owner-only album isPinned/legalHold controls, keeping draft/active/archived state unchanged. Editors/photographers/retouchers can read flags but cannot change them. Clearing either existing flag requires an explicit confirmUnprotect boolean plus UI acknowledgement, revision CAS and append audit. Non-owners cannot replay old owner success after ownership loss. Deleting/deleted albums reject new changes. This does not enable retention, delete assets, reset activity clocks, grant guests, or implement the full project review state machine. State/protection/deletion must eventually share workspace/resource lock order; preservation of these flags is a required eligibility gate, not a standalone cleanup implementation.

## D-011 — Archive is reversible metadata, initially empty and idle only

Owner-only archive/restore, with UI acknowledgement and API revision/requestId, is separate from deletion and the full review state machine. Project draft/delivered and album draft are the initial origins; store original state in DB rather than assume draft on restore. Block nonempty photos/busy children, parent archive blocks child transitions, do not cascade child state changes. Archived content is readable, names/new child writes frozen, owner protection stays editable. Preserve human-view clocks. Legacy archived data without recorded origin fails closed. Future upload/review/delivery/retention tables must be integrated into shared locks/idle checks before expanding support. No generic status editing, guest/download grant behavior, automatic cleanup or physical deletion is implied.

## D-012 — Explicit Cloudflare/Owner target adopted, staged compatibility preserved

User now explicitly authorizes the architecture addendum: Workers/Static Assets/Hono, D1/Drizzle, Better Auth Google/GitHub closed Owner, R2 single-node default and Cron, GitHub CI/CD. Supersedes the earlier non-adoption interpretation; does not authorize deletion of existing behavior/data or production cutover without acceptance. Original document preserved at supplied filename; canonical reviewed copy at CODEX_ARCHITECTURE_ADDENDUM.md. New D1 node default9GB is internal only; old PG8GB unchanged. No free-tier/terms guarantee, cross-account enablement or automatic deletion.

First foundation is actually local executable, while old Next/PG functions stay intact. Auto-review rejected directly disabling old production Supabase login as a possible outage; no old Auth modification was applied. Safer integration preserves the reference and uses a new deployment guard that rejects release until a reviewed cutover. No work is blocked on external keys for local implementation; actual cloud/provider/data/security gates remain pending.

## ADR — CF-02a D1 workspace command transaction

Use a single INSERT with SQL guard/apply triggers for this first D1 business operation. D1 batch rollback on SQL failure alone does not make a zero-row mutation an authorization error; the trigger must abort invalid current Owner/session before historical replay, and audit failure must abort state plus request ledger. Result snapshots preserve original response across retries. Keep reference Next/Supabase UI and business endpoints operational while target repositories mature. CF-02a is backend-only; project/album/CAS/protection/archive and shared operation request namespace plus existing React UI adapter remain next before claiming CF-02 complete.
