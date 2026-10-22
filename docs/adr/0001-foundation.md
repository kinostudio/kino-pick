# ADR-0001: 單一 Git Repo + 同構文件 + 私有 R2

Status: Accepted, 2026-10-23

## Context

要由本地 Codex 與 Google Antigravity 交替修改同一套攝影平台，同時具備私有 R2 儲存、可追溯挑片與自動刪除防護。

## Decision

使用 pnpm monorepo；`AGENTS.md` 作為跨代理主規則；`GEMINI.md` 僅導引；`docs/HANDOFF.md` 記錄可重現狀態。以 PostgreSQL 保持 workspace、event、version、storage ledger 一致；照片在私有 R2，Workers/Queues/Cron 處理圖片及清理。

## Consequences

優點：低代理鎖定、可 Git review、權限清晰，後續分工容易。代價：需要嚴格維護 migrations、storage ledger 對帳、事件歷史及刪除 job；必須做真實負面授權測試。
