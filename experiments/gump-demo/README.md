# 歷史設計參考（已停止作為產品前端）

產品介面統一使用 `apps/web/target-ui`，由 Cloudflare Worker 提供真實 API。此目錄只保留原型畫面與歷史互動供比對，不再作為交付／驗收入口，請勿新增功能或把記憶體狀態當作產品資料。

正式本機開發：專案根目錄執行 `pnpm.cmd dev:cloudflare`。隔離 UI 確認工具與真實本機 Worker 驗收工具詳見 `docs/HANDOFF.md`；它們都載入同一份 target-ui build，並不是另一套產品介面。

以下保留歷史說明：

# Kino Pick 相簿互動展示

獨立本機 UI prototype。相簿、照片、選片與分享設定均為合成展示資料，只暫存在目前分頁的記憶體；重新整理會清除。頁面未連接 Kino Pick API，不會建立或提供正式分享連結。

## 啟動

在專案根目錄執行：

    pnpm.cmd exec vite --config experiments/gump-demo/vite.config.js

開啟 http://127.0.0.1:4174。
