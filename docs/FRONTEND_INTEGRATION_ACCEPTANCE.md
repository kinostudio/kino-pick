# Kino Pick 統一前端逐頁驗收

## 最新驗收覆蓋（2026-11-01）

以下保留歷史驗收紀錄。當前 B 已 source10b0b7b、CI41236744712、Actions41238436526、version526e3f16-f4dd-4567-9551-7ac7b05b8bd9／schema59；私人V3上傳／縮圖、自動三星Red、推薦與獨立客戶評等、雙端筆畫／留言、Owner與Guest歷史、V1/V3滑桿實際拖曳、提交快照及後台明細通過。完整MVP未完成，詳見 docs/HOSTED_COLLABORATION_ACCEPTANCE.md。舊V2保留queued；版本就緒清單目前需重開更新。不要把下面歷史「待部署／未驗」視為當前狀態，也不要把受限合成相簿當成一般新建scope已開放。

## 當前 hosted 邊界（2026-11-01）

B 已實際部署統一前端 source56288cb／CI41233234187／Actions41234844192／version3e9c8a69-dfb2-4f74-b391-67213c9b7ccf、schema59。Owner真實OAuth、固定專案／相簿／單張、私人R2原圖與Cloudflare縮圖、攝影師推薦OR門檻與即時修改／清除／還原、Guest獨立星等收藏挑片、雙端手繪共享與留言及下載審計已驗。完整MVP未發佈。下表與早期段落記錄當時的本機驗收範圍，不應把其中「尚未部署」套用到目前版本。

現有V2原檔直傳完成但排隊處理未被喚醒，正在補正常／版本完成事件的精確job wake；Before/After hosted尚未通過。全域收藏／近期、帳號連結解除、三密碼邀請、固定交付／通知、一般新建scope與保留政策UI仍各自待完成。不得把受限合成相簿當成全面開放。A／DNS／客戶資料不動。

2026-10-31。此表記錄實際完成邊界，不代表線上 MVP 已發佈。驗收入口：http://127.0.0.1:4180/__review/login 。資料為隔離合成測試資料，使用正式前端及真實本機 Worker/D1/R2 服務。

| 頁面                 | 外觀與操作                                     | 真實接線／驗證                                            | 邊界                                                                                                  |
| -------------------- | ---------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 共用版型與 Logo      | 深色側欄、米白、響應式；透明v11圖標            | 明暗SVG透明alpha；桌面與375px檢查                         | 僅本機新UI，尚未部署                                                                                  |
| 工作台               | workspace卡片及授權導覽                        | 真實workspace API；目前頁數量                             | 不虛構跨頁總計                                                                                        |
| 專案／相簿           | 卡片、建立modal、編輯／封存既有流程            | 實際建立專案／相簿；8照片圖庫；既有啟用確認保留           | 本輪未重驗雲端上傳                                                                                    |
| Owner 單張           | 左圖右工具、燈箱、鍵盤與焦點；比較全寬         | 私人圖片、既有留言／標註／版本；V2發布實際完成            | 攝影師 metadata、即時評等／色標／推薦策略已接真實 API，本機讀取原圖及清除／還原通過                   |
| 分享與邀請           | native modal、密碼／期限／獨立權限、複製／撤銷 | 真實建立與exchange；能力開關由API；未知結果保留重試intent | hosted Guest開關仍OFF；本輪未逐項重跑全部拒絕組合                                                     |
| Guest 入口／圖庫     | 同套Logo／主題、挑片提交                       | 真實session、挑片5星收藏，重載保留                        | 非外部OAuth                                                                                           |
| Guest 單張           | 同款暖色燈箱、留言／點與矩形註記區             | 實際版本留言與點註記、滑桿／並排／疊圖                    | 0058 正式手繪 migration 與雙端 API 已在隔離環境驗證；主圖畫布實際鍵盤畫線／存檔／重載保留通過（本機） |
| 選片結果             | 提交確認、封存輪次與重開                       | 第1輪1張；Owner重開第2輪保留第1輪快照                     | CSV匯出本輪未重驗                                                                                     |
| 活動歷史             | 獨立工作區頁／同套導覽                         | 真實下載、提交、留言、標註、評分、收藏等事件              | CSV本輪未重驗                                                                                         |
| 處理設定             | 獨立頁、現有供應者與優先順序元件               | 真實policy讀取、LocalSharp seed處理完成                   | Oracle仍候選；未重驗雲端failover／修改儲存                                                            |
| 帳號                 | 真實session與可用OAuth來源                     | get-session及providers讀取                                | 綁定／解除未完成，沒有假儲存按鈕                                                                      |
| 下載                 | 正式授權按鈕／附件連結                         | 私人preview 27119bytes下載及audit實際完成                 | 本機，非固定核准交付包；工具延遲不算效能通過                                                          |
| 近期／全域收藏／交付 | 原需求保留                                     | 未完成正式服務／頁面                                      | 不放假可操作入口                                                                                      |

