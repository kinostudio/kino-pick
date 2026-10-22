# Architectural / Product Decisions

## 已確定（2026-10-23）

- D-001 Web：Next.js + TS strict + Tailwind/shadcn；可調整但須 ADR。
- D-002 Auth：攝影師用 Google OAuth；客戶有免註冊邀請模式，可選無密碼/系統產生密碼/自訂密碼。
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
