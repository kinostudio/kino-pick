## 2026-11-17 本機縮圖 HTTP 400 已解除

測試改用 Node Request 編碼 FormData，再將配對的 Content-Type 與原始 bytes 傳入 Miniflare。schema 0073 上 browser-processing-native.mjs 實跑 8 組通過，含私有縮圖與預覽、原圖 SHA、重播、授權拒絕與備援。正式 CI／部署與線上驗收仍待執行。下方暫停紀錄為修正前狀態。

# 瀏覽器縮圖：停止重試，交接 Claude

## 當前狀態

依使用者「堵塞三次以上提醒並交給 Claude」規則，已停止 native API 重試及正式遷移／部署。不是已完成的線上功能。

- 正式工作樹：`C:\Users\Aaron\Documents\Codex\KINO Pic\.local\album-tabs-release-20261109`
- 分支：`codex/lightbox-ux-20261116`，HEAD `ea6494adeea12f769a3607851ac5d3b3d63c7241`。本輪程式與先前 UI／Owner feedback 修改仍未提交；保留全部，不重設根工作樹、不初始化新專案。
- 遠端 main 最後核對為 `0f976b5e45f71b6efc650efd37075ee7f33456ad`；本輪沒有推送、PR、CI 或部署。
- B 正式 D1 `kino-pick-production-live` / `65d2286e-f2ac-4ad2-90e2-4b31e2f24251` 仍是 **0070**。沒有 live 0071/0072、沒有新 Time Travel bookmark。
- A、DNS、Review、正式客戶資料未修改；自刪 OFF／dry-run、R2 優先／Oracle 配額沿用。

## 精確阻塞與重現

在上述工作樹的 `apps/worker` 執行一次：

```powershell
node tests/browser-processing-native.mjs
```

最後一次已結束（exit 1，沒有仍執行的 exec session），停在 `browser-derivative-success`：`browser derivatives accepted` 預期 HTTP 200，實際 **HTTP 400 / `INVALID_INPUT`**。尚未辨明測試 payload 或 route 驗證哪一項不符，不能宣稱產品或測試已修好。當前 helper 已保留只輸出 stage／安全狀態碼／錯誤碼的診斷，不應輸出 Cookie、session、原始請求／SQL或影像資料。

檢查 `apps/worker/tests/browser-processing-native.mjs` 的 `derivativeForm`、`multipartRequest`、`validForm`，對照 `apps/worker/src/browser-processing-routes.ts`。新 API 必須維持：

- Origin、`X-Kino-Expected-Actor`、`X-Kino-Expected-Session` 及真 Owner session；不能移除驗證來使測試通過。
- multipart 僅三個欄位，各一份：`sourceSha256`、`thumbnail`、`preview`。
- source SHA 必須等於完成上傳的 immutable 原圖；照片／版本／儲存節點從完成見證推導，不能讓客戶端指定 key。
- 派生檔 MIME `image/jpeg`、非空；縮圖上限 512 KiB、預覽上限 4 MiB；兩種輸出邊長 320／2048，原圖上限 16 MiB。
- request 大小例外只限這條 POST 的 multipart；其他 JSON 維持 16 KiB。

修正後以同一 isolated native 驗證合法提交、Owner/session/Origin/來源 hash 拒絕、原圖 SHA 不變、兩份私人派生資產、重送冪等、瀏覽器失敗的 Cloudflare 備援。不要先跑整個 local-smoke。

先前 harness 問題已修：Node FormData 改以 Request 編碼 boundary／body，再交 Miniflare；`guestDownloadChecks` 的 fixture 參數應是 `worker`，不是 `mf`。實際 17 MiB 請求在 Miniflare transport 拋 `fetch failed`，該案例已移除；**不得稱 native 大 body 已過**。`tests/unit/browser-processing-body-limit.test.ts` 已在 Hono middleware 直接驗證宣告與實際超量都在 handler 前回 413。

## 已完成的接線與必要檢查

