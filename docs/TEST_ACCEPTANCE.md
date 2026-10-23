# 測試策略與驗收案例

必須包含 Unit (Vitest)、Integration（真測試 Postgres/RLS、R2 adapter mock）、E2E（Playwright）。CI `lint`、`typecheck`、`unit`、`integration`、`build` 至少全通過後才能標註可交付；沒有雲端憑證時 E2E 可跑 mock 測試，但須註明 real R2/OAuth 尚未測試。

## 系統／驗收清單

| ID    | 情境                              | 必須通過的斷言                                                                 |
| ----- | --------------------------------- | ------------------------------------------------------------------------------ |
| A01   | Google/GitHub 首次/既有登入及綁定 | 同 provider subject 回同 user；雙來源綁定後 ID 不變、跨 workspace 權限不能混淆 |
| A02   | Guest 無密碼訪問                  | 只可讀取 invite 指定 project/albums、權限最小                                  |
| A03   | 系統產生/自設密碼                 | 正確通過、錯誤節流、撤銷/到期即拒絕                                            |
| A04   | Guest view-only                   | can_select/can_download=false 時 API 403；不是只有隱藏 UI                      |
| A05   | Guest client portal               | A 專案連結不能列出 B；OTP/portal grant 才可看授權 B                            |
| A06   | Photo grid 1000+                  | 分頁讀取、Lazy Loading、RWD、按原比例、無全量 DOM                              |
| A07   | 多選/取消、跨頁                   | DB 狀態一致；重整、再登入後保持                                                |
| A08   | 選片額度 30                       | 第31張 server 拒絕；兩裝置同時選取也不可超額                                   |
| A09   | 星等收藏標籤註記                  | 權限、資料保存與按照片查詢正常                                                 |
| A10   | 活動歷程                          | 選→取消→收藏→評分→再選 = 5 筆有 UTC 的事件；前後值正確                         |
| A11   | request 重送                      | 同 idempotency key 只寫一筆事件和一次狀態變更                                  |
| A12   | 提交與重開                        | 提交生成不可覆寫快照；需有權限才可重開，原事件保留                             |
| V01   | 同名同相簿/新內容                 | `auto_filename` 啟用時生成 V2，R2 V1 byte 原封不動                             |
| V02   | 同名不同專案                      | 建立新 photo，不跨專案自動綁版本                                               |
| V03   | 同雜湊相同圖片                    | 重複提示，不默默佔版本和配額                                                   |
| V04   | 模糊／同名多筆                    | 強制人工確認，不能任意代替                                                     |
| V05   | 手動上傳新版                      | 選片/評分/收藏不消失；註記維持原 version_id                                    |
| V06   | 設定 current version              | 切換舊版不覆寫 assets，歷程完整                                                |
| V07   | Before/After                      | slider/side-by-side/overlay 在不同尺寸正確顯示；差異不可靠時警告               |
| S01   | 配額 79.9%                        | 不能啟動 80% 容量清理                                                          |
| S02   | 配額達 80%                        | 按最舊可清相簿排序，清至 65% 或無候選為止                                      |
| S03   | 受保護舊相簿                      | legal hold/pinned/active review/processing 全被排除                            |
| S04   | 30天未瀏覽                        | 29天不刪、30天符合且無保護才可入列                                             |
| S05   | 有效瀏覽                          | owner/guest 真實看圖 reset（依政策）；CDN/機器人不 reset                       |
| S06   | 刪除競態                          | 刪除前重新檢查 last_view/pinned，最近有人看就取消                              |
| S07   | dry-run                           | 沒有任何 R2 delete；列出候選理由與預估 bytes                                   |
| S08   | 刪除失敗重試                      | 部分物件失敗可恢復、已刪不重複扣帳、工作狀態可查                               |
| S09   | 無清理候選                        | 不刪合法保護相簿；超過 block ratio 要阻擋新上傳並通知                          |
| S10   | quota ledger/metrics              | 含所有 buckets & 版本/預覽/預留；metrics stale 不誤刪                          |
| SEC01 | IDOR                              | guest A / workspace A 永不能查 B 的任何 photo/version/diff/history             |
| SEC02 | R2 private / signed access        | 非授權不能下載原圖或猜測物件路徑                                               |
| SEC03 | Secret scanning                   | 沒有將真 key、guest session / invitation token 寫入前端 bundles/Git            |
| DEL01 | 精修交付                          | 版本批准、精修交付檔按權限下載，產生 download event                            |
| OPS01 | Agent 交接                        | 新代理不依賴舊聊天，靠 docs 能執行既有測試並指出下一任務                       |

## 刪除邏輯必須使用的 deterministic 測試時間點

