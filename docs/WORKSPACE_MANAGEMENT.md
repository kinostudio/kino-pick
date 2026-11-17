# 工作空間更名／移除（0073，本機候選）

正式前端卡片提供更名與刪除小圖示。建立工作空間只保留一個入口，以對話框填寫名稱；專案頁不再放重複的大型管理區塊，原專案卡片操作保留。

PATCH／DELETE `/api/v1/workspaces/:workspaceId` 要求有效 Owner session、相同 Origin、預期 actor/session、requestId 與 expectedName。資料庫原子核對擁有權及名稱，重試回原結果；跨操作重用 requestId 拒絕。輸入上限 8KiB。

刪除只接受已清空的工作空間：未移除專案、使用量／預留、有效上傳授權與未完成處理會阻擋。專案保留 archived 歷史列時，必須另有相同 scope 的 `project.deleted` 審計。刪除寫入 tombstone（移除標記），保留歷史資料，不刪照片、不連帶清空專案。新列舉與內容存取排除已移除工作空間，資料庫拒絕在其中新增／更新專案。

既有 100 筆歷史工作空間上限未改，已移除的紀錄仍占額度。

## 遷移與復原

0073 為 additive migration：新增 `deleted_at_ms`、命令紀錄及守門。已於隔離本機 D1 套用及驗證；尚未執行 B 的 0073 備份／獨立復原、live 遷移、adoption 或發布鏈更新。不得直接部署依賴此欄位的新程式到 schema70。

遷移後不要 DROP 欄位或歷史表，也不要手動清除 tombstone。若尚未發生工作空間操作，可在確認相容後回退應用版本，保留 additive schema；若已有刪除操作，舊程式不理解 tombstone，禁止直接回退，須 forward 修正或在隔離庫復原適用備份、核對資料後重新發布。正式變更前依既有備份／獨立復原與 CI 守門執行。

## 本次必要驗證

- Root／Web TypeScript、指定 ESLint／Prettier、前端建置與 Worker dry-run 通過。
- `pnpm exec vitest run tests/unit/workspace-management-native.test.ts`：1 項原生 D1 整合通過，涵蓋 session／Owner／租戶拒絕、名稱競態、重播、非空拒絕、移除後讀寫拒絕。
- 獨立 Chromium + 4181 合成資料 API：建立→更名→刪除空工作空間、非空拒絕、單一建立入口、移除專案大區塊、375px 對話框與無橫向溢出通過。
- 活動紀錄詳情顯示對象及可讀的前後變更，原始編號／JSON 收在「技術資料」；缺少名稱時不虛構。

沒有雲端變更、CI、推送或部署；瀏覽器縮圖 HTTP400 發布阻塞仍依原交接文件暫停。