- `browser-image-processing.ts` 使用原生 ImageBitmap／Canvas，不需安裝工具；原檔 Blob 不修改。寬／直／方／透明白底／EXIF6 五組真 Chromium 檢查曾通過，來源 SHA 前後一致。
- `upload-client.ts`、一般／版本／resolved 上傳沿原完成與佇列接派生圖；原圖失敗不被派生圖掩蓋，派生圖失敗保留原圖與 durable 備援工作。
- `browser-first.ts` 的新 immutable profile 明確允許 Cloudflare fallback；伺服器仍用 Images `.info()` 驗證解碼。不能宣稱不依賴 Cloudflare 服務，僅正常路徑不用 CF 產縮圖。
- `browser-processing.ts` 處理部分輸出已寫入後的重試：依同 job／photo／version／scope 讀回 immutable slots、保留已驗 bytes；完整 pair 不重新轉換，不把未知儲存讀取錯誤當作不存在。
- 20 項核心專項 unit 通過，另請求大小 middleware 及既有 JPEG 隱私／adapter 測試通過；root/web strict、scoped lint/format 與 build 曾通過。新增 factory 後的最終完整 CI 尚未執行。
- 最後 `.build` 在最新 `privateJpeg` 原生 `indexOf` 掃描優化之前產生；該優化的既有 14 項測試通過。修 HTTP 400 後只做一次最終 build＋native，證據需綁該實際 bundle。
- 已收緊 ingress 記憶體預算，但沒有 hosted 記憶體／CPU 壓力驗收，不可宣稱已證明不會 OOM／1102。

設計及復原原則見 `docs/BROWSER_IMAGE_PROCESSING.md`。

## 不要重做已通過的遷移復原

0071 原有獨立復原與 0070 全部保留，不重跑。

0072 已完成本機 populated 演練及 **B 真獨立復原核對**：160 張舊表、8,330 列逐表雜湊與 schema 相符、FK0、integrity ok。證據：

- `docs/releases/owner-feedback-0071-independent-restore.json`
- `docs/releases/browser-first-0072-local-rehearsal.json`
- `docs/releases/browser-first-0072-independent-restore.json`

B 測試庫名稱仍為 `kino-pick-restore71-20261116`，ID `cb9b2030-dcbe-4bf0-aa7a-fbc08cbe7d60`，但**現已 schema72**；不要再當 schema71 或重新套遷移。

原受 ACL 保護、Git 忽略的目錄為本工作樹 `apps/worker/.local/owner-feedback-0071-20261116`，保存原70／71備份與 `restore72-after.sql`；不要提交或印出內容。0072 SHA256：`5ffeefb4f6b6a45f4573c4db3a35824ab03a9ca764e59cc6ace0a51714e88d3e`。

同目錄已準備 `live71.config.json`／`live72.config.json`，各只含本次單一 migration 路徑並精確指向 B live ID；**尚未使用**。`verify-live71-browser.mjs pre` 已核對新的 `live70-browser-preflight-20261117.json` 與舊復原證據相符；它只取 001..0071 作歷史71驗證，不以72取代71證據。

## 恢復發布的順序

1. 先解決單一 HTTP 400 阻塞並完成必要最小驗證，保留失敗證據。
2. 取得新 Time Travel bookmark，沿已驗證71套用並核對／記錄實際 adoption，再走72核對與 adoption；不要把測試庫成功或預先填值當正式證據。
3. `docs/releases/production-schema-adoptions.json` 目前只記到70。實際遷移前不可附上假71／72紀錄，也不可放寬發布守門。
4. 檢查 Git diff／機密，提交有意義的變更，一次 main CI 全綠後自動部署 **B**；不修改 A 的入口／DNS／其他部署。
5. 真 Owner 選瀏覽器優先，上傳合成照片；Guest 看縮圖／預覽、原圖下載 SHA 一致，確認 fallback 與私人存取；再回報網址／版本／實際證據。

未部署前，4180 仍是舊常駐後端，本輪未重啟以避免重設使用者的合成測試 URL。不要以本機新靜態 UI 宣稱後端已接通或正式成功。