- `now = 2026-10-23T12:00:00Z`；`last_valid_viewed_at = 2026-09-23T12:00:00Z` 正好 30 天，必為候選（如 policies enabled / eligible）。
- `last_valid_viewed_at = 2026-09-24T12:00:00Z` 29 天，不可刪。
- 同時有相簿 A 50 天前建立 pinned，B 45 天前 unpinned，C 20 天前 unpinned，80% 壓力下先選 B，再選 C（如 minimum age 達標）；絕不能選 A。
- 兩位客戶針對 30 張上限相簿在第 29 張同時提交新增一張，結果 count 不可變成 31。

## 容量壓力模擬

建立假的 storage ledger `quota=10_000`, `current=8_100`, eligible albums: oldest A=500, B=600, C=800；target=6_500，應按序清 A+B+C，最終 current=6_200（略低 target 是以相簿為單位）。如果 A pinned，只清 B+C，current=6_700；不可為了達 6500 而刪 A（應於下次測試進一步有其他候選或保留 6700）。

## 品質要求

- DB migration 有回滾/備份策略。
- 每次 feature 增加對應 API/schema 測試及一條 E2E happy path。
- UI 所有按鈕皆有可用後端，未完成 P2 功能標示 unavailable 而非假互動。
- Release 需要至少 1 次 staging 端對端測試：實際 Google OAuth + 實際私有 R2 上傳/刪除 + 完整客戶流程；必須用假圖與測試 bucket。

## 本機已驗證的開發子集合（2026-10-23）

M1-01/M1-02 本機安全/內容管理回歸已通過，命令及數量見 VERIFICATION.md。包括當前權限先於重送、audit failure 原子回滾、父項不可變、revision 防覆寫、UI 提交成功但回應丟失的重試。這些證據不等同 A01 真實 Google 驗收、A06 照片 Grid 或整個 M1 完成；真實雲端/多連線 PG、全部尚未實作 A/S/V 案例均保留。

## 同身分 OAuth 綁定驗收補充

本機正/負面測試通過，詳 VERIFICATION。真實 Google/GitHub 與 Supabase manual linking callback 必須各測一次，同一 user 可只綁一個或兩者、改用另一來源登入仍保留工作空間、不同平台 user 不能因 app 參數合併/轉移 workspace。另須驗證 hosted automatic-email-linking 行為是否符合選定政策，不能以 fixture 代替。Closed/Owner bootstrap、fresh reauthentication 和安全 unlink 尚未完成，不能因雙登入切片通過而勾選新架構補充的完整驗收。

## Album protection regression gate

Owner flags persist after reload; non-owner API mutation denied even when an old page is open; owner change/current authorization checked before historical replay. Clearing either flag requires explicit confirmation in API and UI. Rename/protection CAS conflicts retain draft and require reload/review, with flags unchanged on stale writes. Lost response retry uses same request/body and writes one event/revision. Audit insertion failure rolls flags/revision/ledger back. Deleting/deleted reject new changes, archived allows protection. Direct authenticated table writes and anonymous/unsupported identities denied. SQL/PGlite tests do not establish multi-connection PG/real Supabase concurrency or a working retention executor.

## Empty archive/restore regression gate

Project draft/delivered and album draft archive preserve origin and restore exactly; legacy missing origin rejects. Nonempty photos, busy child/parent and deleting/deleted cases reject without audit/state mutation. Parent archive freezes names/new children; child restoration requires restored parent; child state/protection/times do not cascade/reset. Owner protection still works while archived. Current owner before replay; unsupported/anon/direct write denied. Shared CAS with rename/protection, historical retry does not restore old state, audit failure rolls state/origin/revision/ledger back. Browser verifies confirmation, reload/reconfirm, lost response identical request retry, parent/child UI freeze, roles/revocation and no mobile overflow. Serial PGlite is not hosted PG contention or a live upload/review/job test.

## Cloudflare migration acceptance additions

Run pnpm test:cloudflare against actual local workerd/D1/R2, with provider responses replaced only in the test harness. Must prove explicit one-time bootstrap and audit-failure rollback; Google/GitHub subject → same internal UUID; unapproved same-email subjects cannot register/link; Google invalid signature rejected; PKCE/state/origin/callback/body limits; current Owner disable/forged/revoked cookies fail closed; R2 conditional immutability/cross-scope/no-delete; node credential fields absent. Existing Next34unit/49integration/14browser remain reference evidence, not D1 business-flow proof. Real-provider/key/HTTPS/live quota/remote restore/CI gates stay not_checked.

## CF-02b local target evidence boundary (2026-10-23)

`pnpm test:cloudflare` now runs25 actual workerd/D1/R2 local check groups, including D1 migration upgrade, workspace/project/album command atomicity, tenant/CAS/audit/protection/archive and metadata parent guards. The isolated test OAuth uses synthetic provider HTTP endpoints; it is not live OAuth acceptance. Existing14 Playwright tests still target the Next/Supabase reference and do not prove Worker UI. CF-02 stays incomplete until existing user UI uses the target API and browser acceptance runs against its D1-backed session. Original M1–M5 and release E2E criteria are unchanged.