## 最小驗證與證據

- 產品 pnpm build 成功；TypeScript strict、scoped ESLint、invite能力映射3測試、兩版SVG透明檢查通過。
- 57個實際migration、8照片／27assets／9完成jobs／兩ready版本隔離seed通過。
- 手動流程證據：apps/worker/.local/studio-ui-manual-acceptance-before-standard-port.json。該dataset先使用4190，後發現WHATWG限制埠，現在4180是新dataset；不把舊dataset操作說成新dataset資料。
- 最終4180入口：匿名API401、foreign-Origin登入403、前端200；4174只302至4180。最終工作台與專案相簿瀏覽器讀回成功。
- 圖片截圖位於既有visualizations目錄，檔名前綴kino-pick-unified-。
- 新完整CI、雲端新UI／新OAuth／R2上傳／客戶hosted流程本輪not_checked。原雲端證據保留，不能代替新來源驗收。

## 接續

依使用者最新授權直接接續：推薦／手繪已實作，B 獨立57→59還原升級通過；完成精確來源CI、B採用／部署及真實hosted協作，再補固定交付／通知及帳號綁定；其餘原產品需求仍在MVP_RELEASE_PLAN。每個slice保留真實授權／idempotency／audit，以必要最小測試驗證；通過新來源CI與B部署閘門才部署。A及DNS保持不動。

最終補驗：4180工作台→專案→相簿8張→單張／兩ready版本已讀回；版本卡片改窄面板單欄，避免viewport兩欄擠字。最終root strict、scopedlint／format與target-ui build通過。曾誤用不存在build:ui腳本失敗，改用既有build:target-ui成功；失敗不計為通過。入口證據 apps/worker/.local/studio-ui-final-entry-proof.json。

分享彈窗後續原生回歸已執行通過，含未知結果／401重試／同request去重／secret限制／關閉能力與375px；詳見HANDOFF最新節及.local/invite-create-focused-proof.json。初始networkidle超時已保留為失敗；僅改用DOM與控制項就緒判定，未縮減業務斷言。

## 2026-11-01 本輪補驗

- XMP container32測試、推薦native D1六組、真實R2原圖／推薦API十組、B固定協作profile本機24組通過（來源變更後需要刷新proof）。邀請UI權限相容四測試通過；Web strict通過。
- Owner 手動操作已驗證：即時五星、重新讀取原圖3星／Red、手動清除、還原原圖；Guest推薦badge與客戶評等分開。這是本機真實API與私有R2，不是hosted證據。
- B獨立資料庫049e766a-76b0-4f5c-9c56-33e3cf565c6e還原當前57資料、升級59通過；舊資料／schema／sequence保持、FK0。來源B仍57，尚未修改。
- 架構圖已採用指定Cocoon-AI/architecture-diagram-generator的skill/template及MIT授權，詳見docs/diagrams/kino-pick-architecture.html；中文頁面流程與部署圖分開，未完成項目明示。
