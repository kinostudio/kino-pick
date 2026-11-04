# Kino Pick：受限線上協作驗收（2026-11-01）

本輪已將原型的正式前端接線部署到 Cloudflare B。這是固定合成相簿的實際線上驗收，**不是完整 MVP 開放**。

- 網址：https://kino-pic-staging.kino-pick-aaron2026.workers.dev
- 程式來源：10b0b7b82a89a2e0fc041d401ac7b53c898475ab
- 完整 CI：https://github.com/kinostudio/kino-pick/actions/runs/41236744712 （success）
- Actions 部署：https://github.com/kinostudio/kino-pick/actions/runs/41238436526 （success）
- Worker version：526e3f16-f4dd-4567-9551-7ac7b05b8bd9
- Deployment：066270a3-e12c-44f7-b2d6-c0445276cac4
- D1：59 migrations、foreign-key violations 0；本次程式修正未重套 migration 或 restore。

## 真正執行並通過

| 項目               | 實際證據                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真實 Owner         | 沿用 Edge 的真實 GitHub OAuth session；session ID 保持原大小寫，不假設 UUID。                                                                            |
| 原型正式介面       | 工作台導覽、專案／相簿、單張照片與比較皆使用正式 Worker 前端及私人資料。                                                                                 |
| 攝影師推薦         | 私人 R2 XMP 三星／紅色；四星以上「或」紅色可推薦；五星修改、清除、還原生效，客戶四星／收藏／挑片保持獨立。                                               |
| 雙端手繪與留言     | Guest 筆畫及留言保存後重載仍在；Owner 可讀取並建立自己的筆畫；Guest 可看 Owner 筆畫但沒有 Owner 編輯權。左右方向鍵不換照片，Owner 不再把筆畫誤標為刪除。 |
| 私人版本直傳與縮圖 | V3 真正直傳 21,527 bytes；Cloudflare Images 處理成功，私人預覽 13,885 bytes、縮圖 4,266 bytes。沒有直接改資料庫為 ready。                                |
| 自動讀檔案資訊     | V3 未手動匯入，即顯示三星／紅色。                                                                                                                        |
| 明確切換目前版本   | V3 切換後 current-head revision 1；V1、V2 保留。                                                                                                         |
| Before／After      | Owner 與 Guest 可比較已就緒的 V1／V3；鍵盤、閒置提示與實際把手拖曳運作。Owner 拖曳由 60% 改為 20%，Guest 鍵盤至 40%。                                    |
| 版本隔離           | V1 的留言與筆畫不會出現在目前 V3。                                                                                                                       |
| 操作歷史           | Owner 看見 UTC 真實事件；Guest 歷史頁恢復，只見自己的評分、收藏、選取、留言、筆畫及下載事件。                                                            |
| 提交與後台審查     | Guest 一張挑片送出凍結；Owner 讀到封存明細。客戶原選的 V1 保留，沒有因目前版本改為 V3 而被覆寫。                                                         |
| 下載／匯出         | Guest 預覽下載產生 requested/generated 審計對，38,286 bytes；Owner CSV 匯出 UI 請求已執行，未顯示錯誤。瀏覽器檔案落地位置尚未確認。                      |

正式 API／R2 原圖／推薦及處理接線的本機原生檢查 13 組、B 邊界 24 組及發佈 checker 通過；來源的完整 CI 亦通過。這些本機 provider fake 測試與上述真正 hosted Cloudflare 操作分開記錄，不相互代稱。

## 保持的安全邊界

Cloudflare B account d3e930465c0df7e89b35de3ca65ea36a；單一私人 R2、r2.dev 關閉、公開 Worker 入口開啟、preview URL 關閉。自動刪除 OFF、retention dry-run、無 Cron。A／FILM.KINOSTUDIO、DNS 與客戶資料未改動。程式快照掃描 798 檔，已知憑證命中 0；原 HEAD／index 與其他未提交變更保留。

先前一個合成測試邀請連結曾意外輸出，已撤銷並讀回撤銷狀態；該邀請未建立 Guest session。新驗收連結僅存在記憶體，分享結果隱藏後才讀畫面；本文件／JSON 不含 bearer、cookie 或金鑰。

## 還不是完整 MVP 的原因與下一個任務

1. 目前只開固定合成 workspace／project／album。下一個垂直切片：沿用既有服務，讓真實 Owner 在既有 workspace 建立新的 project＋album，透過明確授權範圍完成上傳、啟用、邀請與 Guest 讀取；保留 foreign 資源拒絕，不直接移除隔離守門。若需要 schema60，先做獨立備份復原與相容性驗收。
2. Google／GitHub 帳號綁定解除、三種密碼邀請、固定版本核准／交付／通知與保留政策完整 UI 尚未完成 hosted 驗收，原需求保留。
3. 舊合成 V2 原檔仍保留並 queued。新 V3 精確喚醒成功，不會代替舊佇列執行，也未直接修復舊測試資料。
4. 背景處理完成後，目前需重開照片或重新載入來更新版本列表；待補就緒狀態更新與正式重試操作。
5. CSV／照片下載的瀏覽器落地檔、Oracle 實際 failover 與一般新建 scope 尚未驗收。pick.kinostudio.tw 仍未接 DNS，避免改動 A。

## 交接與證據

- 可攜式非敏感證據：docs/releases/hosted-collaboration-2026-11-01.json。
- 真實部署收據：apps/worker/.local/collaboration-action-41238436526/staging-collaboration-validation-release-receipt.json。
- 私有物件狀態／大小與精確 job 讀取：apps/worker/.local/hosted-version-v3-assets.json、hosted-version-exact-wake.json。後者的 derivativeCount 是預留 output slots 數，不能把 queued V2 的 slots 當成已產生檔案。
- 畫面位於既有 visualizations 目錄，檔名前綴 kino-pick-hosted-；架構圖確實沿用指定 Cocoon-AI/architecture-diagram-generator skill/template 與 MIT 授權。
- 最後的交接／圖表／可攜式證據只更新工作目錄，沒有為純文件再次觸發全量 CI 或部署；遠端 main 與實際產品來源仍是上述 10b0b7b。
- 下一輪可沿用 Git Credential Manager 的既有 GitHub 授權與 tools/github-kino-pick-actions.py。B OAuth CLI 過期時先執行一次隔離設定下的 whoami 刷新，再重試；不要反覆要求新憑證。不得重做 Owner/bootstrap、100uploads、0058/0059 migration 或已通過的完整驗收。
