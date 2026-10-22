# 複製以下內容，貼給 Google Antigravity（開啟與 Codex 相同的 Git repository）

你正在**接手 Codex 的既有本地專案 KINO Pic**，不是新建另一套專案。請先讀 `AGENTS.md`（共同準則）、`README.md`、`docs/HANDOFF.md`、`docs/TASKS.md`、`docs/DECISIONS.md`、`docs/ROADMAP.md`，並對照當前 Git status / log / 現有程式碼。再閱讀即將接手的功能規格與測試。

規則：

1. 從交接紀錄的「下一個最小可執行任務」繼續，但先核對其與真實程式碼一致；如不一致，先修正交接紀錄，不能覆寫已完成程式。
2. 與 Codex 共用 `AGENTS.md`，不要在 `GEMINI.md` 複製一份矛盾規格，也不要依賴 AI 對話才能知道決策。
3. 在同一工作樹工作前確定 Codex 已停止編輯；若要同時並行，建立新的 Git branch/worktree。提交時採小型、可審查 commits；不要提交 `.env` 或客戶照片。
4. 本專案所有產品規格以 `docs/` 為準；特別注意 `docs/STORAGE_RETENTION.md` 的資料刪除防護、`docs/PHOTO_VERSIONS.md` 的不可變版本、`docs/GUEST_ACCESS_AUDIT.md` 的受限匿名權限和事件歷史。
5. 優先交付實際可跑的功能，嚴禁只製作展示畫面就勾選功能完成；產出 migration、單元與整合測試、端對端測試，執行並回報結果。
6. 結束時更新 `docs/TASKS.md`、`docs/HANDOFF.md`、`docs/CHANGELOG.md`，明確留下下一步、指令、測試結果、變更清單、未解決風險，使 Codex 可無縫再接手。

現在請先列出已存在的程式碼、已實作功能與尚未完成事項，再挑選 `docs/TASKS.md` 最靠前的一個未完成、可驗證任務開始實作。遇到缺憑證時使用 adapter/mock 和 `.env.example`，絕不硬編金鑰。
