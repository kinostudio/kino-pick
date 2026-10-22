# Shared Agent Rules — KINO Pic

> 本檔是 **Codex 與 Google Antigravity 共用的最高層專案指引**。不得由不同 AI 各維護一份相互矛盾的規格。

## 執行次序

1. 每次工作開始：閱讀 `README.md`、`docs/HANDOFF.md`、`docs/TASKS.md`、`docs/DECISIONS.md`，再閱讀本次功能對應的 docs。
2. 先檢查目前檔案、Git 狀態與未提交變更；尊重其他代理已完成的程式，不重建、不覆蓋。
3. 按 `docs/ROADMAP.md` 垂直切片實作：DB migration → API → UI → 測試 → 文件更新。每次以一個可驗證範圍為限。
4. 變更公共合約、資料表、權限、儲存政策前須先讀 `docs/STORAGE_RETENTION.md`，並同步修改 docs 和測試。不能以程式碼與規格長期不一致的狀態宣告完成。
5. 工作結束：執行可用的 lint/typecheck/test/build；更新 `docs/TASKS.md`、`docs/HANDOFF.md`，註明通過/失敗/未執行原因。不得虛構成功的測試。

## 安全與資料底線

- TypeScript strict；禁止 `any` 逃避型別。所有外部輸入以 Zod 驗證。資料庫必須開啟 RLS 或在可信伺服端實施等效租戶授權，兩者以測試證明。
- R2 Bucket 永遠保持私有。禁止將原圖公開網址、R2 主密鑰、Supabase service role key 送至瀏覽器。
- 影像上傳採臨時授權，驗證 object key、MIME magic bytes、大小、租戶配額、上傳狀態與 ownership；完成回報不得盲目信任客戶端。
- 任何照片被刪除、替換或提交挑片時要有 transaction/狀態鎖與可重試機制。所有會破壞資料的任務必須支援 dry-run。
- 客戶的每次挑選、取消、星等、收藏、標籤、標註、留言、版本核准等事件以 append-only log 紀錄；不能僅保留最後狀態。
- 無密碼分享連結是 bearer credential；不可讓擁有單一相簿連結的訪客自動看見其他專案。
- 用具唯一 object key 的新版本／衍生圖，絕不在 R2 原地覆寫舊版。版本切換須可追溯。
- 自動刪除必須 opt-in、先 dry-run、提供預估釋放量與刪除原因；依法須保留的內容不受自動清理影響。
- 不向 Git 提交 `.env`、API key、Cookie、下載連結、客戶影像。使用 `.env.example` 與專案密鑰管理。

## 技術基線

- Web：Next.js App Router、React、TypeScript、Tailwind、shadcn/ui、TanStack Query、Zod。
- Auth/DB：Supabase Auth（Google OAuth）+ PostgreSQL；自訂客戶匿名邀請 Session。
- Storage：Cloudflare R2（private）；workers for image delivery and image processing；Queues / Cron for background tasks。
- Monorepo：pnpm workspaces；有需要時以 Turborepo 輔助，但不要為了工具化過度複雜。
- 測試：Vitest / Testing Library / Playwright；權限、事件 log 與自動刪除優先測試。
- Coding：採清晰分層和單一職責，資料存取只能走 repository/service；避免 UI 直接接觸高權限金鑰。

## 跨代理共用

- 所有事實以 Git 檔案為準，不依賴單一 AI 的對話上下文。
- Antigravity 應讀本 `AGENTS.md`；`GEMINI.md` 僅做導引。勿把 `.agents/workflows/` 當成唯一工作流程（舊 workflows 在部分新版已有遷移變動）。
- 永遠以相對路徑寫文件，不綁 Windows `C:\` 或特定電腦路徑；命令另說明 Windows PowerShell / macOS Linux 差異。
- 若有兩個 AI 同時工作，採獨立 Git worktree/branch；不得在同一工作樹同時修改同一檔案。
- 決策需記 `docs/DECISIONS.md`，交接需記 `docs/HANDOFF.md`，改動需記 `docs/CHANGELOG.md`。

## 交付格式（每次工作完成後）

- 完成哪些功能、修改檔案、migration 影響、執行指令與結果、已知問題、下一個最小任務。
- 完成標準以 `docs/TEST_ACCEPTANCE.md` 為準，不得用 UI mock 代替 API / DB 真實功能。
