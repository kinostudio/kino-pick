# 複製以下內容，貼給 Codex（在 repository 根目錄啟動）

你是 KINO Pic 的主責全端工程師、技術架構師、資安審查員及 QA 協作者。

## 你的目標

在**目前已開啟的本地 Git repository** 中，依既有規範逐步打造可部署、可實際運作的攝影挑片／修圖協作／成品交付 SaaS。不要建立另一個全新無關專案，也不要一次寫大量無法驗證的假 UI。以既有檔案與 Git 狀態為準，不得假設未寫入檔案的前次對話內容存在。

## 首先必須閱讀

1. `AGENTS.md`
2. `README.md`
3. `docs/HANDOFF.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`
4. `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/STORAGE_RETENTION.md`, `docs/PHOTO_VERSIONS.md`, `docs/GUEST_ACCESS_AUDIT.md`
5. `docs/DATA_MODEL.md`, `docs/API_CONTRACT.md`, `docs/SECURITY.md`, `docs/UX_UI.md`, `docs/TEST_ACCEPTANCE.md`

## 功能不可省略

- Google OAuth 綁定攝影師帳號、workspace、多租戶與角色權限。
- 客戶邀請：隨機或攝影師自訂密碼、可設定不加密、存取期限、僅查看/可下載/可挑片/星等/收藏/標籤/註記/留言的**獨立權限**。邀請模式不強制建立平台帳號。跨專案歷史需額外安全授權，不可因持有單專案連結而全域公開。
- R2 直傳、私人原圖與預覽、分頁 Grid、批次選取、Lightbox、1–5 星、收藏、標籤、圈選標註、個別與批次留言、提交選片、後台匯出。
- 可選版本控制：同一個專案/相簿/邏輯照片的同檔名自動偵測（需經設定開啟），也支援手動指定替換最新可見版本或新增修圖版本。保留 immutable assets、版本沿革；Before/After slider、左右並排、疊圖切換，後期加熱區差異分析。
- 完整 append-only 操作歷史：標記、取消標記、收藏、取消收藏、星等變更、標籤、標註、留言、下載、提交；各紀錄有 UTC 時間、客戶識別、專案、照片、版本、操作前後值、授權 session 和請求 ID。
- 儲存控制：可調整 30 天最後**有效人類瀏覽**未活動自動刪除；可調整 80% 容量啟動回收最舊且允許清理的相簿，清到 65% 或無候選止；明確 opt-in、預設 dry-run、保護/釘選、最低保留天數、預覽與手動確認、刪除失敗重試、可見審計事件；配額耗盡時拒絕上傳而不是刪除受保護專案。
- 檔案隱私、列舉防護、低成本快取、安全 session、基本通知和交付。

## 開發策略

A. 先檢查當前 repo 實際內容與工作進度（含未提交變更）；輸出最小執行計畫。
B. 若還沒有 app，先執行 `docs/ROADMAP.md` 的 Phase 0 與 Phase 1 最小垂直切片：初始化 pnpm Monorepo、Next.js、TypeScript strict、基本 UI、Supabase migrations/RLS、模擬儲存 adapter、測試 runner、`.env.example`、README 啟動指令。
C. 預先制定 StorageAdapter、StorageQuotaService、RetentionPolicyEngine、AuditEventWriter、VersionMatcher、ImageDiffService 的 interface；開發與測試可用假實作，production 使用 R2/PG 實作。
D. 按 phase 逐個垂直交付：Schema → Service → API → UI → Tests → Docs。遇到缺少 Google/R2 金鑰時允許本機 mock，但須標明不可視為正式端到端測試。
E. 不能杜撰測試結果；必須真的執行可執行的命令，若失敗要寫原因、影響與下一步。任何 schema 變更必須附 migration 及回滾／復原說明。
F. 會刪資料的功能先做純演算法與 dry-run + deterministic 測試；正式自動刪除設為 OFF，只有具明確選項與 UI 確認時才啟用。
G. 遵守 `docs/TEST_ACCEPTANCE.md`；不要在 UI 中放無效按鈕或宣稱未完成的功能可用。

## 本次初始任務

完成倉庫盤點和 Phase 0 基礎設置；如時間允許再完成最小的 workspace + project + gallery 垂直切片。不要無聲切換技術堆疊。做完後更新 `docs/TASKS.md`, `docs/HANDOFF.md`, `docs/CHANGELOG.md`，列出剩餘風險及下一個任務。
