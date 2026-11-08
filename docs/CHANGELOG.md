## 2026-11-08 ZIP 第二輪減量候選：首次失敗仍保留

bedc21b已完整CI42488303312／自動B42490385780成功，Worker dd05058f-0d18-4b96-ab85-549494832cd5，schema67。真Guest兩張新票券首次ZIP均完整54145bytes、CRC與兩原圖SHA一致；第三張首次53935bytes截斷。safe tail明確回覆D1_ERROR＋「Too many resources consumed within a 10 second window」，是D1 resource throttle，非已證實Worker CPU上限。初載access503亦保留；不能稱全部驗收通過。

第二最小候選只在預檢使用本次初讀授權的immutable manifest、精確asset PK與R2 HEAD；移除N次預檢完整view與重複postHEAD查詢，每張真正R2 GET仍fresh完整ticket＋conditional ETag，完成前ticket／generated audit及trigger不變。不加寫入／實檔重試、不改schema或權限。若HEAD期間撤銷，可能先回attachment HTTP200後零ZIP bytes串流失敗；不會輸出私人檔名／內容，不宣稱此競態統一401。Native26／focused13／11單元／strict／scopedlint／release self-test及顧問唯讀審查通過；待CI→自動B→真Guest首下載，不把local當hosted。

A／DNS／Review／客戶資料未改，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB維持。live67／獨立restore67勿重做或刪除；GOAL文件依使用者指示、內建舊GOAL仍paused無覆寫API。完整MVP／production cutover未完成。

## 2026-11-08 live0067 已採用並自動部署；ZIP overload 修正候選

Fresh-source parity與live67採用9步exit0，152舊表／3414列保持、FK0；完整release self-test、CI42482772015與B自動部署42485107607成功。Source92e7507，Worker ac580772-86d2-45b6-b74e-7263cc91c83e。不得重做0067復原／遷移或刪獨立測試庫。

真Owner／Guest讀到新合成照片的機型／鏡頭／f2.8／1/125秒／ISO200；2份邀請僅1位代表核准，Owner交付僅指定1份邀請，雙方站內通知顯示正確。ZIP首輪／新票券首次下載出現截斷；成功的兩次原圖SHA完全一致，但不能稱ZIP驗收完成。安全tail實際捕捉D1_ERROR＋overloaded，未證實其子類或Worker CPU上限。保留失敗檔，不重試寫入或放寬授權。

最小候選減少重複live delivery view：每檔及完成前完整ticket重驗不變，fresh manifest逐項核對後查immutable asset PK，R2仍HEAD及conditional ETag。Native26／focused13／11 ZIP單元、strict／scopedlint／release self-test通過；待正常CI→自動B→真Guest新票券首次ZIP雜湊驗收。A／DNS／Review／客戶資料未動，自刪OFF/dry-run、R2優先／Oracle30GB維持。完整MVP及production cutover未完成。內建舊GOAL仍paused且API不能覆寫，文件GOAL依本次明確要求執行。

## 2026-11-08 B live0067 已採用，release self-test 通過，待正常CI與部署

使用者明確授權fresh-source parity→live0067→CI／自動B→真Owner／Guest驗收。固定B工具完成9步exit0，fresh source與既有66備份一致才套唯一0067；live與獨立drill精確一致、FK0，未覆寫舊資料。證據docs/releases/approved-deliveries-0067-restore.json。首次parity export失敗保留，後續唯讀metadata與同工具成功，未擴憑證；不宣稱已確定根因。

完整release self-test已實跑成功。保留失敗：舊photographer proof的bundle hash失配，重跑13組原生photographer後更新；新增prior flags比較未排序與67 self-test ledger fixture用了[id,name]而實際receipt用name陣列，已精確修正並保留負面守門。predeploy DB必須67，舊Worker仍按66 receipt核對；不放寬物件／SQL／hash／scope或安全flags。

當前GOAL覆寫為完成此0067發布與真實ZIP／通知／EXIF驗收；MVP_RELEASE_PLAN為執行依據。內建GOAL仍paused、API不支援覆寫未完成目標，未假標完成。下一步正常CI→既有自動B部署→真Owner／獨立Guest驗收，不重做已通過restore/adopt。Worker目前尚未更新；A／DNS／Review／客戶資料不動，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。

## 2026-11-08 B 的0067獨立備份／復原已通過，live仍66

使用者已明確授權本次live66受ACL保護完整備份與B獨立測試庫。已完成6個CLI步驟，全部exit0；新獨立庫7eabf9e7-babb-48f5-81ec-a25ee870f309，復原66後升67。備份3218715bytes／SHA c39aeb29960b1be3322137f06c916e782db1ae5b572d643a5224e82b8d35ff1a；152舊表／3414列的hash、schema、sequence保留，FK0。實際獨立庫匯出再次驗SHA／67 ledger及精確1view／1index／2triggers；多餘物件拒絕守門保留。restore-only proof仍被adoption gate正確拒絕，不能當live遷移／完整self-test／CI成功。

證據docs/releases/approved-deliveries-0067-independent-restore.json及independent-validation.json。備份位於release apps/worker/.local/approved-deliveries-0067-f95d54f2-1483-4a79-99de-9062ea971c13，ACL僅Aaron／SYSTEM／Administrators；SQL及原始IP未提交。首次CLI export失敗保留，根因未證實；唯讀metadata與後續匯出成功，未擴大憑證。首輪sandbox讀proof EPERM反映ACL限制，後用授權context只輸出安全metadata。

本次沒有修改live DB、沒有adopt或部署，A／DNS／Review／客戶資料不動，自刪OFF／dry-run及R2優先／Oracle30GB不變。下一步為fresh-source parity後才可live0067 adoption→完整release self-test→正常CI／自動B→真Owner／Guest ZIP、通知、EXIF驗收；source變動則重新rehearse，不能拿舊快照覆寫新資料。恢復方式為關閉新flag、保留歷史與原圖並forward fix。不要重做已成功的獨立復原或擅刪此測試庫。

## 2026-11-08 G1 本機整合通過，0067 雲端授權待答覆

新版 GOAL 的 G1 已實際接線 ZIP／站內通知／相機資訊並補原生權限驗證；26 組 native D1/R2、schema67、3 份 image fixtures 通過。相機資訊增加 IO 後再次授權核對；12 metadata、19 ZIP/history、20 config/boundary、5 notification 單元通過；原生手動清理 1 項、固定版本 ZIP 真下載／解壓雜湊與通知 browser、root/web strict、前端與 B-profile dry-run build、scoped lint/format 通過。證據 docs/releases/g1-0067-local-readiness.json；不把 local 當 hosted。

保留失敗：清理首輪 config 未命中測試、沙箱編譯拒絕、EXIF helper transport Origin403、未發布 V2 正確被 Guest 拒絕；分別沿既有 config/request wrapper/正常 CAS set-current 修正，未放寬產品授權。

自動核准審查在命令執行前拒絕 fresh live66 export／新 restore67：理由為舊授權僅限舊 restore66 備份。已提出一次本次完整備份＋B 獨立復原的明確授權問題，尚待答覆；未備份 live、未建 restore67、未套 live67、未部署。不可重試或繞 gate。0067 checker 已完成精確 schema／hash／receipt／負面守門補強，normal self-test 仍待真實復原證據；接續正常備份→獨立復原→parity／adopt→CI→自動 B→真 Owner/Guest 驗收。A／DNS／Review／客戶資料不動，自刪 OFF/dry-run、R2 優先／Oracle30GB 維持。

## 2026-11-08 重新安排GOAL，接續G1→G5並行開發

依使用者明確指示，以docs/MVP_RELEASE_PLAN.md最新「新版研發GOAL」為執行依據，主要終點是可實際操作的production線上MVP。內建GOAL仍paused且create_goal拒絕覆寫未完成objective；工具無修改／resume能力，未假標舊目標完成，人工開發繼續。

G1先完成ZIP／站內通知／相機資訊及0067安全發布；G2清理政策；G3剩餘必需驗收；G4production獨立資源與網域cutover；G5真Owner／Guest全流程與交接。主代理負責規劃／複雜問題／資安／整合及雲端變更；三個gpt-6-luna／max分別處理0067 release gate、EXIF原生ACL測試、通知原生隔離測試，分檔案並行、不覆蓋他人WIP。0067先獨立復原及parity，未具備完整證據不套live或部署。

起始f455d00／B schema66基線與已驗切片保留；WIP已另保全patch及21個untracked來源，未碰ignored憑證。A／FILM／Review／客戶資料不動，自刪OFF／dry-run、無Cron、R2優先／Oracle30GB維持。各階段以必要最小驗證→CI→自動B→真實驗收→交接完成，不把文件計畫或local測試當成已上線。

## 2026-11-08 Guest回饋／下載／交付清單恢復補強已部署B並真實驗收

Source f455d0018b16c61bd7e6cdfd95718c2d346f5373，完整CI42410930478成功，自動部署42412803984成功；Worker cac5baee-757a-4504-b98f-bb9b8ecc2f07，baseline bot5668f61，schema66不變。只加列舉Guest metadata GET的一次有限重試／no-store；401／403／404／429、契約／scope、取消、Owner／寫入／實際下載不重試，不共用授權快照；原前後session／邀請／期限核對保留。所有未發布ZIP／通知／EXIF／0067 WIP與根髒檔保全，未改schema／儲存路由或A／DNS／Review／客戶資料。

同一真Guest／既有INV-3061D3CE連續三次重載，相簿24張照片清單、首張私人縮圖、正常下載清單及固定V3成品皆可讀，三項錯誤文字均無。未授權rate／favorite控制保持0，未增加權限，也未冒充已驗該Guest的評等寫入。清單實際展開、燈箱無feedback誤報且可關閉。透過可見「下載成品」連結取得固定V3原圖21527bytes，SHA b26b590c55c31f7d092f2e65d400134cfb252dae3eea81c70dbbef5c2880a6c7，與既有發布manifest完全一致。無Cookie對access／downloads／deliveries三端點均401 GUEST_ACCESS_REQUIRED且無私人payload。租戶／相簿／邀請等拒絕仍由完整原生CI回歸，未新增真第二租戶。

原始首次瞬時失敗HTTP未捕捉、根因未定；不能宣稱已證實冷啟動／配額或所有首次載入零錯誤。Hosted未故意造成503，本機乾淨來源及CI已注入三路首次503、各精確2次後成功。驗收工具曾有兩次locator wait未匹配，後續fresh native AX／DOM確認已就緒，失敗保留，不當作快速載入證據。未做hosted負載／CPU／記憶體或實機觸控。證據docs/releases/guest-read-resilience-{local,hosted}-acceptance.json；截圖root .local/guest-read-{downloads,delivery}-hosted.png，下載檔由瀏覽器存於使用者Downloads，未印Cookie、token、原始IP或憑證。

GOAL tool現查仍是舊KINO Pic／M1→M5、paused；實際已到B schema66與R5部分完成，不能從M1重做，也不能宣稱完整MVP。已將差異寫入MVP_RELEASE_PLAN的最新盤點。下一優先為已保全ZIP／站內通知／EXIF WIP的0067獨立復原與安全發布，並補齊retention確認、production獨立資源／網域cutover及其餘真實驗收；不重做0066、密碼、固定交付、Oracle或縮圖。自刪OFF/dry-run、無Cron、R2優先9GB／Oracle30GB保持，舊restore66備份保留、勿重刪。

## 2026-11-08 Guest唯讀清單有限重試：乾淨來源本機通過，待CI／B

真Guest同一session的access與downloads直接讀取正常，手動重試／重載後三面板恢復；安全tail觀察access／downloads／deliveries200、無exception，selection401符合未授權。原首次失敗HTTP狀態未捕捉，根因未定，不宣稱ACL或資料庫已壞。未更動任何權限／schema／儲存／B資料；A／DNS／Review不動。

最小前端修正只對列舉的Guest metadata GET，遇TypeError或502／503／504重試一次、no-store、不共用授權快照。401／403／404／429、契約／scope／取消、Owner、寫入及實際下載不重送；原前後session／邀請／期限檢查完整保留，持續失敗仍顯示原錯誤。不加入延時選項、背景輪詢或新套件。

乾淨tracked-source快照（獨立offline lockfile安裝，無ZIP／通知／EXIF WIP）26unit、root／Web strict、scoped lint／format、正式product build及原生D1/R2 browser5組通過；新增三清單首次503→實際200各精確2次，無手動重載，原固定版本下載與OFF檢查保留。初次root tsc缺generated Worker types，按標準前置補產後通過；第二次安全tail子行程在本機退出3221226505，不當成雲端成功證據。證據docs/releases/guest-read-resilience-local-acceptance.json。正常CI→自動B→同一真Guest重載及原圖下載待後續最終節。

此為短暫讀取的恢復改善，不宣稱原事件根因已證實或完整MVP完成。GOAL紀錄仍是早期M1–M5／paused，實際進度依MVP_RELEASE_PLAN及發佈證據；既有新指示正在人工接續。正式來源.local/oracle-release-20261106，其餘WIP及根髒檔保全，不從根stage-all、不做0067／新restore。自刪OFF/dry-run、R2優先／Oracle30GB保持。

## 2026-11-08 自適應縮圖列已自動部署B並線上驗收

最終source c685c887b87885ff9f0fe0660437b8b803937cae，完整CI42400059486成功，自動部署42401987313成功；Worker d7fabc7f-b225-4b92-8031-e7fdf2295568，baseline bot7d6b5d2，schema66。縮圖依實際可用寬度顯示目前與鄰近照片，不固定五張；獨立flow row收合露上方1/3、opacity0.62，hover／真鍵盤focus展開，選中高亮。收合及展開均不覆蓋照片，保留原服務、權限、網址及草稿保護；觸控原有完整可點列維持。

真Owner在既有24張合成相簿實測1699px21張、1280px17張、375px6張；三尺寸兩態均noOverlap／thumbsFit／selectedVisible，私人預覽正常。切第17張後window移至8–24，Owner網址更新、移出收合、關閉移除photoId及重開正常。獨立Guest1280px17張、相同鄰近window／高亮／鍵盤展開／關閉通過。Guest375 hosted未驗：現有IAB tab未套用viewport override而維持1280；CI的真產品Guest375檢查已通過，不把它冒稱hosted或實機觸控。暫時viewport均reset。證據docs/releases/filmstrip-adaptive-hosted-acceptance.json；截圖root .local/filmstrip-adaptive-{owner-expanded,owner-folded,owner-mobile,guest-expanded}-hosted.png。

兩次CI失敗均保留：42395835837忽略Guest既有160px最低stage，已按實際floor修正；42397770413最後Guest navigation等networkidle逾時，僅比照Owner改DOM就緒，保留HTTP200與真實按鈕／燈箱／下載斷言。最後完整CI成功，未跳過守門。原CSS fixture加入tall tools edge後證據同步raw variant；不以fixture取代clean CI或hosted。

尚有獨立Guest讀取問題：下載／交付清單錯誤在本次部署前已見，feedback於本次重載亦顯示暫時無法載入，根因未定；不能宣稱Guest完整流程零錯或完整MVP。下一步先定位其現有capability／授權session／邀請scope的讀取失敗，保留隔離，不全域開權限。ZIP／通知／EXIF及0067仍為未發布WIP；新restore67未建立、live67未採用。舊restore66僅依明確授權完整備份核對後退役、備份保留，勿重刪或重做已通過0066。

正式來源仍.local/oracle-release-20261106；根不同產品髒檔保全，不從根stage-all或重建。此次無schema／儲存路由變更；A／DNS／Review／客戶資料未改，自刪OFF/dry-run、無Cron、R2優先9GB／Oracle30GB維持。Owner與Guest驗收頁保留，Owner為使用者輸出、Guest留接續診斷。尚未驗實機觸控／負載／CPU記憶體，ZIP等不得混入此次已驗UI發布。

## 2026-11-08 第二輪 CI 導航等待修正（產品不變，待 CI／B）

de94bf8 的 CI42397770413 已通過原失敗的 Guest 縮圖檢查、完整 test:cloudflare 及 B 原生範圍驗證；最後獨立核准／交付 UI helper 在 Guest page.goto 等待 networkidle 30秒逾時，原因未定，保留失敗，不宣稱CI成功。只將該 Guest opener 比照現有 Owner opener改為domcontentloaded；原 HTTP200、照片按鈕可操作、燈箱及後續核准／固定原圖實際下載斷言完整保留，不增加逾時。

以HEAD helper隔離副本（不含ZIP／通知WIP）加此單行修正，本機現有候選bundle／隔離D1/R2實跑5組通過；這不是clean CI或hosted驗收。node --check與scoped format通過；正常CI／自動B待後續最終節。UI產品仍是87c6bdab的可用寬度／獨立列實作，schema66與A／DNS／Review／客戶資料不動。原CSS fixture增加最低高度情境後，compact evidence亦同步目前raw variant的幾何值，原失敗紀錄保留。

## 2026-11-08 自適應縮圖 CI 失敗保留與窄螢幕最低高度檢查修正

87c6bdab 的 CI42395835837 未通過；Guest browser 第1202行錯誤假設375px鍵盤展開時照片必定再縮小。此前同次 noOverlap／thumbsFit／selectedVisible 檢查已通過。獨立 production CSS fixture 實測 tall tools＋header：收合／展開 stage 均160px（既有最低高度）、rail18.922→56.797px、兩態 stage.bottom386.562≤rail.top397.75；沒有重疊，tools／scroll吸收餘下高度。保留原失敗log，不以fixture冒充完整產品驗收。

只修正測試按既有最低高度計算預期stage，保留桌面縮小、窄／寬可容納縮圖數、1/3收合、active高亮、滑鼠移出、真鍵盤focus及所有隔離斷言；不改產品CSS／服務／schema。修正後正常CI及B結果待後續最終節。A／DNS／Review／客戶資料不動，0067與ZIP等WIP不混入UI發布。

## 2026-11-08 縮圖依可用寬度顯示鄰近照片，收合／展開均不重疊（待 CI／B）

使用者最新要求取代舊overlay設計及hover不改stage尺寸的舊斷言：縮圖列恢復獨立flow row，收合只佔full高度1/3且半透明，展開時照片區1fr同步縮小，兩態stage.bottom皆小於rail.top。沒有隱藏區覆蓋照片或搶點擊。觸控保留完整獨立列；keyboard focus-visible展開，mouse click後移出收合，active外框及原導航／網址／草稿保護維持。版本比較保留既有獨立列。

沒有固定5張上限。共用pure window＋ResizeObserver量nav內容寬度、CSS縮圖尺寸、gap與padding，僅render可容納的目前／鄰近照片，保留絕對序號；窄螢幕減少、寬螢幕增加，無水平截斷。Guest hook在early return前呼叫，穩定callback ref處理比較模式卸載／重掛，原權限與私有資產不變。

本機pure window5測試與Web strict／scoped lint通過；production CSS四組Owner／Guest desktop/touch版面測試通過，收合約25.33px／完整76px；hover照片stage658.53→607.86px，兩態noOverlap、thumbsFit、selectedVisible均true。root另以真本機workerd/D1/R2/Sharp八張合成照片實際查看收合／展開，照片與縮圖分離；這不是雲端OAuth驗收。既有原生browser helper已改為新規範，CI與B結果待最終節。證據docs/releases/filmstrip-hover-layout.json；預覽http://127.0.0.1:4180（暫時驗收runtime，非正式B）。

此次前端發布不含ZIP／通知／EXIF的其餘WIP，不改schema66或儲存路由；B先前3395d58／CI42390574802／deploy42392569721已通過，但不是這份最新規範。A／DNS／Review／客戶資料不動。另依使用者本次明確授權，舊restore66完整備份、hash／152表／FK0核對後退役，備份保留，B剩9個DB；live66保持，未套0067。初次本機0067檢查誤比較整份schema hash，修正為精確舊表／舊schema及四項新增物件後通過，失敗保留；不得用它冒充遠端獨立復原。其餘WIP不混入UI-only staging patch。

## 2026-11-08 縮圖點擊後移出收合補正（待 CI／B 驗收）

第一版 d9aa056／CI42388285058／自動部署42389764115已成功，B version62538342-7f64-4251-8d23-8b15460e237e、schema66；一般燈箱已無thumbnail專用列，hover可浮出。補驗發現滑鼠點縮圖後focus-within殘留會使移出仍展開，不能把第一版宣稱完整通過。最小補丁只將展開／外框的條件改成focus-visible：滑鼠點過再移出收合，真正鍵盤Tab仍完整展開。

Owner／Guest既有browser helper新增真實點擊→移出→1/3斷言及Shift+Tab／Tab焦點可見斷言；保留選圖、網址、草稿、切圖、原授權與版本比較例外。本次仍不包含ZIP／通知／EXIF WIP，不改schema或A／DNS／Review／客戶資料。完整CI與hosted結果待後續最終節，不能以本機CSS fixture冒充正式UI驗收。

## 2026-11-07 燈箱縮圖列浮動收合（待 CI／B 驗收）

實際 Chromium 的 production CSS／最小 DOM 版面驗證四組通過：Owner／Guest 桌面 hover、focus、移出及 reduced-motion；375px touch context 完整可點。檢查真實 bounds／elementFromPoint，收合約 1/3，展開不改照片 stage 尺寸。證據 docs/releases/filmstrip-hover-layout.json（不是 API／hosted 或實機觸控驗收）。

本次只發布一般 Owner／Guest 相片燈箱的縮圖列改善：桌面未 hover 時露出上方約 1/3、透明度 0.62；hover／鍵盤 focus-within 完整浮出，選中照片外框保留。縮圖列改為覆蓋照片的定位，不再保留獨立 grid row；收合的隱藏部分不攔截照片點擊。觸控維持完整可點列，reduced-motion 關閉動畫。Owner 展開版本比較沿用既有獨立縮圖列；Guest 比較畫面原無該列。

保留既有操作／授權及 schema66，不含尚未完成驗收的 ZIP／站內通知／EXIF 工作。相關 WIP 檔案留在隔離 release checkout，未混入此次發布。A／DNS／Review／客戶資料未改，自刪 OFF／dry-run、單 R2 與 Oracle30GB 設定不變。既有 Owner/Guest 真實 browser helper 增加收合比例、hit-test、hover/focus、active highlight 與無專用列檢查。CI／部署與 hosted 尚未完成前不宣稱上線；以後續最終節及 release manifest 為準。

## 2026-11-07 代表核准與固定版本成品交付已自動部署 B 並真實驗收

最終source ac5dd7bd98ae10125f28acd8a73ed0dec72dda94，完整CI42381439868成功，既有流程自動部署42383253098成功；Worker be30a41a-f94f-4515-b601-eda1db55849a，baseline bot6980099，schema66。已明確授權退役舊restore65並保留完整備份；fresh65→獨立restore66→live parity／0066採用通過。D1約7.3MB，先前阻塞是10個DB名額，非照片或資料量滿；未刪其他DB。

真Owner在既有合成613487…相簿、a3a6…照片為V3建立兩份邀請的固定請求ecd6a2b7…；只有一位Guest代表確認，雲端唯讀核對為2個指定邀請／1筆receipt。Owner只交付INV-3061D3CE；獨立Guest實際下載V3。暫時將head3→1仍下載同一V3原圖，後還原head3／revision3；V2保持queued。三次native下載均21527bytes、SHA b26b590c55c31f7d092f2e65d400134cfb252dae3eea81c70dbbef5c2880a6c7，含撤銷後重新發布的實際檔案。

INV-40C9BFFB可看相簿但看不到交付檔名或下載控制，重播第一人的直接下載URL回GUEST_ACCESS_REQUIRED。Owner確認撤銷後，原收件人連結移除且直接重播亦拒絕；重新發布只給第一份邀請。最終保留active交付4cf01abe-0f82-45e6-b185-7426bc6b5d7e供驗收，舊167ec913…保持撤銷與歷史。雲端審計核對published2／revoked1／requested3／generated3；兩份manifest皆固定V3與唯一收件邀請，IP只檢查型別text，未輸出原值或憑證。核准在Guest登出後仍保留，沒有要求第二位確認。

實際觀察保留：部署後首次Guest核准面板讀取曾顯示一般服務錯誤，同Guest直接GET成功，透過可見重試後恢復並完成其餘流程，原因未定，不宣稱首次載入零錯誤或負載穩定。可選CLI審計首讀7403；確認B OAuth與既有D1權限、明確固定account後回讀成功，未變更／擴大憑證。先前3次CI失敗（Web narrow／OFF多讀／舊schema證據）均保留並修正；最終完整CI成功，不以失敗冒充通過。

證據docs/releases/approved-deliveries-hosted-acceptance.json、0066-restore與retired-restore65 manifests；截圖root .local/approved-delivery-{guest,owner}-hosted.png。真Owner／獨立Guest頁保留可操作，連結token只用於瀏覽器記憶體並已清除工具變數。正式候選仍在.local/oracle-release-20261106，根不同產品變更保全，勿覆蓋。

此切片完成；完整MVP未完成。下一步依MVP_RELEASE_PLAN完成ZIP／基本通知、其餘retention確認與production cutover；不要重做已通過0066復原、代表核准、固定交付、密碼或Oracle接線。未驗hosted負載／CPU記憶體數值、實機觸控、真第二租戶帳號（native跨租戶拒絕已過）。A／DNS／Review／客戶資料未改；自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。

## 2026-11-07 全部產品 CI 測試通過，發布證據版本守門修正

CI42379148941（02e334f）所有產品／原生／browser與新核准交付介面檢查已過；最終release evidence仍失敗，不稱CI成功。原因為動態manual cleanup proof已驗schema66，但checker仍要求65。已改精確66，新增拒絕65負例；原生單一manual cleanup test實跑成功（6 assets／2 versions／11276 bytes實際釋放），目前B-profile26組與完整release self-test通過。之前local65proof不能代表新schema；Git合併將新SQL CRLF正規為LF，舊raw hash失配後亦重新實跑profile產生證據，未手改proof冒充。第三輪失敗保留；再走正常CI，不重做已完成的B0066遷移，不改A。

## 2026-11-07 CI 關閉功能的多餘權限讀取已修正

第二輪CI42378092992已通過strict／unit／integration／build／前段browser，在原生Guest feedback初始read計數5!=4失敗。新交付面板於OFF仍先讀access；改為先查公開capability，OFF即返回，ON仍保留前後Guest身分及獨立權限核對。舊精確4次斷言完整保留，不以增加數量掩蓋多餘請求。Web strict、scopedlint/format、target build與5組核准交付focused browser（實際下載與OFF）通過。首個沙箱build遇Windows libuv assertion；受允許環境第二次成功，保留失敗log。再走正常CI／自動B，不更動schema66或A。

## 2026-11-07 CI 型別檢查修正

首輪CI42377707860於Web strict未通過：Guest panel status為合併union，雖runtime已隱藏loading/disabled，TypeScript未排除該成員。補上ready正向render guard，不改權限或請求；完整Web next typegen＋tsc實跑通過，scoped lint/format通過。root strict原先未包含target-ui，不能用它代替Web strict；前次本機驗證未涵蓋此點。保留失敗，接續正常CI／自動B部署與hosted驗收，不跳過檢查。

## 2026-11-07 0066 雲端獨立復原與 B 遷移通過；待 CI／部署

使用者明確允許退役已完整備份的舊 restore65；重驗SHA後只刪04966465-e0f7-4cd8-9c32-7065034406cd，備份仍保留。B先前滿的是10個DB名額；實際live DB約7.31MB，不是照片滿。新獨立庫kino-pick-restore66-cd22482b／bd1042a1-3c29-4ccb-9a8e-0c8ef80d6f9e成功復原fresh65並升66；152舊表／3306列hash、schema與sequence一致，FK0。fresh live parity後只套0066，source-after與獨立drill一致，9次CLI均0。正式manifest docs/releases/approved-deliveries-0066-restore.json；舊庫退役證據retired-restore65-20261107.json。A／DNS／Review／客戶資料不動。

保留失敗：第一輪schema核對只因CRLF/LF不一致；命令均0，未重跑restore/DDL。工具新增--verify-restore核對既有匯出、原成功命令與固定B/target，schema只正規換行，資料hash不放寬；再--adopt成功。首兩次release self-test分別發現舊65組名與66自測fixture缺nativeProof，已修正測試/守門fixture，第三次通過，沒有刪除負面守門。Product/native/browser驗證沿用同一未變來源，不重複全量本機測試。

目前live DB為66、Worker仍是前一版55af3ca／616e7a23-cd3f-4738-bc55-82da5c226ad9。接續合併已保全功能分支至main，正常CI→自動B部署→真Owner建立核准、獨立Guest代表確認、Owner發布、固定V3原圖下載與head切換／撤銷驗收。完整MVP與ZIP／通知仍未完成；自刪OFF/dry-run、R2優先／Oracle30GB保持。

## 2026-11-07 代表核准＋固定版本成品交付：本機完成，B 復原名額待確認

沿用既有0054核准與原介面；一位明確授權客戶代表確認即可，Owner再明確發布給核准名單中的收件邀請。新0066僅增2 views／3 indexes／3 triggers，固定原圖版本、檔名、節點、大小、mime、SHA與核准收據，不隨目前head切換。發布／撤銷／下載沿用append-only audit；查看與原圖下載獨立，租戶／相簿／邀請／session／期限／撤銷逐次驗證。Guest只顯示自己的安全下載歷史，不回傳原始IP。單一照片一份交付，可多次發布；ZIP／通知仍待完成，非完整MVP。

實跑：18 config/boundary＋17 Guest-history單元；26本機原生B-profile組（schema66、2影像fixture）；13攝影師回歸組；5 Chromium核准／交付組，實際存檔size／SHA一致。25份交付為同一原圖的metadata測試，不是25張上傳。strict、product/profile build與scoped lint通過。負面注入GET503與publish409後恢復正常，無草稿燈箱可關閉；精確journal重試、撤銷與request-ID衝突保留。證據docs/releases/approved-deliveries-local-acceptance.json。保留先前失敗紀錄，未把失敗／mock負面回應當正式驗收。

雲端阻塞：B實際回覆D1數量已滿，新的獨立0066復原庫未建立，未套用live0066、未部署本次功能。已完整匯出舊獨立測試庫kino-pick-restore65-20261106（04966465-e0f7-4cd8-9c32-7065034406cd），本機獨立還原65／FK0；2979263 bytes、152表／3039列、SHA e4e44ce7f81cc6b6ecd9feefcc2970c43c1f2cc6b069cb85209007246d539aff，符合原0065 proof。已提出一次刪除此舊測試資源的確認，尚未答覆；不可擅刪、不可繞過復原gate。備份在release clone的apps/worker/.local/approved-deliveries-0066-20261107/preserved-prior-restore65.sql（受ACL保護）。

下一步：收到明確允許後只退役上述舊復原庫；以固定B工具node tools/rehearse-approved-deliveries.mjs --restore產生fresh65備份並遠端獨立復原/升級，成功後--adopt做live parity再只套0066。真正manifest出現後跑release self-test→正常CI→自動B部署→真Owner／獨立Guest核准及固定V3下載、head切換驗收。工具使用隔離Wrangler config；失敗停止不覆寫live。復原優先forward fix；不要將舊snapshot覆蓋新資料，任何回滾先關新flags並保留審計與資產，不能刪歷史換綠燈。

B目前仍是source55af3ca／CI42353228572／deploy42354807451／version616e7a23-cd3f-4738-bc55-82da5c226ad9，schema65。正式候選在.local/oracle-release-20261106；根不同產品變更保全，A／DNS／Review／客戶資料未改，自刪OFF/dry-run、R2優先／Oracle30GB保持。尚未驗新CI／hosted／ZIP通知／負載／實機觸控。

## 2026-11-07 密碼分享已自動部署B並真實驗收

Source55af3ca240a976378c9ef59606363ef8eb142ec0，CI42353228572成功，Actions42354807451自動部署成功，Worker version616e7a23-cd3f-4738-bc55-82da5c226ad9，baseline bot09470f0。沿用原介面與原KDF，三種分享方式保留；系統密碼確為五位數，自訂仍沿用12–256 UTF-16／Unicode／byte限制。附密碼toggle預設OFF，ON在fragment編碼、OFF回復token-only；持完整連結者即可取得密碼。

真Owner只在既有3a21…／94ab…合成相簿建立INV-5917BFF1與INV-54189B8B。獨立Guest先登出舊session，五位數附密碼連結無手動輸密碼即可進入；自訂含Unicode與&/#/+字元，token-only入口錯密碼顯示通用拒絕且無私人照片，輸正確密碼成功，再登出用自訂附密碼連結只填稱呼也成功。兩模式各有4張320×213私人縮圖載入、fragment清除且最終無alert。Owner2次與Guest4次真KDF請求完成，不宣稱hosted CPU數值或壓測。直接DOM密碼值比較曾回false、原因未定；未手動輸密碼的實際登入已通過，沒有把該DOM探針寫成通過。

28單元、26原生B profile組、13攝影師組及完整CI通過；既有browser helper新增toggle ON/OFF斷言已在CI實跑。隔離、期限／撤銷、metadata-only recovery與native KDF釋放保留。證據docs/releases/password-sharing-hosted-acceptance.json與local proof，截圖root .local/password-sharing-{options,toggle,generated-guest,custom-guest}-hosted.png，均不含明文憑證。schema65不變，A／DNS／Review／客戶資料未修改，自刪OFF/dry-run、R2優先／Oracle30GB保持。根不同產品變更保全，正式驗收用B；舊localhost4195不代表本次來源。

下一步依MVP_RELEASE_PLAN完成其餘交付／核准／通知與production cutover驗收；不要重做已通過的密碼分享、65restore或Oracle容量接線。完整MVP仍未完成。附密碼連結應視同密碼保管；未驗hosted負載、CPU／記憶體數值、crash取消、分散猜密碼或實機觸控。

## 2026-11-07 五位數／自訂密碼分享接線：本機通過，待CI與B驗收

沿用既有分享表單、五位數產生器及固定scrypt N32768/r8/p3，僅在B collaboration profile宣告passwordModes:true並開通既有generated_password/custom_password；其他staging／production守門不變。仍限定固定B workspace、enabled Owner、immutable管理見證、單一active album與各自permission。Recovery不重發token或密碼。既有附密碼toggle預設OFF，ON只加入URL fragment；Guest啟動前移除網址片段並預填，custom字元保持原樣，不落browser storage。完整連結持有人即可取得密碼。

28相關單元、strict／scopedlint／product與B profile build、26原生profile組、13攝影師組、release checker通過。Native驗五位數、自訂、wrong/cross-invite401無cookie、非明文verifier、metadata recovery與Owner2/2 Guest5/5 KDF釋放；原隔離／撤銷測試保留。新增既有browser helper的toggle ON/OFF及fragment斷言待完整CI實跑。失敗保留：過早checker使用舊photographer proof；custom回應測試誤預期undefined，合約是null；第二次修正路徑錯未寫入，第三次正確修正後通過，產品驗證未放寬。證據docs/releases/password-sharing-local-acceptance.json。

下一步正常CI→自動B部署→合成相簿真Owner建立兩模式與獨立Guest驗收，確認hosted KDF不超資源限制；若異常不盲重試或清鎖，依KDF_ADMISSION.md。schema65不變、自刪OFF/dry-run、R2優先／Oracle30GB保持，A／DNS／Review／客戶資料不動，根不同產品變更保全。完整MVP未完成。

## 2026-11-07 Managed分享／Guest接線與照片主體燈箱：已自動部署B並驗收

最終source32ee04f577575c88a537413de2522a686b0569c5，CI42285915567成功，Actions42288958762自動部署成功，Worker version d996457b-b637-49d7-b267-f624de4911bc，baseline bot f38193c。第一版d185d1f／CI42281886730／deploy42284130975也成功，但hosted Guest發現disabled shared-review capability404誤報；已修成兩個唯讀能力200 enabled:false，資料／寫入仍不開放。此節取代待CI狀態。

真Owner透過既有GitHub正常刷新登入，在Owner建立見證的3a21…專案／94ab…合成相簿建立INV-44206342分享。獨立IAB Guest免註冊進入，四張私人縮圖320×213均載入，Oracle測試圖預覽1280×853可讀，挑選一張後重載及補丁部署後仍保留；Guest SVG切第二張成功。最終Guest無通用載入錯誤、無alert，期限顯示正常；沒有把bearer、password或session cookie寫入Git／證據。相簿單一link_only分享已接通，密碼模式仍保留原hosted守門，不稱完整MVP。

Owner與Guest上下張SVG保留aria/tooltip，右欄縮窄且可一鍵收合。真Owner測得stage1314.49→1667.11px，hover縮圖opacity0→1且照片rect完全不變，SVG下一張更新photoId並可關閉。側欄預設展開，收合時照片為主；pending禁止收合，保留原草稿與未知寫入保護。觸控常駐／reduced-motion規則與375px原生檢查通過，不宣稱實機觸控驗收。UI在補丁前後來源未變；完整CI包含新增hover／收合／SVG斷言，最終Guest已重載驗收。

本機22單元、26原生B profile組、13攝影師組與既有真草稿browser2組、strict／lint／build／release checker通過。Native已驗跨project／同project未分享album、invite recovery一致、download-only不要求view、撤銷、封存狀態fixture登出；線上無CookieOwner/Guest資料讀取仍401，兩項未開放Guest能力200 false。證據docs/releases/managed-sharing-hosted-acceptance.json，截圖root .local/managed-sharing-{lightbox,guest}-hosted.png。僅合成邀請與挑片測試，A／DNS／Review／客戶資料未修改，schema65不變，自刪OFF/dry-run、R2優先／Oracle30GB保持。

正式來源.local/oracle-release-20261106與私人GitHub已整合；根不同產品變更與舊localhost4195未覆蓋，驗收用B。下一步是hosted密碼分享模式與其KDF／濫用／跨邀請驗收，以及其餘交付／版本核准／production cutover需求；不要重做已通過的managed sharing、65restore或Oracle儲存驗收。完整MVP仍未完成。

## 2026-11-07 Managed分享已部署、Guest實測發現補充能力404；修正待CI

第一版source d185d1fe3e83c6caa46477119f6bcea7e95aa304，CI42281886730及Actions42284130975成功，B version1103ce35-498c-4742-a23a-2c84bbab384a。真Owner重新以既有GitHub登入、在managed Oracle/R2合成相簿建立分享成功，獨立IAB Guest免帳號進入，4張320×213私人縮圖載入且挑片成功。一次性連結只在瀏覽器記憶體使用，不輸出或保存憑證；瀏覽器clipboard橋接讀回空，但頁面已複製提示與提供的訪客入口有效，不宣稱橋接讀回驗收通過。

未標此切片完整驗收：GuestSharedReviewLinks固定讀取shared-reviews capability，collaboration邊界未放行而404，誤顯示通用載入失敗。補放行Guest shared-reviews與version-approvals兩個GET/HEAD能力查詢，兩者仍回enabled:false，資料／寫入路由不開放，Guest不顯示未提供功能。22單元、26原生profile組（新增false能力與POST404）、13攝影師組、build／scopedlint／release checker已通過；UI原始版本desktop hover／收合／SVG／pending斷言已在第一版完整CI通過，不重跑無關本機browser。接續正常CI→自動B部署→Guest重載無誤報＋挑片持續性、Owner/Guest燈箱互動與截圖。

schema65、A／DNS／Review／客戶資料與R2優先／Oracle30GB保持，自刪OFF/dry-run；沒有新憑證或schema。正式來源仍.local/oracle-release-20261106，根不同產品變更保全。完整MVP未完成。

## 2026-11-07 Managed新專案分享與Guest接線、精簡燈箱；待CI／B驗收

沿既有B collaboration profile擴展單相簿無密碼分享：固定B workspace、enabled Owner、project.created／album.created immutable命令見證，非管理資料仍拒絕；邀請create/recovery/revoke、Guest exchange／HTML入口／相簿API／資產／登出同一範圍。Recovery比對payload與live project/唯一album，服務仍檢查session、seal、期限、maxUses、撤銷及獨立permissions。download-only不再被額外can_view阻擋。能力加可選managedAlbums:true供既有分享表單選自己的相簿，單相簿link_only限制保留；不是全域開啟所有模式或租戶。

Owner與Guest燈箱沿用現有元件，SVG上下張保留aria／tooltip、工具欄縮窄並可收合（預設展開以保留操作路徑，pending不可收合）、桌面縮圖列hover/focus顯示、觸控常駐與reduced-motion，顯示不改photo layout。比較模式不顯示收合控制，避免藏掉比較內容。現有pending、鍵盤及網址行為保留；沒有新框架／dependency／schema。

本機最終成品：21單元、26原生B profile組（真managed邀請／exchange／挑片／縮圖、跨專案／未分享相簿／download-only／撤銷／封存狀態登出）、13攝影師組、燈箱註記真草稿／未知write復原2組、strict／scopedlint／build／release checker通過。新desktop hover不reflow、收合加寬、SVG與pending鎖斷言已加入原photo-version-heads browser helper，待完整CI實跑，不冒稱本機已跑。顧問靜態審查指出logout不應要求仍active，已修；隔離封存狀態是DB fixture，不是封存API驗收。

保留失敗：sandbox dry-run讀目錄被拒後elevated成功；首次native登出fixture缺既有requestId，第二次試以非空相簿呼叫archive API被既有守門409，改隔離archived-state fixture後通過，產品守門未放寬。證據docs/releases/managed-sharing-local-acceptance.json。下一步CI成功→自動B部署→真Owner新managed分享、獨立Guest瀏覽／挑片與燈箱互動驗收。A／DNS／Review／客戶資料不動，自刪OFF/dry-run、R2優先／Oracle30GB保持；根不同產品變更保全。完整MVP仍未完成。

## 2026-11-07 Owner協作讀取已自動部署B並真實驗收

Source f9818399921775f56e47cf257d67e39484cf5668，CI42261696602成功，Actions42263958748自動部署成功，Worker version0f258dda-bdc1-4a0a-ba04-656f90e84086，baseline bot db11be3。此節取代下方待CI狀態；schema65、R2優先／Oracle30GB、自刪OFF/dry-run保持，A／DNS／Review／客戶資料未修改。

真Owner在B新managed project驗收：邀請空清單可讀、註記初始化不再拒絕、V1正常，版本核准能力不再冒稱權限改變。在原已授權合成相簿明確選邀請1，V3空留言／註記正常；切V1後讀到既有Guest留言、Guest自由筆畫與Owner自由筆畫及編輯入口。版本紀錄V1/V2/V3與head V3正常，舊queued V2保留；沒有新增留言／筆畫／版本或改head。六個無Cookie讀取端點均401 AUTH_REQUIRED。原生與CI已驗跨邀請／非管理範圍拒絕。證據docs/releases/owner-collaboration-read-hosted-acceptance.json，截圖root .local/owner-collaboration-{comments,annotations}-hosted.png。

Ponytail審查：產品僅修兩處讀取入口，沿用既有Owner/session/workspace與managed command見證、參數化D1服務；不改DB、Guest邊界或寫入服務。新managed專案邀請POST與hosted版本核准寫入仍有原守門，勿把此次讀取修復說成已開通全部Guest分享或完整MVP。下一步處理managed專案分享發行／Guest範圍的最小安全垂直切片與正式驗收；Oracle縮圖處理仍候選。根目錄不同產品變更保全、舊本機預覽未覆蓋，正式來源仍.local/oracle-release-20261106。

## 2026-11-07 已授權Owner協作讀取修正；待CI與B真實驗收

共同根因：managed project已有Owner建立命令見證，但boundary把所有非舊驗收專案的/invites一律404。Owner留言、手繪初始化共用邀請清單，因而一起失敗。現在只讓GET沿既有managed project/session/workspace檢查讀取；非原驗收scope的POST issuance仍拒絕，Guest路由／scope不變。版本清單原服務不變；Owner版本核准capability准予讀取真實enabled:false，不擅自開啟核准寫入。

新增實際隔離managed project＋active album＋R2上傳/Sharp衍生圖＋sealed邀請，驗GET邀請、版本、留言thread、客戶註記及Owner手繪讀取200；錯邀請與未登入拒絕。沿用現有DB服務與參數化scope，不改schema或套件。9單元、26原生B profile組、13攝影師組、strict/scopedlint/build/release checker通過。首次原生因外來邀請fixture引用尚未建立相簿而FK失敗，改用已存在但不同scope的相簿後通過；產品授權未放寬。證據docs/releases/owner-collaboration-read-local-acceptance.json。

下一步：正常CI→自動部署B→真Owner留言／手繪／版本讀取驗收；A／DNS／Review／客戶資料不動，自刪OFF/dry-run、R2優先與Oracle30GB保持。根來源不同變更保全，正式來源仍.local/oracle-release-20261106；完整MVP未完成。

## 2026-11-07 燈箱／處理設定／單列複選歷史：已自動部署B並真實驗收

Source d08f20b920f686398f621248117be4426e505c14，CI42252665080成功，Actions42255098747自動部署成功，Worker version38631e68-2350-4085-a3a0-80f09193fedf；baseline bot fb7edf6。此節取代下方待CI狀態。本次無schema變更，schema65不變；A／DNS／Review／客戶資料未改，自動刪除OFF/dry-run，R2優先與Oracle30GB儲存保持。

真Owner在B驗收：處理設定正常讀取無404，候選radio可選並還原Cloudflare（未儲存新設定）；無編輯且註記讀取404時不再誤報「操作待確認」，可切下一張再關閉回相簿，網址photoId正常移除。既有註記／留言等範圍拒絕仍保留，沒有繞過授權；真草稿與不確定寫入仍由原journal保護，原生測試已驗。

歷史事件單列40px，系統／管理者／訪客checkbox常駐、可複選即時server查詢；系統單選、系統＋管理者複選、全不選的穩定空結果與還原全部24筆均真實通過。進階篩選仍收起，不影響操作者選項；未重下載線上CSV／JSON，實際原生匯出／快照／375px隔離測試與完整CI已通過。兩端無Cookie讀取history／image-processing-policy均401 AUTH_REQUIRED。證據docs/releases/ui-ux-lightbox-hosted-acceptance.json；Ponytail檢驗docs/UI_UX_SIMPLIFICATION_REVIEW.md。

正式來源位於 .local/oracle-release-20261106，已推送私人kinostudio/kino-pick。根目錄五個產品檔仍有不同變更，18個產品來源／本機4196靜態檔均保全未覆蓋；驗收請以B網址為準，不把舊本機頁當本次版本。完整MVP仍未完成；下一步處理現有managed scopes下的協作讀取拒絕與其正式驗收，Oracle縮圖處理仍是候選未接線（儲存溢位已啟用）。不要重做已通過的65restore或Oracle儲存驗收。

## 2026-11-07 燈箱誤鎖／處理設定404與緊湊歷史整合；待CI／B驗收

燈箱：OwnerAnnotations只在loading時以尚未讀完journal作暫時導航保護；error且沒有真草稿／pending／blocked journal時不再誤報待確認。真草稿、待確認寫入與blocked保護保留。原生新增404讀取失敗可關閉，既有精確寫入恢復斷言保留；修正原helper在options送達前就要求更多分頁的競態，現在等實際目標或下一頁按鈕。

B處理設定：exact allowlist補固定workspace image-processing-policy的GET／POST，無query、Owner／session／Origin／workspace服務檢查不變。原生驗讀取、儲存、相同操作重播、跨來源／身分／workspace拒絕。設定頁改全寬卡片／原生選項與開關，技術版本資訊收起，Oracle縮圖處理仍明示候選未接線，R2優先／Oracle30GB儲存不變。

歷史：事件改單列，操作者checkbox外露、可複選即時server query；新增有界actorTypes（最多3、去重拒絕、固定順序、[]明確無結果），保留legacy actorType，衝突拒絕，快照與匯出同套篩選；不是只濾目前頁面。沒有schema或新dependency。

實跑最後成品：20 focused unit、lightbox原生2組、history375px原生2組（CSV／JSON／快照／Owner變更）、photographer13組、B profile26組，rootstrict／scopedlint／format／正式build與release checker self-test通過。失敗與環境／fixture原因見docs/releases/ui-ux-lightbox-local-acceptance.json，不宣稱失敗為成功。Ponytail審查見docs/UI_UX_SIMPLIFICATION_REVIEW.md。Next正常CI→自動B部署→真Owner燈箱關閉／切圖、處理設定與多選歷史驗收；A／DNS／客戶資料不動，自刪OFF/dry-run，完整MVP未完成。不重做schema65restore。

## 2026-11-06 活動歷史正式整合並已部署B

Source 832b22c4cb8a10e7a13f3c5c89b6641ecae4b443（UI功能a17f366；832b22c僅修既有Oracle表格格式），CI42239361510成功，Actions42242718586自動部署成功，Worker version 9ebc58d7-77a6-4f36-a45e-6b41b4dc663b，baseline botf175583。首次CI42239012475因既有Oracle文件格式停止，已修正並保留失敗；未跳過或放寬部署守門。schema65、R2優先／Oracle30GB、原有授權與自刪OFF/dry-run不變，A／DNS／客戶資料不動。

真Owner在B頁面已驗全寬單欄1376px、篩選／匯出預設收起、24筆管理者篩選全為Owner、清除回全部、下一頁24→48、CSV／JSON入口可用。無Cookie明確same-origin請求回401／AUTH_REQUIRED，無私人事件；首次預設urllib得到403，僅作邊緣／前置拒絕，未冒稱應用401。線上未重新下載匯出檔；本機原生375px完整CSV／JSON、快照、串流失敗與Owner變更測試已通過，CI完整通過。證據docs/releases/history-timeline-hosted-acceptance.json，截圖root .local/history-timeline-hosted.png。

已更新正式共用來源，不另建prototype。未知操作保留明細中的原代碼；API、tenant／invite／workspace隔離不變。此歷史UI切片已完成；完整MVP仍未完成，下一高優先仍是燈箱誤報pending與workspace處理配方404，勿重做已通過的Oracle／65restore驗收。

## 2026-11-06 活動時間軸正式整合；待CI與B線上驗收

沿用已確認的簡化UI，正式OwnerWorkspaceHistory採全寬圖示時間軸，篩選／ID條件與CSV/JSON入口預設收起，原操作代碼／來源ID／UTC與安全明細保留。僅history頁隱藏專案側欄，不改API、資料庫、匯出完整性、快照cursor或Owner／workspace／tenant／invite授權。原有browser helper已配合收起狀態先展開篩選及匯出，不減少任何安全斷言。

最小原生驗證：history browser＋outbound0共2組通過，實際375px、51筆快照分頁／新增後refresh、52筆JSON／CSV下載、匯出中斷不產檔、Owner變更清除與重新授權。root strict、scoped ESLint、target build通過。部署所需同bundle photographer13groups與B profile26checks重新生成，release checker self-test通過；schema65不變，既有backup／restore沿用。證據docs/releases/history-timeline-local-acceptance.json。Next：正常CI成功→既有自動B部署→真Owner hosted頁唯讀驗收與收據；A／DNS／客戶資料不動，自刪OFF/dry-run，完整MVP仍未完成。

## 2026-11-06 活動歷史介面簡化（本機驗收）

依使用者標註，正式共用OwnerWorkspaceHistory改全寬圖示時間軸；移除history頁側欄ProjectDirectory占位，設定／邀請頁維持原配置。篩選、進階ID查詢、匯出預設收起，來源ID／UTC時間／原操作代碼與安全明細仍可展開；未知操作主標題改人話「其他操作」，原代碼留在明細。沿用既有API、權限、snapshot、分頁及匯出流程，未更動DB／審計資料。

既有瀏覽器測試同步展開篩選／進階條件並更新未知標題期待；本次未執行整組原生history harness。release clone root strict、scoped ESLint及Vite正式UI build通過（既有chunk>500kB警告保留）。4196真本機API手動驗：系統篩選成功、清除回全部、匯出CSV／JSON入口可展開；本次未下載匯出檔。截圖root .local/history-simplified-preview.png。正式來源與root4196靜態資產已更新；未push／部署B，不動A／客戶資料。Next：使用者驗收外觀，之後合併到B部署前需刷新bundle-bound release證據；不要把本機UI結果宣稱線上已發布。

## 2026-11-06 Oracle overflow 正式線上切片通過；完整MVP仍未完成

B source e6c49e8e84f65d457712a54be7afd776975a304c，CI42193586106成功，Actions42196024894成功，version36e4ed7e-585d-4595-aba5-8bf942ab5aa4；baseline bot88ab0ae。首次部署42195575135在predeploy Cloudflare API503停止，保留失敗；同版正常重試通過，未放寬任何守門。schema65與既有備份復原證據不變。

真Owner重試新c679工作成功（attempt2），再以受控R2 logical cap上傳全新KINO_ORACLE_AUTO_ACCEPTANCE_20261106.png，Oracle原圖／Cloudflare縮圖與預覽自動成功（job02f80ab3…attempt1）；結果後立即CAS＋審計還原R2 9GB，requestcb79f2f3…狀態restored、primary metrics保留。原6376工作最後attempt3亦正常成功，沒有operator改寫product slots。四筆合成job全部succeeded／reserved0；Oracle帳本71673bytes、R2 9051458bytes，兩節點active／reserved0；policyrevision1／command1／30GB／floor20GB。先前真R2恢復優先上傳保留，現在R2各3資產再次驗節點。

兩組fixed合成照片唯讀D1各6資產，changed_db=false／rows_written0。舊與全新Oracle各3物件實際GET size＋SHA全部匹配；original16336、thumbnail547、preview7008。正式Owner瀑布流四縮圖natural320×213、全新Oracle預覽1280×853皆載入，截圖保存在root .local/oracle-hosted-final-{gallery,preview,settings}.png。公開證據docs/releases/oracle-hosted-overflow-acceptance.json，含本機證據雜湊、不含憑證或原始請求。cache:no-store已經hosted修復驗證；冷HEAD轉GET是合理根因推論，仍未直接觀測Edge改寫。

R2有足夠原圖＋16MiB預算即優先R2，不足才Oracle；已存在VM照片不自動搬回，容量擴充不是備份。自刪OFF/dry-run，A／DNS／Review／客戶資料不動。30GB實體near-full、VM重開機、filesystem實體擴大與Guest Oracle完整E2E未驗。

Next最高優先：修正Owner燈箱未編輯仍誤報pending而鎖住關閉／導航（兩tab已保留，不清journal），以及workspace處理配方404；新PNG安全tail另有PHOTOGRAPHER_METADATA_IMPORT_FAILED，衍生圖已成功但不可宣稱metadata匯入成功。既有相簿留言／版本確認／註記在此新合成managed scope仍有不可用提示，屬後續正式功能驗收。完整MVP未完成；本次Oracle儲存切片完成，不再重做已通過65restore或四筆上傳。

## 2026-11-06 修正私人SigV4請求快取；HEAD改GET仍屬待hosted驗證推論

C8分類版：c8f5ccc／CI42189031679／Actions42190870619成功，version60348755-8173-4abf-8958-4c45558a0b7f，baseline botc7ea731。新合成KINO_ORACLE_DENIAL_ACCEPTANCE_20261106.png原圖上傳完成，jobc67969ea-9bd1-4773-a321-99a548a8a7d7實查attempt1／retryable／16MiB；phase thumbnail_write收到403，分類OTHER_RESPONSE／NO_S3_CODE／CF_RAY_PRESENT／SERVER_CLOUDFLARE。R2 cap51431104…已立即restore9GB並保留primary metrics。

重要更正：舊job63761339…第二次重試後preview7008實際已存在，thumbnail547也存在；所以write階段包含PUT後的HEAD，不能把此前403直接稱為PUT被拒。DNS A=161.33.30.210、AAAA無紀錄；local Node／workerd相同preview bytes寫獨立key成功。Cloudflare官方明載cold HEAD對可快取資源可能轉GET；這與SigV4綁定method相衝突，是目前有證據支持的推論，尚未直接觀測Edge改寫。不能僅憑server/cf-ray就認定A防火牆阻擋，未改A安全規則。

最小修正：S3 request增加cache:no-store，覆蓋HEAD/GET/PUT私人簽名資料；manual redirect、checksum、conditional write、404/412/304處理不變。既有compat日期已支援，不增flag。403額外只記固定HTTP method，便於辨別PUT與HEAD。13項unit驗最終aws4fetch Request的cache，rootstrict／scopedlint／target build、photographer13groups、B profile26checks及release checker self-test通過；actual local workerd對既有preview只做HEAD，cache:no-store／200／7008bytes。此read-only operator的舊顯示label沿用created，但outbound僅1個HEAD，不能解讀為新增物件；raw log保留。不是hosted修復證明。

Next：正常CI→B部署→先重試較新的c679工作，成功後驗fresh Oracle完整自動縮圖（cap後立刻restore9GB），再使用舊6376最後第3次。舊job實查attempt2，禁止盲目消耗最後機會。原圖／版本／審計保留、schema65不重做restore，自刪OFF，A／DNS／Review不動。獨立診斷小物件保留在_kino/probes供核對，不占product slot。

另：舊只讀燈箱tab1650469677在長時間媒體下載後顯示Owner pending而關閉disabled；本代理未做標記編輯，未清除任何可能journal，保留該tab handoff。新tab1650469679用於上傳驗收。此UI問題與工作區配方404仍待後續，不宣稱完整MVP完成。

## 2026-11-06 線上阻點確定為preview PUT403；保留舊工作最後重試

0eca0f7／CI42164555235／Actions42166043202成功，versionc58c40ae-1213-432c-be69-39030902e771，baseline botc505250。真Owner按新『重試縮圖』一次，job63761339…仍retryable，預期attempt2。安全tail已捕捉S3_STORAGE_HTTP_403＋IMAGE_PROCESSING_FAILED／preview_write；不再盲目重試此job，保留第三次機會。

原圖16336／SHA0ed3…與縮圖547／SHA654cf9…皆可讀；正式R2同來源preview7008／SHA7a8258…已透過可見Owner燈箱取得（browser媒體下載等待異常延長，未重複嘗試）。相同7008bytes透過Node與local workerd實際S3 adapter寫獨立私人診斷key都200，不能拿此當hosted成功；productpreviewslot未被operator改寫。VM storage／timer／Review／Caddy active，無signature/error log；Caddy未啟用HTTP access log，無既有請求記錄可分類，未修改設定。A/DNS/Review均不動，R2仍9GB。

下一版只補S3 403的最多4KiB錯誤body分類：固定HTML/XML/other、六個S3 code白名單（含constructor防護）、cf-ray存在性與server分類，不記原文／URL／headers／keys。13項S3 focused測試通過；標準建置、root strict、13groups photographer與26checks B profile、release checker self-test通過。Next：正常CI／B部署後，以新合成上傳工作收集分類（不要消耗舊job最後attempt）；R2 temporary cap結果後立即restore9GB。403來源尚未確定，不能關安全規則、移除checksum/conditional write或宣稱MVP完成。

## 2026-11-06 B Oracle原圖直傳已驗；補既有工作精確重試與安全階段日誌

f708825／CI42159596204／Actions42161310874成功，versiond97eef49-7dea-4f5e-86c8-5c4495a527af，baseline botf4588d8。真Owner頁面reload後，單張KINO_ORACLE_HOSTED_ACCEPTANCE_20261106.png已完成Oracle PUT／completion。受控R2 logical cap25828674（不是實體滿載），request6ec4d26b…；上傳結果出現後已CAS＋審計立即還原9GB，primary metrics保留。先前4999fdeb…新上傳回R2證據仍保留。

Oracle job63761339-33c5-4f71-a83f-84ae84379aab目前retryable／PROCESSING_IO_UNCERTAIN／attempt1，保留16MiB預留。原圖真S3 GET16336bytes／SHA0ed3…匹配；thumbnail已存在547bytes且NodeHEAD/GET checksum匹配，preview不存在。本機actual workerd direct GET同縮圖547／SHA654cf9…成功；後續guarded bridge helper失敗，不能宣稱bridge護欄已驗。尚未定位根因，不能宣稱Oracle完整縮圖圖庫或全MVP完成。

KISS新增Owner精確photo/version processing-retry：沿用既有Owner/session/版本SQL授權，只允許retryable／Cloudflare recipe／epoch<3／active node／非archive；POST空body＋Origin＋CF flag／IMAGES守門，B仍驗managed scope，Guest不開放。復用原job claim/lease、immutable conditional write、讀回與processing審計，不新建上傳、不改schema。圖庫只對Owner retryable照片顯示SVG『重試縮圖』，pending防連點、嚴格回應與刷新，不提供放棄/刪除操作。固定phase日誌不含job key／URL／原始exception；S3只額外分類subrequest limit，不把通用錯誤當排除限額證據。

實跑：focused4files39tests、原生processing recipes10checks（新增Owner/foreign/version/第三次人工審查守門）、B profile26checks、photographer13groups、正式UI/Worker dry-run build、root＋Web strict、scopedlint／format與release checker self-test通過。先前兩次local release self-test因新bundle/新boundary對舊本地proof hash拒絕，已跑原生工具重新產生證據後通過，未放寬守門。Next：此變更正常CI→B自動部署→安全tail只看固定phase→真Owner按同照片重試→核對原圖/縮圖/預覽與兩個節點；R2保持9GB、不重做65restore。A／Review／DNS／客戶資料不動、自刪OFF。

## 2026-11-06 Owner 切回分頁驗收同步修正

8ad7896 的 CI42157936395 於既有 Owner 回覆刪除確認失敗，未部署該前端版本。測試切回 Owner 後在快取的較後頁找到回覆便開始點擊，背景 focus 重新讀取第一頁會替換清單。現在先等待同 scope、切回後的已送達第一頁及載入狀態結束，再用既有分頁 helper 找回回覆；刪除確認、revision、Guest 隔離與 append-only 審計斷言不變，沒有改產品程式。

集中原生 D1/R2/Sharp/375px Chromium exit0，Owner 留言、處理及 outbound0 共3組通過，log SHA256825f664d5d0a4590fee70dac4a14b225f423a9abb67468fcf5720a84f42da103；scoped lint/format 通過。這不是 hosted Oracle PUT 驗收；B仍7f54d93／version59cc383f、Oracle已啟用30GB，R2維持9GB。Next：正常CI及B自動部署，reload前端後驗真Oracle PUT／縮圖及立即還原容量cap。A／Review／DNS不動。

## 2026-11-06 Oracle30GB已生效，R2恢復優先已驗；最後補前端Oracle PUT白名單

7f54d93／CI42153519040／Actions42155770338完整success，version59cc383f-e5be-41a4-aee2-c4c48adec413，baseline botdb1b365。真Owner以原指令完成同步，頁面顯示Oracle容量擴充已生效30GB、floor20GB；schema65不重做。

受控R2邏輯額度cap25804783（不是實體滿載），唯一Oracle session e77789d4…確實reserved／authorized，但前端putUploadFile僅允許R2 host而在fetch前拒絕drive.kinostudio.tw。真S3 HEAD確認無物件，瀏覽器無PUT／CORS錯誤；立即CAS＋審計還原R2 9GB且原metrics保留。Owner正常取消該測試工作，Oracle reserved回0，歷史保留。之後KINO_R2_RETURN_ACCEPTANCE_20261106.png真Owner上傳成功，session4999fdeb…node primary／completion1，私人圖庫1張，證明恢復R2額度後新上傳會回primary。

僅9行前端allowlist補固定HTTPS drive.kinostudio.tw＋kino-pick-overflow非空key，不開一般HTTPS、不動現有R2／loopback／userinfo／fragment／port及credentials omit、no-referrer、瀏覽器redirect:error。子代理focused14測試（含原R2／AbortSignal）及scopedlint／format通過；主代理審查與更新後baseline release self-test通過。Next：此UI修正CI→B自動部署→必須reload上傳頁載入新bundle→保留舊cap/restored計畫證據，再fresh cap／完整Oracle PNG＋縮圖／預覽→立即restore9GB→核對兩張各3assets節點與SHA。A／Review／DNS不動，自刪OFF。證據docs/releases/oracle-browser-upload-boundary.json。

驗收工具兩項本機修正（不改Worker／DB）：JSONC用既有TypeScript parser；預留數只算尚未完成或孤立紀錄，不能把104筆永久歷史當活躍預留。實際aggregate：held bytes0、unresolved0；SQLite self-test保留V1/V2／取消／過期歷史，真active／orphan及CAS不符仍拒絕。第一次JSON parse及歷史count preflight均停止在cap前，未改資料。

## 2026-11-06 後續schema65部署收據相容性已補齊

66f5342（Workers manual轉址修正）完整CI42149196022成功；Actions42151990068在self-test PRIOR_RECEIPT_RESOURCES停止，未寫Worker。原因是原prior收據白名單僅59–62，且後續live／secret證據仍綁首次e6→兩secret過渡。沒有改寫既有收據或放寬備份／授權驗收。

現在明確分兩種baseline：首次仍驗原secret-only全快照；既有65則須完整固定B／8secrets／65 migration hashes／獨立restore hash及parity／native admission證據，歷史secret transition整塊精確鏈結並持續保留原anchor；live必須是最近成功prior的deployment、100%單一version、source message及latest uploaded。當次D1／policy-chain／R2私人／無Cron與安全守門全保留。legacy62 positive、65 positive及錯B／少secret／restore錯誤／native migration錯誤／history斷鏈／舊版本與未核准latest等反例self-test通過，scopedlint／format通過。顧問唯讀審查無新增阻擋。

以既有B OAuth只讀實際CF metadata，新live分支也驗過目前3832118／version37e159cf／deployment837ef4a5；初次raw token過期401，經Wrangler例行刷新同授權後成功，未擴權。CI最後新增同一local-evidence self-test，避免CI綠後才發現本地收據不相容。證據docs/releases/oracle-repeat-deployment-compatibility.json。Next：新source CI→B自動部署→原Owner指令同步→VM／R2回優先線上驗收。B仍383／requested1但effectivefalse，R2未調低；A／Review／DNS不動。

## 2026-11-06 已重現Oracle根因：Workers不支援redirect error

S3 adapter使用Fetch標準redirect:error，但Cloudflare官方Request文件明載Workers僅支援follow／manual；error於Request建構即TypeError。實際adapter編譯至相同日期workerd後，舊版health讀取503且outbound0，證實失敗在外連前；Node相同簽名能讀與VM無請求錯誤的現象一致。

最小修正共用request改manual，明確拒絕3xx轉址、保留304條件讀取及404／412語意，不轉送簽章到Location。相同native adapter改後read200、302拒絕、總outbound2且沒有Location請求；focused10測試通過（含6種3xx、304與安全診斷），scopedlint／format通過。證據docs/releases/oracle-workerd-redirect.json。6790ae4僅診斷的CI已由本修正取代，正式B仍3832118／policy1／effectivefalse，原9GB未調低、hosted上傳未驗。

Next：此根因修正完整CI→B自動部署→真Owner以同requestId完成同步→受控R2不足轉VM→立即還原9GB再驗下一筆回R2。A／Review／DNS不動，65復原不重做、自動刪除OFF。隔離release clone仍為本次可發佈來源；原工作樹其他髒變更不納入。

## 2026-11-06 B自動部署成功；Oracle已要求啟用，健康同步待診斷

3832118／CI42145303014／Actions42146981782完整success，version37e159cf-6f2f-48c6-86e2-64a1894ce6f5，baseline bot6d38835。既有schema65／13guards／8secrets／私人R2／A隔離守門通過，workers.dev已開且真Owner可用。未重做65復原。

真Owner以既有介面啟用30GB，D1 requested1／revision1／唯一command1已提交，但publishVmPolicy及health讀取失敗，health表0rows；原requestId重試仍待確認，保留原操作，不新發指令。系統按設計effective=false；R2原9GB未調低、未嘗試VM上傳。本機同憑證之真S3 adapter可讀policy39bytes／revision1與fresh mounted健康126bytes／30GB，VM儲存／timer／Review API／Caddy active；B到VM的共同讀取路徑仍待定位，不能宣稱已開通。

已補最小安全診斷：Owner健康／policy失敗只記phase與最長100字的內部enum，S3只記HTTP status；不輸出原始錯誤、網址、headers、body或憑證，generic UI及fail-closed不改。兩檔focused9測試與scopedlint／format通過，含私密字串與超長值遮罩、錯誤不吞掉。下一步此診斷正常CI／B部署→安全tail同requestId→修正確切問題→hosted VM／R2回優先；A／Review／DNS不動、自刪OFF。證據docs/releases/oracle-hosted-sync-pending.json。

## 2026-11-06 完整CI通過；部署schema清單資料形狀修正

01d6cf8／CI42141264599完整success。自動Actions42144701474通過前置原生測試及復原雜湊自我檢查後，在LIVE_ORACLE_SCHEMA停止，尚未寫Worker。唯讀程式定位：queryD1回傳{type,name}物件，常數則為[type,name]陣列，原直接deep equality必然失敗。現在共用validateOracleSchema只將實際row轉成二欄陣列，SQL篩選、排序、八項exact equality不變；self-test新增真API形狀通過、缺項／錯type／錯name拒絕，全部舊守門self-test與scopedlint通過。不是放寬schema或移除守門；schema65採用／復原不重做。

本機隔離Wrangler whoami正確B且列d1 write，但只讀query回7403；未擴權或輸出憑證，原因仍待核對。Actions既有B憑證能執行query並到清單比較。公開證據docs/releases/oracle-schema-shape-check.json。下一步新source完整CI→B自動部署→Owner30GB及hosted VM／R2回優先；B目前仍e6／requested0，A／Review／DNS不動。

## 2026-11-06 Owner 留言驗收等待實際完成，集中測試通過

233156b／CI42136258344於Owner reply刪除確認測試失敗，未部署。根因成功edit的target read先於最後身分核對與journal清除，測試隨即開Guest分頁造成blur，使原操作按設計保留。共用helper現在等同一Owner／album journal確實清除後才執行後續操作；刻意pending／stale測試不加入等待，產品權限、審計、重試與guard不改。另略過已在目標版本的重複selectOption，避免合成change清空thread卻不觸發版本effect。

集中原生D1／R2／Sharp／Chromium runner exit0：Owner留言、留言處理與outbound0共3組；Guest API前置驗證4個ready且已發布版本，保留原comparison options>2與同邀請／跨邀請UI斷言。先前fixture未發布版本等失敗log保留，不列通過。scoped ESLint／Prettier通過；公開證據docs/releases/oracle-owner-comments-reconciliation.json。

下一步此修正完整CI→自動部署B→真Owner啟用30GB與hosted VM／R2回優先。B仍舊sourcee6、requested0；schema65復原不重做，A／Review／DNS不動。

## 2026-11-06 完整CI通過，自動部署在原始SQL雜湊守門停止（尚未部署）

2216d64／CI42132445238完整通過，含燈箱與Owner處理恢復修正、recipe及所有後續隔離檢查。自動觸發Actions42135465840；所有native前置驗收通過後，self-test在ORACLE_RESTORE_MIGRATION_HASHES停止，未寫Worker。根因0065已採用檔案含單一CRLF，但原.gitattributes將Git blob正規化LF；Windows工作樹raw783626…符合既有復原證據，Linux checkout raw80b5…不符合。

最小修正：只對0065設定-text及whitespace=cr-at-eol（承認既有CR為換行，其他空白規則不改）並明確git add --renormalize，將原已採用bytes原樣入Git，沒有修改SQL語意／manifest／checker。第一次一般git add沿用舊index，獨立hash斷言有失敗並停止，之後renormalize後index內容SHA256確實等於78362649605fbe19d66af6ea23813117c8892cee27ec4a8e3273e03f56f2c40b；63／64仍text auto+LF。原守門self-test通過。公開證據docs/releases/oracle-migration-byte-packaging.json；schema65不重做採用或復原，A／Review／DNS不動。

下一步此封裝修正完整CI→B自動部署→真Owner啟用30GB及hosted VM／R2回優先。B仍舊sourcee6、requested0；獨立驗收相簿94abb620-6422-4e3d-9071-12f43394ac62保持空白未分享。

## 2026-11-06 燈箱修正已越過CI，Owner處理測試需等待實際reconciliation

2cd7a2e／CI42130729104已通過新增燈箱commit時序驗收，後於comment-processing-browser.mjs:408因『標記處理中』disabled失敗；完整CI仍未通過、B未部署。唯讀定位：lost receipt相同UUID重試後，helper只等thread read及『有一筆…尚待確認』文案不存在；sending=true時文案會換成『正在傳送原操作…』，不代表最後/me複核及finishOwnerCommentIntent已完成。隨即blur/focus可能令uiStillCurrent失效，按設計保留pending journal，後續新操作鎖定。

僅在Guest edit／blur前以bounded expect.poll等同一owner／album sessionStorage journal實際清除；不改產品、不延長timeout、不移除stale／API payload／單次命令審計／CAS斷言。scopedlint／format／syntax通過，本機整套未重跑；完整驗收交由新CI，不把靜態定位列為新的runtime通過。舊失敗log保留。下一步仍完整CI→自動部署B→Owner30GB與hosted VM／R2回優先；schema65不動，A／Review／DNS不動。

## 2026-11-06 修正真實燈箱分頁鍵盤競態；待完整CI與B部署

bdcd6f1／CI42128802868在processing.mjs的cursor page剛追加後按ArrowRight仍停首張；不是recipe回歸。album-gallery的moveLightboxRef原在passive useEffect更新，DOM已顯示新照片但鍵盤仍可能用舊readyPhotos。集中processing-only runner以原生D1/R2/Sharp及375px Chromium重現：在下一張disabled→enabled的DOM commit以MutationObserver立即發一次ArrowRight，舊effect確實失敗；僅將該ref同步改useLayoutEffect後同一runner exit0／18檢查（含outbound0），保持原生方向鍵／photoId URL／Escape焦點與配額審計斷言。不加延遲、不移除測試、不改安全guard。

公開證據docs/releases/oracle-lightbox-cursor-commit.json；舊失敗log與新成功log均保留。目標build、Web strict、scopedlint通過，完整CI待新推送；B依然sourcee6／schema65／Oracle requested0，不重做復原。真Owner UI已建立獨立KINO_ORACLE_CAPACITY_ACCEPTANCE_20261106專案3a21aa9e-82d2-4f5a-a71f-deb9dac86828、啟用相簿94abb620-6422-4e3d-9071-12f43394ac62（0照片／未分享），待部署後VM／R2回優先驗收，A／Review／DNS／原有相簿不動。

## 2026-11-06 完整Cloudflare階段通過；recipe歷史fixture相容性已修正

7c2e910／CI42124508470已實際通過完整test:cloudflare與隔離auth，後續processing-recipes因schema54 fixture呼叫最新版schema65 HTTP admission而503，整體CI仍失敗，B未部署。現將fixture建立限用既有D1UploadRepository的primary預設，真正54→55 populated／故障rollback／rowhash／FK證據保持；56後補齊所有正式migration才切回最新版HTTP上傳，沒有假的view或放寬產品guard。移除不必要的Guest下載fixture。因repository具有TS parameter properties，改用獨立Vitest wrapper/config（不混入build前unit suite）。第一直接Node嘗試strip-only失敗保留，不列通過。

集中第二次Vitest exit0，10個真本機D1/R2/Sharp/API/375px檢查通過；provider是Sharp-backed mock Images，非雲端Images。公開證據docs/releases/oracle-processing-recipes-focused.json。root strict／scopedlint／format通過；下游upload20、Guest19、photographer13隔離檢查通過，activation13、collaboration26亦通過。activation首輪因獨立bindings漏填CLIENT_ACTIVITY_ENABLED、defaulttrue導致wrapper先回503，已僅補與部署config一致的false；保留真56→57 migration／rollback13群組且重跑通過。各結果docs/releases/oracle-downstream-focused.json，失敗log保留。未重跑本機整套、未重做65復原。下一步修正推送後完整CI與自動部署B，再Owner啟用30GB與hosted VM→R2回優先；A／Review／DNS不動，Oracle requested0，不得宣稱上線。

## 2026-11-06 改以集中式原生驗證，剩餘18群組通過；整體CI尚待重跑

CI42118739118已通過評分／收藏、挑片上限、共用挑片，後因inheritance helper要求「專案預設」工程標籤失敗。實際Guest有挑片權限，畫面正確顯示本次上下限；已改驗可讀文案／上下限，並另外驗刷新後API source=project與maximum，沒有將來源正確性降級為只換字樣。針對性domain6測試通過。

已停止逐條重跑整套：ignored focused runner重用既有Miniflare／syntheticOwner／小PNG，實際跑繼承、matching-rules與Owner歷史。首版抓到schema65每筆queued metadata保留16MiB，1,001筆超出舊fixture配額；內部failedGroups不算通過（原Vitest包裝banner曾誤顯示pass，已改aggregate失敗直接throw）。集中第二次exit0／18群組／failed0／outbound0，含1,001筆完整metadata歷史與375px規則UI，證據docs/releases/oracle-remaining-ui-focused.json及clone .local/oracle-remaining-ui-focused-second.log。

正式test local-smoke僅在後段大量metadata/index benchmark前，將該ephemeral primary及gallery workspace最低quota設64GB；前段9GB配額邊界測試原樣保留，不改guard、pending預算或job狀態。這不是64GB物理上傳，B的R2 9GB／VM30GB與資料皆未改。新schema沒有變，不重做65復原；A／Review／DNS不動。下一步集中修正推送→完整CI與B自動部署→真Owner啟用與hosted VM/R2回優先驗收；目前B仍舊sourcee6、requested0，勿宣稱已上線。

## 2026-11-06 CI42116040580 通過歷史與版本管理後停在舊初始讀取次數

01b1022 的CI通過歷史撤權與Owner版本控制，之後guest-feedback-browser.mjs:388仍假定2次album access；實際現在是回饋、下載、期限顯示及預設背景瀏覽紀錄各1次，共4次。已核對四個caller與fixture flags，將讀取次數改4，評分／收藏仍限各1次批次及每批1–24筆，沒有改產品。另補matching-rules helper在專案goto/reload與成功／衝突／同UUID重試造成整頁更新後開啟既有「專案進階設定」；CAS、identity、recovery與歷史斷言全保留。matching-filename-index helper已會開「進階相簿整理」，未改。scoped syntax／format／lint通過；完整CI仍待下一版，B未部署且requested0，schema65不動，A／Review／DNS不動。已保留失敗log，不重跑已接受備份復原或本機全套。

## 2026-11-06 CI42111866894 通過入口後停在歷史頁舊撤權提示

目前 aa1a5d0 的完整CI仍失敗，沒有部署。Chromium安裝曾因Ubuntu字型下載耗9m37s後自行完成；瀏覽器／Cloudflare整合已通過訪客入口、新建分享與留言恢復，之後 guest-history-browser.mjs:423 仍預期舊「工作階段已失效」文案。已將該斷言對齊實際generic alert，保留401、舊24筆紀錄清除；另修selection-policy-inheritance舊未開放提示為提示及送出按鈕皆不存在。標籤helper本就先開Lightbox，19/20→20/20等來源符合，未改；其runtime仍由後續CI驗證。只有測試與交接變更，scoped格式／lint／syntax通過。新CI成功前仍不啟用B分流，不改A／Review／DNS、schema65不動，不重做復原與本機整套。

## 2026-11-06 CI42107886933 停在舊訪客入口文案，B未部署

ca4b117 的CI已通過分享邀請建立／不確定結果重試，隨後 guest-entry-ui-browser.mjs:503 因仍要求暴露停用原因的舊文案失敗；失敗log保留於受控clone apps/worker/.local/ci-42107886933-failed.log。現僅修測試：四處入口提示對齊generic denial／完整連結提示，並將select-only「未開放送出」改驗提示不存在；原無POST／無session／原UUID／cookie與秘密保護、送出按鈕缺席／仍可選片斷言保留。產品不改，scoped格式／lint／syntax通過，另補版本設定helper在停用初始頁與成功重試重新載入後展開專案設定，保留可見／CAS／審計斷言。selection-policy、shared-review雙端與Owner history的靜態核對未發現確定過時定位器，runtime仍待CI。完整結果待新CI；不再重跑本機整套，A／Review／DNS不動，schema65／Oracle requested0。下一步仍是完整CI→自動部署B→Owner啟用30GB→hosted VM上傳／縮圖與R2回優先。

## 2026-11-06 比較模式留言撤權回呼修正

本機 run16 失敗定位到真實接線缺漏：GuestVersionComparison 內 GuestCommentsPanel 未傳既有 onUnauthorized，401 後留言面板隱藏但私有比較燈箱未清除。已補單一 prop，與相鄰註記面板一致；不改409重試或舊generation guard。保留 run15/run16 失敗證據及整個燈箱必須清除的斷言，不能只換字樣。新版 dry-run build、Web strict、scoped lint／format 通過；run17 已實證401會清除整個燈箱／私有圖庫，並提供相簿「重新載入」；驗收補上重新載入此相簿再恢復原操作的必要步驟，完整結果仍待CI。前一10a9f42／CI42105215394不應視為最終通過版本；後續CI必須驗此修正後SHA才可部署。B分流仍關閉，不改A／Review／DNS。

## 2026-11-06 Oracle corrective release — CI 尚未通過、B 分流仍關閉

目前私人 main 為 9e61a147a147fa0339c26c68465981d5c0079ac3，CI42086340827 因既有 UI 驗收步驟不符新版相簿導航失敗，尚未部署此版；B 仍 sourcee6d4d68／secret-only versioned43c23d-ae6c-4b73-b5d8-d1916a180e37、schema65、Oracle requested_enabled0。不要將本機通過或實際 VM 測試誤報為 hosted 分流已啟用。

修正於受控 .local/oracle-release-20261106：驗收 helper 沿用正式相簿卡片、燈箱與隱藏無權限操作的流程，保留 API／資料庫／隔離斷言；另修正邀請撤銷誤傳短顯示編號（API 恢復完整 UUID）、選片 SVG 攔截點擊、批次留言成功後收合而隱藏結果。Oracle OFF 且 R2 已滿維持既有 409 配額錯誤。部署 checker 接受具有完整 Owner 命令／審計鏈的已啟用設定，並驗正確 numeric0/1 result。root strict、完整 lint／format 通過；實際批次留言成功可見已驗，401 後同一請求恢復與後續頁面完整驗收於 run16 執行中，先前15次失敗 log 均保留，不計為通過。不要推 root 全量 dirtytree。

VM 已實際採用內層檔案系統可用空間 guard，保留512MiB scratch；5個 stdlib 單元測試通過。實際小量 scoped vacuum 回收5,251,072 bytes、存留 SHA 不變，再回收1,052,672 bytes，最終兩個零位元 fence，Review／Caddy 等6服務 active。首次非同步刪除未完成導致的失敗及同一 job 恢復證據均保留。公開證據 docs/releases/oracle-filesystem-free-guard.json、oracle-physical-reuse-small.json；這不代表30GB近滿容量／重開機／擴容驗收。

下一步：選定 corrective commit 推送，CI 與本機 run16 並行；完整 CI／既有 gate 通過後自動部署 B→真 Owner 啟用30GB→隔離合成照片驗 hosted VM／縮圖／私人圖庫與 R2 回優先。不要重跑已接受65備份復原；不改 A／DNS／客戶資料、Review，自動刪除 OFF。暫時配額模擬僅能於部署完成後操作且必須恢復9GB，不得跳過 gate。

## 2026-11-06 Oracle 容量登記與隔離部署驗證完成

B 已採用 schema65；備份、獨立復原與舊146表3035列保全已通過，不重跑。平台 Owner 指定工作區 bd927a6d-d5d3-4743-bbae-e4560cdda4c7 已由系統審計將總額度9→39GB，固定 oracle-vm 節點30GB／used0／reserved0已登記，其他租戶額度不變；公開證據 docs/releases/oracle-storage-capacity-bootstrap.json。Oracle policy requested_enabled仍0，網站分流尚未啟用。

受控 release checkout .local/oracle-release-20261106 已完成產品／profile build、攝影師13群組、schema65協作26群組與checker self-test；新案例驗公開背景統計能力、平台Owner設定可讀及非平台Owner拒絕。測試曾誤用status()而未解析JSON，已改用現有json() helper後通過；保留失敗log，不列為產品故障。下一步必要型別／格式檢查、選定變更推送、CI與B自動部署、真Owner啟用及hosted驗收。不要推全foundation dirtytree、不向GitHub存Oracle金鑰、不改A／DNS／Review，自動刪除OFF。

## 2026-11-06 B 授權恢復與 schema65 已採用

B最小OAuth五scope已恢復且限定B；freshbackup、獨立restore/63–65升級、freshliveparity及B採用全通過，舊146表3035rows保留，B現152表3039rows/FK0。Oracle兩項Secret僅存B，程式/設定/入口資產不變的secret-only新baseline為ed43c23d-ae6c-4b73-b5d8-d1916a180e37，source仍e6d4d68。網站Oracle分流仍未啟用；Ownerworkspace39GB明確授權投影、node註冊、受控CI/部署與hosted驗收待續。詳HANDOFF及docs/releases/oracle-storage-0065-restore.json、oracle-secret-stage-baseline.json。不要重問B登入，不重跑已接受restore，不推全dirtytree。

## 2026-11-05 — Hosted acceptance caught outer-profile routing regression; hotfix ready

Source6b5f41f CI41900526273 fully passed; auto-dispatch41903699008 and deployment41903718393 succeeded. B versionf83ffd5b-9da2-47a7-9702-c4a39915c9a6/deploymentcbbacb65-296e-4d92-8673-791d12d19cd9 is live, schema61. Hosted real Owner successfully created project62fcddb5-9bbc-4745-a35c-ff5a68a9ac21 named KINO_DELETE_ACCEPTANCE_20261105, but its albums page failed: outer tools/staging-collaboration-validation-worker.ts still called the static fixed-scope route shape and omitted DELETE. Do NOT claim this source passed hosted Owner creation workflow or storage reclamation. No hostedalbum/photo/deletion yet; preserve and reuse this project.

Hotfix changes only structural UUID route targets in the outer profile, adds DELETE with Origin enforcement, and leaves authoritative inner managed D1 witnesses intact. New actual wrapped-native flow traverses projectcreate/read,albumcreate/list,preview,foreignOriginDELETE403/nojob,correctemptyalbumDELETE/completedjob,projectDELETE/404; Ownerforeign404 and allGuestdenials retained. Focusedprofile25 passed (.local/manual-delete-wrapper-integration.log). Gatechecklist nowrequires25 including this flow. Root strict/scopedlint/format passed; source needs a new CI/automatic B deployment then hosted continuation. Schema61 is unchanged: do not redo or mutate the already-adopted migration/backup.

## 2026-11-05 — Manual storage reclaim and managed Owner creation; B61 adopted, deployment pending

User clarified deletion must reclaim real R2 payloads, not just archive/empty content. Implemented immutable creation-command managed scopes in the existing workspace, strict tenant/foreign/invite denial, native manual deletion jobs/items, preview+exact-name confirmation, bounded retries, zero-byte ETag-conditional permanent fences and exactly-once quota/audit. All albums must finish reclaim before project tombstone deletion. No workspace deletion, automatic cleanup, new Guest scope promotion or production bucket cutover is claimed. See docs/MANUAL_STORAGE_DELETION.md.

B source D1 now schema61: fresh backup SHA25665e5887902db81ab1e93f638c90a1e3a1dd0e7a29b940356be4d503aa14af9b7, distinct drill e94143eb-fa9a-44db-9240-73c09264022d; old144tables2997rows/schema/sequences preserved, FK0. Source after61 has146tables2998rows. Private proofs apps/worker/.local/manual-delete-0061-20261105, nonsecret releases/manual-album-deletion-0061-restore.json. Initial backup attempts stopped at an ACL identity mismatch before export; ACL now grants only the sandbox runner and AERO15/Aaron. No cloud payload deleted; no A/DNS change.

Native schema/API/photo-pin3 groups passed, managed boundary8, historyprojection14, root strict/scopedlint/format and target build passed. Real local R2 V1/V2 six asset payloads11276bytes→0, stale immutablePUT denial, audit-failure recovery and exactly-once ledger accepted; .local/manual-album-deletion-native-proof.json binds migration/runner/core source hashes. Local focused collaboration24 on61 and photographer13 passed. UI4191 actual creation/project/album/preview passed; permanent UI confirmation was not clicked. Old helper's direct reversible deleting-state mutation was replaced by asserting the new immutable guard and using archived state for Guest denial.

Known blockers: any live approval request, active Guest/recent human view, pins/holds, unexpired grants/reservations, and every nonsucceeded processing job conservatively prevent manual cleanup. queued/unsupported cancellation and orphan reconciliation remain required. No automatic deletion/Cron/multiR2, no production deployment. Current live Worker remains source4a3a6fc/version36838b5a until new CI/auto-deploy/hosted acceptance completes. Continue that release rather than repeating already-green native tests. Preserve all unrelated dirty files and checkpoints.

## 2026-11-05 — B schema60 automatic deployment and hosted scoped acceptance

Completed: fresh B backup, independent cloud restore/0060 upgrade, fresh source parity and source adoption; CI `41874139521` passed for source `4a3a6fcf42d12ee6151e2ea6873fc739b021ce71`. Automatic trigger `41876809935` successfully dispatched deployment `41876831641`; all deployment steps including preflight, postdeploy, entry activation and baseline receipt commit succeeded. GitHub run summary still reported in_progress at final API read; actual live version and hosted behavior were independently verified. No manual deployment shortcut was used.

Live B Worker `kino-pic-staging`: version `36838b5a-8138-4032-a79a-67c129fde64a`, deployment `4eb73a4d-ac40-4df9-a8c9-0ade5f14724b`, URL https://kino-pic-staging.kino-pick-aaron2026.workers.dev . Main metadata commit `04fa9885c2426339b35e93f1d53ed52b43eec021` records the verified source/receipt for subsequent releases; it does not change product code. Origin/main was fetched without changing the dirty foundation checkout.

Actual browser acceptance: real GitHub Owner login; private24-photo page; masonry/list toggles; URL-addressed full-page lightbox and24-thumbnail strip; deep-link reload; synthetic photo pin/unpin persisted. D1 confirms two distinct requests, one Owner session, two paired command/result/audit rows, final unpinned revision2 and FK0. Anonymous capability GET and pin PUT both401, homepage200. V1/V3 private previews both900x600 and comparison slider35% were observed. Photos/assets were not deleted; recommendation metadata and queued historical V2 remain.

Local proof `.local/hosted-0060-acceptance.json`, deployed receipt `.local/hosted-0060-deployment-receipt.json`, anonymous proof and screenshots `.local/hosted-0060-*.jpg`. SQL backups remain protected and ignored. Remote non-secret restore manifest and automatically recorded deployment receipt are committed. This final local handoff does not trigger another redundant code deployment.

Full MVP remains incomplete: next existing-workspace Owner project/album creation with managed scopes and tenant/invite/foreign denial; remaining release-plan features and production cutover still required. This run did not repeat100uploads, Google login, full Guest hosted flow or mobile viewport acceptance. A/DNS/customer data untouched, private single R2, deletionOFF/dry-run, no Cron.

## 2026-11-05 — B 0060 backup, independent restore and adoption accepted

B staging D1 is now schema60 (144 tables / 2,988 rows). Fresh protected SQL backup SHA256 `580d58f479297ae27c267fbe0997c23cd1e5051df7b8d061a45d96eb4a25b78e` was independently restored in B drill `ada35da7-b075-4d42-b358-86d6dbf25cbf`: all 141 old tables / 2,987 rows, schema, sequences and FK definitions matched. The drill was upgraded to0060 before a fresh source parity check and source adoption. All existing product data/schema/sequences were preserved; FK0. Only the new migration's applied_at timestamp differs between independent executions; ledger id/name and other hashes match. No source backup was restored over live data.

Evidence: `docs/releases/photo-pins-0060-restore.json`; private SQL/proofs remain ACL-protected under `apps/worker/.local/photo-pins-0060-20261105/`, never commit or print them. Scoped operator helper `apps/worker/tools/rehearse-photo-pins-0060.mjs` requires an explicit operation, fixed B/source/new drill and a verified saved backup; no deletion operation. Recovery: retain new append-only pin ledgers and fix forward; reverting Worker to59 remains read-compatible, but do not restore an old SQL dump over newer writes.

Focused populated59→60 native API test, photographer13 and collaboration24 ephemeral D1/R2 checks, Worker/profile builds and release-checker self-test passed locally. Existing immutable59 restore/prior-release evidence is retained; new60 proof/hash/schema/native checks extend it. Deployment now records its verified receipt as the next baseline after entry activation; this metadata-only GITHUB_TOKEN commit does not recursively trigger Actions. Predeploy accepts only the verified prior version, with previews disabled; deploy closes entry through the existing profile before postdeploy validation and reactivation.

Preserved failed attempts: initial D1 internal metadata read; unsupported migrations --yes flag; final parity check on the new applied_at timestamp. The source migration command itself succeeded and was not repeated; verification resumed against retained exports. Initial local build sandbox access failure was resolved using isolated Wrangler build config outside the sandbox. CI and automatic hosted deployment remain pending at this checkpoint; do not call local checks online acceptance. A/DNS/R2/customer data untouched; deletionOFF/dry-run, single R2, no Cron.

## 2026-11-05 — 0060 populated upgrade local acceptance; B reauthentication required

Enhanced `apps/worker/tests/photo-pins-api.test.ts` to seed Owner/session/workspace/project/albums/photos/versions/private assets on migrations 0001–0059, then apply 0060. All pre-existing product rows and schema objects remain identical; FK violations are zero. The existing native D1 pin API/cursor/audit/rollback/authorization/legacy-read test then passes. Focused Vitest via ignored `.local/photo-pins-vitest.config.mjs`, scoped lint and formatting passed. First attempt failed on D1's protected `_cf_METADATA`; only this provider-internal table was excluded from row reads, retaining product tables and sqlite_sequence. No hosted acceptance is claimed.

B readonly D1 inventory failed with Cloudflare API 10000. Isolated Wrangler config expiration was 2026-11-04T17:44:36.727Z. User was asked once to log in with B using `%TEMP%/kino-pic-wrangler-isolated-config`; no credentials printed. Fresh remote backup, independent restore, 0060 adoption, release-gate update, deployment and hosted acceptance remain pending. Existing 59 gates remain intact; A/customer data untouched. Do not use old backups or claim remote schema state before a successful new authenticated inventory.

## 2026-11-05 — Cloudflare B 自動部署

新增 `.github/workflows/auto-deploy-cloudflare-b.yml`：僅同倉庫 main 的 push CI `checks` 成功才自動 dispatch 既有受控部署，傳入該次 CI 的完整 SHA；若 main 已前進則跳過舊結果。PR、fork、失敗 CI 不會觸發部署。現有手動部署入口、B 帳戶／資源／復原／部署後驗證全部保留。

必要最小驗證：YAML 與格式、權限範圍、成功 main／失敗／PR／其他分支／fork 條件、舊 SHA 跳過及完整 SHA dispatch 均通過本機 assert 檢查（GitHub API 為 mock）。這不是線上部署驗收。

已知阻擋：main 有 migration 0060，但現有部署復原閘門仍要求 59 份 migration。未完成 0060 的 B 備份、獨立復原及相容性證據前，自動部署應停止；本次未放寬閘門、套用 migration 或修改 A。

## 2026-10-29 — Retention pure-planner foundation accepted

Implemented `packages/domain/src/retention.ts` and exported it through existing domain index. Deterministic dry-run only:defaultOFF;30-day inactivity/7-day minimum;80→65% estimates including reservations;oldest/least-viewed+UUID order;preservation/protection/busy/reference/recent-state guards;metrics/inventory fail-closed;whole-album caps and dual-reason dedupe. `preservationRequested=true` excludes;`cleanupAllowed` is the independent cleanup opt-in. Both mode traverses the global order once and continues required inactive candidates after the pressure target is estimated reached. Inputs are validated and not mutated;no DB/R2/delete adapter or clock/random dependency.

Focused13 tests pass (`.local/retention-planner-focused-final.log`),final root strict passes (`.local/retention-planner-types-third.log`),scoped lint passes (`.local/retention-planner-lint-final.log`;React detect warning only). Acceptance `.local/retention-planner-acceptance.json`. Earlier strict failures were fixed without relaxing TS:date tuple/exclusion reason safety and a test helper's overly narrow UUID literal type. No broad suite/build/browser run was needed or claimed for the pure module.

Critical boundary:current D1 has no effective-human-view heartbeat/projection,and several policy/busy/reference witnesses remain incomplete. This is NOT a usable D1 cleanup candidate API or deletion service. Next implement authorized visible-photo heartbeat evidence and rolling5-minute session dedupe,then read-only snapshot adapter,persisted plan/Owner UI/explicit opt-in+confirmation,locks/rechecks,delete/retry/reconciliation. Permanent fences/history must remain intact.0052 remains locally adopted;all feature/default hosted gates and automatic deletion remainOFF/dry-run. Version-approval aggregation question remains pending;fullM1–M5 remains ACTIVE/incomplete. See docs/RETENTION_PLANNER.md. Preserve unrelated dirty edits;no commit,push or deploy.

## 2026-10-29 — 0052 adopted LOCAL ONLY; version confirmation policy pending

The accepted Guest current-version download migration is now adopted in persistent LOCAL D1. Run `apps/worker/.local/guest-downloads-adopt-0052-third.log` exited0:8 actual CLI commands all0. Fresh backup was restored and upgraded in an isolated config directory,then a fresh live snapshot was compared before apply. All123 product-table row hashes match the accepted0051 development snapshot;all4 development rows,existing schema and product sequences are unchanged. Exactly one audit trigger was added;ledger is52,no pending migrations,and foreign-key checks on exported snapshots are empty. Live-after schema equals isolated-upgraded schema. Download/default hosted flags remainOFF;automatic deletionOFF/dry-run. No remote/customer data,commit,push or deploy.

Proof `apps/worker/.local/guest-downloads-adopt-09a31a74-8bb1-4913-ac86-9eea3b29515a-proof.json` SHA256 `39405b94e76c07bb607fae599cb9b2e68b0c1dcc081238f2c6c69b603c917300`. Fresh backup `apps/worker/.local/guest-downloads-adopt-09a31a74-8bb1-4913-ac86-9eea3b29515a-before.sql`,SHA256 `ae713c7515505a10cbc5d26ecee941da3af5668d31cd1e2ce44cdfc7ee282502`.0052 source SHA256 `a247e8efe8b3cf2152cffb500b5d8dacc5eab6385e4ce96086672600645dbb81`. Preserve failed preflight proofs:first CLI export did not support persist-to;second checker compared SQLite null-prototype rows with plain objects. Both stopped before persistent apply;neither is acceptance. The successful run uses an isolated Wrangler config directory and normalized sequence rows;no old backup was restored over live data. Recovery:keep flagOFF,retain audit/assets,prefer forward fix;drop only the new guard if reverting schema deliberately.

Read-only version-approval inventory found no approval permission in the existing12-bit mask. Do not reinterpret can_view/can_compare_versions/can_select as approval authority or enlarge persisted4095 mask casually. A separate Owner-authorized sealed request/invitation relation can pin exact photo/version/head revision and preserve individual Guest receipts. The user has not decided whether one representative or all designated clients must confirm;they requested clarification,which was provided,with a simplified question still pending. Do not silently choose an aggregate publication policy or show an unimplemented approval control. Owner history/head switching exists;Guest comparison canvas exists;Owner equivalent comparison remains required. See docs/VERSION_APPROVALS.md. FullM1–M5 remains ACTIVE/incomplete;next implement independent exact-version confirmation records and resolve the final delivery gate without deleting any existing product requirement.

## 2026-10-29 — Guest current-version downloads accepted locally

KISS: reused existing Guest sessions, private R2 adapter/current heads and append-only audit. Independent preview/original rights work without can_view. Bounded24-row catalogue + native attachments + download-only375px UI/logout are implemented. Source filenames use immutable V1/V2 completion witnesses; asset IDs are not upload session IDs. Fixed a real SQL bug discovered by native execution: request candidate omitted photoId/versionId used by its audit INSERT. Bounded server-side failure logs contain phase/requestId/error message, never credentials/SQL bindings.

Actual isolated runner seventh exited0 (`apps/worker/.local/guest-downloads-focused-seventh.log`):3 API groups + one375px Chromium flow. One PNG used existing Owner upload/init/authorize/local R2 put/complete and real LocalSharp processing. Preview/original bytes and SHA match; requested/generated rows pair exactly; native forged audits abort; injected generated-audit failure returns503 JSON/no file and retains requested only; opposite/view-only/foreign/unshared/revoked access denies without new download audits. Chromium saved the native attachment with exact size/hash and logout removed private filename/cookie. Root inspected `apps/worker/.local/guest-downloads-mobile.png`. Proof `apps/worker/.local/guest-downloads-focused-acceptance.json`;log SHA256 `59a56a0ed0d62bb908daa74ef00bf69f34b8d135ceba7dd92f0ce5483e90e707`. The injected error in the successful log is expected fail-closed evidence. Earlier failed logs remain failures,not acceptance.

Corrected target Worker/UI build passes (`.local/guest-downloads-sql-fix-build.log`);final root strict/scoped lint pass (`.local/guest-downloads-final-types.log`,`.local/guest-downloads-final-lint.log`). Prior scoped9 contract tests and Web types passed;full broad suites were not repeated. Browser helper uses a small real loopback HTTP bridge because route interception canceled native attachment persistence;no synthetic API responses. GUEST_DOWNLOADS_ENABLED remainsOFF/hard-local.0052 is SOURCE ONLY:default persistent local D1 remains0051;no production/customer writes,commit,push or deploy. Automatic deletionOFF/dry-run.

This supports current ready-version downloads,not a final published/approved delivery package. FullM1–M5 remains ACTIVE/incomplete. Next inspect version-approval/publication requirements and implement immutable delivery manifests,then notification/ZIP and remaining retention/hosted acceptance without removing earlier requirements. Any later0052 persistent adoption needs a fresh backup/restore/parity proof. See docs/GUEST_DOWNLOADS.md.

## 2026-10-29 — M3i5b first multi-file resolved UI accepted locally

Keep KISS: the new opt-in queue wraps the existing ResolvedAlbumUpload and its journal/lock/network pipeline. Gallery now mounts ResolvedBatchAlbumUpload. RESOLVED_BATCH_UPLOAD_ENABLED defaultsOFF in all environments/example,requires the full matching-rules chain,and rejects hosted activation. Owner-only GET /api/v1/resolved-batch-uploads/capabilities exposes strict1000-file/24-row limits. No new D1 migration or production/customer write occurred.

Implemented: multi-file descriptors/IDB queue,explicit start,one-file-at-a-time fresh preview and upload,24-row progress/reselection,pause and queued-only skip;stable async journal port with fixed request IDs and committed persistence before network;current-session checks and private filename hiding on access loss;captured-intent recovery retained when new batch admission is disabled. Queue creation briefly reuses the existing album Web Lock and rereads its pointer,preventing stale tabs from replacing another queue. Per-file parent Gallery refresh is coalesced. Human rule/error copy replaces internal codes. Server-confirmed review/rejection records remain retained;unknown captured jobs are not discarded.

Actual focused local run12192 exited0 (`apps/worker/.local/m3i5b-browser-run-fifth.log`):three375px browser scenarios/six checks true:OFF keeps legacy widget;stale-tab pointer remains one queue;three files complete signed local R2 uploads;dropped accepted reservation restores with exact original UUID/body after a rules change;new stale-policy admission stops;foreign identity clears filenames and performs no upload writes. Acceptance `apps/worker/.local/m3i5b-focused-acceptance.json`,SHA256 `57c4cd4f22ca30514e2ba71e916355c6c28ad1f72e51cc06dee99cd7d88515cc`. LogSHA256 `0e33b40bc02a29bce16d4a364a3f9e581e14f3e35a129546f95958703299f090`. The old runner success banner incorrectly included Sharp;the log is preserved and runner banner corrected for future runs. This helper did NOT invoke Sharp/derivative processing. Do not repeat that overclaim or add a redundant image-engine test.

Second target UI/Worker dry-run build exited0 (`.local/m3i5b-worker-build-second.log`);root strict and scoped final UI/helper lint exited0 (`.local/m3i5b-root-types.log`,`.local/m3i5b-ui-lint.log`). Scoped web TypeScript/Prettier pass;new gate18 unit tests,codec9 and existing journal/protocol48 targeted tests pass. Full650 unit and17 native IDB tests are earlier foundation checkpoints,not rerun or summed into a fabricated new total. Preserved failures:first real hidden pre-create/stale-pointer notice was fixed by root;other attempts exposed fixture basename,existing two completion-reconciliation probes,and an obsolete raw-code UI assertion. No failed run is reported as a pass. Main full smoke/Next reference suites were not repeated per user minimal-validation instruction.

Boundary: local workerd/D1/R2/Chromium only;no real OAuth/remoteCloudflare/production deployment,Sharp in this run,1000 physical transfers,power-loss or native-headed acceptance. Batch admission remainsOFF in checked-in config. Active captured server cancellation and remaining comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness remain unfinished.0051 stays adoptedLOCALONLY;automatic deletionOFF/dry-run. FullM1–M5 ACTIVE/incomplete. Next prioritize the roadmap's remaining real delivery features using existing services;inspect current docs/code before starting and avoid new frameworks/unnecessary test expansion. Preserve unrelated dirty work;no commit,push or deploy.

## 2026-10-29 — M3i5b integration seam in progress (KISS)

Reuse the existing resolved uploader instead of creating another upload engine. `ResolvedAlbumUpload` now accepts an optional async `ResolvedUploadJournalPort` (itemId/load/save);default localStorage behavior and existing Web Lock key are preserved. Loads/saves use the original strict max-one journal protocol. Persistence is awaited before reservation and subsequent mutations;refs/UI update only after committed save and current-generation checks. The port supplies the descriptor item ID;the three operation UUIDs remain generated once and fixed. Use a stable/memoized port object.

A batch envelope can now retain terminal `rejected` metadata for an unreserved request after a definitive server rejection,without overwriting its body or pretending the server placed it in needs_review. Controller code must establish that definitive outcome;the codec cannot determine network truth. Timeouts,AbortError and unknown outcomes must never take this path. Reserved or terminal rejected intents cannot be reactivated or rewritten. Targeted codec9 tests pass;existing journal/protocol48 tests pass after the async seam. Scoped lint plus root/Web strict checks pass. Full650 unit/17 native storage results below are prior foundation checkpoints,not a new batch UI acceptance claim;no broad suite was repeated for these isolated changes.

Actual multi-file chooser/queue/controller,session reauthorization and UI/native transfer acceptance remain unfinished. Next add the small queue wrapper and existing port binding;keep explicit current policy checks for unstarted items and exact old-intent replay for captured work. Do not introduce a new lease/timer system or another lock namespace. Default/hosted gates and automatic deletion remainOFF/dry-run;0051 stays local-only. FullM1–M5 goal ACTIVE/incomplete. Follow user KISS and minimal relevant validation;do not restart quota investigations or repeat already-green checks without a concrete reason.

## 2026-10-29 — M3i5a internal storage foundation accepted locally

Follow the user's KISS instruction: reuse existing flows/helpers/locks, add only necessary abstractions, and run the smallest meaningful checks for changed behavior. Do not repeat passing suites without a relevant source change or failure;do not expand browser-internal quota experiments. Full product scope is unchanged.

Final isolated Chromium harness exited0 with17 groups (`apps/worker/.local/m3i5a-resolved-batch-browser-final.log`;summary `apps/worker/.local/m3i5a-resolved-batch-browser-a4ae4c38-f691-4130-83d9-b294912494b8.json`,SHA256 `4c32e45f644cb4e815d64d0cff2283f8ea2e94d2fccda96ad13dccc172c7c3f6`). Actual native IndexedDB evidence:49 rows page24/24/1 with25-row lookahead;1,000 synthetic metadata rows over42 pages;updates exactly2gets/0getAll/0cursors;native operation/session uniqueness;scope/session/policy/wrapper denial;fixed intent immutability;existing-data preservation on transaction abort;reload/second-page commit;two-page same-revision CAS one winner/one conflict;fresh-context native quota rejection. Metadata volume is not physical upload acceptance. Quota lowering after existing usage remains not_checked;Chromium accepted writes despite live lowered overrides. Existing-data preservation is separately proven by native transaction abort. No further quota experiments are needed for this slice.

Latest full unit650/73 files passes (`.local/m3i5a-unit-second.log`). Full generated strict35349/whole lint28524 passed before the additive optional PUT AbortSignal;after that change root/Web strict and scoped lint pass (`.local/m3i5a-root-tsc-after-abort.log`,`.local/m3i5a-web-tsc-after-abort.log`). Final helper syntax/ESLint/Prettier pass. Native runner bundles actual adapter/codec;no app assets or main smoke runner were changed. Earlier harness failures (absent file/API name assumptions,scan scope,unsynchronized race,expanded quota experiments) are retained as failed diagnostic evidence,not accepted passes.

Next M3i5b: integrate a genuine multi-file queue with existing ResolvedAlbumUpload,its existing resolvedUploadJournalKey Web Lock,and the new storage. Avoid a new persistent lease/timer system. Existing resolved/single upload UIs already fail closed without Web Locks;do not claim unsupported-browser fallback. Preserve per-file fresh preview/fixed UUIDs/current identity/session/recovery and explicit review. Batch UI/controller and active cancellation remain unfinished;no new batch capability is exposed.0051 stays adopted LOCAL ONLY;all hosted/default gatesOFF,automatic deletionOFF/dry-run. Real OAuth,hosted/productUI integration,physical R2 bulk and power-loss acceptance remain not_checked. FullM1–M5 goal ACTIVE/incomplete. Preserve all unrelated dirty work. Read RESOLVED_BATCH_UPLOADS.md and the accepted0051 proof below.

## 2026-10-29 — M3i5a internal foundation in progress

Added strict metadata-only batch manifest/per-item codecs with1,000-descriptor bound, per-record64KiB/manifest1MiB limits, exact legacy/profile-aware intents, revision CAS, frozen descriptors/policy/UUIDs and explicit lifecycle transitions. Manifest touches do not load all item payloads. Existing single-item journals remain unchanged. Added `getUploadIdentity(signal?)` returning validated Owner UUID plus opaque session ID while stripping extra metadata;existing `getUploadOwner` callers remain unchanged.

Root latest `pnpm test:unit` exited0:650 tests/73 files (`.local/m3i5a-unit-second.log`), including8 new codec,12 identity-client and5 interruptible-PUT tests. `putUploadFile` now accepts an optional AbortSignal without changing existing call sites;already-aborted calls never start transport,in-flight interruption retains unknown-server-outcome semantics and fixed intent recovery. Scoped lint plus root/Web strict checks after this additive change exited0 (`.local/m3i5a-root-tsc-after-abort.log`,`.local/m3i5a-web-tsc-after-abort.log`). These include mocked fetch/unit evidence, not browser or hosted OAuth acceptance. IndexedDB adapter is implemented and frozen:atomic create,24+1 paging,two-read target updates,no queue-wide update scan,unique operation/session indexes and per-row scope/session/policy/wrapper checks. Root generated full typecheck35349 exited0 (`.local/m3i5a-types-first.log`);whole lint28524 exited0 (`.local/m3i5a-lint-first.log`). The isolated native Chromium harness is still being implemented; do not claim native storage acceptance,batch UI/controller,processing lease,cross-tab admission ownership,active cancellation or physical bulk upload ready. Root found and required removal of the draft adapter's all-item update scan: final update must read manifest+target only, with native unique indexes for operation IDs and upload sessions. Per-item case-insensitive UUID collisions must also fail codec validation, because a multiEntry index deduplicates keys within one row.

0051 remains adopted LOCAL ONLY with all gatesOFF and deletionOFF/dry-run;see next M3i4 accepted checkpoint and RESOLVED_BATCH_UPLOADS.md. Full goal ACTIVE/incomplete. Next finish actual IndexedDB transaction/abort/quota/CAS/reload tests, generated strict/lint and docs before UI/controller integration.

## 2026-10-29 — M3i4 accepted locally;0051 adopted LOCAL ONLY

Complete standard67362 exited0:367 actual local Cloudflare checks (`.local/m3i4-cloudflare-first.log`); focused15850 exited0:15 actual workerd/D1/R2/Sharp/API/375px groups (`apps/worker/.local/m3i4-focused-eleventh.log`).625 unit/70 files, final strict30771/lint41244,61 reference integration tests, Next build and14 reference Chromium tests pass. Large history fixtures are synthetic metadata, not1,001 physical R2 uploads. Draft-album compatibility and normal BetterAuth identity envelopes were fixed and exercised; unknown-outcome recovery keeps exact IDs/body. Earlier failed runs remain retained as failures.

Root local adoption31615 exited0 (`apps/worker/.local/m3i4-root-adopt-0051-second.log`):62 CLI commands all0;119 old tables/hashes/4 development rows/product sequences preserved;exactly one replaced resolution guard matches isolated SQL;46 added objects/four empty tables/123 total tables;FK0;ledger51/no pending. Proof `apps/worker/.local/m3i4-persistent-local-adoption-proof-323e0e3a-e1ac-4493-bea0-e84dc8000281.json`, SHA256 `dcfd4da8248b4b32cca4bd71eb9b9996ce17695c73b790cdf6db539dd08bc634`. Backup `apps/worker/.local/d1-before-0051-1e6340d0-a00b-4967-b732-9e9cb8ce8a36.sql`,699926 bytes,SHA256 `a550d2a4e353fa3f7ef5ce91a69b62cc77807673b03e8f62d64adda0ff98615e`. Source0051 SHA256 `4751bd2696f6b766ce42869470b3f98ca36c3338975cfb8cca29623108940ed3`.

Isolated prep retained all200 recorded CLI exits0 after evidence-only reconciliation of four late proof queries: `apps/worker/.local/m3i4-adoption-prep-proof-reconciled-1e6340d0-a00b-4967-b732-9e9cb8ce8a36.json`,SHA256 `f3c59003c1f4d394e952e734d716f913c7e79b46bc5a800091dac27c50e6f61c`. Preserve original failed/count-mismatched proofs. Resume fixed only snapshot `table` versus `tbl_name`;root's first adoption attempt stopped before any CLI at a multiline-Zod preflight regex, then corrected whitespace parsing without product changes. Never restore stale backups over newer writes.

All hosted/default gates remainOFF/hard-local and automatic deletionOFF/dry-run. No remote/customer write,commit,push or deploy. Real OAuth/remoteR2/CORS/edge latency/CPU/free-tier/hosted acceptance remains not_checked. FullM1–M5 goal remains ACTIVE/incomplete. Next M3i5a is internal strict batch manifest/per-item codecs and IndexedDB storage/tests;multi-file resolved UI/controller,processing lease,active cancellation,identity recovery and full native acceptance are not yet implemented. Read MATCHING_RULES.md and RESOLVED_BATCH_UPLOADS.md. Preserve all unrelated dirty work.

## 2026-10-28 — M3i4 full local runtime acceptance; persistent adoption pending

Complete `pnpm test:cloudflare` exited0:367 actual local workerd/D1/R2/API/Chromium checks (`.local/m3i4-cloudflare-first.log`). Final focused run exited0:15 groups (`apps/worker/.local/m3i4-focused-eleventh.log`), covering eight fixed profiles, Unicode expansion, full immutable history, rule CAS/ABA, fresh versus replayed six/seven-field intents, native atomic rollback and same-UUID retry, real small R2/Sharp transfers and375px settings/index/recovery UI. The1,001 appended history records are synthetic metadata, not1,001 physical uploads. Screenshots are local development UI, not hosted or final visual-design acceptance.

625 unit tests/70 files, final generated strict30771, whole lint41244,61 reference integration tests, Next reference build and14 reference Chromium checks passed. Final logs: `.local/m3i4-unit-first.log`, `m3i4-types-final.log`, `m3i4-lint-final-second.log`, `m3i4-integration.log`, `m3i4-reference-build.log`, `m3i4-reference-e2e.log`. First lint failed on generated nested `.local` artifacts; ESLint now ignores `**/.local/**`, retaining tracked production/test checks. Earlier focused failures are preserved as failures, not accepted passes.

Two real regressions were fixed and covered: the replacement resolution guard now preserves draft as well as active albums; settings/index identity readers accept the normal BetterAuth session envelope while retaining validated identity fields. The lost-response test now suppresses transparent automatic PUT retries until explicit recovery; original intent bytes/UUID and single command/result/event remain asserted.

Persistent local D1 remains0050. Source0051 SHA256 `4751bd2696f6b766ce42869470b3f98ca36c3338975cfb8cca29623108940ed3`. Fresh backup/isolated restore/upgrade proof is still running; first two prep attempts stopped before0051 execution at runner inventory-count assertions (47 unique CREATE objects,46 added objects and one replaced guard), not a migration failure. Third prep executed0051 successfully only in the isolated store, then stopped at a verification-only field-name mismatch: snapshots expose `table`, but the assertion read `tbl_name`. All144 recorded CLI exits were0. Resume verification against the retained store after correcting the checker; do not repeat DDL or weaken product assertions. Do not apply persistently before successful proof plus fresh live parity. No remote/customer write, commit, push or deploy. All hosted/default gates and automatic deletion remainOFF/dry-run. Full M1–M5 goal remains ACTIVE/incomplete. Next: finish local0051 adoption, then genuine per-file batch/captured-identity recovery and remaining roadmap.

## 2026-10-28 — M3i4 immutable matching rules in progress

Read docs/MATCHING_RULES.md. Source0051 adds nondefault keys/union view and separate immutable project rule ledger/head/result with shared project revision bump and full Owner namespace. Domain fixed8profile registry,strict contracts,default-OFF/hard-local flag,configuration/index services/routes,profile-aware indexed snapshot/cursor/native resolution context,upload dual-key batch,Owner settings/current-rule index UI and safe history projection are written. Old default keys/mode ledgers/request bodies are preserved. All production/default gates and automatic deletion remainOFF. Persistent D1 remains0050;no0051 adoption or remote/customer/commit/push/deploy.

625 unit/70 files and generated full strict28002 pass;first target dry-run build .local/m3i4-worker-build-first.log exited0. Fresh native0001–0051 syntax/schema/view-plan probe passes123 tables/FK0,but populated upgrade acceptance is pending. Root actual isolated workerd/D1 core probe passes default/no-op/profile transitions,index-gap review/bounded advance/casefold pending match,nondefault feature-OFF failclosed,reset and exact old command replay;metadata only,no R2 transfer claimed. NativeR2/Sharp/375px/full-history/CAS/replay and complete standard remain pending;runtimeagent owns matching-rules.mjs and focused runner,UIagent owns matching-rules-browser.mjs. No assets rebuild during a live focused runner;poll its reported exact handle. Standard harness already has matching-rules-test and0051 upgrade helper but not runtimehelper invocation yet. Root owns that integration.

Current key risks: actual union-view/profile snapshot plans/atomic rollback,strict new context with historical absent payloads,cross-namespace/source witnesses,Unicode expansion500-char keys,new UI recovery/identity/focus and representative-volume cost. Native large-history fixtures must be called synthetic metadata,not bulk R2 E2E. Next complete this full vertical slice/backup-live-parity adoption,then genuine per-file batch/captured-identity recovery and remaining M1–M5. Goal remains ACTIVE/incomplete. Preserve huge unrelated dirty worktree and all M3i3/older proof artifacts.

## 2026-10-28 — M3i3 Assisted catalog accepted locally

Complete standard18844 exited0:352 actual local workerd/D1/R2/API/Chromium checks (.local/m3i3-cloudflare-third.log). Final focused18128 exited0:7 checks (worker .local/m3i3-focused-runner-final7.log),including1,001 guarded synthetic logical photos over24-row BINARY pages,exact Owner/session/scope/expiry/HMAC/query checks,arbitrary final-page selected-head reserve/replay,375px first/previous/next/off-page selection,correct explicit-choice headings,separate native radio groups,late identity clearing,lost-response same-UUID recovery,one real signed R2 original upload/native Sharp derivatives,stale head/sequence no-write and legacy1,000/truncated/default-OFF preservation. Root inspected final worker .local/assisted-candidate-catalog-mobile.png. Synthetic metadata is not bulk physical R2 E2E; the metadata-only picker is not final visual design.

588 unit/67 files,full strict68388/lint8613 plus later UI scoped strict/lint and final helper10/10,61 reference integration95549,Next build/14 reference Chromium13914,52-document presence and diff checks passed. Final target build was .local/m3i3-worker-build-final3.log; the second standard rebuilt the same final product source. Third standard used those unchanged assets after only the Guest-comment recovery test assertion changed. First86510 failed after338 groups at an obsolete privacy-helper assertion; second47811 failed after192 at existing recovery-form-versus-journal timing. Root replaced only that assertion with bounded polling of actual sessionStorage cleanup,retaining three exact retry payloads and single command/result/change/comment assertions; read-only source review confirmed pending hides the form before authoritative cleanup. Earlier failures are historical,not accepted passes. Deliberate one-row fixture audit delta is processing.enqueued/upload.authorized/upload.completed/upload.reserved each+1; stale denial changes no post-fixture state.

0050 is now applied LOCAL ONLY. NEW699707-byte backup worker .local/d1-before-0050-eddfe26a-9645-4a9a-b497-a4e7bbb3d58a.sql SHA25666eda00c7faff5744680489ca46607c82e2f14a765af9695062b114e11645bf0. Source0050 SHA2569c8fd019d57d00df0bf56a732ff8215e10e1bad1c7f9183fd27cb6a9b67d480b. Isolated prep35093 exited0:145 Wrangler commands all0,backup restored under a unique .local/m3i3-isolated-persist path,119 old tables/hash/schema/sequences/ledger unchanged,one scoped seek index,FK0 and native unforced covering-index BINARY ID range/no temp sort. Root verified hashes and performed fresh live parity before adoption38239 exit0:61 local CLI commands all0;all119 old product tables/rows/schema/product sequences unchanged,same4 development rows,one index,FK0,ledger50/no pending. Proofs: worker .local/m3i3-local-adoption-proof-eddfe26a-9645-4a9a-b497-a4e7bbb3d58a.json and .local/m3i3-persistent-local-adoption-proof.json;before/after snapshots and apply output retained. Preserve these and older M3h/M3i2 proofs; never restore a stale backup over newer writes.

ASSISTED_CANDIDATE_CATALOG_ENABLED and all hosted/default gates remainOFF/hard-local;automatic deletionOFF/dry-run. No remote/customer write,commit,push or deploy. Real OAuth/remoteR2/CORS/edge latency/CPU/free-tier/native-headed acceptance remains not_checked. Next Task: distinct immutable opt-in matching profiles and genuine per-file batch/captured-identity recovery;coverage-scan cost,legacy witnesses,expiry/preview liveness and metadata-picker UX remain. Comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness are still required. FullM1–M5 remains ACTIVE/incomplete. This entry supersedes earlier in-progress run states; preserve unrelated dirty work.

## 2026-10-28 — M3i3 third complete standard LIVE (supersedes earlier run states)

Root18844/.local/m3i3-cloudflare-third.log is LIVE, executing the complete tests/local-smoke.mjs against the unchanged second-built final target/harness assets. Poll this same handle; never restart solely on observation timeout. Second47811 exited1 after192 groups at existing Guest-comment recovery helper623: the recovery form disappears during pending retry before follow-up authority reads and final sessionStorage cleanup. Root changed only that assertion to bounded polling of the same request ID's actual journal absence. Three identical retry payloads and one command/result/change/comment assertions remain. Scoped format/lint pass; read-only product source analysis independently confirmed the lifecycle ordering. No product fix or rebuild was needed for this test correction.

Final M3i3 focused18128 remains7/7 on final3 source/build with screenshot inspected,588 unit plus reference/strict/lint checks as below. Complete standard acceptance is still pending; first86510 and second47811 are failures,not passes. Persistent local D1 remains0049. Separate fresh backup/isolated0050 evidence is being prepared only; no persistent0050 apply before complete acceptance/live parity. All hosted/default flags and deletion remainOFF/dry-run; no remote/customer/commit/push/deploy. FullM1–M5 remains ACTIVE/incomplete; see ASSISTED_CANDIDATE_CATALOG.md and preserve all unrelated dirty work.

## 2026-10-28 — M3i3 final focused acceptance; complete standard LIVE

Read docs/ASSISTED_CANDIDATE_CATALOG.md. Final target build .local/m3i3-worker-build-final3.log exited0; final focused18128 exited0 with7 real workerd/D1/API/Chromium groups (.local log under apps/worker). Covers1,001 guarded synthetic logical-photo fixtures over24-row pages,exact cursor/session/scope/expiry boundaries,arbitrary final-page selected-head reserve/replay,375px first/previous/next/off-page selection,three correct decision headings,separate native radio groups,late identity clearing,lost-response same-UUID recovery,one actual signed R2 upload/native Sharp derivatives,stale head/sequence no writes and legacy/default-OFF. Root inspected worker .local/assisted-candidate-catalog-mobile.png; a filename list is not final visual-design acceptance. Exact fixture audit deltas are processing.enqueued/upload.authorized/upload.completed/upload.reserved each+1; stale denial full-state baseline is unchanged.

588 unit/67 files,full strict68388/lint8613,subsequent UI strict/scoped lint,final helper10/10,61 reference integration,Next build/14 reference Chromium,isolated populated0050 preservation/native range plan,52-document presence and diff checks pass. First full attempt86510 exited1 after338 groups at the obsolete privacy helper assertion imported before its correction; not a full pass. SECOND standard pnpm test:cloudflare is LIVE root47811/.local/m3i3-cloudflare-second.log. Poll that exact handle; do not restart for observation timeout. Final standard acceptance remains pending.

Persistent local D1 remains0049; source0050 is index-only and isolated-tested,not adopted. Before adoption require complete standard acceptance,fresh backup/isolated restore/upgrade/live parity. All hosted/default gates and deletion remainOFF/dry-run. No remote/customer write,commit,push or deploy. FullM1–M5 remains ACTIVE/incomplete. Next after acceptance: configurable opt-in matching profiles,true per-file batch/recovery,then comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness. Preserve the large dirty worktree and all proof artifacts.

## 2026-10-28 — M3i3 Assisted catalog in progress

Read docs/ASSISTED_CANDIDATE_CATALOG.md. Source now includes default-OFF/hard-local Assisted catalog, signed24-row keyset pages, real chosen-head authorization outside the tiny preview map, bounded UI paging/selection and additive source migration0050. Gate OFF retains legacy Assisted behavior. Persistent local D1 remains0049; no0050 adoption, remote/customer write,commit,push or deployment.

Actual588 unit/67 files, full strict76374 and whole lint58155 exited0. Initial target build passed; a later source-only cursor-cycle fix needs rebuilt browser acceptance. Focused runtime owner is continuing actual workerd/D1/R2/Chromium tests; previous failures were test assumptions, not full acceptance. Do not claim M3i3 complete or apply0050 before complete runtime validation and fresh backup/restore/live parity. All hosted flags and automatic deletion remainOFF/dry-run. FullM1–M5 remains ACTIVE/incomplete.

## 2026-10-28 — M3i2 indexed automatic matching

Added one-snapshot canonical/full-history aggregate classification for local auto_filename,including large albums and renamed heads without raising the materialized-candidate cap. Preserved Assisted choices and request replay/CAS;3 reservation paths attempt immutable keys transactionally. Cancelled/expired uncompleted invalid keys no longer permanently block coverage. Added explicit index-gap UI,human matching labels and per-album heading IDs. All new gates defaultOFF/hard-local.

345 actual local standard checks and563 unit pass; final-copy focused13 adds foreign-tenant404/no-write and readable375px UI. Strict/lint,61 reference integration,14 reference Chromium and Next build pass. Large synthetic history is distinct from verified small-image R2 processing.0049 adopted LOCAL ONLY after fresh backup/isolated restore/upgrade/live parity:119 tables/same4 development rows,all118 old tables unchanged,empty index,FK0,no pending. No remote/customer edit,commit,push or deployment. HANDOFF records proof/hashes,earlier failures and remaining scope; fullM1–M5 remains active.

## 2026-10-28 — M3i1 local filename index maintenance

Added append-only canonical upload-session witnesses (source migration0049), strict aggregate completeness contracts, current-Owner scoped status and bounded24-session idempotent maintenance API, and an explicit local Owner gallery panel with lifecycle/identity protection. New independent MATCHING_FILENAME_INDEX_ENABLED defaultsOFF and rejects hosted activation. Existing matching decisions/Assisted choices are preserved; indexed classification/rules/batch remain pending. Gallery toggle aria-label now tracks its actual view/collapse state.

Final actual standard41317 passed332 local Worker/D1/R2/API/Chromium checks;541 unit/63 files, strict/lint,61 reference integration,14 reference Chromium and Next build passed. Populated isolated0048→0049 preserves118 old tables/schema/sequences and adds one empty table/FK0. Persistent D1 remains0048; no remote/customer change,commit,push or deploy. See HANDOFF for exact commands, earlier failed runs, recovery and remaining risks. FullM1–M5 remains active.

## 2026-10-28 — M3h Owner workspace history/export accepted locally

Full standard run41792 exited0:326 local workerd/D1/R2/API/Chromium checks (.local/m3h-cloudflare-seventh.log),including all10 new history API groups and actual375px enabled/default-OFF history filters,paging,complete CSV/JSON Blob files,error/no-file and late-identity privacy. It reads74 actual workspace action families across every owned workspace,retains original actor/session/request/UTC context and safe before/after values,and proves reads create no audit/retention activity. Unknown/malformed details never expose raw JSON. Current Owner/session/workspace checks repeat on pages/chunks; signed24-row snapshots exclude later backdated appends and survive a fresh authorized Owner session. Related invitations include immutable Guest/Owner witnesses,multi-invitation reviews and exact long reopen IDs. Guest visibility/read-right boundaries are unchanged.

Real Gallery bug fixed and accepted in this standard run: a pending page changed the navigation callback and tore down the open modal lifecycle,losing the opener focus. Keyboard callbacks now update through a ref; lifecycle cleanup occurs on actual open/close. The deterministic real-cursor hold regression opens the modal before releasing a new eligible photo,tests latest keyboard navigation and Escape focus restoration. Synthetic fixture timestamps/order are restored in finally; images/versions/keys/guards remain unchanged. Root inspected the final375px Owner history viewport and Gallery focus-ring captures (worker .local/owner-history-mobile-viewport.png and gallery-grid-mobile.png).

529 unit tests/61 files (.local/m3h-unit-sixth-final.log),integrated generated strict types (.local/m3h-types-sixth-final.log),whole lint (.local/m3h-lint-sixth-final.log),61 original reference integration,14 reference Chromium and Next reference build passed. Separate real workerd/D1 probes verify160-codepoint project/album create/rename/before/after retention (.local/m3h-unicode-probe.log) and512-character opaque session provenance across51 events/3 pages/complete JSON export (.local/m3h-session512-probe.log). Unit boundaries also reject unsupported513-character session IDs. The local/synthetic-only stream test Worker delegates to the real repository/D1 and proves pre-generation cancel/session expiry yield1 start/0 completion,restores the session and permits read200; native preinstalled completion-audit failure rejects the body. It is never mounted in the production API. Server generation is not client receipt. Standard run includes these checks; earlier failed/partial runs below are historical,not acceptance.

0048_owner_history_indexes.sql is applied LOCAL ONLY:8 CLI commands succeeded,7 indexes added. NEW694741-byte backup SHA256c5c604d5bb06170f83e5d4677138d57b235630bffadf2bb1a95252c52799444f was isolated-restored/isolated-upgraded and compared with a fresh live118-table snapshot before adoption22101 exit0. After adoption all118 old-table row hashes/counts/same4 development rows are unchanged,FK0,no pending migrations. Evidence: worker .local/m3h-local-adoption.log,m3h-apply-0048.log,m3h-after-0048-state.json and m3h-isolated-upgrade-proof.json. Migration SHA2560add396c3c6e0e1e4ad3d0fc519f0dca2cd8ae4e25ce98ec04042ba34206158f. Populated standard upgrade also preserves sequences/audit triggers; actual D1 plans use workspace-time/photo indexes and a workspace/implicit-rowid seek. No history-wide MAX is recomputed on every authority check. Leave data/ledgers intact,disable gate and repair forward; never restore an old backup over newer writes.

All hosted/default gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer modification,commit,push or deployment. Real OAuth/remoteR2/CORS/edge/free-tier/native-headed acceptance remains not_checked. Sparse actor/invitation filters and large exports need representative-volume assessment; client files above64MiB fail explicitly. Workspace history information hierarchy needs refinement before hosted enablement. Original independent Guest annotation read-permission question remains pending,so can_annotate128 is unchanged.

Next Task: scalable indexed matching/rules/batch upload,with Owner comparison refinements,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted readiness still required. FullM1–M5 goal remains ACTIVE and incomplete. Read docs/OWNER_HISTORY.md and preserve the large unrelated dirty worktree. This entry supersedes historical pending/run-state entries below.

## 2026-10-28 — M3h fourth standard run active

Current actual process48775/.local/m3h-cloudflare-fourth.log is LIVE; poll this same handle and never restart solely for timeout. Third78128 exited1 after315 old checks plus2 new API groups: the broad actual-source helper shallow-compared nested processing outputs against raw JSON,incorrectly expecting deliberately omitted SHA256 hashes. It now recursively checks every retained value,all array lengths/order and sensitive-key exclusion. Product privacy was correct; no hash was added back. Separate real-data bug fixed: project/album160-codepoint names can exceed256 UTF-16 units,so content-name projection now matches the original160-codepoint rule.528 unit/61 files pass; final full strict18605/lint45506 pass. Actual rebuilt workerd/D1 Unicode probe .local/m3h-unicode-probe.log preserves create/rename/before/after values and the prior51-event snapshot. Main fourth rebuilt the final source and includes all10 history API groups plus375px enabled/default-OFF browser coverage. Persistent DB remains0047 pending complete vertical acceptance; no remote/customer/commit/push/deploy. FullM1–M5 remains active.

## 2026-10-28 — M3h third standard run active

Current actual process78128/.local/m3h-cloudflare-third.log is LIVE; poll the same handle,do not restart on timeout. Second43270 exited1 before new history API checks: existing owner-annotation-authoring-browser helper immediately asserted journal null after server current-target200,before browser consumption. Root changed only that assertion to bounded expect.poll of actual sessionStorage null; target/current revision/command audit/UI assertions remain. Product source is unchanged. Third includes latest product build,all10 new history API groups and enabled/default-OFF375px history browser helper. Final527 unit,full strict53951,whole lint63688,format check,49-file document presence and diff checks pass; actual Next build/61 integration/14 reference Chromium remain green. Persistent DB remains0047. Pre0048 backup/restore/index-only isolated upgrade and pinned proof are ready; ignored adoption script requires a not-yet-created verified326-check acceptance file before local application. Full vertical acceptance is still pending; no remote/customer/commit/push/deploy. FullM1–M5 remains active.

## 2026-10-28 — M3h workspace history/export in progress

Read docs/OWNER_HISTORY.md. Source service/routes/contracts/projection/UI and independent default-OFF/hard-local OWNER_HISTORY_ENABLED are integrated.0048 is additive seven indexes only; persistent development DB remains0047/118 product tables/same4 development rows/FK0. FullM1–M5 remains active; no remote/customer edit,commit/push/deploy.

Actual527 unit/61 files and61 original reference integration tests passed; integrated strict types86713 and Next reference build86904 passed, plus14 reference Chromium tests29540. First full standard96007 exited1 after all315 old checks (including genuinely populated0047→0048 preservation) because a new helper expected application JSON for native hostile-Origin403; exact native403 and missing-Origin application JSON are now separate checks. Do not call this a complete M3h pass. Lint first found root this-alias, then an unused ignored-probe variable; both fixed, final whole lint still to confirm. Initial strict/UI Blob/optional-field errors were fixed and verified.

The latest rebuilt product passed actual isolated workerd/D1/Chromium probe (.local/m3h-browser-probe-third.log under worker), including24-row snapshot paging,complete CSV/JSON Blob downloads,forced completion-audit failure/no file,blur/focus,held200 followed by invalid identity,and genuine default-OFF UI. Root inspected the375px viewport capture .local/owner-history-mobile-viewport.png. Expected OWNER_HISTORY_EXPORT_FAILED in that log is injected stream-failure evidence,not a successful production download. The later capability lifecycle fix was rebuilt before this third probe; older runs used the prior bundle.

Actual isolated workerd/D1 upgrade (.local/m3h-upgrade-probe.log) preserves118 tables/71 populated fixture rows/39660 canonical bytes/audit trigger SQL/FK0, adds seven indexes and verifies workspace-time/photo/rowid-seek query plans and seek bytecode. The main populated upgrade also exercised existing command and sequence history before its later unrelated API-helper failure. NEW pre0048 backup694741 bytes SHA256c5c604d5bb06170f83e5d4677138d57b235630bffadf2bb1a95252c52799444f was restored into a separate directory and isolated-upgraded: all118 old-table hashes/counts/same4 development rows preserved/FK0/no new tables (.local/m3h-backup-restore.log and m3h-restored-upgrade.log). Current0048 SHA2560add396c3c6e0e1e4ad3d0fc519f0dca2cd8ae4e25ce98ec04042ba34206158f. No persistent0048 adoption until complete vertical acceptance and fresh live-state recheck. Keep gates OFF,repair forward,never restore over newer writes. Real OAuth/remoteR2/CORS/edge/free-tier/native-headed acceptance remains not_checked.

Next: finish full standard API/UI acceptance with actual per-action source checks across all owned workspaces,then local adoption if verified; afterwards scalable matching/batch,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted gates remain required. Preserve other dirty edits.

## 2026-10-28 — M3g5 independent annotation processing accepted locally

Genuine Owner processing of Guest annotations is implemented across schema/service/API/current reads/UI/recovery/tests. Independent open/in_progress/resolved decisions retain real Owner provenance and never modify Guest geometry, authorship or lifecycle. Guest content edits make the decision stale; explicit Owner reack pins the current content revision. Same-invitation sharing and different-invitation isolation remain enforced. The separate read-versus-write permission question is still pending: preserve can_annotate128 metadata read eligibility.

Final complete standard run17448 exited0:315 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g5-cloudflare-twelfth.log), including a fresh product build and the final mobile layout correction. Earlier complete runs31021/12781 and main rerun68398 also passed315; historical failed/partial runs below are not passing evidence. Coverage includes dual revision CAS, audit rollback, fresh-session historical replay, actual Owner A→B→A recovery isolation, held real200/full reload/exact UUID retry/current targeted read, and real historical AfterV28 Guest point/color edit. Guest own-target verification precedes fresh shared-target reconciliation; stale processing remains visible before reload, and Owner reack acknowledges content revision4.498 unit tests/58 files, generated integrated strict types, full lint and Next reference production build passed (m3g5-unit-indexed/types-indexed/lint-indexed/next-build logs). Root visually inspected the final Owner and Guest375px captures (worker .local/annotation-processing-owner-mobile.png and annotation-processing-guest-mobile.png). Guest labels/status are readable above the separate mobile action row; no horizontal overflow. Native-headed delivery remains unverified. Whole-repository Prettier,48-file document presence checker and git diff --check passed; the document checker is not an app test.

0047_owner_annotation_processing.sql is now applied LOCAL ONLY:48 commands succeeded. New651211-byte backup SHA256199ee6cc95a9cc0328de16c69e017c50cd3a59ef38940d8b91773bfd39ab770b, actual isolated restore70166/upgrade13204 and fresh live114-table parity passed before adoption. Post-adoption118 product tables/same4 development rows: all114 old table hashes/counts unchanged,4 new processing tables empty,FK0,no pending migrations. Evidence: worker .local/m3g5-local-adoption.log, m3g5-apply-0047.log and m3g5-after-0047-state.json. Current migration SHA2561d9ba2b88d59beb606be1b5457650c8e9fd8f0ca8a087f75ded146c182eef9ee is pinned in m3g5-isolated-upgrade-proof.json. Never restore an old backup over newer writes; gates OFF plus forward repair.

Actual current Wrangler/workerd D1 EXPLAIN verifies exact/page partial-index seeks and no global annotation/history materialization (.local/m3g5-query-plan-after-actual.log); readers join scoped processing states directly. This is local query-plan evidence, not edge CPU, latency or free-tier cost acceptance. All hosted/default feature gates remain OFF/hard-local; automatic deletion OFF/dry-run. Real OAuth, remote R2/CORS, edge deployment and native-headed delivery remain not_checked. No remote/customer modification, commit, push or deployment.

Next Task: full Owner operation history and exports, then scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, roles/multi-node and hosted acceptance. Full M1–M5 goal remains active. Preserve unrelated dirty edits. Earlier entries below are historical checkpoints; this entry supersedes their0046/pending0047 status.

## 2026-10-28 — M3g5 API accepted within partial runs; full UI acceptance active

All6 new processing API groups have actually passed in fourth76307/.local/m3g5-cloudflare-fourth.log: independent gate/input/current Owner boundary, body-free real Owner state/audit with unchanged Guest/comment sources, dual CAS+concurrency, content stale versus lifecycle +explicit reack, deleted-parent historical replay after original-session pruning, and Owner/Guest shared processing-clock cursor invalidation. The same run passed existing Guest annotation, Owner readonly and Owner authoring browser groups. It then failed only the new helper's parsing of the stored journal envelope as flat metadata; fixed. Fifth94575 passed a real accepted held processing request/full reload and then failed an overly strict raw-envelope equality: status legitimately changed ready→uncertain while metadata/command stayed identical. The helper now allows only that status transition and compares every original metadata field; B/A switching still requires unchanged post-reload raw bytes.

498 unit/58 files (.local/m3g5-unit-complete.log), final generated Worker/shared/Web strict (.local/m3g5-types-second.log), full lint (.local/m3g5-lint-final.log) and actual Next reference production build (.local/m3g5-next-build.log) pass. No hosted evidence. Current full standard run26971/.local/m3g5-cloudflare-sixth.log is ACTIVE; do not restart solely on observation timeout. The historical GuestAfterV28 setup and actual Guest UI point/color edit are in this helper, with strict own-target read preceding shared-target processing reconciliation and pre-reload stale-label assertion. A/B same-photo/version cross-invite recovery is also in source and still awaits a complete runtime pass. Root source/journal scopes were reviewed and hardened; no cross-invite replay/read/reconcile is allowed.

New651211-byte pre0047 backup and actual isolated restore/upgrade are verified as below:114 old-table hashes/4 development rows preserved,4 empty new processing tables,118 total/FK0. Persistent development DB remains0046/114tables;0047 adoption has NOT happened. Prepared ignored .local/m3g5-adopt-0047.mjs performs migration SHA/backup SHA/current114-table parity before local-only application, but must not run before full vertical acceptance. All default/hosted flags OFF/hard-local and deletion OFF/dry-run. No remote/customer edits, commit/push/deploy; fullM1-M5 remains active.

## 2026-10-28 — M3g5 independent annotation processing in progress

M3g4/0046 remains the last locally accepted baseline (308 Worker/browser checks,467 unit,114 persistent product tables/same4 development rows/FK0). This turn continues genuine Owner processing of Guest annotations: separate open/in_progress/resolved decision/revision, expectedAnnotationRevision + expectedProcessingRevision CAS, immutable body-free receipts and real Owner audit. Guest create/update (geometry/style/link) advances content watermark and makes prior decisions stale; Guest resolve/reopen/delete do not count as content edits. No Guest geometry/authorship/lifecycle is modified or impersonated.

Contracts, service/routes/default-OFF hard-local gate, current SQL readers, Guest status reconciliation, Owner processing panel and metadata journal are integrated.498 unit/58 files (.local/m3g5-unit-complete.log) and generated Worker/shared/Web strict types (.local/m3g5-types-second.log) pass; full lint passed before final scope hardening, whose focused Web lint/typechecks also pass. Cross-invite recovered A intent under B was found by read-only review and fixed before acceptance: full target match before claim/send/read, metadata-only guidance under B, and actual source scope in parent reconciliation. The browser regression is written but not yet passed. Root also requires the Guest content-edit browser path to prove strict own read followed by current shared processing projection without losing status.

First runtime99760 passed actual populated0046→0047 history preservation then failed the old Owner read field whitelist; processing was added explicitly with exact initial/null assertions, retaining all privacy restrictions. Second78496 failed the hostile-Origin fixture's expectation; real native403/Invalid Origin header is now checked separately from missing-Origin JSON403. Third81557 passed the first3 processing API groups and all content/lifecycle/reack assertions, then the privacy fixture incorrectly serialized its own body-bearing comment objects; it now checks only real receipt/annotation projections. No weakening of server checks. Guest historical UI helper was corrected to select actual AfterV28 (with a third Before) rather than silently switching the fixture to currentV1. Full runtime/UI acceptance remains PENDING; do not call this enabled/hosted usable.

NEW pre0047 backup651211 bytes, SHA256199ee6cc95a9cc0328de16c69e017c50cd3a59ef38940d8b91773bfd39ab770b, worker .local/m3g5-backup-integrity.json. Actual isolated restore62330 exit0 preserves all114 old-table hashes/4 development rows/FK0. Isolated0047 upgrade95858 exit0 preserves those114 tables and adds4 empty processing tables, total118/same4 rows/FK0. Proof .local/m3g5-isolated-upgrade-proof.json pins migration SHA256 ed8eceb5b18908a6a10fb617658d908f4eb1681ee85c13eaf23c0b888610dd11. No persistent0047 adoption; live remains0046. Before eventual adoption finish current API/UI acceptance and recheck current114-table contents against this backup. Before eventual adoption require NEW pre0047 backup/isolated restore/current114-table parity, populated-history preservation and full vertical acceptance; do not restore the pre0046 snapshot over newer data.

Guest /annotations/own and immutable Guest receipts remain unchanged. GuestShared cursor becomesv3 with independent Guest/Owner/processing counters; Owner Guest-read cursor becomesv2 with independent Guest/processing counters. Existing author-only OwnerOwn reader is unchanged. Current can_annotate128 read boundary stays unchanged pending the separate read-permission answer. All hosted gates and auto deletion remain OFF/dry-run. No remote/customer edit, commit/push/deploy. Read docs/ANNOTATION_PROCESSING.md for the frozen contract; preserve other dirty edits.

## 2026-10-28 — M3g4 genuine Owner annotation authoring accepted locally

M3g4 is locally accepted. Genuine Owner create/update/delete/resolve/reopen use separate commands/projection/changes/results, strict current Owner/session/exact invitation/photo/version authority, immutable before/after user audit and exact replay under a fresh valid Owner session. Owner can retain metadata for expired/revoked invitations and private versions; this never publishes bytes or broadens Guest access. Owner author-only recovery is separate from the existing readonly Guest annotation viewer. Guest shared lists include explicit Owner/Guest roles within one invitation, never peer write authority or identity IDs. Independent Guest/Owner cursor watermarks invalidate on either source, and the combined lifetime1000 cap includes tombstones while permitting replay/edit/lifecycle at capacity. Cross-role IDs and symmetric Owner request namespaces are guarded.

Actual final complete standard run94669 exited0:308 local Worker/workerd/D1/R2/Chromium checks (.local/m3g4-cloudflare-fourth.log). Prior complete third30871 also passed308.467 unit/55 files (.local/m3g4-unit-complete.log), generated Worker/shared/Web strict (.local/m3g4-types-complete.log), full lint (.local/m3g4-lint-final.log) plus focused final visual-helper lint passed. Same-turn Next reference build passed; it is not hosted E2E. Real375px Owner pointer geometry, reverse rectangle, full lifecycle, a held accepted create across full reload/exact UUID replay/current-own reread, and genuine disabled-Owner403 hiding Gallery/photos while preserving the exact raw journal all passed. Root visually inspected worker .local/owner-annotation-authoring-updated-mobile.png: actual purple private preview and red rectangle are visible. The helper also checks saved SVG geometry/visibility and actual red stroke pixels, retaining a canvas capture. Native headed delivery, real OAuth/remote R2/CORS/edge/free-tier acceptance remain not_checked.

A real integration defect found by the second runtime (Object.toString on a parsed query) was fixed with the production URLSearchParams helper and3 regression tests; strict types alone had not caught it. Initial raw-tamper error assertion was corrected to the actual predecessor guard without allowing writes. Current Owner auth denial and verified identity changes invalidate panel and Gallery caches/controllers under exact scope/generation guards, retaining journals; stale callbacks cannot repopulate or clear a replacement scope. Guest own/result contracts remain unchanged.

0046 is applied LOCAL ONLY:50 commands succeeded after NEW594730-byte backup SHA256 bf27e82976d3bddb995ca669f2f39eadfc6eca85228cc385403b7a1a4b9c3d09, isolated restore/isolated upgrade and a fresh live110-table hash comparison. Successful adoption36744 exit0: worker .local/m3g4-local-adoption-second.log and m3g4-apply-0046.log. All110 old tables remain byte-content-hash/count identical;4 new Owner tables empty, total114 product tables/same4 development rows/FK0/no pending migrations. Proof pins migration SHA256 c2288d201616fa486fed664bc019ac2a6a6249a9f629626986a1193d0eefd230 (.local/m3g4-isolated-upgrade-proof.json). First adoption11759 failed before migration because this Wrangler version has no --yes on migrations apply; read-only list confirmed0046 still pending. Corrected non-interactive local-only invocation rechecked the live snapshot before success. Never restore either backup over newer writes; gates OFF and forward repair.

All annotation hosted/default gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer edit, commit/push/deploy or production acceptance. The user-confirmed same-invitation sharing policy is resolved. The separate read-versus-write permission question remains pending, so can_annotate128 read eligibility is unchanged. Owner browser coverage does not claim native headed delivery or every valid-B delayed-response scenario (Guest already has separate actual coverage; Owner metadata CAS has unit/source review).

Next Task: genuine Owner processing decisions on Guest annotations with independent processing revision/status/audit (never modify Guest geometry/lifecycle or impersonate a Guest), then full Owner history/exports. FullM1-M5 remains active: scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, roles/multi-node and hosted acceptance remain unfinished. Preserve unrelated dirty edits.

## 2026-10-28 — M3g4 functional runtime passed; final visual check pending

Actual complete standard run30871 exited0:308 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g4-cloudflare-third.log), including all genuine Owner annotation API/cap/collision/history/replay cases, shared paired watermarks, real375px point/reverse rectangle/create/update/resolve/reopen/delete, a held accepted create across full reload with exact UUID/current-own reread, and real disabled-Owner403 clearing Gallery/photo cache while retaining the exact raw journal.467 unit/55 files (.local/m3g4-unit-complete.log), generated strict types (.local/m3g4-types-complete.log) and full lint (.local/m3g4-lint-final.log) pass. Earlier Next build passed; no hosted evidence.

Root visually inspected the first new Owner screenshot and found only controls/black canvas top visible because the nested scroller was positioned above the actual image. Functional assertions passed, but that capture was NOT visual acceptance. Helper now explicitly scrolls real decoded photo/rectangle into view and verifies saved SVG attributes plus actual red stroke pixels before capturing; final full run94669/.local/m3g4-cloudflare-fourth.log is active. Do not restart solely on observation timeout. Product source is unchanged by the screenshot-only strengthening.

NEW backup/isolated restore/isolated0046 upgrade are verified as detailed below. Latest live pre-adoption snapshot90074 exit0 still matches all110 backed-up tables/4 rows/FK0 (.local/m3g4-pre-adoption-parity.log under worker). Persistent DB is still0045; adoption is pending final checks. All flags OFF/hard-local; deletion OFF/dry-run; no remote/customer change, commit/push/deploy. FullM1-M5 remains active.

## 2026-10-28 — M3g4 genuine Owner annotation authoring in progress

The confirmed annotation policy remains same-invitation shared / different-invitation isolated. Owner authoring uses new strict contracts, independent commands/projections/changes/results in source-only migration0046, genuine user/session audit actions and a current Owner author-only recovery reader. It never writes a Guest command. Owner metadata can target any owned immutable version and retained invitation; Guest visibility still requires a live authorized invitation and an eligible published version. OWNER_ANNOTATION_AUTHORING_ENABLED defaults OFF and is hard-local, independent of Guest/comment flags.

Current source integrates Owner service/routes/editor/journal and mixed Guest/Owner shared rows with explicit authorType and independent Guest/Owner cursor watermarks. Actual464 unit/54 files (.local/m3g4-unit-final.log), generated strict types (.local/m3g4-types-final.log), full lint (.local/m3g4-lint-second.log) and Next build (.local/m3g4-next-build.log) passed before the latest URL serializer correction. First full runtime39250 exited1 only on an overly narrow raw-tamper error assertion; the trigger correctly rejected the write. Second5450 passed every new Owner API group, combined1000-row/tombstone cap, cross-role ID collision, paired stale cursors, populated0046 upgrade, Guest annotation browser and Owner readonly browser, then failed the new editor initial read. Root found the parsed query object was serialized with Object.toString instead of URLSearchParams; correction and a production-path regression test are underway. Full M3g4 UI acceptance remains PENDING. Current-auth denial/identity change now force Gallery cache/selection/request invalidation under generation guards while preserving all journals; actual disabled-Owner403 browser coverage is being added.

NEW pre0046 backup594730 bytes, SHA256 bf27e82976d3bddb995ca669f2f39eadfc6eca85228cc385403b7a1a4b9c3d09, worker .local/m3g4-backup-integrity.json. Actual isolated restore54476 exit0 matches all110 old-table hashes/4 development rows/FK0. Isolated upgrade68699 exit0 preserves all110 tables and adds four empty Owner tables, total114/same4 rows/FK0. Proof .local/m3g4-isolated-upgrade-proof.json pins migration SHA256 c2288d201616fa486fed664bc019ac2a6a6249a9f629626986a1193d0eefd230. Migration0046 has NOT been applied to persistent local D1; it remains0045. Before eventual adoption complete actual UI acceptance and recheck live110-table state against the NEW backup; never restore either older snapshot over newer writes. All hosted flags OFF, automatic deletion OFF/dry-run. No remote/customer changes, commit/push/deploy or hosted OAuth/R2 acceptance.

A separate read-versus-write permission question remains pending: retain the existing independent can_annotate128 read boundary until explicitly answered; do not infer permission broadening from elapsed time. Owner processing of Guest notes and remaining M1-M5 features are unfinished. Preserve all unrelated dirty edits.

## 2026-10-28 — M3g3 invitation-shared annotations accepted locally

The user-confirmed policy 同邀請共用（比照留言） is implemented and locally accepted. Guest main lists and overlays use /annotations/shared for the current sealed invitation; different invitations remain isolated. isMine and plain client badges derive from exact stored identity, with no peer edit/delete/resolve/reopen controls. /annotations/own remains strict author-only for command recovery and postreceipt current-row reconciliation. Commands, revision CAS, immutable witnesses and full Guest audit are unchanged; sharing never grants peer writes or image/compare/comment privileges. Shared cursors have their own viewer/session/scope domain and all-author watermark. Peer comment links are redacted without can_comment; no peer Guest IDs, bodies, keys, credentials or media URLs are exposed. No new migration was needed beyond0045.

Actual complete standard run:295 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g3-cloudflare-first.log, session43746 exit0).430 unit/50 files (.local/m3g3-unit-first.log), generated Worker/shared/Web strict types (.local/m3g3-types-first.log) and full lint (.local/m3g3-lint-first.log) passed. The same turn also passed61 reference integration/10 files,14 reference Chromium/28.1s and Next production build; these are reference coverage, not hosted E2E.375px Guest and Owner screenshots in apps/worker/.local were visually inspected; Owner capture includes the actual version overlay. Controlled delayed200/401 cases are distinct from explicitly canceled headless lifecycle cases; no native headed delivery claim.

Own canvas/recovery and Owner readonly base first passed288 checks (.local/m3g2-cloudflare-eighth.log, session78510 exit0). Actual tests cover point/reverse rectangle/keyboard/portrait/resize/zoom+pan pointer mapping, ancestor clipping, source version scope, real same-invitation peers and different-invitation isolation, own-only recovery reads, current tombstones, lost response/full reload/exact metadata CAS, live late200/401 versus valid replacement raw intent, corrupt/unavailable storage, cookie identity changes and current401 gallery-wide privacy clearing. Owner viewing supports explicit invitation/version, all authors, retained expired/revoked invite history and private draft metadata; bytes remain separately authorized. Cached image onLoad dimensions survive no-op selection and invite switching. Owner resource UUIDs retain exact SQLite identity; only new request UUIDs have canonical case.

0045 is now applied LOCAL ONLY:48 commands succeeded after a new550884-byte backup and isolated restore/upgrade proof. Backup SHA256 e031882926ae6237b483ab9008d8a5cb60d8ea719433e62d5f42487a90475b91; manifest apps/worker/.local/m3g2-backup-integrity.json. The live pre-adoption snapshot still matched all106 backed-up old tables. Post-adoption hashes preserve every one of those106 tables;4 new annotation tables are empty, total110 product tables/same4 development rows/FK0/no pending migrations. See worker .local/m3g3-apply-0045.log, m3g3-post-adoption-snapshot.log and m3g3-post-adoption-parity.log. Never restore this old backup over newer writes; gate OFF and repair forward. All Guest/Owner annotation gates remain OFF/hard-local, automatic deletion OFF/dry-run. No remote/customer modification, commit/push/deploy or real OAuth/R2/CORS/edge/free-tier acceptance. FullM1-M5 remains active: next genuine Owner annotation authoring/processing (never Guest impersonation), full Owner history/exports, scalable matching/batch, delivery/notifications, retention confirmation/retry and hosted/role/multi-node acceptance. Visibility is resolved; do not ask again or revert to own-only final display.

## 2026-10-28 — User decision: same-invitation annotations are shared

The user explicitly answered 同邀請共用（比照留言）. The prior visibility question is RESOLVED. Implement an invitation-shared reader/API/list/overlay while retaining the explicit own reader for exact recovery and existing author-only create/update/delete/resolve/reopen authority. Different invitations must remain isolated. See the new DECISIONS/GUEST_ANNOTATIONS/TASKS entries. Backend shared-reader/API test work is underway in new files; shared UI and full acceptance remain pending. Do not claim own-only display satisfies the final user policy.

Guest own drawing/recovery/identity/mobile acceptance passed within sixth/seventh runs, and375px Guest screenshot was visually inspected. Seventh failed on Owner cached-preview geometry after changing invitation: root fixed passive-effect clearing of image dimensions and made no-op selector changes idempotent. Eighth full local run .local/m3g2-cloudflare-eighth.log/session78510 is active; do not restart solely on observation timeout. Backup/isolated restore/isolated0045 upgrade are verified as documented below; persistent DB remains0044 and no annotation tables are persistently present. New policy does not enable any hosted flag; deletion stays OFF/dry-run. FullM1-M5 remains active.

## 2026-10-28 — M3g2 backup/isolated upgrade verified; complete UI acceptance pending

New pre0045 local backup is550884 bytes, SHA256 e031882926ae6237b483ab9008d8a5cb60d8ea719433e62d5f42487a90475b91, manifest apps/worker/.local/m3g2-backup-integrity.json. Actual restore to a new isolated directory matches all106 old-table row-content hashes,4 total development rows and FK0 (.local/m3g2-backup-restore.log under worker, session5620 exit0). Applying0045 ONLY to that restored copy also preserves all106 old tables, adds4 empty tables, total110 tables/same4 rows/FK0 (worker .local/m3g2-restored-upgrade.log, session3506 exit0). Persistent development DB is still0044; before eventual adoption recheck live state against this snapshot and take a new backup if anything changed. Never restore the old snapshot over newer writes.

Fourth full run53696 and fifth94286 both ended exit1 at the historical comparison selector, after actual point/rectangle/keyboard/zoom+pan pointer creates and all five new Owner API groups. Fifth diagnostic proves version GET200 and correct3457 permission mask; V28 is the selected Before and intentionally omitted from After to prevent equal-version comparison. Fix the test to select a different Before before choosing V28 as After; retain the product guard. Complete remaining portrait/version/recovery/delayed-response/identity/Owner browser checks and visual screenshot inspection before accepting M3g2.

Source now maps pointers from the actual decoded image rectangle while rejecting viewport/ancestor clipping via hit testing. Exact same-intent current401 clears the entire Guest gallery/Lightbox and selection state through a guarded callback, retaining metadata recovery; independent403 remains scoped. Guest pageshow reauthorizes. Stale A must not invoke global clearing or change replacement B. Live200/401 raw-replacement, cancellation-only and current401 gallery clearing tests are in source but NOT yet reached by a complete passing run.

Actual427 unit/49 files (.local/m3g2-unit-complete.log),61 reference integration,14 reference Chromium/28.1s, full generated integrated strict types (.local/m3g2-types-integrated.log), earlier full lint plus focused final integration lint and Next build pass. Full final lint/Worker UI suite remain pending after the latest source/test edits. Gates OFF/hard-local, deletion OFF/dry-run; no remote/customer change, commit/push/deploy or hosted/native headed acceptance. FullM1-M5 remains active. See GUEST_ANNOTATIONS.md/TEST_ACCEPTANCE and preserve dirty worktree.

## 2026-10-28 — M3g2 third runtime checkpoint

Third full local run .local/m3g2-cloudflare-third.log/session63283 ended exit1 at the first actual Guest point-coordinate assertion: request y412205 versus DOM-painted expected y412256, a51/1,000,000 discrepancy. All five new Owner API groups passed first, including genuinely expired/revoked invitations, readonly multi-author/tombstone pages, cursor changes and a fresh expired Owner session without altering the primary OAuth session. This is not complete Guest/Owner UI acceptance.

Next fix pointer mapping against the decoded rendered image rectangle, keeping the original viewport clipping check and pure oriented-image adapter, rather than weakening request/DB equality. Current 401/403 command/pagination denials must clear private UI only for the matching generation/Guest/full intent while retaining recovery metadata. Also distinguish a canceled lifecycle request from a genuinely delivered late panel response; add raw-journal-replacement acceptance for real delayed200/401 without weakening the send mutex. Final427 unit/61 reference integration/14 reference Chromium, generated strict types, full lint and Next build evidence remains in the preceding checkpoint; rerun focused/full relevant checks after these edits.

0045 remains source-only/local DB0044; all hosted gates OFF/hard-local and deletion OFF/dry-run. New ignored .local/m3g2-local-state.mjs is prepared for later backup/restore/hash parity but has not been executed. No persistent migration, remote/customer modification, commit/push/deploy or hosted acceptance. FullM1-M5 remains active.

## 2026-10-28 — M3g2 annotation UI integrated; acceptance in progress

Guest own point/rectangle canvas, version-bound drawing/list/lifecycle and metadata-only recovery UI are now mounted in the current Lightbox and After comparison view. Pending operations protect navigation. Authenticated Owner readonly invitation/version annotation contracts, D1 reader, routes, independent default-OFF OWNER_ANNOTATIONS_ENABLED gate and viewer are integrated. Owner metadata may include owned private drafts; Guest eligibility and private image-byte authorization remain independent and unchanged. Peer annotation visibility still awaits the explicit product decision; no peer list is exposed to Guests.

Actual checks this turn:427 unit/49 files (.local/m3g2-unit-final.log),61 reference integration/10 files,14 reference Chromium/28.1s, Next production build, final generated Worker/shared/Web strict typecheck (.local/m3g2-types-final.log) and full lint (.local/m3g2-lint-final.log) passed. Initial test discriminant and Owner React lint findings were fixed. First Cloudflare run32344 exited1 on an observation bug: ordinary annotation POSTs were not included in the helper mutation list; bridge now observes every actual command. Second run12542 passed the first three new Owner API groups, then exited1 because the expiry fixture tried to UPDATE an immutable deadline; the guard correctly rejected it. Fixture now creates a genuinely short-lived sealed invite, proves pre-expiry access and polls the D1 clock before post-expiry assertions. Full-metadata late-response CAS, synchronous Owner scope clearing and explicit visible SVG strokes are repaired. Third full API/browser acceptance and screenshot inspection remain pending; do not call M3g2 accepted yet.

0045 remains source-only; persistent development DB remains0044. New pre0045 backup/isolated restore/old-table parity and local adoption are pending after vertical acceptance. All hosted gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer data modification, commit/push/deploy or real OAuth/R2/CORS/edge acceptance. Full M1-M5 remains active and unfinished. Preserve dirty worktree and use actual terminal logs before updating acceptance claims.

## 2026-10-28 — M3g1 Guest annotation backend accepted locally

M3g1 Guest annotation backend and coordinate foundation are accepted locally. Point/rectangle geometry is normalized to integer1e6 in the oriented preview frame and immutable photo/version scope. Independent can_annotate128 never grants images/comments/selection/compare. Author-only create/update/delete/resolve/reopen, dual immutable command/state/change/result witnesses, full before/after Guest audit, exact same-session replay, lifetime cap and scoped own cursor pages are implemented. Optional own-comment links additionally require can_comment256. Public own activity exposes only annotationId/revision/state, never geometry/style/comment link/body. No drawing UI or peer list is shipped in this slice.

281 Worker/406 unit/61 reference integration/14 reference Chromium and types/lint/build passed.0045 additive source/upgrade/query-plan proof only; no persistent migration or drawing UI claimed. Scope indexes prevent own reads walking peer revision ranges. Default gates OFF/hard-local and deletion OFF/dry-run. See GUEST_ANNOTATIONS.md and HANDOFF; full M1–M5 remains active.

## 2026-10-28 — M3f2b accepted locally

Independent Owner processing (待處理/open, 處理中/in_progress, 已處理/resolved) is now locally integrated and accepted. It preserves Guest text, lifecycle and revision; Guest body edits mark the saved decision stale, and explicit acknowledgement uses both CAS revisions. Same-invitation Guests see readonly status; other invitations stay isolated. Body-free receipts, genuine Owner audit and shared cursor markers commit atomically. Status and reply recovery share full metadata CAS and always reconcile a fresh authorized thread row before confirmation.

269 Worker/369 unit/61 reference integration/14 reference Chromium and strict/lint/build passed.0044 adopted locally after verified backup/isolated restore and102 old-table hash parity; new4empty/FK clean. Shared marker sequence preserved. Default gates OFF/hard-local and deletion OFF/dry-run; no hosted acceptance/deployment. See COMMENT_PROCESSING.md and HANDOFF; independent annotations and remaining M1–M5 are next.

## 2026-10-28 — M3f2b source integration (not yet runtime accepted)

Added independent Owner processing decisions, immutable history/body-free receipt/audit, Guest edit stale detection, current authorized read projections, Owner controls and Guest readonly badges. Status/reply recovery shares full intent CAS and bodyless status restore.0044 preserves prior shared sequence; protected insert/update are separate to avoid SQLite UPSERT before-insert guard conflicts. Added indexed legacy reply namespace checks, upgrade/API/browser tests and COMMENT_PROCESSING.md. Current369 unit/reference61/14/types/lint/build checks pass; full Cloudflare and persistent0044 adoption remain pending. No hosted deployment or customer change.

## 2026-10-28 — M3f2a Owner reply vertical accepted locally

Supersedes pending M3f2 checkpoints below. Genuine Owner thread reads/reply/edit/delete, explicit invitation/version UI, readonly same-invitation Guest visibility, durable recovery and shared thread cursors are integrated. Actual final standard run:260 local Worker/D1/R2/Chromium checks passed (.local/m3f2-cloudflare-twelfth.log, session94956 exit0);345 unit/41files,61 reference integration,14 reference Chromium(33.9s), generated strict types/lint/Next build passed.375px Owner screenshot was visually inspected. Hosted services and native headed lifecycle delivery remain not_checked.

0043 applied LOCAL ONLY after verified ignored468000-byte backup and isolated restore.63 commands succeeded;97 old tables retain exact row-content hashes,5 new tables start empty, FK clean/no pending migrations. Populated pre0043 Guest history upgrade also passes using guarded commands and an actual private16x16 R2/Sharp V2. Keep shipped OWNER_COMMENTS_ENABLED=false/hard-local, deletion OFF/dry-run. No customer/remote changes, commit/push/deploy. FullM1–M5 remains active; next Owner processing status with genuine actor provenance, then independent point/rectangle annotations, full history/exports/delivery/retention/hosted acceptance. Read OWNER_COMMENTS.md and HANDOFF before continuing.

## 2026-10-28 — M3f2 backend accepted locally; Owner UI pending

Actual standard full local Worker run passed258 checks (.local/m3f2-cloudflare-sixth.log, session1557 exit0), including15 new Owner reply/API cases, existing Guest/Owner Chromium and actual isolated D1/R2/Sharp flows.338 unit/40files, root strict types, lint and isolated43-migration/FK probe passed before the newest UI work;7 additional Owner journal tests now pass after reproducing/fixing2 stale-storage overwrite cases. Do not treat these as final full Owner UI acceptance.

0043 source adds genuine Owner replies/commands/changes/results, shared Guest/Owner markers, canonical request casing and symmetric indexed legacy namespace guards. No persistent0043 application, remote change, commit/push/deploy. Owner replies remain OFF/hard-local in all environments; deletion OFF/dry-run. Owner UI is now mounted behind the gate, but bootstrap visibility/race fixes, new1000-reply capacity case and actual375px workflow/recovery acceptance are pending. Read docs/OWNER_COMMENTS.md and latest HANDOFF. FullM1–M5 remains active; Owner status/annotations/delivery/retention/hosted acceptance are unfinished.

## 2026-10-28 — M3f2 Owner reply contracts; runtime pending

Owner reply/edit_reply/delete_reply now have strict shared Zod contracts and meaningful validation tests. Commands reject client actor/session/workspace/Guest identity injection, bind new replies to invitation/photo/version/parent revision, and require reply CAS for edits/deletion. Owner thread pages enforce scoped unique items; authorType/parent/canEdit and tombstone/result invariants prevent representing Guest text as an editable Owner reply. Body normalization reuses the existing Guest Unicode rules.

Actual checks this turn:325 unit tests/39files passed (including9 new Owner contract cases); root TypeScript strict check and focused ESLint passed. ESLint emitted the existing React-detection warning, with no lint findings.44-file documentation portability check passed (presence only). Initial tsc caught a test reading body without narrowing the delete_reply union; corrected narrowing passed the rerun. Existing243 Worker/reference/browser acceptance remains historical and was not rerun for these unexposed contracts. No new migration, API, UI, persistent DB change or hosted deployment.

Read docs/OWNER_COMMENTS.md for the concrete next implementation. Add genuine Owner commands/replies/changes/results and a shared transactionally guarded thread watermark; preserve0042 Guest actor/session FKs, all Owner request namespace witnesses and exact replay under a fresh valid Owner session. Then service/API/UI/runtime acceptance; Owner processing-state transitions require explicit actor-aware projection. Do not advertise Owner replies as available yet. All default-OFF/hard-local flags and deletion OFF/dry-run remain unchanged. FullM1–M5 remains active; annotations/delivery/retention/production acceptance are unfinished.

## 2026-10-27 — M3f1 Guest version comments

- Added invitation-isolated version threads, single/24-target batch comments, author-only editing/deletion/resolution/reopening, safe text and pagination.
- Added0042 immutable command/change/result/audit provenance, atomic capacity/CAS guards and current-state reconciliation so old receipts cannot resurrect deleted comments.
- Added metadata-only durable retry, journal compare-and-set and real mobile fault/identity/pagination acceptance.243 Worker,316 unit,61 reference integration,14 reference Chromium and strict/lint/build passed.
- Applied0042 locally only after ignored430590-byte backup; new tables empty, FK clean, none pending. Feature flags OFF/hard-local and deletion OFF/dry-run; no remote/deploy/commit/push.
- Remaining: Owner comment workflow, annotations and the rest of M1–M5; hosted services remain unverified.

## 2026-10-27 — M3f1 source integrated; runtime acceptance pending

Schema0042, D1GuestCommentsRepository, strict routes/default-OFF gate and actual Guest single/batch UI are integrated; no persistent0042 application.315 unit tests/38files passed. Isolated42-migration workerd/D1 syntax/FK probe passed with all4 new tables empty. Full generated Worker/shared/Web typecheck passed; later UI journal-race hardening also passed Web strict checks. First Next build passed before the final recovery hardening; final build remains required. Full lint initially found unused new-test variables plus a temporary diagnostic harness; tests were corrected and the completed temporary harness removed. No final full-suite acceptance yet.

Two API diagnostic runs use real baseline Worker/R2/Chromium and actual new comment HTTP/D1 fixtures; new comment browser checks were explicitly omitted. First58655 failed on stale24-target fixture assertions expecting2; production returned24 valid results. Second55592 passed same-invitation privacy, independent can_comment and the24-target/2,000-emoji batch, then failed because a malicious Origin is rejected by the outer runtime with plain403 `Invalid Origin header`, while the fixture expected application JSON. An isolated actual Worker probe verified missing Origin JSON403/FORBIDDEN_ORIGIN versus malicious-Origin plain403; tests now distinguish both without relaxing protection. Preserve .local/m3f-cloudflare-api-first.log and second.log. Capacity/CAS/full browser cases remain unaccepted until the standard full run.

Static review found and fixed duplicated batch body/result-size bounds, missing Owner-creator binding/timestamp/audit-session consistency, and a missing comment audit-change witness guard. A second independent UI review found delayed old responses could erase a newer request journal for the same album/Guest. Root added metadata/operation compare-and-set to success, denial demotion, abandonment and async recovery; a real same-Guest two-command browser regression is being added. Unknown intents stay scoped across401/409, and browser storage contains only metadata/body hashes. NFC/Unicode trim is enforced by application Zod; trusted raw SQLite writers lack built-in NFC normalization. Public thread deletion gives tombstones; same-author/same-session historical exact command replay may return its immutable prior body, while own activity exposes only revision/state.

Next: complete standard full Worker/API/Chromium regression, final types/lint/build/format/docs checks and only then consider local0042 adoption after backup. Keep hosted flags OFF/local-only, deletion OFF/dry-run, no commit/push/deploy/customer writes. FullM1–M5 remains active; Owner comment work, annotations, full history/delivery/retention/hosted acceptance remain required.

## 2026-10-27 — M3f1 invitation-shared version comments underway

M3e is accepted locally (228 Worker checks); M3f1 is not yet accepted. Root froze strict comment contracts, default-OFF/hard-local GUEST_COMMENTS_ENABLED and HTTP routes;25 new contract/gate unit tests passed.0042 schema/service, actual UI, same-invitation/different-invitation authorization and browser recovery tests are under parallel implementation. No0042 application or hosted acceptance. See docs/GUEST_COMMENTS.md. FullM1–M5 remains active, including independent annotations and later Owner/history/delivery/retention work. Preserve current dirty worktree and all previous accepted evidence.

## 2026-10-27 — M3e Guest published version comparison accepted locally

This supersedes the pending M3e checkpoints below. Guest Lightbox now provides published version history, slider, side-by-side and overlay comparison with synchronized zoom/pan, keyboard controls, preserved image proportions and explicit size/aspect warnings. Current version metadata remains pinned even outside the24-item history page. Authorization requires independent can_view + can_compare_versions, never can_select. Ready unpublished drafts are excluded from history AND direct Guest derivative requests; current/baselineV1/immutably published versions remain eligible. Every metadata/byte request rechecks live session, invitation, Owner and active parent scope.

Actual final evidence:228 local workerd/D1/R2/Chromium checks passed (session21352, .local/m3e-cloudflare-seventh.log, exit0);288 unit tests/37files, full generated strict typecheck, lint, Next production build and targeted Prettier passed.375px comparison screenshot apps/worker/.local/guest-version-comparison-mobile.png was visually inspected. New tests use actual local R2 originals and Sharp derivatives,27 published versions plus an unpublished ready draft, a restored V1 outside page one, portrait V2 and a neighboring photo. They cover strict/head-bound pagination, safe metadata, independent permissions, unpublished-byte denial, readonly ledgers, keyboard/focus and live revocation. Reference integration/E2E were not rerun for M3e; their prior61/14 passes remain historical baseline. Hosted Google/GitHub/R2 CORS/edge, real cloud quotas and deployment remain not_checked.

Earlier failures remain in first–sixth logs. Actual fixes include access-envelope parsing, upload-session metadata joins that do not confuse init/completion request IDs, nullable head typing, and capturing range values before deferred React state updates. Sixth run passed new API/browser checks but failed later while an old exchange test held four unconsumed Response handles. It now issues and validates each denial sequentially with all original assertions; seventh full run passed. The underlying transport/body-consumption cause is not proven and no production login fix is claimed. Intentional TEST_* audit-trigger exceptions in the passing suite are asserted rollback injections.

No new schema/migration or persistent development/customer data changes in M3e;0041 remains latest locally applied. No commit, push, remote resource or deployment. GUEST_VERSION_COMPARISON_ENABLED remains false in all Wrangler environments and rejects non-local enablement. Automatic deletion stays OFF/dry-run. Recovery: disable comparison, retain immutable assets/versions/publication witnesses/audit and preserve the stricter asset ACL; repair forward. See docs/GUEST_VERSION_COMPARISON.md.

Next task: version-bound comments/annotations with independent rights, same-invitation comment sharing and different-invitation isolation, delivered through schema/service/API/UI/tests/docs. Owner comparison/history, canonical indexed matching/rules/batch, delivery/notifications, retention planning/confirmation/retry, production processing/roles/multi-node and hosted acceptance remain required. FullM1–M5 stays active. Next operator: run `python tools/check_handoff.py`, then read the comparison contract and latest TASKS before starting the comment schema. Preserve the dirty codex/kino-pic-foundation worktree (base b14d505); do not assume untracked files are committed.

## 2026-10-27 — M3e comparison runtime verified; full regression pending

Guest published history and Lightbox slider/side-by-side/overlay are implemented behind default-OFF/hard-local GUEST_VERSION_COMPARISON_ENABLED. Both can_view and can_compare_versions are required independently of selection. Current/baselineV1/immutably published ready versions are eligible; never-published drafts remain inaccessible through both history and direct asset URLs. The current version is pinned outside DESC24 pages; each request rechecks live authorization.

Latest actual checks: full generated typecheck, lint,288 unit tests/37files and Next production build passed. Sixth local Worker run passed all new version API cases and375px Chromium comparison, including real private R2/Sharp derivatives, portrait/landscape letterboxing, keyboard ranges, synchronized transforms, readonly ledgers and live revocation. Screenshot apps/worker/.local/guest-version-comparison-mobile.png was inspected. The full run then failed in the existing Guest exchange denial fixture with Body is unusable: Body has already been read; its diagnosis/full rerun remains pending. This is not final full-suite acceptance.

Fixed actual integration defects: access response envelope, upload-init versus completion request-ID join, nullable head typing, and deferred React range event access. Earlier failed runs remain in .local/m3e-cloudflare-first.log through sixth.log; do not overwrite their evidence. No schema/migration, persistent data operation, commit, push or deployment in M3e.0041 remains latest locally applied; hosted OAuth/R2/CORS/edge acceptance is not_checked. Automatic deletion stays OFF/dry-run. FullM1–M5 remains active.

Next: diagnose the Guest exchange fixture, rerun the full local Worker suite, finalize comparison docs/portability checks, then implement version-bound comments and annotations with same-invitation sharing and different-invitation isolation. Large-album indexed matching/batch, Owner comparison/history, delivery/notifications, retention and hosted acceptance remain required.

## 2026-10-27 — M3c2b2 resolved single-file upload vertical slice accepted locally

This supersedes pending checkpoints below. The Owner workbench now has real strict preview, explicit Auto/Assisted choice, atomic reservation, authorized create-once R2 PUT and ordinary/private-version completion. Same-name changed content can create a private retouch version of one logical photo without switching its visible head. Assisted mode explicitly selects a same-album head or independent photo; exact duplicates/invalid/incomplete/pending-name evidence cannot allocate a resolved upload. The old independent-photo uploader remains an explicitly labelled manual override. Four confirmed project modes are offered only behind the new matching capability.

Existing immutable upload_requests payloads capture resolution and optional server-derived versionTarget.0041 atomically checks the0040 watermark plus project mode/revision before reservation; prior namespace/ACL/quota/head-CAS/replay guards remain. Two UUIDs from one preview have one reservation winner; exact accepted retry retains one original session/target. Actual private R2 raw dimensions must match declared matching dimensions for both ordinary and version completion. A mismatch records existing UPLOAD_METADATA_MISMATCH review state, returns the specific422, retains quota and creates no V2 metadata. SQL separately rejects mismatched workflow completion. Processing/full decode remains separate; no implicit head switch.

The scoped write-ahead journal keeps original bodies/UUIDs, file fingerprints and captured target, with no bytes/object keys/signed URLs/secrets. Unknown results retry/check original work and cannot silently allocate a replacement. Saved work stays visible/resumable after project mode changes to Off/Manual; modeActive blocks only fresh matching controls. Needs-review work retains its journal and stops further PUT/reservation attempts. Server-confirmed completion notices survive local gallery refresh.

Final run79633 (.local/m3c2b2-cloudflare-fifth.log) terminated0:220 local workerd/D1/R2/Chromium checks. New actual API cases cover default-OFF/mode gates, canonical replay/current ACL, deterministic stale SQL clone, same-preview race, pending names/isolation, failed-audit full rollback/exact retry, real PNG V1→privateV2/head preservation, explicit assisted new-version/new-photo and foreign-head denial, and declared-vs-actual dimension review/quota retention.375px browser uses checked synthetic SigV4 PUTs; lost accepted201 is recovered by exact replay after changing Auto→Manual, reload/reselect, then restoring Auto for V2. Original guest/history/version/quota/immutability/Cron regressions passed.

Also passed:260 unit tests/35files (.local/m3c2b2-unit-complete.log),61 reference integration/10files (.local/m3c2b2-integration.log),14 reference Chromium29.1s (.local/m3c2b2-reference-e2e.log), full generated Worker/shared/Web strict types60186 (.local/m3c2b2-types-complete.log), final full lint63540 (.local/m3c2b2-lint-final.log), Next production build16854 (.local/m3c2b2-next-build.log), targeted formatting and documentation checks. Reference OAuth providers and local SigV4/R2 bridge are synthetic; hosted Google/GitHub/R2 CORS/edge/deployment/free-tier limits remain not_checked.

0041 applied ONLY to local development D1 after ignored backup apps/worker/.local/d1-before-0041-20261027.sql (426031bytes).10 commands successful; none pending, foreign_key_check empty, resolved_requests0 with no backfill. The populated upgrade test preserves all old rows. A static comparison proves the three replaced guards retain predecessor checks except reviewed mode/key-count changes. No remote/customer migration, commit, push or deployment. PHOTO_VERSION_MATCHING_ENABLED is false in all Wrangler environments, requires all supporting upload/version/configuration flags, and rejects non-local enablement. Automatic deletion stays OFF/dry-run.

Intermediate failures are retained as evidence: first run19503 hit an invalid JSON expectation for the existing plain-text403; two unused fixtures and a generated literalfalse type mismatch were corrected. Second90447 hit a browser assertion confusing public choice with server-derived versionTarget. Third4197 hit a redundant nested locator after successful mode-change recovery. Fourth80937 passed new browser acceptance but an old test's zero-held-quota expectation shared the new deliberate needs-review fixture workspace. New acceptance now creates its own workspace; held quota was never cleared to satisfy the old assertion. Fifth is the final full pass. Intentional audit-failure injection log lines are expected and asserted.

Next: finish scalable canonical lookup, persisted opt-in matching rules and multi-file batch matching; single-file complete-set cap remains1000 version/pending rows. Guest version history/Before-After slider/side-by-side/overlay is the next independent product vertical slice. FullM1–M5 remains active: comments/annotations (same invite visible, different invite isolated), full Owner history/downloads, delivery/notifications, production processing/retention/roles/multi-node, backup restore and hosted release gates remain required. See RESOLVED_UPLOADS.md. Recovery disables matching/configuration writes, retains0040/0041 guards/history/targets/fences/quota, and repairs forward; restore backups only into an isolated verified recovery copy.

## 2026-10-27 — M3c2b1 candidate watermarks and pending uploads accepted locally

Migration0040 adds append-only `album_matching_changes`: future photo/version inserts, head insert/switch and upload reserved/cancelled/expired transitions append scoped internal invalidation markers in the source transaction. Safe integer sequence, immutable source identity, causal current-source and exact scope validation, and UPDATE/DELETE/OR REPLACE guards protect the watermark. No backfill or prior-table rewrite; existing content starts at0. These are internal invalidation markers, not actor/request operation audits. AFTER-trigger sequence order must not be interpreted as causal ordering.

`D1VersionMatchCandidates` now reads changeSequence and unfinished reservations in the same current-Owner scoped statement as immutable versions/head/configuration. One authority anchor plus1001 data rows bounds returned data; only1000 complete version/pending rows may classify. Same canonical-name pending uploads force review for automatic new-photo/new-version decisions; Off/Manual and duplicate-without-upload remain explicit separate behavior. Reserved URL expiry alone never removes pending evidence: actual completion or a safe cancelled/expired state is required. This is still an internal advisory read; no automatic/assisted mode, public resolver or resolved upload UI is enabled.

Final full run2321 (.local/m3c2b-cloudflare-final.log) terminated0:209 local workerd/D1/R2/Chromium checks. New runtime groups prove scoped reservation/cancellation/exact retry, unchanged unrelated-album clocks, immutable markers/invalid source/scope denial, failed upload audit rollback of marker/quota/request/session followed by exact retry, processed gallery stability, populated upgrade preservation, and final coverage for actual photos/versions/current heads/reservation expiry after the complete lifecycle. Earlier run81396 passed208 before the final lifecycle assertion.212 unit tests/33files passed (.local/m3c2b-unit.log); same-name automatic pending classification is unit evidence, not public automated-upload E2E. Final root strict types31521 and full lint94794 passed. Worker/UI bundles built within the suite. Reference integration/E2E and Next build were not rerun for this Worker/internal-schema change; hosted OAuth/R2/CORS/edge remains not_checked.

0040 applied ONLY to local development D1 after ignored backup apps/worker/.local/d1-before-0040-20261027.sql (418844bytes).12 commands successful; migration list has none pending, foreign_key_check empty, marker_count0 as expected with no backfill. No remote/customer migration, commit, push or deployment. Keep all hosted flags OFF/hard-local and deletion OFF/dry-run. Recovery retains0040/table/triggers/history and repairs forward with matching writes disabled; never drop the table beneath the new reader. Restore only into isolated verified recovery copies.

Next is the actual resolved reservation/API/UI slice, not more standalone matcher scaffolding. Prefer binding canonical resolution, expected watermark/configuration/head and explicit assisted choice into the existing immutable upload_requests command/target path, with one atomic pre-reservation guard; add a new ledger only if existing command guarantees cannot cover the requirement. Current authorization precedes historical replay; exact accepted retry must recover its original target before treating the reservation's own watermark change as stale. Prove simultaneous same-name first uploads, stale preview, safe conflict/unknown response recovery and no implicit head switch, then expose confirmed automatic/assisted settings and usable UI. Scalable canonical candidate lookup and persisted opt-in rules remain required. FullM1–M5 stays active: Guest comparisons, comments/annotations (same invite visible, different invite isolated), full history, delivery/notifications/retention, multi-node and hosted release gates remain unfinished.

## 2026-10-27 — M3c2a scoped advisory candidate snapshots accepted locally

Implemented `D1VersionMatchCandidates`: one prepared SELECT binds current enabled Owner, exact live session and active workspace/project/album scope to persisted mode, project/album revisions, immutable per-version completion filenames/hashes/encoded dimensions and captured current heads. Empty authorized albums return an empty complete snapshot; missing authority returns404. No storage keys, credentials or session secrets are returned. Caller evidence cannot set scope/mode/options/candidates. More than1000 rows or missing version/head evidence forces review; this bounds returned rows, not total SQLite scan work.

After filename identification establishes one logical photo, the resolver checks its complete immutable version history, including differently named current heads, before suggesting a new version. This detects hidden crop differences and duplicate hashes under another version name without rewriting candidate names. Explicit JPG/JPEG aliasing now handles uppercase/mixed-case extensions while preserving basename case sensitivity. Malformed historical names still conservatively force review; scalable indexed candidate lookup and persisted opt-in matching rules remain unfinished.

Verified final source: `pnpm test:cloudflare` session65035 terminated0,204 local workerd/D1/R2/Chromium checks (.local/m3c2-cloudflare-final.log). First run48650 also terminated0/204 before the final full-history refinement. Six new runtime groups cover current actor/session/disabled Owner denial, scoped revisions/head and secret exclusion, immutable completed metadata with Manual staying disabled, forged evidence rejection, missing album, and authorized empty/archived album. `pnpm test:unit`:211 tests/33files (.local/m3c2-unit-final.log), including unit-only1000/1001 completeness and differently named head/duplicate cases. Root strict TypeScript passed (.local/m3c2-types-head-fix.log); full lint session69244 terminated0 (.local/m3c2-lint-final.log). Worker/UI bundles built in the full suite. Reference integration/E2E, Next production build and hosted OAuth/R2/CORS/edge were not rerun or verified for this internal Worker read layer. Test-only entry stays outside the deployable Worker.

No schema/migration application, persistent customer-data change, commit, push or deployment.0039 remains the latest migration from the prior accepted slice. All hosted flags remain OFF/hard-local; automatic deletion OFF/dry-run. This is an internal advisory read, not a public API, durable resolution ticket or upload authorization; automatic/assisted mode settings remain unavailable.

Next M3c2 work: persist exact resolution/explicit assisted choice and atomically revalidate current authority, configuration, complete candidate set and head during reservation. Project/album metadata revisions alone do not capture photo/version additions. Prove concurrent same-name first uploads, stale decisions, conflict/unknown-result retry, immutable targets and no implicit head switch, then add API/Owner UI/browser acceptance. FullM1–M5 remains active: Guest version comparisons, comments/annotations (same invitation visible; different invitations isolated), complete operation history, delivery/notifications/retention, multi-node routing and hosted release gates remain required. See PROJECT_VERSIONING.md.

## 2026-10-27 — M3d durable external-effect intents accepted locally

This supersedes pending M3d checkpoints below. The old defect was reproduced in isolated workerd/D1/R2: a colliding project-mode UUID returned409 but left one R2 fence and local certificate with quota held. The fixed probe now rejects that collision before any R2/local-certificate write. The same probe also passes claim-audit rollback, unknown committed R2 result with no guessed certificate, final-audit rollback/exact retry, safe expiry of pending failed cancellation, deterministic competing D1 insertion between claim and R2, uppercase UUID compatibility, and adapter-identity mismatch denial while preserving MULTI_NODE_DISABLED.

Final full run58288 (.local/m3d-cloudflare-fourth.log) terminated successfully:198 local workerd/D1/R2/Chromium checks passed. New runtime cases cover namespace collisions in both directions, current Owner denial, exact UUID coalescing, distinct UUID same-target receipts with one finalizer/release, lost post-fence result, audit failure/expiry recovery, immutable claim snapshots, processing output-key certificates, processing lost physical result and forged-key certificate rollback before exact recovery. The prior full runs188/198 also passed; the final run includes the adapter node binding correction.202 unit tests/32files, final strict Worker/shared/Web types (55113), full lint (70534), targeted formatting and diff checks passed. Worker builds ran in the suite. Reference integration/E2E and Next production build were not rerun for this Worker-only slice; hosted OAuth/R2/CORS/edge remains not_checked.

0039 applied ONLY to local development D1:26 commands, after ignored backup apps/worker/.local/d1-before-0039-20261027.sql (392650bytes). Follow-up has no pending migrations, foreign_key_check empty, receipt table and claim audit events empty. Upgrade tests compare every prior table snapshot; no legacy ledger/alias/audit backfill or rewrite. No remote/customer migration, deploy, commit or push. All hosted feature flags remain OFF/hard-local; automatic deletion OFF/dry-run.

Architecture: owner_external_intents fixes actor/request/op/payload/scope/node/immutable keys/epoch before external effects. Existing D1 ledgers remain namespace witnesses; symmetric transactional guards cover every current Owner writer. Receipts are append-only attempt identities, not resource locks: multiple UUIDs may target one immutable key, while idempotent fences and existing finalizer guards enforce one state/quota transition. System expiry still resolves a physically fenced pending cancellation safely; it is not blocked forever by a receipt. Processing certificates now bind each declared physical observation to the captured output key. Existing completed operations replay without fabricating a new claim. R2 adapters declare storageNodeId; cancellation checks it and authorized expiry only inspects that adapter's node. This does not enable multiple accounts.

Recovery: stop serving cancel/abandon mutations before application rollback; retain claim-compatible handlers, receipts, physical fences, certificates and audit, then repair forward. Do not downgrade to pre-0039 R2 handlers merely because flags are OFF: old cleanup endpoints may still be callable. Never clear receipts/held quota to hide an unknown result. Restore backups only into an isolated verified recovery copy. Any new Owner writer must participate in the namespace guards before activation. Production contains no interleave/drop-result test hooks; those live only in the storage-test entry.

Next: wire the scoped deterministic matcher into automatic/assisted upload resolution with usable confirmation and recovery, then Guest version history/comparison. FullM1–M5 remains active; comments/annotations, full Owner history, delivery/notifications/retention, multi-node routing and hosted deployment/acceptance remain required. Different invitations remain isolated for comments; same-invitation sharing is the confirmed user decision.

## M3d external-effect intent claims underway

Read docs/OWNER_INTENT_CLAIMS.md. M3c1 remains accepted locally (188checks); fullM1–M5 stays active. Root selected external-only immutable claims plus symmetric transactional guards on all legacy Owner writers, retaining old ledgers/intentional aliases without risky backfill.0039 SQL, store and namespace inventory are isolated drafts; no active migration or persistent application. Root owns cancellation/review integration and deterministic R2-interleaving verification. Claim must commit before storage effects; unknown effects retain claim/quota; default-OFF/hard-local/deletion-dry-run safeguards stay intact.

## 2026-10-27 — M3c1 project version configuration accepted locally

This supersedes pending M3c1 checkpoints below. Run36156 (.local/m3c-cloudflare-fourth.log) terminated successfully:188 local workerd/D1/R2/Chromium checks passed. New acceptance covers local/default-OFF capability, confirmed Off/Manual settings, shared project CAS with rename, no-op/history replay/current-state reconciliation, strict body/origin/actor, audit-failure full rollback and exact retry, symmetric request-ID conflicts, immutable command/results, provenance clone/predecessor denial, disabled/expired Owner and archived-project replay denial, and375px confirmation cancellation/stale-conflict refresh/lost200 exact retry followed by a fresh current read. Existing M3a/M3b and other regressions passed in the same run.

202 unit tests/32files, strict Worker/shared/Web types (24608), full lint (65362), Next production build (73127), focused formatting and git diff checks passed.14 of the new unit cases exercise the pure matcher: exact scope, NFC/trim/UTF-16 bounds, opt-in suffix/JPG-JPEG/case rules, logical-photo ambiguity, duplicate hashes, truncation and oriented aspect/scale review. This classifier is not yet wired to an adapter/API/upload flow. Only Off/Manual settings are available; automatic/assisted modes remain unavailable. Reference integration/E2E were not rerun for this slice; previous M3b reference integration61 remains a baseline, not new hosted evidence.

0038 applied ONLY to local development D1:33 commands, after backup apps/worker/.local/d1-before-0038-20261027.sql (git-ignored,372860bytes). Follow-up migration list has none pending; foreign_key_check is empty; new command/result tables and existing-project provenance pointers are empty/null. Recovery disables configuration writes, preserves mode provenance/commands/results/audit and repairs forward; restore backups only into an isolated verified recovery copy. No remote/customer migration, deploy, commit or push. All feature gates remain OFF/hard-local; deletion OFF/dry-run.

The expiry test uses a separately issued synthetic OAuth session and preserves its revocation audit; it never recreates an old signed-in session or bypasses append-only guards. Historical intermediate test failures are retained below as evidence, not current acceptance status.

Required next work: docs/OWNER_INTENT_CLAIMS.md describes the confirmed existing cancellation/abandonment ordering risk. Implement durable actor/request claims before R2 effects and prove collisions/races/unknown outcomes without premature quota release; expanding a read-only preflight is insufficient. Then integrate scoped automatic/assisted filename resolution and Guest version comparison. Hosted OAuth/R2/CORS/edge and the full M1–M5 goal remain incomplete. Comments/annotations, complete history, delivery/notifications/retention and deployment gates remain required.

## 2026-10-27 — M3c integration and external-effect intent risk

M3c config contracts/capability,0038 SQL, service/routes and Owner UI are in active source behind default-OFF/hard-local gates.202 unit tests and final strict types passed; full lint passed. Isolated Miniflare D1 proves populated preservation, change/no-op/replay, CAS race, failed-audit rollback/exact retry, immutable history and provenance-clone denial. No0038 persistent migration or final M3c acceptance yet.

Full run99197 stopped because a CSRF test incorrectly parsed the existing outer middleware's plain-text403 as JSON; it now verifies403 and retained state. Run85751 then passed basic APIs and audit rollback/rename-CAS/namespace/immutability, but expired the main fixture session and attempted to recreate it, correctly hitting APPEND_ONLY_AUDIT for the old sign-in event. The expiry fixture is being changed to a separate signed synthetic OAuth session; never bypass/drop the audit guards or recreate a revoked session ID. No suite is currently live; next launch follows the frozen fixture fix.

Source review identified an existing actor-scoped external-effect ordering risk in uploads.cancel and processing-review.abandon: R2 fences precede final command insert; a cross-ledger request-ID conflict can leave a fence and held quota without finalizing the command. This does not expose/delete another tenant's photos. Read-only preflight cannot close the concurrent claim gap. Before hosted activation, implement a durable actor/request intent claim (fixed operation/payload/target, current authority, all Owner writers) before R2 effects, and test deterministic collision, concurrent claim, lost R2/DB result and recovery. Do not claim this risk fixed by0038's D1 namespace triggers. Source ordering was reviewed; this specific R2 collision has not yet been fault-injected at runtime.

FullM1–M5 remains active. Keep flagsOFF/deletionOFF/dry-run; no deployment/customer data/commit/push. After M3c1 acceptance, prioritize durable external-effect intent claims, then wire the scoped matcher/auto-assisted upload resolver and Guest comparisons. The pure matcher14 focused cases passed but is not an API/product feature yet.

## M3c implementation underway

Read docs/PROJECT_VERSIONING.md. M3b remains accepted locally (179checks); fullM1–M5 stays active. Root added strict mode configuration contracts and default-OFF/hard-local capability;14 focused tests passed. SQL/service drafts are isolated under .local/m3c-draft, no0038 application or runtime acceptance. Parallel work owns configuration backend, confirmation/recovery UI and deterministic filename matcher. Only off/manual configuration will be available until automatic/assisted matching is actually integrated. Existing versions/head/selection/audit must be preserved.

## 2026-10-27 — M3b manual version uploads accepted locally

This supersedes the pending M3b checkpoints below. Full run30293 (.local/m3b-api-eighth.log) terminated successfully:179 local workerd/D1/R2/Chromium checks passed. New cases prove fixed immutable reservation targets, current Owner/tenant/photo authorization before replay, head/mode-shift preservation, private same-photo versions, unique concurrent numbering, canonical audit/results, audit-failure rollback with exact retry, quota accounting, cancellation fences, stale new-init CAS denial, default-OFF bypass denial, immutable target/completion primary/alternate/null/UPDATE/DELETE defenses, and375px explicit replacement/file selection/SigV4-checked local R2 upload/lost-completion/reload/reselect recovery with the V1 head unchanged. Existing M3a current-head and other feature regressions passed in the same run.

Also passed:174 unit tests/30 files,61 reference integration/10 files, strict Worker/shared/Web typechecks, final full lint (48177), Next production build, targeted format and git diff checks.38-file documentation presence check passed. Reference-app Playwright was not rerun in this session; Worker-target Chromium is included in179 checks. Hosted OAuth, real R2 CORS/S3/edge and deployment are not verified. The browser R2 bridge uses synthetic credentials and local Miniflare storage.

0037 applied ONLY to local development D1:34 commands. Follow-up migration list has none pending; foreign_key_check returned empty; new targets/completions are empty. Pre-migration backup is apps/worker/.local/d1-before-0037-20261027.sql (git-ignored). No remote/customer migration, commit, push or deployment. Keep all feature flags OFF/hard-local and automatic deletion OFF/dry-run.

Recovery: disable version writes and keep immutable targets, completion ledgers, assets, processing jobs and audit. Repair forward with a new migration. Restore the local backup only into a verified isolated recovery copy; do not drop0037 tables beneath code whose generic upload queries now reference both completion ledgers. Do not remove history to roll back application behavior.

Full M1–M5 remains active. Next required slices: project version-mode controls and enabled filename/assisted matching, Guest scoped version history/comparison slider/side-by-side/overlay, followed by comments/annotations, full operation history, delivery/notifications/retention and hosted acceptance. Same-invitation comments may be shared; different invitations remain isolated. Completion still leaves the original current head; exposing a ready version requires a separate explicit CAS switch.

## 2026-10-27 — M3b security probes passed; browser final assertions rerun

Run27180 (.local/m3b-api-seventh.log) passed all new version API cases, including head/mode-shift frozen targets, concurrent unique version allocation, injected photo.version.created audit rollback/same-ID retry, immutable target/completion update/delete/null/primary/alternate REPLACE guards and disabled-Owner replay denial. Chromium reached file selection, explicit replacement confirmation, signed local R2 upload, lost successful completion response and reload/reselect/exact completion replay; the helper then failed its final D1 check because its fixture return and assertion call omitted photoId. Those two fixture properties are restored, with targeted lint/format passing. No product guard was relaxed.

Run30293 is LIVE at .local/m3b-api-eighth.log; poll before launching a duplicate. Full M3b acceptance, final browser D1 assertions and remaining M3a regression checks are pending.174 unit,61 reference integration, strict types, UI lint, full lint and Next build previously passed in this session.0037 remains unapplied persistently; flags remain OFF and deletion dry-run. No remote deployment or customer data changes. Full M1–M5 remains active.

## 2026-10-27 — M3b V2 runtime evidence; final regression in progress

Run21660 (.local/m3b-api-sixth.log) passed canonical V1 API setup, upload-disabled bypass denial, V2 fixed target/recovery/exact init replay, wrong-photo/tenant isolation, and real local R2 V2 completion with immutable private version/audit and unchanged head. It then failed a test that compared the richer recovery response to the init response. The expected shape now verifies the exact recovery metadata, authorization and original target/session; no authorization requirement changed.

Additional fixes from integration review: version uploader accepts the existing UPLOAD_OBJECT_NOT_FOUND409 before PUT; it had incorrectly expected404. The completion success notice now lives in the parent panel so list refresh cannot discard it. The Chromium fixture uses the canonical V1 authorization and joins upload_specs for MIME/hash. Browser expectations mirror these contracts. Latest Web strict typecheck and targeted UI lint passed. Full strict types, Next build,174 unit and61 reference integration passed earlier in this session.

Run27180 is LIVE at .local/m3b-api-seventh.log. Poll that handle before starting another full suite. It includes V2 audit rollback/same-ID retry, stale new-init CAS, target/completion UPDATE/DELETE/REPLACE/null guards and375px file upload/lost-completion/reload recovery via a synthetic SigV4-checked Miniflare R2 bridge. No final browser or full M3b acceptance is claimed until terminal results are inspected.0037 is not applied persistently; no remote/customer data, commit, push or deployment. All flags OFF/dry-run. Full M1–M5 remains active.

## 2026-10-27 — M3b API contract and manual intent UI

Current verification:174 unit tests/30 files and61 reference integration tests/10 files passed. Full lint passed after removing an unused fixture variable and an unused UI suppression. Web strict typecheck and targeted UI lint passed after the flat completion-response fix and manual intent selector. Documentation checker verified38 files; this is presence only.

The Owner uploader now explicitly offers new_retouch or replace_current in enabled modes. Off mode forces replace_current; any replacement requires confirmation. Both preserve immutable history and leave the current head unchanged until a separate ready-version CAS switch. These new UI paths still require Chromium acceptance.

Fifth full local Worker run4554 terminated at .local/m3b-api-fifth.log: existing Guest history and the canonical public V1 setup passed, then new version reservation returned200 where creation expects201. The version init router now returns201 consistently with ordinary creation; no security assertion was relaxed. The next full run is pending expanded V2 rollback/integrity/stale-CAS tests and a self-contained browser fixture.0037 is not applied persistently. Hosted OAuth/R2/edge, deployment and full M1–M5 remain incomplete; flags remain OFF and retention dry-run.

## 2026-10-27 — M3b regression and completion response correction

Current source includes the manual version upload router/service/migration and Owner UI behind default-OFF local-only gates. The UI now parses the dedicated completion endpoint's flat versionUploadCompletionSchema response, matching the API rather than an invented completion envelope. Browser verification is being added; do not claim acceptance yet.

Run .local/m3b-api-third.log terminated at a missing fixture-helper import. All five consumers now import the canonical authorized-version fixture; targeted ESLint, node syntax and formatting checks passed. Fourth run .local/m3b-api-fourth.log advanced through Guest history and version capabilities, then terminated at its new ordinary-V1 setup: the test PUT/completed without first authorizing the upload and received INVALID_STATE_TRANSITION. Repair the fixture with the normal authorization call; preserve the guard. No full M3b pass is claimed. Earlier full unit run:174 tests; latest pre-response-fix web typecheck passed. Post-response-fix typecheck log .local/m3b-web-types-response.log shows successful type generation, but the interrupted process handle is missing, so terminal exit is not proven and must be rerun.

0037 remains unapplied to persistent local/remote D1. All deletion flags remain OFF/dry-run. No hosted test, deployment, commit, push or customer data change. Next: canonical V1 setup, complete full HTTP/R2 regression, integrate isolated Chromium file-upload/recovery checks, then integrity/rollback gaps and final checks. Full M1–M5 remains active.

## 2026-10-27 — M3b UI promotion and regression fixture compatibility

The live Owner version panel now mounts the promoted version uploader with full project/album/photo context and OR-combined switch/upload pending gates. Upload completion refreshes only the version list, never the current head or gallery. New uploader context is omitted for archived/noneditable parents. Web strict typecheck passed after promotion;174 unit tests/30files passed (.local/m3b-unit-first.log). HTTP/browser upload acceptance is still pending.

Sessions10421 and22558 are terminal.10421 stopped at unused Node imports of Worker classes with unsupported strip-only parameter properties; those imports were removed.22558 stopped at another legacy direct-V2 metadata fixture, before the new API helper. A shared authorized SQL fixture helper and affected Guest selection/feedback/history/shared-review fixtures are being updated without bypassing0037. No runtime suite is currently live. The version-upload API helper is frozen with mode/head replay, private sibling completion, concurrent numbering, cancellation fencing/quota and Owner-disable cases; wait for legacy fixture updates before rerun.

0037 is active source but NOT applied persistently. No remote/customer data, deploy, commit or push. Full M1–M5 remains active.

## M3b first integrated HTTP/R2 run live

The version-upload API helper is now wired before the current-head regression helper. Session10421 is live at .local/m3b-api-first.log; poll it before any duplicate run. It exercises isolated manual-project V1/V2 public API flow, local Miniflare R2 fixture objects, scoped recovery, feature-gate bypass denial, target isolation, private completion/audit and quota conversion. These results are pending; do not infer remote R2 or production E2E.

M3a fixture versions2–27 now use authorized version uploads; only V2 is processed and the other siblings stay queued for readiness checks. Direct V1 and neighbor V1 seed setup remains. Existing immutable/scope/dimension guards retain priority, and valid V2 still requires its upload workflow. The isolated SQL behavior probe passed after this adjustment. Draft UI and journal validations passed focused5 journal tests, strict TS/lint/format, but UI is not mounted and has no browser acceptance yet.0037 remains unapplied to persistent local/remote D1.

## M3b active integration and first regression feedback

Reviewed0037 SQL, common upload service and strict version router are now integrated into active source behind all default-OFF local gates; current TypeScript check passed. Original service backup is .local/m3b-draft/live-uploads-before-integration.ts.0037 is in active migrations but is NOT applied to persistent local/remote D1. The dedicated HTTP/R2 helper is being written; existing full regression run75668 stopped at guard-priority compatibility before version API cases.

The new valid-V2 workflow gate masked established invalid scope/dimension/identity errors. Its WHEN filter now delegates malformed basic records to the existing0011/0012/0033 guards, retaining the upload-workflow requirement for valid new V2. Isolated behavioral probe passed again after this change. The probe was pinned to baseline0001–0036 after promotion to avoid accidentally applying0037 twice. Old M3a V2 fixtures are being changed to authorized version uploads rather than bypassing the new guard; initial non-current versions will be captured-parent siblings and queued targets remain unready. No security assertions are removed.

Journal module/tests passed focused5 cases; draft UI remains unwired. M3b HTTP/R2/processing/browser/full regression acceptance remains pending. Full M1–M5 stays active; no deployment or new persistent migration.

## M3b reviewed service/routes and isolated D1 checkpoint

Root virtual TypeScript validation passes for the frozen common upload service plus isolated version-upload router at their intended source paths, without replacing live code. Init replay/post-insert and completion replay/post-insert now read results and current Owner/active photo/parent scope in the same SQL query. Root also scoped target-type detection to current Owner/session before feature-gate errors and bound dedicated completion's route photo to the immutable target.

Root tightened SQL completion timestamp to its workflow witness and required exact canonical completion result JSON (including status/field set); a fresh isolated Miniflare D1 probe applied baseline0001–0036 plus draft0037, found both new tables and no FK violations. Probe setup initially needed Worker-scoped dependency resolution, the repository's v5 compatibility adapter and existing SQL normalization; these were corrected. This proves DDL application only. Separate behavioral probe has passed atomic V2 reservation and exact init replay with no new photo/head changes; completion/V1 parity/denials remain under test.

The version-aware browser journal is being implemented as a distinct module, with structured-field privacy and full Owner/workspace/project/album/photo scope; legitimate user notes/URLs/hash filenames must remain valid. UI and API drafts remain unwired, no0037 persistent migration or deployment. Full M1–M5 stays active.

## M3b fixed-target recovery and draft review checkpoint

Strict versionUploadRecoverySchema is implemented with legacy recovery fields plus immutable target metadata; it rejects storage paths, signed URLs, session identifiers and unknown fields.23 focused contract/config tests passed. Three scoped workers own isolated SQL, common upload service, and single-photo upload UI drafts under .local/m3b-draft; none is wired into live routes. SQL captures the reservation-time project mode from D1, and old exact init retries must recover the same target despite later head/mode changes after current ACL passes. Remaining completion-aware cancel/expiry/archive/accounting paths and runtime probes are still pending. No M3b migration is applied or feature enabled; M3a remains locally accepted.

## M3b version upload implementation underway

Read docs/VERSION_UPLOADS.md. SQL and service drafts are isolated in .local/m3b-draft; contracts are implemented but not exported into API routes. Root capability helper requires direct-upload/current-version/version-upload flags together and hard local-only activation;22 focused contract/config tests passed. Target photo/parent/intent metadata is fixed at reservation, completion must preserve photo_id and allocate an immutable next version without switching the head. Both completion ledgers must be recognized by recovery/cancel/expiry/archive/quota paths. No M3b runtime acceptance or migration application yet; M3a remains accepted locally and full M1–M5 stays active.

## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison slider/side-by-side/overlay, delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

## M3a browser response synchronization; isolated M3b preparation

Sixth run96001 passed version API/integrity and progressed through actual Owner switching/lost-response retries, then failed because the helper asserted replay status before the response completed (request-start record still had status0). Root added explicit completed-status polling for replay200 and definitive-conflict409, preserving all original result/body assertions. Seventh run89861 is live at .local/m3a-cloudflare-seventh.log; poll it before a duplicate run. Mobile screenshot apps/worker/.local/photo-version-heads-mobile.png was inspected; synthetic preview and version panel fit the viewport without horizontal overflow. Final runtime acceptance remains pending.

In parallel, M3b SQL is being drafted only under .local/m3b-draft (not active migrations); strict new upload contracts/tests are separate new files and are not exported into current APIs yet. Root added PHOTO_VERSION_UPLOADS_ENABLED defaultfalse/hard-local;7 focused config tests passed. This does not implement or enable manual V2 upload. No persistent0036/0037 migration or hosted deployment.

## M3a corrected Owner browser run live

UI and browser files are frozen after the definitive-conflict and direct-project-navigation corrections. Focused web typecheck, scoped lint/format and Node syntax checks passed. The browser helper now distinguishes a dropped request before Worker execution from a committed response lost in transit; it holds the fresh reconciliation GET to verify the navigation gate and confirms eventual release. Sixth full session96001 is live in .local/m3a-cloudflare-sixth.log. Poll it before starting another run. No final M3a acceptance or persistent0036 application yet.

## M3a definitive-conflict correction checkpoint

The Owner UI now recognizes only PHOTO_VERSION_REVISION_CONFLICT and PHOTO_VERSION_NOT_READY as definitive non-commit results after an ambiguous exact retry. It clears the intent, keeps the parent navigation gate during fresh-state reconciliation, and refreshes the gallery afterward. Other ambiguous codes retain the original intent. Web strict typecheck passed after this correction. Browser navigation and a pre-commit-drop/intervening-change regression remain in progress; no runtime suite is currently live. Last runtime84980 passed version API/integrity but failed the helper's project navigation. Wait for the updated browser helper freeze before launching another full run.

## M3a backend acceptance evidence; Owner browser corrections pending

Fifth full run84980 is terminal. Real ready-V2 processing, paged version metadata, CAS race/replay, Owner/Guest current and restored galleries, independent old-version comparison ACL, state/version/asset preservation, audit-failure rollback/exact retry, archived/foreign denial and direct immutable head/command/result/alternate/null/predecessor checks passed. The run then failed in the Owner browser helper because it started at the workspace homepage and searched for a project link that belongs on the workspace/projects page. The helper will navigate directly to the authenticated project route using its fixture project_id.

Independent review also found that an ambiguous request receiving definitive PHOTO_VERSION_REVISION_CONFLICT or PHOTO_VERSION_NOT_READY can remain locked forever. SQL exact replay precedes those checks, so those two codes prove that exact intent did not commit. UI correction and a pre-commit dropped-request/intervening-change regression are underway; committed lost200/retry401 must still retain intent. No final M3a browser acceptance or persistent0036 application is claimed. Log: .local/m3a-cloudflare-fifth.log. Full M1–M5 remains active.

## M3a ready-V2 evidence and gallery fixture order correction

Fourth run34588 reached and passed real V1/V2 processing, version24+3 pagination, no-op/replay, not-ready denial and two-concurrent-command CAS with exactly one200/one409. It then failed a gallery assertion because the test had restored V1 before expecting V2. Root moved the restore after V2 Owner/Guest gallery and comparison-right assertions and added both Owner/Guest V1 restoration reads. No production code or expected security boundary was weakened. Fifth run84980 is live at .local/m3a-cloudflare-fifth.log; poll it before rerun. Successful switching now has actual evidence, but remaining gallery/integrity/browser acceptance is not yet claimed.

## M3a runtime verification update

Root fixed the authenticated session fixture using /api/auth/get-session and exact D1 session ID/user/expiry. Third full run91193 then reached Owner capability assertions and failed because the helper omitted authentication; /api/v1 is correctly Owner-protected. Both OFF/ON capability checks now include Owner cookies and explicitly assert anonymous401. Fourth run34588 is live at .local/m3a-cloudflare-fourth.log; poll it before another run. These are fixture corrections; ready-V2/CAS acceptance remains unproven until that path runs.61 integration tests passed in run48063; full typecheck76265 and Next build13487 passed. Owner browser helper is now wired. No persistent0036 migration or hosted change.

## M3a interrupted-run recovery and runtime fixture correction

Root confirmed first run57801 was terminal before helper execution due an undefined cookies caller; caller now passes googleCookies. Second run6780 is also terminal: fixture incorrectly compared the signed Owner cookie string to owner_sessions.token, so no current session row was found. Correct fixture resolution through the authenticated session endpoint, then recheck exact session ID/user/expiry in D1. These failures do not validate or disprove ready-V2 switching; that path has not yet executed. Logs: .local/m3a-cloudflare-first.log and .local/m3a-cloudflare-second.log.

Full Worker/web typecheck76265 and Next build13487 passed. Owner browser helper is written and syntax/lint/format checked; it has not run. Isolated neighbor photo and immutable-guard tests are prepared. No active runtime suite remains at this checkpoint; await the corrected helper freeze before rerun. User's same-invitation comment visibility decision is recorded in DECISIONS/GUEST_ACCESS_AUDIT; different invitations remain isolated.

## Confirmed comment visibility decision — 2026-10-26

The user chose: Guests on the same invitation may read each other's comments; Guests on different invitations remain isolated. Treat invite_id as the discussion boundary in addition to workspace/project/album/photo scope. An Owner reply must target that exact invitation thread; possession of another invitation for the same project/photo grants no access to its comments. Do not merge Guest identities by nickname, email or shared photo. can_comment stays independent of can_view, selection and other permissions. This decision resolves earlier pending visibility notes; other comment lifecycle/status/retention details still need an explicit implementation contract and tests. No comments feature is implemented or enabled by this documentation update.

## M3a first runtime acceptance running

Backend0036 and head repository are frozen. Agent isolated real Miniflare/D1 probe passed V1 backfill/preservation, no-op/replay, stale/changed intent denial, head rollback/REPLACE rejection and FK integrity; successful ready-V2 switching is being verified by the main harness, not inferred from that probe. Root integrated TypeScript and full lint27752 passed; unit146/27files remains passed.

First full runtime session57801 is live at .local/m3a-cloudflare-first.log. The new helper creates an independent album/photo, processes real V1/V2 through the existing image pipeline, and exercises CAS/current galleries/Guest comparison rights/preservation/audit rollback. Poll this handle rather than starting a duplicate run. Direct immutable command/result/alternate/null/predecessor cases and the Owner browser helper are next after runtime feedback.0036 has not been persistently applied, all flags remain OFF, and manual V2 upload is still a required next vertical slice.

## M3a strict verification checkpoint

Root integrated TypeScript check now passes after correcting nullable unit fixture inference with the actual PhotoVersionItem contract type. Full unit suite passed146 tests/27files. Owner version test worker/caller is wired with explicit cookies; acceptance fixture will use a new synthetic album/photo and real processing pipeline, preserving the shared gallery fixture. Review requested safe-integer revision exhaustion rejection, explicit final version-page ordering, exact returned revision matching, and removal of an arbitrary96-item UI history cutoff. Scoped workers are completing those corrections and the runtime/browser helper. No full M3a runtime acceptance or persistent0036 application is claimed.

## M3a Owner integration checkpoint

Root connected PhotoVersionsPanel to the Owner Lightbox and added synchronous pending-operation guards on close/previous/next plus keyboard navigation. The panel must retain exact uncertain intent and report onPendingChange until the result is known; onCurrentChanged refreshes gallery only after successful reconciliation. Default-OFF panel leaves no empty visual block. Dedicated photo-versions-test Worker is wired with enabled flags for synthetic acceptance. The helper will receive existing Owner cookies explicitly; no shared fixture mutation is needed. Backend/service/0036 and UI remain in progress, so no full build or runtime acceptance is claimed for this checkpoint. Prior12 focused contract/config tests remain the current test evidence.

## M3a integration checkpoint

Root wired default-OFF Owner capability/list/set-current routes with strict UUID/query/body validation and Origin checks. Owner and Guest gallery SQL now reads the tenant/photo-scoped photo_version_heads record rather than hardcoded V1; Guest non-current derivatives additionally require can_compare_versions2048 alongside can_view. This code depends on the pending0036 migration and is not yet runtime accepted or applied to local D1. Scoped workers continue the migration/service, Owner panel and real D1 acceptance helper.12 focused contract/config tests passed (root-run); full type/runtime/browser verification remains pending. No manual V2 upload or comparison completion is claimed. Full M1–M5 stays active.

## M3a photo versions implementation underway

Read docs/PHOTO_VERSION_HEADS.md and PHOTO_VERSIONS.md. Existing uploads and gallery queries hardcode V1; immutable rows cannot safely act as mutable current-state. Scoped workers own new0036/head service, version contracts/tests, and Owner panel respectively; root owns existing integration. PHOTO_VERSIONS_ENABLED is defaultfalse/hard-local;7 config tests passed. No new version workflow or migration acceptance is claimed. Next complete atomic head switching and gallery/current/non-current access integration, then explicit manual V2 upload and comparisons. Full M1–M5 remains active; comment visibility decision is pending independently.

## M2p final local verification — supersedes earlier pending status

Final full Worker run54253 passed157 local checks (.local/m2p-cloudflare-lifecycle.log), including history API privacy/current ACL/cursor scope, three-page fixed lifetime, deleted-photo witnesses, real Chromium pagination and explicit lifecycle-event identity clearing.134 unit/25files,61 integration/10files,14 reference Chromium, final generated Worker/web strict typecheck, lint/format, Next build and36-file documentation checks passed.375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected.

0035 was applied to local development D1 only (4 commands), and follow-up migration list is empty. Existing history was preserved. Recovery is forward-only; disable history on application rollback and retain indexes/audit. All feature flags remain OFF/hard-local and retention deletion remains OFF/dry-run. No remote/customer data, deploy, commit or push occurred.

Limit: headless Chromium did not emit native blur/visibility on bringToFront or the isolated CDP probes. The passing browser test explicitly dispatches FocusEvent blur/focus and checks current-cookie/D1 reload plus old-data clearing. Native headed desktop tab delivery and hosted E2E remain not_checked. This does not complete the full product goal. Earlier status/failure notes below are retained as historical evidence, not the current acceptance status.

Next work: immutable explicit Owner photo versions with a separately audited CAS current-version pointer; current uploads/galleries hardcode V1. Add independent non-current Guest comparison authorization before V2 exposure. Comment visibility choice remains pending; do not broaden disclosure. Filename tombstones, full history/Owner views, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 goal stays active.

## M2p headless lifecycle validation boundary

Run13832 failed the real-tab transition assertion: after a second tab was opened, the first tab stayed visible/focused and no blur/visibility event arrived. Independent minimal Chromium probes reproduced events=[] / visible / hasFocus=true, including CDP focus-emulation and freeze/active probes. This is an observed headless behavior, not evidence that the application handler failed. The helper now explicitly dispatches browser FocusEvent blur/focus around the cookie switch and retains zero-old-rows/new-Guest-only assertions. It does NOT prove native desktop tab event delivery; that remains not_checked. No application safeguard or assertion was removed. Full rerun54253 is live in .local/m2p-cloudflare-lifecycle.log; poll it before another run. Final Next build93578 passed after the focus changes. Persistent0035 application remains pending.

## M2p cross-tab verification in progress

The focus/visibility fix is written: background transitions invalidate request generations, abort reads and clear the rendered snapshot; foreground reloads capabilities and page one with the current cookie. Manual refresh also invalidates older requests. Web strict typecheck and scoped formatting/lint checks passed. The real second-tab regression initially failed in run54594 because visibleGuest had zero events while the new test required one. Root added one valid favorite event to that synthetic Guest; no production logic or assertions were relaxed. Rerun13832 is live in .local/m2p-cloudflare-focus-fixed.log. Poll that handle before starting another suite. Do not claim final acceptance or apply0035 persistently until the result is known.

## M2p follow-up security gate

Integrated Worker run50575 passed157 local checks including the actual Guest history Chromium helper, cursor privacy/three-page lifetime, and existing regressions (.local/m2p-cloudflare-browser.log). The375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected without horizontal overflow. This is not final slice acceptance: independent review found that an already-loaded history tab with no next page does not clear/revalidate after another tab changes the shared Guest cookie. Add blur/hidden invalidation and focus/visibility revalidation plus a one-page cross-tab browser regression before acceptance or persistent0035 application. Gallery entry requiring can_view is intentional because it appears within the gallery; standalone1024-only history passed independently. Reference application Chromium run30695 passed14 tests in26.8s (.local/m2p-reference-e2e.log); this is separate from Worker history UI acceptance. No hosted deployment, customer data or flags changed.

## M2p — Guest own-history implementation in progress

Current slice adds an independent can_view_own_history (1024) timeline. GUEST_HISTORY_ENABLED defaults OFF in all environments and rejects non-local activation. Root added capability/activity routes with strict query keys and duplicate rejection; backend, UI and acceptance helper are being implemented by scoped workers. This is NOT accepted end-to-end yet; no migration0035 has been applied and no hosted service has been changed.

The contract allowlists 14 own Guest selection/submission/rating/favorite/tag/shared-selection actions, exposes only projected before/after details, and excludes raw audit JSON, session/request IDs, storage data and other identities. Read scope derives from the current cookie and sealed invitation albums. Pagination must use signed scope/filter-bound cursors, recheck current authorization on every page, and exclude later appends with a snapshot watermark. Missing photos show a generic unavailable marker; retained safe filename tombstones remain a separate unfinished requirement.

Verified this pass: root independently ran13 focused Guest history contract/config tests, then the full134 unit tests in25 files; all passed. Documentation presence36files and diff whitespace checks passed. Integrated TypeScript rerun passed after the scopeHash refactor. First full local Worker run68699 failed at new history fixture setup with WORKSPACE_LIMIT_REACHED; earlier regressions including Guest tags browser passed, but history API acceptance was not reached. Correct the isolated fixture without weakening quota constraints, then rerun. A misplaced gallery client directive was corrected and its focused lint passed. Subsequent full lint and61 integration tests in10files passed; current integrated TypeScript also passed. Second full local Worker run82029 passed156 checks (.local/m2p-cloudflare-second.log), including history API scope/cursor/tombstone/current-session tests; history-specific Chromium integration remains pending. Next build initially failed exactOptionalPropertyTypes in the new UI; explicit optional types were corrected without weakening settings and fixed build80479 passed (.local/m2p-next-build-fixed.log). First failed run log: .local/m2p-cloudflare-first.log. Next: finish backend/UI, inspect authorization/cursor sanitizer, run real local D1/workerd/Chromium acceptance, and only then update acceptance status. Preserve all existing dirty work and always use explicit KINO Pic workdir. Full M1–M5 goal remains active.

## M2o — independent Guest tags accepted locally

Read docs/GUEST_TAGS.md.0034 implements immutable project label catalog, per-invite/Guest/photo membership and canonical command/result/state/audit. can_tag is independent; Grid/Lightbox also require can_view. Labels NFC/trim/case-sensitive,40codepoints,20active/photo,1000catalog/project. No Guest catalog enumeration; removing unknown membership hides another Guest catalog ID. Tags remain editable after selection submission without changing snapshots. Exact expectedGuestId/UUID/body survive uncertain responses and cookie switches; only first definite cap409 may refresh/recover. All feature flags remain OFF/hard-local.

Final full Worker run58214 passed148 local checks (`.local/m2o-all-acceptance3.log`), including actual375px Chromium tag controls, Grid/Lightbox sharing, private images, lost-response exact retry, switched-Guest denial/isolation, beforeunload warning, stale-cap refresh/removal, immutable PK/alternate/null guards, predecessor rollback, catalog1000cap/isolation/reuse, currentACL/replay and populated upgrade preservation.121 unit/23files,61 integration/10files, strict types/lint, Next build,14 reference Chromium, format and35-file spec presence checks passed. Worker UI acceptance is in the148-check suite. Screenshot `.local/guest-tags-mobile.png` inspected.

0034 applied to local development D1 only:28 commands; follow-up list has none pending. No remote/customer data, deployment, commit/push or flag activation. Recovery is forward-only: retain catalog/membership provenance/command/result/audit; disable tag writes before application rollback and repair with new migrations. Broader tags filtering/Owner history, own-history timeline, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 remains active; next assess independent Guest own-history timeline.

Intermediate failures were test/code issues and were fixed before acceptance: nullable UI context, unused fixture workers, wrong Owner session_id audit assertion (Guest uses guest_session_id), image-helper argument mismatch, dialog.type method comparison and reload hydration race. The final suite includes those corrected paths. Isolated workerd catalog/integrity probes also passed; they are additional evidence, not hosted acceptance.

Execution incident retained for handoff: a subagent accidentally invoked a pnpm Prettier check in unrelated `C:\Users\Aaron\Documents\奇諾影像形象網站`, emitting dependency move/install warnings. Observed child processes ended; read-only status showed untracked pnpm-lock.yaml and node_modules/.ignored exists, without a clean before-snapshot to prove all provenance. No automatic cleanup/repair was performed there; preserve unrelated user work. All further commands use explicit KINO Pic workdir.

## M2n2 — immutable photo insertion accepted locally

0033 prevents REPLACE across version id/photo-version number, asset id/object key/version-kind and processing output job-kind/asset ID/object key; null photo version/asset IDs are rejected. Existing rows, scope checks and mutable job transitions are preserved. Isolated baseline0001–0032 reproduced queued-slot identity replacement, same-ID version hash/size replacement and original-to-delivery replacement with valid FKs;0033 rejected all with unchanged snapshots.

Final frozen-helper Worker suite passed135 checks (session59049, `.local/m2n2-final-cloudflare.log`), including populated upgrade preservation and immutable table/audit/FK comparisons.108 unit,61 integration,14 reference Chromium, strict types, lint, Next build, format and specification checks passed. Intermediate lint unused-variable warning was fixed; the old cross-tenant asset fixture now uses an unused delivery kind so it tests scope rather than colliding with the new duplicate guard.

0033 applied locally only:4 commands, then no pending migrations. No remote/customer data, deploy, commit/push or flag activation. Recovery: preserve guards/history, disable writes before code rollback and repair forward. Broader command/snapshot integrity, independent tags/comments/annotations/history, version workflows/comparison, delivery/retention and hosted gates remain incomplete. Next product slice: independent Guest tags; specification assessment underway. Full M1–M5 remains active.

## M2n1 — immutable result integrity accepted locally

Migration0032 rejects primary/alternate event-key replacement in seven immutable result tables and rejects null result keys/null or empty audit IDs;0031 duplicate-audit protection remains. Tests isolate a fresh non-null key with an existing event ID, duplicate primary key, null key, duplicate audit REPLACE, unchanged history, foreign keys and populated upgrades. Existing authorization and exact retry tests remain green.

Final strengthened Cloudflare suite passed134 local checks (session54580, `.local/m2n1-final2-cloudflare.log`).108 unit,61 integration,14 reference Chromium, typecheck, lint, Next build, format and34-file specification presence checks passed. Intermediate rerun failed on deferred Response.clone; immediate per-response parsing preserves24 concurrent attempts and20 allowed and passed the final suite.

0032 applied locally only:10 commands; no pending local migrations. No remote/customer data, deployment, commit/push or flag changes. Recovery: preserve guards/history, disable affected mutations before code rollback and repair forward. Remaining command-ledger, version/asset and snapshot/seal defenses still need audit. Full M1–M5 and hosted acceptance remain active.

## 2026-10-26 — M2m3 project defaults and album inheritance (accepted locally)

- Implemented strict contracts,0031, services/API, Owner project/album controls and Guest effective policy reads/refresh. Explicit album overrides win as a whole, including unlimited maximum; inherit mode retains its durable epoch. Cursors bind source/album epoch plus inherited project epoch. Existing shared review rounds keep their confirmed fixed bounds.
- Atomic current authorization/CAS/cap checks, immutable command/result/audit, symmetric request namespaces and safe legacy replay are enforced. Project cap lowering checks inheriting open drafts; album reset checks its own drafts. Owner confirmation shows actual proposed bounds, retains exact unknown intent across401/403 and reads current state after historical replay. Old0028 results/history remain untouched; new legacy API writes use explicit overrides and a stable original-payload commitment.
- Root review fixed UPSERT INSERT witnesses, effective-vs-stored inherit witnesses, NULL CHECK fallthrough, same-query replay authorization and legacy-seed replacement. New/old policy results and audit_events reject INSERT OR REPLACE. Cron preserves the first same-day dry-run event through insert-if-absent; deletion remainsOFF.
- Actual final checks: pnpm test:cloudflare133 local workerd/D1/R2/Chromium checks; test:unit108/21 files; test:integration61/10 files (27.81s); typecheck; lint; Next build; test:e2e14 reference Chromium (25.9s). Worker browser coverage is in test:cloudflare. Final format:check,34-file specification checker and git diff --check passed. Populated0004→0031 compares every old table, seeds a real0028 override and rejects legacy-result/seed replacement. Concurrent Cron observations preserve one unchanged audit event.
- Local list showed only0031 pending; db:migrate:local applied41 commands; follow-up list has none pending. No remote resources, real provider credentials, customer data, commit/push/deploy or flag activation. Shared Owner mobile screenshot shows both new policy panels at375px; visually inspected alongside automated overflow checks.
- Recovery: disable Guest selection before code rollback, retain0031 plus old history and repair forward or restore a separately verified consistent backup. Do not restore an enabled0028 issuer against its now read-only command table.
- Three gpt-6-luna/max workers used isolated worktrees; root integrated, reviewed and ran acceptance. Remaining: broader historical ledger replacement audit, tags/comments/annotations/full activity/versions/BeforeAfter/delivery/notifications/retention and hosted OAuth/KDF/edge/R2/CORS/import/backup/CI/deployment gates. Full M1–M5 goal remains active.

## 2026-10-26 — M2m2 shared reviews accepted locally

- Implemented explicit Owner-confirmed shared subjects with sealed invitation membership, independent rights, per-round bounds, immutable submissions/history, streamed exports and confirmed reopen. Private picks and feedback remain separate. Cookie-switched uncertain retries retain expectedGuestId and are denied without new writes.
- Actual final pnpm test:cloudflare:127 checks PASSED, including populated0004→0030 preservation, two-distinct-Guest29→30 race, Owner native CSV/TXT/JSON downloads and two-Guest Chromium flows with real private processed-thumbnail loading. Latest typecheck, lint, format:check, Next build,34-file documentation checker and git diff --check passed. Earlier same-slice unit98, integration61 and reference Chromium14 passed; these do not prove hosted services.
- Local migration list contained only0030; db:migrate:local executed75 commands successfully; follow-up list has no pending migrations. No remote migration/customer data/credentials/commit/push/deploy. All feature defaults remain OFF/hard-local; retention dry-run stays ON.
- Browser test bridge uses real loopback HTTP for native attachments. Hard-navigation cancellation is tested; successful preflight completion after React-only unmount remains code-reviewed rather than independently browser-proven. No live collaboration push: participants explicitly refresh.
- Recovery: disable shared access, preserve0030 and all immutable history, repair forward or restore a separately verified consistent backup; no destructive down migration. Next M2m3: project inherited selection defaults. Tags/comments/annotations/full history/versions/BeforeAfter/delivery/notifications/retention and hosted OAuth/KDF/edge/R2/CORS/backup/CI/deployment remain required. Full M1–M5 goal stays active.

# Changelog

## 2026-10-26 — M2m1 private policy and retained-round repair (complete locally)

- Added current Owner policy min/max/CAS/confirmation, immutable command/result/audit and private per-Guest enforcement, policy-bound selection cursor and independent submit permission output.
- Added Guest bounds display, capacity-clipped visible-page batch planner and usable limit/cancel/submit controls, plus safe Owner form/retry/current-policy reconciliation.
- Added migration0028 and forward0029 repair for unchanged reopen submission, preserving old snapshots/replay and appending initialization audit for legacy open revision0 rows.
- Actual Worker123/unit95/integration61/reference Chromium14, Next build, strict checks and populated upgrade through0029 passed.0028/0029 applied locally (28/6 commands), no pending migrations. No remote SQL, production credentials/customer data, deployment/commit/push; shared mode and complete M1–M5 remain open.

## 2026-10-26 — M2l independent Guest ratings/favorites

- Added logical-photo stars1–5/clear and favorite/unfavorite with exact version witnesses, independent permissions, strict API and24-ID current-state batches.
- Added migration0027 immutable feedback commands/results, predecessor-chain state protection, atomic before/after audit, no-op/replay semantics and symmetric cross-ledger conflicts; existing snapshots/history remain intact.
- Added shared Guest Grid/Lightbox controls, exact uncertain retries, current-state reconciliation and A→B→A stale hydration protection; Owner composer reflects feedback capability.
- Local unit91/integration61/reference E2E14, Next build and strict checks passed. Final pnpm test:cloudflare passed117 local checks including browser acceptance; see VERIFICATION.0027 applied only locally; flags stay OFF, no deploy/push/remote migration.

## 2026-10-26 — M2k connected invitation entry

- Added real Owner invitation creation/share UI with three modes,12 independent rights, active-album pagination, local expiry/UTC serialization and max-use configuration.
- Added Guest fragment entry, nickname/password exchange, private gallery navigation and explicit uncertain-response session checks. Tokens never enter path/query or persistent browser storage.
- Unknown Owner intent retains UUID/payload across retry401 and metadata recovery; same-tick Guest submission is locked. Composer collapse retains transient state.
- Added strict non-secret capability reads and shared browser/server password validation; no migration or deployment flag change.
- Local Worker suite112, unit88, integration61 and Next build passed. Final supplementary check results and resolved test failures are in VERIFICATION. Hosted service acceptance remains open.

## 2026-10-26 — M2j Guest selection and Owner submission review

- Added Guest 24-photo cursor pagination and full selection-cursor hydration; visible-page batch selection is sequential, stale or partial writes refresh from the server, and logout retries retain one request ID.
- Added Owner submission list/detail contracts, D1 repository, and scoped API routes for history, immutable snapshot detail, CSV/TXT/JSON export, and explicit round reopen.
- Reopen writes the selection.reopened audit event and advances the current round atomically under Migration 0026 guards; sealed earlier submission snapshots remain immutable.
- Bound idempotent replay to the exact actor, workspace, project, album, invite, Guest, expected round and deterministic event ID. Reusing a request ID for a changed target returns 409 and does not mutate that target.
- Neutralized spreadsheet-formula filename cells in CSV for leading whitespace/control followed by =, +, - or @; normal CSV quoting remains. TXT and JSON are unchanged.
- Successful CSV/TXT/JSON export GETs append a scoped download.generated event before returning the attachment; metadata excludes filenames and export contents, and audit failure fails closed. No schema migration was needed.
- Owner UI provides submission review and downloads. Only the latest submitted round can be reopened. The dialog manages focus, Tab trapping, idle Escape close and focus restoration; historical cards accurately reflect later round status.
- Worker and Chromium coverage includes changed-target replay, malicious CSV filenames, keyboard dialog behavior, focus restoration, and the round-2-only reopen action.
- Root verified: pnpm test:cloudflare 109 local checks, pnpm test:unit 88, pnpm test:integration 61 after the timeout fix, pnpm typecheck, and pnpm lint.
- Verified final local checks: test:cloudflare 109, unit 88, integration 61 after the timeout fix, typecheck, lint, Next production build, 14 Next/reference Chromium E2E tests, format, 30-file specification checker, and diff check. The Next/reference E2E suite does not exercise the Worker UI; hosted OAuth/Supabase/R2/edge/restore/deployment remain unchecked. Selection routes are default-off and hard local-only.

## 2026-10-25 — M2j Guest selection customer UI and browser acceptance (historical)

- Applied additive migration `0026_guest_selection_snapshot_guards.sql` to local Wrangler D1 (`--local`). Enforces snapshot sealing (`guest_selection_submission_seals`), immutable snapshot items, and atomic status transitions (including preparation for `selection.reopened`).
- Implemented Guest selection customer UI in `apps/web/target-ui/guest-selection.tsx`: responsive gallery grid, thumbnail rendering, Lightbox preview, permission awareness (`can_view`, `can_select`, `can_submit`), interactive photo selection with version pinning and UUID request ID, sticky bottom status bar, empty submission guard, confirmation modal, round freeze, and guest self-logout.
- Integrated Guest route `/guest/albums/:albumId` into `apps/web/target-ui/app.tsx` without triggering owner authentication hooks.
- Added Playwright Chromium mobile E2E test `runGuestSelectionBrowserChecks` in `apps/worker/tests/guest-selection-browser.mjs`, verified against real local workerd + D1 + synthetic R2 on 375px mobile viewport with screenshot `.local/guest-selection-mobile.png`.
- Fixed test assertion scoping in `apps/worker/tests/guest-access.mjs` (scoped command/state count queries by `guestId`) and immediate response consumption in `apps/worker/tests/guest-exchange.mjs`.
- Passed all checks: 104 local Cloudflare checks, 88 unit tests, 61 integration tests, 14 Playwright E2E tests, typecheck, lint, Prettier format, and handoff integrity check.

## 2026-10-24 — M2j Guest selection read and submission backend (local-only)

- Added migrations 0024/0025 for Guest-scoped round revision, immutable submission rows with exact version IDs, result snapshot, atomic submitted state and append-only audit. Existing rows remain intact.
- Added a current-ACL, can_select-only selection page and an independent can_submit submission route. The submit body never accepts the selection list; the database snapshots current selected rows and freezes Guest writes after commit.
- Local verification: 103 Cloudflare checks passed, including populated upgrade preservation through 0025 and submission/failure/retry cases. Applied 0025 to local D1 only. Guest and Owner UI, reopen/export, selection limits and hosted acceptance remain open.
- No remote database, deployment, push, commit, credentials or safety flag change.

## 2026-10-24 — M2i Guest selection write backend (local-only)

- Added migration 0023 with per-invite/guest/photo selected state, immutable command/result snapshots, current ACL trigger, scoped version/album FKs and atomic append-only audit.
- Added a strict Guest selection PUT contract/repository and default-off `GUEST_SELECTION_ENABLED`; hosted activation is rejected. Selection-only grants remain independent from can_view.
- Verified populated migration preservation, exact retries/conflicts, current ACL/revocation denial, audit rollback and no-op semantics in local Worker/D1 tests. No Guest selection read/submit UI or Owner export is included.
- No remote migration, customer data, OAuth/R2 credentials, deployment or push.

# KINO Pic Changelog

## 2026-10-24 — M2h Guest read-only gallery backend

- Added Guest-scoped paginated album reads and private thumbnail/preview gateway. Current D1 ACL checks run on every read and bind the requested album; unauthorized album IDs cannot be confused with authorized empty albums. Only `can_view` is required for preview display; original bytes are unavailable.
- Verified private derivative output slot, image/jpeg, exact size/SHA-256 and8MiB cap before streaming inline with no-store/same-origin headers. No migration, write API, action audit, browse event, Guest UI or view-retention heartbeat was added.
- Fixed the unauthorized-empty-result ambiguity after the new real D1 test exposed it. Full local Cloudflare suite passed102 checks; other test/build/hygiene evidence and hosted limits are recorded in VERIFICATION.md.

## 2026-10-24 — M2g local Guest session exchange

- Added migration0022 and local-only default-OFF `POST /api/guest/exchange`: strict bearer/password input, trusted CF address admission, current ACL, generic denials, Guest/Owner shared global KDF permit, atomic identity/session/max-use/audit, and confirmation-bound HttpOnly cookie.
- Added one-time response handling with no secret persistence/recovery, HMAC request commitment, Owner revocation guidance, populated migration checks, workerd/D1 race/rollback/HTTPS and Chromium lost-response coverage. No Guest UI/gallery/action or hosted enablement.
- Initial local runs exposed and fixed a 503-vs-401 mapping error for a held global KDF slot, then a Chromium harness route gap. Final verification passed:101 Cloudflare checks,86 unit/16 files,61 integration/10 files,14 E2E, build, strict typecheck, lint, format and diff check. Migration0022 applied to local D1 only (22 commands); no hosted-service acceptance is implied.

## 2026-10-24 — M2f Guest admission foundation

- Added0021 D1-clock atomic fixed-window buckets for source address, address/invite and invite. Domain-separated HMAC pseudonyms only; malformed/unknown bearer creates no invite bucket, all denied attempts count. Capacity ledger bounds rows at100000; Cron prunes at most1000 oldest expired transient buckets per invocation.
- Added address canonicalization, boundary/reset/capacity/privacy/prune workerd tests and docs. No Guest route, KDF verification, session creation or permission grant was enabled. Exchange remains pending current ACL and atomic issue integration.
- Final local evidence:93 real workerd/D1 groups,83 unit, strict typecheck/lint;0021 applied local-only in7 commands. Hosted/live address and abuse load are not tested.

## 2026-10-24 — M2e Owner KDF admission

- Added0020 D1 single-slot admission with immutable resource history and bounded current slot; actual local issuer acquires before hashing and releases only after native settlement. Audit failure/unknown outcome fail closed; link-only and recovery remain available.
- Added real workerd/D1 concurrency, stale held slot, old-release isolation, acquire/release rollback and actual issuer failure tests. No TTL/reaper/public Guest exchange/production enablement. Quiesced repair and rollback documented in KDF_ADMISSION.md; final evidence in VERIFICATION.

## 2026-10-24 — M2d local Owner invitation issuance

- Added0019 atomic creation/scope/seal/request audit and six-ledger replay namespace; all prior data preserved. Added strict three-mode Owner POST and metadata-only original-request recovery.
- Credentials only for positive proven initial winner; concurrent/unknown-response retries never reissue or redisplay secrets. HMAC binds exact custom password without plaintext persistence; rotation uses recovery GET. Flag false in every env, new issuance local-only; no Guest exchange or creation/share UI.
- Actual87 initial Cloudflare groups,78 unit/61 integration/14 reference Chromium/build/types/lint pass; final current-source migration/hygiene in VERIFICATION. No remote data/push/deploy or production flag enablement.

## 2026-10-24 — M2c Guest credential primitives and self-logout

- Added fixed native scrypt verifier, exact bounded Unicode/format, random bearers and domain-separated hashes; no downgrade/public KDF call.0018 guards new verifier format including NUL/terminal-newline cases while preserving old data.
- Added Cookie-proof Guest logout API and immutable command/session revocation/request audit. Exact retry, conflict isolation, expired/Owner-disabled withdrawal, failure proof retention and selective HttpOnly cookie clearing are tested. No Guest login/gallery UI or public issuance/exchange.
- 78 unit and final81 local Cloudflare groups pass, plus61 integration/14 reference Chromium/build/strict types/lint.0018 applied local only,9 commands; final hygiene in VERIFICATION. Local KDF wall samples are not hosted/free-tier acceptance. No remote data/push/deploy or safety flag changes.

## 2026-10-24 — M2b Owner invitation inspection/revocation

- Added0017 immutable revocation commands, all-ledger namespace guards before replay, current-Owner/session and atomic request-correlated audit. Existing0016 history preserved; local migration16 commands only.
- Added private24-row invitation list and confirmed same-origin revoke API/UI, refresh/paging/empty/errors and safe same-ID retry after lost success. Existing Guest sessions denied after commit; no photo/history deletion or fake invite creation.
- Actual75 Cloudflare groups pass including populated upgrade, audit rollback, concurrency, namespace/auth and375px Chromium. Full final verification in VERIFICATION; no remote data/push/deploy/flag enablement. Issuance/KDF/throttle/exchange/Guest photos/actions remain next.

## 2026-10-24 — M2a Guest authorization foundation

- Additive0016 introduces hash-only scoped invites, immutable album seals, independent identities/sessions, revocation witnesses, twelve independent rights and atomic audit/max-use guards. Exact populated upgrade preserved; applied local D1 only(36 commands).
- Added separate read-only Guest album-access API with current expiry/revocation/Owner/state/scope checks and uniform denial; Owner routes remain closed. No public issuer/exchange/KDF/throttling/logout/Guest photos/actions/UI yet.
- Actual74 unit,61 integration,70 local Cloudflare groups,14 reference Chromium, Next build, strict typecheck and lint passed. Final hygiene in VERIFICATION; no remote data/push/deploy or safety flag changes. Recovery/next steps in GUEST_ACCESS_FOUNDATION/HANDOFF.

## 2026-10-24 — CF-03c5 upload reload recovery

- Added bounded metadata-only, actor/album-scoped upload journal, exclusive cross-tab locks and explicit original-file reselection/hash verification. Stable mutation IDs persist before requests; storage failure stops writes.
- Added read-only original-intent recovery API and browser actor-expectation binding. Reload resolves lost init/PUT/completion without duplicate originals; stale lifecycle callbacks stop and cancellation retains its intent. No signed URL/File/preview/auth secret persistence.
- 70 unit/62 local Cloudflare acceptance groups pass; broader checks and limitations in VERIFICATION/UPLOAD_RECOVERY. No schema change;0015 remains latest. Original authorization expiry is not renewed; multipart and pending-discovery remain open. No push/deploy or safety-flag enablement.

## 2026-10-24 — CF-03c4b Owner-confirmed processing abandonment

- Migration0015 adds terminal abandoned, preserves populated jobs/slots through a child+parent rebuild, and adds immutable globally scoped resolution commands. Local apply53 commands.
- Explicit Owner confirmation, permanent two-key fences, current session/epoch checks, atomic quota release/audit, exact retry and real abandoned gallery state. Occupied/unknown/readonly retain capacity; originals/used bytes remain.
- Actual61 local Cloudflare groups pass including audit rollback/concurrent replay/FKs/namespace/current-session and375px lost-response recovery. No remote data, deployment or automatic deletion. Full tests/recovery in VERIFICATION/PROCESSING_REVIEW.

## 2026-10-24 — CF-03c4a Owner processing review preview

- Added scoped, private, read-only processing review API and real gallery inspection UI showing retained original,16MiB held and both output states.
- Added trusted conditional two-output fencing primitive and real R2/native-runner race tests; public mutations and quota release remain pending explicit terminal-state migration/Owner confirmation. No schema change;0014 remains latest.
- Actual Cloudflare suite60 groups, typecheck and lint passed; final checks in VERIFICATION. No remote data, push/deploy or safety-flag enablement.

## 2026-10-24 — CF-03c3 durable native processing and private Owner gallery

- Migration0013 adds a transactional original outbox, immutable derivative slots, two-level quota reservation, D1-clock token/epoch leases and atomic private assets/actual usage/audit completion. Unknown writes and expired/review jobs keep capacity; no legacy backfill or deletion.
- Added finite local Node runner using local-only workerd proxies, actual R2 checksum-bound create-once outputs, Owner-only paginated Grid/private gateway and keyboard-accessible Lightbox. No public manifest completion proof, original gateway or paid processing service.
- Fixed missing static assets being eligible for immutable HTML caching. Added native workerd/D1/R2 rollback/retry/quota/lease tests and375px browser paging/focus/preview checks.65 unit/61 integration/54 Cloudflare/14 reference Chromium, lint/typecheck/Next build passed; recovery/gates documented in PROCESSING_PIPELINE/HANDOFF.
- Applied0013 locally only(15 commands), then0014(5 commands); no remote/customer data, push/deploy or safety-flag enablement. Full M1–M5 remains open.

- Forward migration0014 fixes archive busy guards that incorrectly rejected historical replay after restore/new work, and scopes checks to current Owner/session. Real D1 regression verifies preserved snapshot, unchanged current revision/state, invalid-session denial, conflicting request payload rejection and new busy command denial. First test fixture used POST instead of PATCH and was corrected; the subsequent409 exposed the actual guard bug. Local0014 applied successfully(5 commands), no remote data change.

## 2026-10-23 — CF-03c2 real local native image processing

- Added ImageProcessingAdapter and a pinned Node-only sharp implementation: full bounded JPEG/PNG/WebP decoding, strict identity/hash/MIME/dimensions, single-image checks, orientation/sRGB and stripped JPEG thumbnail/preview output verification.
- Added an executable local command with bounded file reads and create-once intent/artifacts/manifest. Flushed staging files publish atomically without overwrite; exact retries, interrupted writes and parallel publishers are tested. Corrupt final files and foreign links fail closed.
- Actual checks passed:56 unit,61 integration,44 local Cloudflare groups,14 reference Chromium E2E, typecheck/lint/Next build. Final format/docs/diff checks are recorded in VERIFICATION. Added LOCAL_IMAGE_PROCESSING.md; updated agent handoff and next job/quota integration requirements.
- No new schema/API/Worker processing route, R2 derivative, gallery or deployment. This local adapter is not yet wired into trusted D1/R2 processing. Safety flags remain OFF/dry-run; original attachment and unrelated work preserved.

## 2026-10-23 — CF-03c1 image dimensions and browser uploader

- Add bounded JPEG/PNG/WebP headers and0012 atomic immutable dimensions, preserving legacy unknown dimensions/history.
- Add feature-gated20-file/64MiB sequential browser upload, local decode/hash/transient previews, stable retries and expiry reconciliation.
- Fix disabled-init quota writes and expired queue rows found by independent review.
- 44 local Cloudflare/46 unit/49 integration/14 reference Chromium E2E/build/typecheck/lint passed. Only0012 applied locally; trusted server decoder, persistent thumbnails/gallery, live R2/CORS/restore/deployment remain open.

## 2026-10-23 — CF-03b local R2 upload authorization and completion

- Additive D1 migrations 0009/0010 introduce strict upload specs, short-lived owner authorization, durable workflow results, key-fence/review records, immutable photo version/original asset records and atomic quota conversion.
- Worker signs a scoped single-part PUT with create-once, exact length/type and SHA-256 checksum constraints. Completion checks private R2 metadata/checksum and image signature before materializing metadata; invalid objects enter `needs_review` and retain reserved bytes.
- Cancel/expiry of signed requests requires a successful persisted conditional key fence. Direct upload remains disabled in all Wrangler environments. Local R2/workerd tests do not prove real bucket CORS or real credential/browser PUT behavior.
- Fence-marker recognition now requires the matching session metadata, zero-byte object size and dedicated fence MIME. Regression tests prove spoofed metadata on a real image cannot pass completion or release quota during cancel/expiry; concurrent expiry creates one fence. Migration 0011 adds composite tenant relationship guards for photo/version/asset/completion/audit writes.
- Local Cloudflare checks, typecheck, lint, unit, integration, build, Chromium E2E, format/docs checks passed. The isolated 0011 upgrade test is local-only; remote migrations, live R2/CORS and backup/restore remain unverified. No upload UI, full image decoder/thumbnail, photo grid, guest flow or resumable multipart support is included.

## 2026-10-23 — CF-03a D1 upload reservations

- Add additive D1 migration0008, strict contracts, Owner-only init/read/cancel API and atomic workspace/node quota reservation, immutable session/history, cancellation and expiry audit.
- Every five minutes release only expired reservations that have no R2 signer; archive blocks while a scoped upload is reserved. Retention deletion remains OFF; its observation audit is deduplicated per UTC day.
- `pnpm test:cloudflare` passes34 local workerd/D1/R2 checks including concurrency, replay/collision, rollback, quota boundary, archive exclusion and Cron expiry. Full regression results and limits are in HANDOFF/VERIFICATION.
- No R2 transfer or authorization, photo/asset/version, upload UI, remote migration, real OAuth or deployment. Next is CF-03b signed R2 upload plus verified completion and safe expiry reconciliation.

## 2026-10-23 — CF-01 architecture integration / closed Owner foundation

- Explicitly adopt Cloudflare target while preserving existing Next/PG functionality and all product requirements; canonical addendum/shared agent/runbook docs integrated.
- Add real Worker/Static Assets/Hono/Better Auth/D1 bootstrap/session-audit migrations and private immutable R2 adapter; no first-login Owner, public signup or Email merge. Strengthen Google token signature verification through SDK helper.
- Twelve actual local workerd/D1/R2/provider-fixture checks pass; original34unit/49integration/14browser/build preserved. Local Cron records deleted0 only.
- CI adds Cloudflare verification; controlled CD remains blocked pending reviewed cutover. No real OAuth/resource deployment, direct upload, D1 business port, full linking/session UI or retention planner completed.

## 2026-10-23 — Reversible empty-content archive

- Migration0008 records archive origins; owner-only project/album archive/restore with revision CAS, transactional audit/idempotency and confirmation UI.
- Block photos/busy states; freeze names/new children under archive, preserve child state/protection/human-view clocks, reject unknown legacy restore origins. No deletion or retention enablement.
- SQL/browser regressions cover rollback, roles/revocation, original-state restore, conflict/reconfirm and lost-response retry. Full verification/remaining gates in HANDOFF.

## 2026-10-23 — Owner album protection

- Add migration0007 and owner-only album pin/hold API and UI, explicit unprotect confirmation, shared revision conflicts and atomic before/after audit/idempotency.
- Current authorization precedes replay; deleting/deleted reject new changes. No state transition/deletion/retention enablement or activity-clock reset.
- Add SQL rollback/permission/CAS/replay and browser conflict/network-retry/confirmation tests; verification and remaining gates in HANDOFF/VERIFICATION.

## 2026-10-23 — Isolated Worker runtime proof

- Preserve a pinned vinext/Cloudflare Vite/Wrangler hosting PoC in a separate branch; production build and browser flows executed on local workerd. Default Next/Supabase/PG unchanged.
- Add expired chunked-cookie direct-dashboard regression; verify proxy rotation, HttpOnly/Lax and private/no-store before writable API calls. Record Next versus workerd Vary differences.
- No schema migration, remote deployment or live provider validation. Reproduction, failures and remaining cloud/security gates documented in HANDOFF/VERIFICATION.

## 2026-10-23 — Compatibility assessment and SQLite transaction probe

- Add staged Cloudflare/Next/Auth/D1 assessment with current official sources, runtime/data migration gates and rollback boundaries.
- Pinned vinext static scan of isolated apps/web reports15/15; no adapter adoption or deployment.
- Add eight isolated SQLite tests for CAS/audit failure semantics, replay, tenant scope and revocation. Full32unit/35integration/lint/typecheck/build pass. Application runtime/schema/dependencies remain unchanged.

## 2026-10-23 — Google / GitHub 共用身分

- 支援單來源登入或主動綁定兩來源，共用同一平台 user ID/workspace；新增帳號頁與來源設定開關。
- migration0006：GitHub OAuth guard、私有短效 hashed link intent、前後 actor 驗證、append audit/安全重送，既有資料不搬移。
- 32 unit / 27 integration / 11 browser、lint/typecheck/build 通過；真實 OAuth/設定尚未驗證，manual linking 預設關閉。Auth automatic-email linking、closed/Owner-only、新部署補充的差異清楚記錄，沒有宣稱部署完成。

## 2026-10-23 — M1-02 subset / security hardening

- 專案與相簿可建立、分頁、改名；角色控制、revision 衝突與草稿保留、安全重試。
- migration 0003–0005：audit TRUNCATE 防誤清、首次建帳鎖順序、不可變父項、transactional audit/idempotency、Unicode 名稱一致性；復原文件齊備。
- 新增撤權競態、失敗回滾、斷線重送與 cookie refresh/重放測試；27 unit / 21 integration / 7 browser、lint/typecheck/build 通過，production audit 0。
- 封存/刪除/保護、照片/R2、真實 OAuth/Supabase 與多連線 PG 驗收仍待完成；自動刪除 OFF/dry-run。

## 2026-10-23 — Phase 0

- 正式名稱改為 KINO Pic；指定目錄盤點、規格展開與 Git 初始化，保留原始附件。
- pnpm monorepo、Next.js App Router、React、strict TypeScript、Tailwind、shadcn 設定/共用 primitive、TanStack Query、Zod。
- 核心 interfaces、記憶體 immutable scope storage、本機狀態頁與健康 API。
- 六張初始表與 read-only RLS、migration runner / checksum / lock、復原指引。
- Vitest、PGlite SQL/RLS、Playwright 桌機/手機、本機 CI workflow；尚未遠端 CI 或部署。
- 自動刪除保持 OFF、dry-run ON；Google OAuth、真實 R2、完整 workspace/project/gallery 功能未完成。
- 驗證與限制：見 HANDOFF、VERIFICATION、ADR-0002。下一步 M1-01。

## 2026-10-23 — M1-01 local identity/workspace

- Add server-only Google/Supabase SSR PKCE and verified sessions, workspace dashboard/cursor pagination, owner member API.
- Add migration 202610230002: transactional provisioning/member writes, append-only management audit and private idempotency ledger; recovery documented.
- Add strict API validation/CSRF/body limits and test-only auth HTTP fixture. Local 17 unit / 6 integration / 4 browser tests passed; real OAuth/Supabase remains unverified.

## 2026-10-23 — CF-02a workspace D1 backend

Added migration0003 workspace/command tables, transactional current-Owner/session guards, immutable original responses and workspace.created audit. New Worker create/read workspace endpoints reuse existing contracts/cursor, strict input/Origin/body bounds,24-row keyset paging and100-workspace cap. Added five real local D1/workerd check groups for concurrent retries, input/CSRF, audit rollback, current authorization and tied timestamp pagination/cap. Reference frontend/Auth unchanged; project/album/UI migration remains pending. Recovery guidance in DEPLOYMENT.md.

## 2026-10-23 — CF-02b D1 content operations

Added D1 migration0004 with projects, albums, photo catalog guard and actor-wide request ledger; upgraded historical workspace command snapshots without removing old audit/rows. Added target Worker repository/API for project and album list/create/rename, album protection, and reversible empty-content archive. Added SQL tenant/parent/current-session/CAS/state guards, immutable results and before/after append-only audit. Twenty-four local Cloudflare check groups now include 0003→0004 data migration, concurrent create retry, cross-operation conflict, tenant IDOR, audit rollback, CAS/replay, protections and archive guards. No target UI or cloud resources changed.

### CF-02b migration0005 parent integrity

Added D1 parent immutability and photo catalog triple-scope guards; applied locally and tested. Documentation distinguishes the metadata catalog from actual image upload/version delivery.

### CF-02b migration0006 audit keys

Preserved audit entries while removing global request-ID collisions across actors; immutable event IDs and append-only triggers remain. Upgrade test verifies history copy and equal action/request IDs from separate actors.

### CF-02b migrations0006-0007 audit repair

Audit rebuild now preserves historical fields/event IDs, removes cross-actor request collisions, then recreates bootstrap/session/workspace/content audit writers. Local upgrade evidence covers both row preservation and successful new events after the table swap.

## 2026-10-23 — CF-02c first Worker React UI slice

- Build a Vite React target UI into ignored Worker Static Assets; reuse existing workspace and project/album form components. Add same-origin Better Auth Owner gate, deep-link shell fallback, JSON 404 for unknown API routes, private/no-store HTML/API and immutable hash-bundle caching.
- UI covers workspace/project/album list and create, rename, album pin/hold, and eligible empty-content archive/restore. Add workerd-backed Chromium acceptance that checks D1 rows after browser actions.
- No database migration, remote data, real provider login, or deployment. Guest/gallery/upload/version/delivery/retention and full migration parity remain incomplete.

## 2026-10-29 — CURRENT: human-photo heartbeat accepted locally; one-client approval confirmed

This appended entry supersedes earlier same-day statements that no heartbeat endpoint exists or that the one-versus-all question is pending. Owner/Guest visible-photo heartbeat is implemented through0053 native append-only witnesses/monotonic album activity/audit,scoped repositories/APIs and existing Gallery grid/Lightbox image wrappers. Default HUMAN_VIEW_TRACKING_ENABLED=false/hard-local.0053 SOURCE ONLY;default persistent D1 stays0052. Auto-deleteOFF/dry-run;no R2/quota mutation or deployment.

Final isolated `apps/worker/.local/human-views-focused-final.log` exited0:3 API groups +2 controlled375px Owner/Guest browser flows using the real existing upload/R2/Sharp fixture. Exact immediate rolling dedupe/deadline,authority/origin/visibility denials,forged actor/audit/projection/log guards and injected audit rollback pass. Management list/unloaded/hidden/subsecond/blur do not count;continuous visible images count;preview shares cooldown. Headless focus/visibility is controlled,not native headed or actual five-minute wall-clock recapture proof.11 scoped contract tests,13 retention safety tests,final Worker/UI build,generated bindings,root/Web strict and scoped lint pass. Acceptance:worker .local/human-views-acceptance.json. Failed DDL parentheses/test-JS-hold/Web-regex strict logs remain preserved. No broad suite was repeated.

New safety requirement: activityEvidenceVerified is mandatory in pure retention input;unknown legacy/offline/untracked periods exclude with activity_unverified. Missing last-view data must not imply never viewed. Heartbeat alone does not provide continuous coverage,state-change/policy/reference completeness or deletion authority. See docs/HUMAN_PHOTO_VIEWS.md for exact files,evidence,recovery and gaps.

User confirmed「其中一人代表確認即可」:any one authorized client may confirm a fixed version. This resolves the prior question;do not ask again or require every anonymous visitor. Next implement explicit Owner-authorized immutable request/invitation/Guest confirmation and fixed delivery manifests;retain full retention policy UI/preview/persistence/locks/recheck/retry and remaining M1-M5/hosted scope. Before0053 persistent adoption use fresh backup/isolated upgrade/live parity. Preserve unrelated dirty edits;no commit,push or deploy.

## 2026-10-29 — CURRENT follow-up: append-only REPLACE and equal-clock safety accepted

This extends/supersedes the earlier three-group human-view checkpoint:the final focused native run `apps/worker/.local/human-views-replace-safety.log` exited0 with4 API groups +2 controlled375px Owner/Guest browser flows.0053 now rejects duplicate event_id OR request_id before INSERT,so SQLite REPLACE cannot bypass append-only delete guards. Projection upsert is attempted only for an advancing frontier;two valid same-millisecond events both remain in log/audit while the maximal timestamp/UUID witness stays canonical. Native replacement/event/request/projection and equal-clock cases pass. Final test fixture selects the known non-frontier witness for timing stability;scoped lint passes. Evidence `apps/worker/.local/human-views-replace-acceptance.json` preserves the earlier checkpoint and its log rather than rewriting evidence.

0053 still SOURCE ONLY;default D1 stays0052,tracking OFF/hard-local,automatic deletionOFF/dry-run. activityEvidenceVerified must cover the policy's decision window;missing legacy/offline data is never proof of inactivity. Future deletion must separately protect in-flight authorized reads/downloads and the first1s visibility qualification window,without renewing the30-day timestamp for preloads. No physical deletion/hosted acceptance claim. User's one-authorized-client representative version approval rule is confirmed and next for implementation;fullM1-M5 remains active/incomplete. All existing document history and unrelated dirty changes are preserved.

- 2026-10-29: Recorded Gump create/share/photo reference and limitations. Drafted local-only default-OFF version approval contracts, history projections and source-only migration 0054; route is unmounted and service incomplete. Focused 18 tests and root TypeScript passed; two separate history suite tests failed due to fixture/contract discrepancies, documented in HANDOFF. No deployment or persistent migration.

- 2026-10-29: Integrated local-only default-OFF exact-version approval API/service and Owner/Guest panels; isolated native D1 and API checks passed. 0054 remains source-only. Browser acceptance and production configuration remain open; see HANDOFF.

- 2026-10-29: Version confirmation isolated Chromium ON/OFF flows passed; PHOTO_VERSIONS_ENABLED is now a prerequisite for its default-OFF capability. See HANDOFF for remaining migration and provider gates.

- 2026-10-29: Full local Cloudflare regression passed 367 checks after correcting stale Guest 401 fallback and access-read expectations. Production/remote provider validation remains open.

- Added fixed delivery contract groundwork and an Owner warning about view-only invites losing access after version switches; delivery publication is not implemented and focused warning verification remains pending.

- Tested version-confirmation head switch: view-only Guest cannot access historical V1, compare-authorized Guest can confirm pinned V1, and Owner receives the warning. Isolated local environment only.

- Fixed delivery schema remains incomplete in .local draft; no migration was applied. Auto-review rejected unfinished SQL in the auto-applied migration directory. See HANDOFF for missing guards and recovery boundary.

- Grouped Owner invite permissions into basic and initially collapsed advanced sections; preserved independent permissions and one-time credentials. Tightened unfinished delivery Guest read contract for view-or-download authority.

- Corrected assisted catalog browser test to wait for rendered pagination; focused local 7-check workerd/D1/API/Chromium runner passed. Full suite remains not rerun after the correction.

- Added active album share entry using the existing invite composer, with safe preselection and non-overwriting pending-operation behavior. Corrected duplicate sibling React keys; focused local Chromium flow passed.

- Added direct Guest Before/After slider handle, pointer capture, touch-friendly scrolling, labels and reduced-motion-aware idle hint; isolated API/Chromium checks passed. Owner comparison remains pending.

- Added Owner read-only version comparison and pinned currentVersion metadata/head-bound cursors; isolated Owner and Guest browser/API regressions passed. No schema migration or deployment.

- Began freehand annotation foundation with bounded geometry, oriented coordinate sampling and canonical JSON; no UI or database write capability is enabled.

- Prepared a review-only freehand annotation guard proposal and verified Guest/Owner valid/invalid geometry behavior in isolated Node SQLite; it is not applied or enabled and still requires workerd/D1 and full integration validation.

- Added a default-OFF local-only freehand safety gate; no freehand UI, routes or persistence is enabled. D1 atomicity verification remains open after two test harness setup failures.

- Verified freehand proposal in isolated workerd D1 batch, including rollback at each guard replacement step; no automatic migration or user-facing feature was enabled.

- Prepared disabled freehand canvas and separate canonical/read compatibility helpers; no end-user brush or persistent migration enabled.

- Prepared opt-in disabled freehand canvas and scoped client compatibility helpers; existing Guest annotation point/rectangle local browser regression passed. No brush UI or server writes are enabled.

## 2026-10-29 — Freehand canvas isolated browser verification

A test-only Vite fixture and Playwright configuration exercise the opt-in AnnotationCanvas without connecting product editors or services. Root independently ran `pnpm.cmd exec playwright test --config playwright.freehand.config.ts --reporter=line`: 4 Chromium tests passed. They cover default omission, actual mouse-drag stroke, scope change and permission loss cancelling a draft, and Enter/arrows/Escape keyboard use. The fixture uses synthetic local data; it does not establish Guest/Owner persistence, mobile touch, hosted services or production E2E. Freehand remains unwired and default OFF. Next integrate authorized full-feed read compatibility and compare the read snapshot watermarks before parsing or returning any items; then complete schemas, serializers, journal, both editors, reviewed forward migration and isolated end-to-end acceptance. No production/customer data or delivery draft was touched.

## 2026-10-29 — Read compatibility draft and prototype inventory

Four annotation read repositories and three route modules now contain a preliminary freehand capability/preflight integration with scope watermarks and 426 handling; freehand remains OFF and no client advertises support. This is an UNACCEPTED DRAFT: root strict TypeScript and the five existing preflight unit tests pass, and the existing isolated Guest point/rectangle runner passed 19 fixture/API groups plus its 375px browser flow after the change. Those tests do not prove the new 426 behavior, deleted-row handling, races, all four scopes, or cross-invite isolation. Do not enable freehand until dedicated actual D1/route tests and review are complete. Existing separate delivery rejection remains unchanged.

Prototype inventory: Worker target UI has Owner workspace/project/album and Guest album flows, but many capabilities default OFF and no general interactive mock login/demo fixture exists. Local Worker interactive use requires configured OAuth and Owner bootstrap. The Next reference homepage/login can run without credentials but is not the full Worker product prototype. `pnpm.cmd dev` started local Next at 127.0.0.1:3000; HTTP root returned 200. Synthetic browser screenshots document only isolated test states. Delivery, cleanup management and freehand end-to-end remain incomplete; no hosted acceptance claimed.

## 2026-10-29 — Isolated interactive prototype

Added `experiments/gump-demo/` as an independent local-only interface prototype, not a product route. Launch from root: `pnpm.cmd exec vite --config experiments/gump-demo/vite.config.js` and open http://127.0.0.1:4174/. It uses CSS synthetic images and per-tab memory; album creation, share option summary, selection/filter and before/after slider are demonstrable without API, credentials or customer data. It explicitly does not generate real links or persist data; nonfunctional controls were removed or made noninteractive. The demonstration is not connected to actual Worker UI or evidence of MVP/hosted completion.

HTTP root returned 200. Chromium desktop 1440x900 and mobile 390x844 tests in `tests/e2e/gump-demo-preview.spec.ts` passed 2/2 after the final wording change, covering create, share settings reflecting selected 14-day/download values, selection, slider keyboard/drag/touch, mobile overflow, and no /api/ calls. An intermediate rerun failed because the previous expected share message changed; the updated assertion was rerun and passed. Screenshots in OS Temp are local synthetic test artifacts. No production/customer data, migrations or feature gates changed. Freehand compatibility remains an unaccepted draft as described in the previous entry; delivery/retention/hosted acceptance and full M1-M5 remain incomplete.

## 2026-10-29 — Freehand compatibility read and full-chain safety checks

Fixed a concrete regression in the preliminary compatibility integration: three annotation route error handlers had dangling `if` statements, which suppressed existing Guest 401 and Owner WorkspaceFailure status mappings and returned generic 503. Each now explicitly returns 426/ANNOTATION_CLIENT_UPGRADE_REQUIRED; existing error branches are reachable again. Root strict TypeScript and scoped route ESLint passed (only the existing React detection warning).

Root independently ran `pnpm.cmd exec vitest run tests/unit/freehand-read-compat-workerd.test.ts`: 6/6 passed using isolated Miniflare D1 fixtures. All four repository scopes exercised legacy 426, Guest own targeted old rectangle plus freehand beyond first 24 still requires upgrade, shared invite isolation, and Guest own preflight/page race returns 409 without items/cursor. Guest 401/400 and Owner route error mapping were checked; Owner 409 was injected, not an actual Owner race. Supported freehand parser/UI/journal recovery remains unimplemented, so this is not freehand feature acceptance. In particular old pending journals must remain intact until upgraded recovery is implemented; idle tabs have no instant invalidation guarantee.

Root independently ran `node tools/freehand-annotation-chain-workerd.test.mjs` from apps/worker, exit 0: fresh isolated workerd D1 applied 0001-0054; both empty and seeded Guest/Owner annotation/audit snapshots survived each of four injected proposal-batch failures; successful batch preserved existing data; accepted freehand and old geometry, replay/conflict, invalid geometry and authorization guards were exercised with FK0. The proposal remains REVIEW ONLY, outside auto migrations, and was not applied to persistent/hosted data. These tests do not establish Wrangler migration application or production parity. The feature remains default OFF; complete new-reader schema, canonical writers, journal, both UI editors, reviewed migration/adoption and end-to-end/hosted tests remain required. Earlier delivery 0055 rejection is separate and untouched.

## 2026-10-29 — Freehand contract and guarded writer preparation

Extended the existing strict annotation geometry union with the bounded freehand variant, retaining point/rectangle schemas. The Worker canonical serializer now handles all three while preserving legacy canonical byte order. Guest and Owner writers have a default-false freehand gate; routes inject the existing local-only capability. A new freehand request with the gate OFF is rejected, while an authorized existing request ID can reach the existing immutable replay/conflict guard; Guest expected identity is checked. This policy and exact writer behavior have focused fake-D1 tests, NOT actual workerd writer/trigger/audit acceptance. No feature flag or migration was enabled, and the proposal remains review-only.

Existing Guest/Owner annotation canvas renderers now draw freehand geometry as polylines and label it correctly, rather than treating it as a rectangle. Editors do not yet expose freehand creation, advertise read capability, or connect recovery; no complete product flow exists. Do not advertise `freehand-v1` until all Guest/Owner reads, processing, UI and journal recovery are verified. Unsupported old clients remain protected by the prior 426 compatibility path; already-open idle tabs have no instant invalidation guarantee.

Root independently ran writer/canonical/config Vitest 18/18, read-compat workerd Vitest 6/6, full root strict TypeScript and Web typecheck, scoped UI/test lint, and freehand isolated Chromium canvas 4/4. Agent ran existing Guest annotation isolated workerd/D1/R2 regression: 19 API/fixture groups and 375px browser passed, freehand not exercised. Initial scoped lint exposed existing explicit-any fixture declarations; added narrow documented exceptions for its partial D1 race wrapper, then lint and typecheck passed. No full suite, physical touch, production OAuth/R2, persistent migration or actual freehand writer/D1 E2E was verified. Next implement and test actual D1 writer and exact replay with proposal in isolation, then both editors/journals and supported-client headers, before considering a reviewed forward migration. Delivery and retention remain incomplete; prior delivery 0055 rejection is separate and untouched.

## 2026-10-29 — Freehand writer D1 and opt-in editors

Root independently ran `pnpm.cmd exec vitest run tests/unit/freehand-annotation-writers-workerd.test.ts`: 1/1 passed against real Guest/Owner routes and a fresh isolated Miniflare workerd D1 with migrations 0001-0054 plus the review-only proposal applied only in the temporary fixture. It exercises new writes with gate OFF, writes with gate ON, exact replay after closing, changed-body conflicts, wrong identity, immutable command/change/result/audit witnesses, unchanged failure snapshots and FK0. `PRAGMA integrity_check` is not supported by D1 (SQLITE_AUTH); it was removed from this test, not claimed as passed. This does not adopt a migration or prove hosted/cloud behavior.

Guest and Owner editors now have opt-in props `freehandCapability` and `allowFreehand`, each default false, mapping drawn strokes to their existing draft/journal commands and preserving exact request body/id on retry. Revoking the prop blocks saving and clears unsent brush drafts; re-enabling does not restore them, while existing journaled commands remain. No product caller enables these props, no trusted server capability endpoint is connected and no `freehand-v1` read header is advertised. The UI is not production-ready or an end-to-end enabled feature.

Root independently ran Guest Chromium fixture 3/3 and Owner Chromium fixture 2/2 (sequentially; concurrent first Owner attempt failed because both test configs use port 3116). Fixtures use mocked API, not integrated Worker. Cases include pointer drawing, identical-body retry and revoke/re-enable behavior. Root strict TypeScript passed; agent reports complete typecheck, focused Guest journal/editor Vitest 5/5, Owner journal Vitest 7/7, scoped lint/format passed. First Guest fixture run failed from incorrect mock URL, corrected before success; Owner initial fixture path was corrected before success. No real photos, persistent or hosted data, migration, deployment or feature activation. Next complete new-client read capability/upgrade messaging across ALL geometry read paths and recovery, integrate trusted capability without breaking legacy capability JSON, perform actual Guest/Owner end-to-end browser+D1 test, and only then review forward migration and local adoption. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Freehand reader and journal recovery opt-ins

Guest and Owner UI now have independent, default-false read-capability opt-ins, separate from brush/write flags. Guest own/shared pages, cursor and targeted recovery use the opted-in header; Owner authored pages/recovery, guest-list and processing targeted reads do likewise. Existing production callers do not pass opt-ins; no server write capability endpoint or feature activation is included. On authorized read 426, UIs show upgrade guidance and clear partial/stale visible rows while retaining persistent journals; Processing 426 also clears the Owner parent list. FREEHAND_ANNOTATIONS_DISABLED 409 remains uncertain/retryable instead of a revision conflict, keeping original request/body for gate reopening. Actual authorization remains server-side, and read support must remain independent of write gate when integrated.

Root independently ran Guest Chromium 8/8 and Owner Chromium 4/4 using mock API fixtures, plus root strict TypeScript. Agent ran Guest focused Vitest 33/33 including isolated workerd read-compat and repaired legacy fake D1 preflight fixture, Owner helper 3/3 and workerd compatibility 6/6, scoped lint/format. An initial Web typecheck failed because the new Owner processing fixture omitted coordinateSpace; agent corrected it and reran Web typecheck and 4/4 browser successfully. Initial test-fixture selector/config failures were corrected before passing runs. Browser tests are mocked, separate from workerd tests; hosted OAuth/R2, physical touch and end-to-end UI/Worker/D1 remain unverified.

Next integrate new-client read capability in all real product call sites independently of write gate, add a separate trusted write-capability endpoint without altering existing strict JSON, wire UI only after full authorization/recovery checks, and exercise real browser/Worker/D1 end-to-end before reviewed migration and local adoption. Freehand remains OFF; no migration or persistent/production changes. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Freehand read integration and guarded capability

Guest selection/comparison and Owner annotation panel/editor/processing now advertise supported `freehand-v1` reads independently of write permissions. Added separate strict `{enabled:boolean}` Guest and Owner freehand write capability endpoints; existing capability JSON remains unchanged. Capability requires the local-only feature gate AND exact SHA-256 fingerprints of both full annotation guard definitions in D1 sqlite_master; missing/mismatched/unavailable guards fail closed. This fingerprint check passed isolated workerd tests but hosted behavior remains unverified. The capability does not grant authority; command routes continue existing checks. Existing production callers can read supported geometry; brush remains hidden under default OFF and against existing 0054 guards. No migration was adopted.

Guest and Owner refresh write capability on focus, fail closed for new drafts, preserve independent reads and pending journals. Exact already-journaled requests remain retryable even when write capability becomes false so committed requests can recover; server rejects uncommitted ones with 409 uncertain. Root independently ran Guest mock-API Chromium 11/11, Owner mock-API Chromium 5/5, capability route unit 6/6, isolated workerd writer/schema 2/2, root strict and Web TypeScript. Owner unit 21/21 after updating stale preflight fakeD1, per agent. These are not hosted OAuth/R2 or complete E2E acceptance.

An added test-only `apps/worker/tools/freehand-browser-workerd-e2e.test.mjs` with Vite fixtures attempted real browser→Worker/D1. It FAILED before any annotation write: capability/me/annotation reads returned 200; actual image `/api/v1/photos/.../assets/preview` enters Playwright bridge but Worker.fetch does not return. D1 preview row and ephemeral R2 JPEG match size/checksum. No root cause established; retain test/diagnostics, investigate bridge and streamed asset behavior, rerun before any claim of UI→Worker→D1 acceptance. No persistent/customer DB, migration, deployment or flag activation. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Interactive prototype multi-page navigation

Extended `experiments/gump-demo` with working local-memory overview, projects, project albums, album studio, recent items, favorites, guest selection preview and photo detail/Before-After navigation. Create/share/selection and favorites are connected across the demo pages; all visuals are synthetic, state resets on reload, no real invitation or delivery is created and no product API is used. The demo remains separate from the actual Worker application; it is not proof of MVP completion.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 2/2 Chromium flows passed at desktop and 390x844, covering navigation round trips, create/share, selection/favorites state, guest preview, detail/compare, pointer/touch/keyboard slider, no horizontal mobile overflow, zero /api/ or external-origin requests. Root also used the existing in-app browser to open the actual overview. During implementation a failed stdin file-write attempt temporarily truncated two untracked demo source files; the worker restored them from validated temporary files, checked hashes/JS syntax and completed the passing browser checks. No customer data or production service changed. Prior freehand browser→Worker/D1 E2E failure remains unresolved; delivery and retention remain incomplete; no migration, deployment or 0055 draft changes.

## 2026-10-29 — Prototype single-photo collaboration

The isolated local demo now opens single-photo detail when the thumbnail itself is clicked or tapped. It includes previous/next, return, selection/favorite, Before/After, photographer 1–5 star rating, local per-photo comments, point annotations and colored freehand with show/hide and clear draft controls. Demo ratings, comments and marks are scoped by album/photo and held only in the current tab; no API or external request, real sharing, persistent data or production capability is implied. The UI is a prototype separate from actual Worker application.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: desktop and mobile Chromium 2/2 passed, covering thumbnail entry, previous/next/back, comments and ratings isolation/clear, selection and rating independence, favorites, point and colored freehand (mobile touch emulation), draft controls, comparison, no horizontal overflow and zero API/external-origin requests. Agent additionally reports scoped ESLint/Prettier passing. Initial fixture selector ambiguity was corrected before final pass. Physical phone, real user media, server integration and hosted acceptance were not tested. Modified untracked prototype files were backed up to temp and staged/hash-checked before replacement. No migration/production data/deploy or delivery 0055 changes. Prior freehand browser-to-Worker D1 preview bridge failure remains unresolved; full SaaS goal remains active.

## 2026-10-29 — Prototype responsive image proportions

Fixed the local-only synthetic prototype responsive scenes and icons to maintain proportions rather than stretching independently. Gallery and detail generated visuals use a consistent 3:2 frame; project/album covers retain their own aspect ratios and icon containers do not flex-shrink. The photo annotation SVG uses a matching 150x100 viewBox with normalized X mapping; point/freehand positions remain aligned to the frame and points remain circular on resize. This is CSS synthetic demo art, not proof of real-photo aspect-ratio handling in the actual product.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 4/4 Chromium desktop/mobile flow and geometry tests passed, including viewport resize, photo frame ratio, actual pixel circle shape and point/freehand relative alignment. Agent reports Prettier check and `node --check` passed. Initial new geometry assertion used separately normalized axes incorrectly and was corrected before final acceptance. Mobile uses browser emulation, not physical device. Prototype only, no production/customer data or migration changed; formal image/R2 and prior integration test limitations remain.

## 2026-10-29 — Photographer recommendation prototype and metadata foundation

The isolated gump-demo now has per-album photographer recommendation visibility, optional minimum 1–5 star and red/yellow/green/blue/purple label criteria, selectable any/all rule, live per-photo rating and color editing/clearing, and a Guest recommendation list/count. Customer selection remains independent. Default any-mode is a demonstration default; both modes are selectable. This uses synthetic initial labels and in-memory data, not uploaded metadata or the Worker application. Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 6/6 desktop/mobile Chromium tests pass, including threshold/color/mode/live edit/hide/selection independence and no API/external requests. Physical device not checked.

Added isolated `packages/image-processing/src/photographer-metadata.ts` and unit tests as an UNWIRED foundation. It extracts only selected embedded XMP Rating/Label from bounded JPEG/PNG/WebP via Sharp, reports missing/cleared/rejected/invalid/unknown states and never outputs unrelated metadata/raw label text. It is a deliberately limited strict XML/RDF subset, not standards-complete or production-ready; extended XMP, sidecars and custom/localized label-set mapping are unverified. Exact English color names only are interpreted, which cannot establish arbitrary custom Lightroom label colors. Root independently ran focused Vitest 23/23 and root strict TypeScript successfully; a prior root Vitest run failed 15 tests due to a real root-marker initialization bug, subsequently fixed before the passing rerun. Synthetic encoded images are not real customer upload acceptance. No migration/schema/API/upload pipeline hookup or persistent data change. Next design version-bound source evidence, safe imported-vs-manual precedence/clearing, durable recommendation policy, audited tenant-scoped services/routes/UI, and true bounded upload/processor integration with real format fixtures before claiming the requested feature complete.

Backup caveat: an agent accidentally overwrote the exact temp backup of the task-start untracked demo main.js while staging; a reconstructed pre-feature copy does not match the original hash and must not be represented as exact. Installed current demo remains intact/tested; an older responsive snapshot and exact task-start CSS backup remain in Temp. Delivery/retention and actual freehand browser→Worker/D1 integration remain incomplete; no 0055 draft touched.

## 2026-10-30 — Local prototype processing and navigation

Expanded local Owner/Guest prototype navigation and added an in-memory image-processing preferences panel with Cloudflare-first default, Oracle-first and single-provider options. R2 is identified separately as storage. No remote bucket, credentials, cloud service, production data or deployment was modified. Real R2 upload and image-processing failover remain unverified and unimplemented respectively.

## 2026-10-31 — Kino Pick naming

Formal product name: Kino Pick（奇諾選圖）. Display names and current documentation updated; existing internal identifiers and historical evidence remain unchanged for compatibility. Directory rename pending if Windows reports an active process. No cloud, migration or customer data changes.

## 2026-10-31 — Prototype photo lightbox

Local synthetic photo detail opens a modal lightbox when clicked in view mode; Escape and close control dismiss it. Point/freehand modes retain annotation behavior, and the lightbox shows the current markup. Browser checked click-to-open, Escape and point-mode non-opening; mobile/real media/production integration not checked. This remains a local in-memory demo. Project directory rename is still blocked by Windows access denied, including a user-run PowerShell attempt; root cause unconfirmed. No cloud or customer data changed.

## 2026-10-31 — R2 staging bucket provisioned

Account kinoaaron2026@gmail.com first Cloudflare account: created Standard R2 bucket `kino-pick-staging-d3e93046`; staging PRIMARY_STORAGE and R2_BUCKET_NAME now reference this same bucket. Hosted upload and other deployment gates remain OFF. A synthetic text object `connectivity/358f9053-9c4e-4611-9284-10c5c966a269.txt` was written remotely and read back; both SHA256 hashes equal 323CE13DF099BE4E86EB3E57C70E8BCA843894EE464F044DE168451EB003A38D. Object retained for traceability; no customer data. Test-bucket CORS readback: origin http://127.0.0.1:8787, PUT, headers Content-Type/If-None-Match/x-amz-checksum-sha256, exposed ETag, max-age 300. This is only a local development origin, not a staging website origin. No live browser signed PUT, real S3 signer credentials, D1/OAuth integration, deployment or derivative processing verified. Next create suitably scoped test-only R2 signer credentials outside Git, verify live CORS/preflight and actual signed upload including immutability/checksum, then assess isolated D1/OAuth staging and deployment readiness. Do not bypass gates or enable automatic deletion.

## 2026-10-31 — Real R2 browser signed PUT acceptance

Using the isolated staging bucket `kino-pick-staging-d3e93046`, Chromium from `http://127.0.0.1:8787` used the actual `presignR2Put` signer and a synthetic PNG: CORS preflight HTTP 204, browser signed PUT HTTP 200, replay HTTP 412 (expected create-once protection), remote Wrangler readback SHA-256 matched. Final isolated test exited 0. The expected 412 appears as a browser console error. Prior attempts failed: initial wrong access-key format (R2 InvalidArgument); then Windows test harness readback command quoting failed after successful PUT/replay; fixed before final pass. Separate diagnostic synthetic objects remain in the test bucket. This validates real signed R2 upload/CORS and readback, not the complete product UI/API/D1/OAuth pipeline, production, or hosted origin. All deployment and automatic deletion gates remain OFF. Next integrate and validate the full isolated application workflow with scoped credentials; do not bypass readiness gates. Test-only browser runner is in the conversation visualization directory.

## 2026-10-31 — Cloudflare B staging isolation and deployment guard

User selected one kinostudio GitHub account, GitHub Actions deployment to Cloudflare B; existing A repositories/deployments must remain untouched. GitHub connector can list kinostudio repositories, but no Kino Pick repository is listed; this local repo has no Git remote and kinostudio gh authentication is invalid. User is completing gh login. No GitHub repo, secret, branch, commit, push or deployment was created in this step. Avoid publishing 51 modified tracked files and extensive untracked work indiscriminately; inspect intended snapshot, secrets and 0055 boundary first.

Created empty remote D1 `kino-pick-staging-d3e93046` (cdee0ac7-bf91-4852-9c17-a996c0b84f8d) in Cloudflare account d3e930465c0df7e89b35de3ca65ea36a and configured staging binding. Remote SELECT 1 passed with zero rows changed; no migrations applied. Existing staging R2 binding remains in same B account. Workflow .github/workflows/deploy-cloudflare.yml now verifies deployment account matches B; tested Bash guard correct=0/wrong=1; Prettier check passed. Existing deployment-readiness check remains intentionally closed (staging check exited 1 as designed); no live product deployment or hosted E2E. Python YAML check unavailable because PyYAML is not installed; Prettier validated parsing. All feature flags/automatic deletion remain OFF; no production customer changes. Next authenticate kinostudio, inventory intended repo, choose safe private snapshot and review before publishing; then provision scoped Actions token and complete migration/restore, OAuth and hosted acceptance before opening deployment gates.

## 2026-10-31 — Private GitHub repository created

Created kinostudio/kino-pick through the GitHub website and independently verified visibility=private and admin/push access through the GitHub connector. User-level gh now authenticates as kinostudio. Kino Pick source is being published as a complete scoped snapshot on a separate codex deployment branch while preserving the original working-tree branch/index. Exclude apps/worker/migration-proposals/ from the snapshot. Static candidate secret scan found no private-key/GitHub-token patterns across 682 candidate files (not a complete secret audit). Updated deployment workflow installs Chromium before Cloudflare browser checks and verifies account B; existing cutover guard remains closed. No A account repository/integration/deployment changes. CI/hosted deployment results must be recorded after actual execution.

## 2026-10-31 — First private CI and local verification

Remote main 626f8ad4e9340eb2e7cc6981272188d500ad67a2 is the first complete scoped snapshot. GitHub run 41112350689 failed at zero-warning lint with five warnings. Fixed unused helper/counters, anonymous Vite config export and side-effect ternary; no lint threshold relaxation. Fixed stale annotation-history assertion to filter annotation actions rather than assuming last-five enum ordering. Local latest unit 820/820, integration 61/61, and complete typecheck passed. First concurrent integration run had one 5s timeout; sequential full rerun passed without changing timeout. Handoff checker passed. Token draft is B-only, 30 days, Workers Scripts Write + D1 Read + R2 Storage Read + Account Settings Read, awaiting user's action-time approval before creation or storage. New repository staging environment created and CLOUDFLARE_ACCOUNT_ID secret set only in kinostudio/kino-pick. Actual deploy remains gated/unfinished; no A changes.

## 2026-10-31 — B deployment token stored and connection workflow

User explicitly selected no expiry and approved creation/storage. Created account-owned B-only token: Workers Scripts Write, D1 Read, Workers R2 Storage Read, Account Settings Read; saved only as CLOUDFLARE_API_TOKEN in kinostudio/kino-pick repository secrets. Browser confirmed secret added; token not printed or committed, clipboard and runtime secret variables cleared. Account ID secret already matches B. No A changes. Added manual read-only connection workflow to validate GitHub Actions credentials against B staging R2 metadata and D1 SELECT 1; it does not deploy or apply SQL migrations.

CI run 41113315272 failed because the initial publishing filter omitted apps/worker/migration-proposals/annotation_freehand_geometry_v1.sql, required by isolated workerd tests. Include that exact review-only fixture in the private repository under migration-proposals; never move it into automatic migrations or apply remotely. This corrects the earlier overly broad proposal exclusion. File SHA256 BB6FB62F7C8C12688689700DEDEDC0E3E13A1F4782CC115C44CC928C9BF78AC4. Other unfinished delivery draft boundaries remain unchanged. Next rerun CI and actual B connection workflow; product deployment gate remains closed pending its original acceptance requirements.

## 2026-10-31 — GitHub Actions B connection passed

Actual workflow 41114135793 completed SUCCESS (44 seconds): GitHub runner used the repository secrets, verified expected B account, read staging R2 metadata and executed SELECT 1 on remote staging D1. No deploy/migration/data mutation in that workflow. Token is no-expiry by explicit user confirmation, scoped only to B and stored in the new Kino Pick repository. Repo remains private; remote main d138ddc2d97007fcd81d8e0a6b4c823791a0e7bd before this follow-up.

CI browser orchestration corrected after test discovery showed 40 tests incorrectly sharing the Next reference server: reference config now runs its 14 cases; CI explicitly executes the four existing dedicated freehand/Guest/Owner/prototype configs, retaining all 40 cases with their own servers. Prototype Vite command now uses the web package's declared Vite dependency and platform-neutral pnpm rather than Windows-only pnpm.cmd. Discovery of reference14 passed; full amended CI pending. Product cutover guard remains closed; OAuth/schema/restore/hosted product acceptance and website deployment remain unfinished.

## 2026-10-31 — Full CI reached Cloudflare smoke; final branding assertion

Run 41115227851 passed documentation/format/lint/types,820 unit,61 integration,Next build and all40 reference/dedicated Chromium cases. The final Cloudflare smoke failed at its static HTML /KINO Pic/ assertion against the renamed Kino Pick page; updated only that expected brand. Existing product gates remain closed. Separate Actions B resource connection remains SUCCESS in run41114135793. Dedicated local browser tests passed4+11+5+6. Full CI needs rerun after the final assertion change; no actual website deployment claimed.

## 2026-10-31 — Deployment handoff clarification

GitHub B connectivity is complete: private kinostudio/kino-pick; repository-only B account ID/API token secrets; no-expiry token explicitly approved. Actual read-only connection workflow41114135793 is SUCCESS. R2 browser signed PUT200/create-once replay412/hash readback also passed separately. These results do not establish real-provider OAuth, a deployed product, hosted signed uploads or complete backup/restore. No FILM.KINOSTUDIO resources or integrations were modified.

CI41116402851 was manually canceled for diagnostics; its retained complete log shows it was still progressing through matching-rule checks. The live browser log had only loaded a portion of its output, so the apparent assisted-upload stall was not a confirmed product failure. Current CI41118459908 (5d425ec) adds running-case messages and bounded120s per-case failures; full result is pending until a later checkpoint below. Do not report the canceled run as passed or failed.

Next cutover order: establish a real staging HTTPS origin and private OAuth secrets/allowlisted Owner bootstrap; rehearse staged schema migration plus consistent D1/R2 backup/restore (keep review-only SQL out); verify hosted authentication/session, private upload/processing, Guest access and abuse/runtime limits; then replace the deliberately closed guard with verified acceptance in a reviewed cutover. Existing hard-local/default-OFF feature gates require implementation review; merely setting readiness booleans true cannot deploy. Automatic deletion remains OFF/dry-run.

## 2026-10-31 — Complete local Cloudflare regression passed

The final local pnpm test:cloudflare completed exit0:368 checks passed on the5d425ec executable tree. Evidence is ignored apps/worker/.local/cloudflare-ci-2026-10-31.log. This includes Worker/UI build, native temporary D1/R2, controlled Chromium375px flows, private uploads/derivatives, immutable versions/matching, invitations/selection/feedback, comments/annotations, history/export and dry-run/Cron guards. Expected injected OWNER_HISTORY_EXPORT_FAILED errors occur in the fail-closed export tests and those checks passed. This is local fixture acceptance, not real OAuth, hosted product acceptance or remote schema adoption. Do not repeat the passed suite for documentation-only closeout. GitHub run41118459908 terminal status is recorded separately below when complete.

## 2026-10-31 — GitHub test steps passed; metadata finalization pending

Run41118459908 on5d425ec0730d8ad642ade896b82b50489e1db4db has all23 job steps completed/success, including Complete job, per fresh job API. All19 setup/build/test steps and three post steps passed:820 unit,61 integration,40 Chromium cases and368 local Cloudflare checks. The live job log also shows the368-check final line. At closeout the run and job top-level API status still says in_progress with null conclusion despite every step being completed/success; do not claim a finalized green workflow until GitHub publishes that state. No code/test changes are pending after this executable snapshot; following commit is documentation-only and skips a duplicate CI run.

Read-only actual Actions→B resource connection remains finalized SUCCESS in41114135793. Actual private R2 signed upload/hash/create-once test passed independently. Website deployment has NOT occurred: real OAuth/Owner bootstrap, staged migration and backup/restore, hosted product/security/runtime acceptance and reviewed cutover remain open. No A/FILM.KINOSTUDIO changes or customer data mutation.

## 2026-10-31 — Photo native-save interaction restriction

Added shared apps/web/photo-interaction-guard.ts and CSS to the Worker React entry, Next Providers and prototype. Capturing contextmenu/dragstart handlers prevent native save/drag on img,canvas and explicitly marked synthetic photo surfaces, including dynamic grid/detail/Lightbox/comparison content. Text fields retain context menus; normal button/link clicks, drawing and pointer sliders are untouched. Existing download APIs/permissions and audit remain authoritative; this UI restriction cannot prevent screenshots, developer tools or a user saving bytes already delivered to their browser. Safari touch-callout suppression is declared in CSS; actual iOS long-press behavior was not checked.

Validation: scoped ESLint0 warnings, web typecheck and target UI build passed; existing six desktop/mobile prototype Playwright cases passed. Isolated Chromium checks confirmed canceled photo/image contextmenu and dragstart, preserved input contextmenu/button click, and opening the Lightbox. No schema/API/credential/deploy changes; no broad regression rerun. Target build still reports its existing >500kB chunk warning. Hosted browser acceptance was not performed.

## 2026-10-31 — CURRENT: online MVP release objective and automatic continuation

User requested review of development planning and automatic continuation toward publishing a usable online MVP. docs/MVP_RELEASE_PLAN.md is the current execution/acceptance order R0→R6; original product/security requirements remain. Existing kino-pic heartbeat was PAUSED and has been updated through the app tool to ACTIVE at the existing61-minute interval in the same thread, with progress-only notification intent and a concrete release objective. No duplicate automation created. Legacy goal object was observed paused; its status is controlled by the user, not changed or marked complete by this work.

Implemented read-only tools/release-inventory.mjs and pnpm release:inventory, with4 node:test cases. It inventories configured origin/bindings/default security, seven acceptance records, local-only guards, migration filenames and source hashes without reading secrets/remote data. --check exit1 is the expected current release-blocked result, not a test failure; it never authorizes deploy. Actual current inventory: placeholder staging origin,seven incomplete acceptance records,28 local-only errors,54 source migrations through0054. Disabled features remain OFF.

Four tests and scoped ESLint pass (existing React auto-detect informational warning). Isolation-safe Wrangler secret list --env staging returned Worker kino-pic-staging not found, so runtime Secret presence is unverified; no remote writes. gh API call returned no active CLI login in this execution context; do not assume older auth remains current or request repeated login while the connected GitHub/browser fallback is available. Prior CI top-level finalization was not reverified. Current next task R1-01: determine exact B HTTPS staging origin/callbacks, real OAuth/Owner bootstrap; proceed independently with isolated restore/processing work when external credentials are missing. No gate bypass, schema application, production deployment, customer data change or A/FILM.KINOSTUDIO mutation. Latest photo native-save restriction remains in the local tree.

## 2026-10-31 — R1-01 HTTPS namespace prepared; OAuth confirmation pending

Advanced beyond inventory: isolated existing Wrangler OAuth credentials were used only in memory for the official B account API. Account GET200 confirmed exact B ID; Workers list count0; subdomain GET404/error10007 confirmed missing namespace. Created kino-pick-aaron2026 with PUT and read back GET success. No Worker code, routes, photos, A account settings or credentials were published. Source staging APP_URL is now https://kino-pic-staging.kino-pick-aaron2026.workers.dev; workers_dev remains false and the Worker does not exist yet. Both OAuth callback paths are fixed in MVP_RELEASE_PLAN. Source inventory now has no configuration blockers but still seven incomplete acceptance records and28 informational local-only errors; never interpret that as deployment acceptance. Worker types regenerated, scoped lint passes; existing4 inventory tests pass and added to CI. No full suite repeated.

Current browser Cloudflare login can only access A, so it was left unchanged. A new read-only B dashboard lookup showed not-found/access denied; used the existing isolated CLI credentials instead of disrupting A login. GitHub browser account is confirmed kinostudio; only existing OAuth App is KINO Studio CMS (Weebly), untouched. Kino Pick Staging new OAuth form is filled with exact callback, no wildcard/device flow, expiring user tokens default; not submitted. One action-time confirmation to create app/Client Secret and save only in ignored local settings/B staging Secrets is pending; do not submit before reply and do not repeat the question. Retained OAuth form tab for handoff.

Independent R2 preparation: actual remote staging D1 table-name query returned only _cf_KV, changes0/rows_written0; no product schema has been applied. No remote SQL writes or migrations. Initial Python metadata helper failed because installed Python lacks tomllib; no request or mutation occurred, Node fallback completed the verified API operations. gh CLI auth remains unavailable in this invocation; browser/connector remain the fallback. Next continue OAuth when confirmed and fresh isolated backup/restore/schema rehearsal without modifying customer data.

## 2026-10-31 — GitHub OAuth approved, created and safely stored

User approved the exact staged OAuth app/Client Secret creation and local/B Secret storage. Created kinostudio Kino Pick Staging App3979161; fixed callback/no wildcard/no Device Flow. Existing CMS App untouched. Generated one Client Secret, transferred only via one-time loopback UI form to ignored .local/staging-auth-secrets.json, generated random BETTER_AUTH_SECRET, cleared one-time browser Secret view/variables and stopped receiver. Local file ACL protected to current user/SYSTEM/Administrators; Git-ignore checked; all691 Git candidates had no new Secret value.

B kino-pic-staging now exists as an infrastructure-only closed503 container because a new Worker cannot store runtime Secrets before its first version. Dedicated config fixes B account, workers_dev=false,preview_urls=false,routes=[]; no product code/D1/R2/assets/Cron. Preflight verified account and Worker404 before upload. Remote settings/subdomain confirm exactly3 secret_text bindings and both public entry flagsfalse. Proof .local/staging-auth-provision-proof.json; successful sanitized log .local/staging-auth-provision.log. This is not product deployment or real OAuth acceptance; original cutover guard/readiness/all feature gates remain unchanged. Never rerun provisioning config against an initialized product app. See docs/STAGING_AUTH_PROVISIONING.md.

Validation:12 local fail-closed route/method checks,scoped lint,Wrangler dry-run,root strict TypeScript and real remote Secret/type/routing metadata passed. First Cloudflare attempt rejected future compatibility date10021 (clientTaipei10/31 vs providerUTC); retained first failure log then used existing2026-10-23 date and succeeded. JSONC parse and diagnostic Python cp950 issues were corrected before acceptance. Protected-file sandbox denial was expected after ACL,authorized scan passed. No broad suites repeated,no database migration/customer data/A changes.

Authenticated GitHub profile confirms kinostudio stable provider subject255123716; one-time Owner bootstrap SQL/proposal prepared via existingCLI under ignored.local,remoteApplied=false. Do not regenerate internalUUID or apply before schema/restore rehearsal. Next R2 schema backup/restore/parity then staged Owner bootstrap/auth validation. Google credentials and real-provider login/link/unlink/session proof remain unfinished. No repeat confirmation or Secret request is needed for the approved GitHub app.

## 2026-10-31 — CURRENT: cloud D1 restore + real GitHub Owner auth passed

Read docs/STAGING_DATABASE_AUTH_ACCEPTANCE.md for complete current scope/evidence/recovery. Applied existing54 migrations through0054 to previously empty B staging DBcdee0ac7-bf91-4852-9c17-a996c0b84f8d after fresh backup and isolated native D1 restore/upgrade/parity. Initialized exactly one previously verified kinostudio Owner using the prepared immutable UUID proposal. Independent cloud restore DBkino-pick-restore-6b279dee/ef13f9cd-69fa-4a48-9ecd-546bb2964b68 has134 tables, identical schema/data hashes and identical exported SQLSHA,FK0. Original persistent local D1 untouched; no A/customer/draft SQL changes.

Implemented narrow staging-auth-validation entry/config/gate reusing Better Auth and current Owner authorization,without product routes/Assets/R2/Cron.10 native denials pass (Miniflarev5 compatibility startup error fixed using existing convertV4 helper). After proof-gated temporary staging publication, browser completed REAL GitHub OAuth App3979161,read:user/user:email,PKCES256 and Owner callback. Remote counts1user/1Owner/1fresh prepared-owner session/1signin audit/provider token present.6 real hosted negative checks pass. Browser logout produced0sessions,1signin+1revoke audits,user/Owner remain1. Final post-logout CDP snapshot timed out,not counted as browser evidence;backend state verified.

Publicworkers.dev andVersion URL then disabled and read back false;config defaultfalse too. Version6578710d-76ee-4d8c-aeea-f5cf48f26fe1 remains auth-only,not product/MVP. real_oauth_and_owner_bootstrap_verified nowtrue specifically for GitHub/Owner baseline;Google/dual-link/fullsession controls and R2-inclusive restore remain pending,other readinessfalse and original product/production guard still exit1. Scopedlint/rootstrict/dry-run and detailed native/remote evidence passed;no broad rerun.

NextR3: staging has only3OAuthSecrets and lacks S3 signing credentials. Read-only accounttoken metadata403/code9109 with currentCLI; prior local R2test key file was deleted as promised. One user request to log into B in an isolated IAB tab6 is pending;EdgeA untouched. Do not ask again or print keys. While waiting, implement real Cloudflare Images adapter/new recipe+compatible migration (existing local-sharp recipe must stay immutable),durable priority/quotas and tests;do not claim prototype settings are real integration. R2CORS needs actualstagingHTTPS origin,then100-photo privateupload→derivatives→gallery acceptance. Do not rerunOwnerbootstrap/migrations or the closed provisioning config.

## 2026-10-31 — R3: private R2 credentials and real Images capability

The user completed isolated B login and explicitly approved creation/safe storage of the new `Kino Pick staging direct upload` credential. It is Object Read & Write for only `kino-pick-staging-d3e93046`. The browser's existing broad `R2 Account Token` was not reused or modified. New signing credentials are stored in ignored ACL-protected `.local/staging-r2-secrets.json` and B staging encrypted Secrets; never print their values. Token verification returned active/200; expiry was not reported by that API, so absence of an expiry field is not independent expiry proof. No further login/key approval is pending.

Real existing S3 signer checks passed: PUT200, create-once replay412, authenticated GET200 with identical SHA256, account-wide ListBuckets403. Six expected runtime Secret names/types were verified without printing values. Bucket CORS now permits PUT only from localhost8787 and the exact staging HTTPS origin, with Content-Type/If-None-Match/checksum headers. Fresh signed-URL OPTIONS passed204 for staging and denied403 for a foreign origin. The first unsigned/immediate preflight lacked allow-origin and is preserved as a failed diagnostic, not acceptance. Evidence: worker `.local/staging-r3-s3-proof.json`, `staging-r3-secrets-proof.json`, `staging-r3-cors-proof.json`. A scan of698 Git candidate files found zero new key-value matches.

Implemented operator-only `apps/worker/tools/probe-cloudflare-images.ts`. With an ignored fixed-B config, `wrangler dev --remote` actually read a private synthetic2x2 PNG from staging R2, ran the native Images binding, generated both JPEG variants, conditionally stored them in a distinct `__capability-tests/` prefix and verified readback SHA. HTTP200/status cloudflare_images_binding_passed; each output269 bytes/2x2 because scale-down never enlarges this source. Evidence `.local/cloudflare-images-probe-result.json` and sanitized run log. Scoped lint/Prettier and root strict TypeScript passed. Remote development was stopped after the probe. No zone/domain, paid plan, customer image or A/FILM.KINOSTUDIO resource was modified.

This proves Cloudflare remote-development processing capability, not the durable product pipeline, normal-size orientation/animation validation, production entitlement/quotas,100-photo upload or hosted Grid/Lightbox acceptance. `private_direct_upload_verified` remains false. Public staging/preview entry flags remain false; original product cutover guard, single-node default and automatic-deletion OFF/dry-run remain intact.

Next concrete slice: implement a separate Cloudflare recipe/adapter compatible with immutable existing local-sharp jobs; safely migrate recipe constraints/outbox and canonical output paths; preserve source checksum/size/decode, leases, bounded outputs, quota reservations and create-once writes. Do not relabel Cloudflare output as local-sharp-0.35.5-v1, globally remove local-only gates or apply the unfinished delivery draft. Then integrate actual upload-init/complete, processing and private gallery before100-photo hosted acceptance and R2-inclusive backup/restore. Oracle remains a candidate, not an assumed running service.

GitHub CLI works as kinostudio when not inheriting Wrangler's isolated XDG_CONFIG_HOME. Apply XDG isolation only to Wrangler processes; do not repeat GitHub login requests. Current remote main6e1d333fe92ec11270607629412c4affc6260542 was verified, and earlier CI41118459908 is now completed/success. This prior CI is not acceptance for the current unpushed source additions.

## 2026-10-31 — R3 source publication checkpoint

Snapshot21fa48431659dcd0ae1224d7eb68c54feb399314 was pushed to private kinostudio/kino-pick main and remote SHA was verified. Thirty changed files preserve the original foundation worktree/index;699 candidate files passed OAuth/R2 credential-value scanning with zero matches. No customer migration or product deployment ran. CI checks41135636903 is in_progress at this checkpoint; do not call it passed until final status is verified. Newly added isolated auth dry-run/native10 checks, whole-tree Prettier and54-file handoff presence checks passed locally; prior lint/type/provider evidence retains its stated scope. Next execution must check this single CI run, fix any real failure, then implement the Cloudflare adapter/recipe/durable-job slice. No repeated login/key approval is needed.

## 2026-10-31 — R3 actual Cloudflare Images adapter implemented

Previous source21fa484 CI41135636903 completed/success (all steps including isolated auth validation). Implemented the existing image-processing interface with distinct cloudflare-images-jpeg-82-v1 recipe; extracted/reused animation checks without changing Sharp behavior. Strict snapshot/hash/raw dimensions,16MiB internal source cap, sequential bounded output streams/cancellation, progressive-scan metadata stripping and provider-error sanitization are implemented. New7+old10 focused tests pass; scoped lint/rootstrict pass. Real B remote-development now invokes this adapter and returned200 with two private checked derivatives; proof worker.local/cloudflare-images-adapter-result.json. Probe stopped; no product/DB/A changes. See docs/CLOUDFLARE_IMAGE_PROCESSING.md for limits and exact next migration/recipe integration. It is not registered in the product: existing64MiB upload ceiling and immutable Sharp job recipe must be reconciled explicitly before activation. No normal-size hosted/100-photo/MVP claim; product gate and auto-delete remainOFF. This slice contains no migration to apply or customer-data change.

## 2026-10-31 — Adapter publication checkpoint

Published and verified private main cdddc19f75ca99180e0bb1c85dc616b97b413862, preserving original HEAD/index.703 Git candidate files scanned for approved OAuth/R2 secret values:0matches. New CI is pending completion; verify the run for this SHA next, without rerunning the already-green prior CI41135636903. Actual adapter probe passed at worker.local/cloudflare-images-adapter-result.json; remote-dev session22258 stopped. Next highest-priority slice is compatible processing-recipe migration/durable integration and the16MiB-versus64MiB admission decision, then hosted upload/derivative/gallery acceptance. No new login/credential approval needed; no D1 migration or product cutover occurred this slice.

## 2026-10-31 — R3 compatible processing migration adopted in B staging

Read docs/STAGING_PROCESSING_ACCEPTANCE.md.0055 now exists and was applied ONLY to B staging after fresh backup, isolated native populated8-group acceptance and an independent cloud restore+upgrade. Remote staging ledger55;133 original product tables unchanged,FK0,schema equals independent upgraded cloud DB66bba5de-c020-40a5-b8a0-f2431bc8f781. Public entryfalse;default local persistent D1 still0052. Never regenerate/overwrite applied0055 or run the old54-only rehearsal against the55 source tree.

New persisted per-workspace Owner policy API/UI, exact-recipe claims/review keys,16MiB Cloudflare admission and bounded durable upload-wake/Cron integration are implemented; cloud runtime defaultsOFF/production activation guarded.20 scoped unit tests,8 native/API/mobile groups,rootstrict/scopedlint and Worker/UI build passed; real cloud full upload/Images/gallery100-photo flow remains pending. Fresh protected exports and proof paths/recovery/failed diagnostics are in the acceptance doc. Main product gate and unfulfilled readiness remainclosed;auto-deleteOFF/dry-run,single-node. Previous cdddc19 CI41139959773 passed;new source requires one CI run. User selected pick.kinostudio.tw and confirmed DNS in A;no A/DNS change has been made. Next gated hostedOwner upload/Images/gallery acceptance and D1/R2-consistent restore; do not rerunOwnerbootstrap or request keys already saved.

## 2026-10-31 — CURRENT: B staging56; upload/processing/gallery integration accepted in isolation

Supersedes prior55-only checkpoint:0055 remains immutable;0056 adds reciprocal Owner request namespace and bounded Cloudflare IO-review guards. Actual B staging AND independent rehearsal DB now have56 migrations; fresh private backup/parity/FK0 passed,135 existing product tables unchanged and public/preview entryfalse. Details/recovery: docs/STAGING_PROCESSING_ACCEPTANCE.md; protected `.local/staging-0056-apply-proof.json`. No A/DNS/customer/default-local mutation.

Final focused20 unit checks and10 isolated native/API/mobile groups pass, including atomic migration rollback, old job preservation, Owner policy persistence/replay/collisions/tenant denial,16MiB quota-safe refusal, V1/V2 completion-aware busy lock, Cloudflare recipe claims and review fences, three transient failures→IO review with reservation retained, private derivative/gallery finalization and375px save/reload. The integration uses a Sharp-backed Images double; earlier real Cloudflare adapter probe is separate. Worker/UI build,root/Web strict and scopedlint pass; full-chain test harnesses now use official split+atomicbatch for the larger migration. Production/cloud flag defaultsOFF and release gate remainsclosed.

Next concrete task: push this source, verify its single CI run, then create a narrowly gated hostedOwner B upload validation with native Images/private R2/gallery/100 test photos and D1/R2-consistent restore. The updated product Worker itself has NOT been deployed; remote schema success is not hosted product acceptance. Preserve missing Google/link/session/Guest/version/delivery/security requirements and do not mark MVP released. User-selected production hostname is pick.kinostudio.tw in A; existing staging callbacks stay unchanged. Prepare hostname-only entry routing without root/NS/existing A deployment changes and resolve exact permissions before applying. No repeated credential/login request needed.

## 2026-10-31 — Published processing integration checkpoint

Private main6709d0bdab307f9ddb7b76ce47f0b5e0a91f2ae2 was pushed and remoteSHA verified.714 Git candidate files had zero approved OAuth/R2 credential-value matches;original HEAD/index preserved. CI41147833540 is running (last observed typecheck,no failures);do not claim a pass before finalization. Next read that one run and fix any actual failure,then perform narrowly gated hostedOwner R2/Images/gallery acceptance. B staging schema56 is already adopted with verified backups and independent cloud parity;the updated product Worker is still not deployed. No A/domain/public-entry change. Currentselecteddomainpick.kinostudio.tw remains a future release hostname,not a live-site acceptance URL.

## 2026-10-31 — Owner hosted-upload validation prepared; CI hold enforced

Added a closed-by-default B-only staging upload validation entry/config, reusing actual product Owner auth/API/UI with only direct upload/Cloudflare processing enabled. Guest routes/registration/production/foreign host+Origin are rejected;no original feature guard is removed. Actual dry-run/rootstrict/scopedlint pass and14 isolated route/static/denial checks pass. Images is a presence double here;not a provider/hosted upload result. Read docs/STAGING_UPLOAD_VALIDATION.md.

Added scoped tools/check-staging-upload-validation.mjs coupling adopted56/independent restore,Secret names,exact tested bundle and successful core CI plus unchanged backend/UI via temporary index. Actually ran it: CI41147833540 at6709d0b is stillin_progress,so gate correctly refused. No deploy/public-entry/DB/R2/A/DNS change this heartbeat. Prepared source is local/unpushed pending the existing CI outcome;preserve it. Next check only that run,fix any actualfailure,then refresh safe CI metadata and proceed with exact scoped preflight/publication/controlled hosted Owner validation. No new credential/login/useroperation is required now. Do not claim MVP release or private_direct_upload_verified.

## 2026-10-31 — Core CI finalized; restricted Owner upload preflight passed

CI41147833540 completed/success for6709d0b with no failed steps. Refreshed actual safe CI metadata and ran scoped tools/check-staging-upload-validation.mjs:passed_owner_upload_staging_preflight. Backend/UI inputs match accepted CI through a temporary index;config/source/bundle match the14-check native validation and adopted56/independent-restore proof. No production deployment is authorized by this gate. The new Owner-only entry/config/checker are ready for exact source publication and CLOSED B deployment,then metadata/denial checks before controlled public staging validation. Do not call this hosted product or100-photo acceptance yet;existing main product/production guard and readiness remainunchanged. A/DNS unchanged. Native Owner boundary check added to CI without rerunning broad suites locally.

## 2026-10-31 — CURRENT: 真實 hosted Owner／100 張 R2＋Images 圖庫驗收通過

B 的 Owner-only staging 已實際部署，來源 `7be9f78496103076f110a4f9e58e96788265f1da`，Worker version `1441d058-27f1-44e8-9440-4861f88d7f47`；CI41154235653 completed/success。真實 GitHub Owner 登入後，以產品介面建立測試 workspace/project/album，五批各20張合成JPEG經瀏覽器私人R2直傳及原生Cloudflare Images完成。100 jobs succeeded、300 assets、reserved0；全部300個物件GET/byte/SHA檢查通過，200衍生JPEG完整解碼、320/2048尺寸及比例、metadata移除與10張EXIF6方向通過。實際Edge圖庫24→48→72→96→100、100個唯一檔名／全部縮圖載入；直式1000×1600與下一張橫式1600×1000燈箱、關閉操作通過。匿名私人縮圖401，原7項hosted邊界通過。

這是受限 staging Owner 流程，非完整MVP。`private_direct_upload_verified`仍不提升為完整發佈就緒：跨租戶／配額故障hosted、含R2的備份復原及Guest等要求仍需完成。詳細scope/證據/復原下一步見 docs/HOSTED_100_PHOTO_ACCEPTANCE.md。D1已有新受ACL保護的匯出，尚未獨立restore，R2物件尚未備份。public staging目前enabled、previewfalse；其他產品feature仍OFF，無Cron／production／A／DNS改動。既有production gate保持closed，自動刪除OFF/dry-run，單R2節點。

下一切片：先完成這100張資料的D1＋R2一致備份與獨立復原，再修正Cloudflare政策16MiB但UI顯示64MiB／未設定Google仍顯示可點登入的能力宣告，依序完成真實雙OAuth綁定與Guest/版本/交付hosted驗收。不要重傳100張、重建Owner、重套0055/0056或重問憑證。保留原worktree/index與未提交變更。

## 2026-10-31 — 100-photo acceptance source publication checkpoint

Private main `1fc914edf79dcba41434f5ab69792222581beb7e` was pushed and remote SHA verified;9 intended files,721 candidate-file credential scan with0matches;original HEAD/index preserved. CI41162510021 is in_progress at handoff,not yet accepted. Actual deployed pilot remains7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47;no redeploy was needed for operator-tool/docs-only changes. Next check only this CI run,then complete fresh D1/R2 consistent backup/independent restore using the protected100-photo snapshot. Do not re-upload100 files or repeat the passed300 GET verification without a new backup/restore purpose. Edge validation tab1650468828 is retained for continuation. No user operation is pending.

## 2026-10-31 — CURRENT: 100-photo snapshot 獨立D1＋R2資料復原通過

B 新D1 bcf68fb8-0079-4c8d-b2a0-745c1aa97a26 與新私人桶kino-pick-restore100-20261031已真正還原完整snapshot。136表／2782列／726triggers／56migrations的schema、逐表hash、sequence與FK0通過；300物件自本機受保護備份還原並讀回SHA全吻合，共8,913,629bytes。原DB／原桶無寫入刪除，無A/DNS/Worker部署變更。已解決真實export的表／唯一索引／trigger載入順序問題，正常app guards及0055/0056保留。詳見docs/HOSTED_SNAPSHOT_RESTORE.md；以private consistent-restore-proof.json為準，不修改原匯出checkpoint的false狀態。

此為資料復原，不是恢復站runtime切換、新桶上傳簽名設定或完整MVP。CI41162510021真實failure：Guest測試helper未捕捉Miniflare socket rejection；新修正CI未通過前不能標green。先完成此最小CI route lifecycle修正，再接Cloudflare16MiB/登入能力UI與Google/Guest/版本/交付hosted驗收；不要重傳100張、重跑已過的復原、重建Owner或重問既有憑證。production gate及自動刪除仍OFF/dry-run，正式預設單R2節點。

## CI helper 最小修正已實作，等待新CI

`apps/worker/tests/guest-entry-ui-browser.mjs` 現追蹤所有route tasks，捕捉dispatch/route rejection，六個情境先page.unrouteAll(wait)並drain再關context，最後以AggregateError保留失敗；沒有POST retry，也沒有忽略真正transport failure。原53個assert呼叫經AST比對逐一相同。helper node syntax／scoped ESLint／Prettier通過，兩個復原工具scoped lint/format通過；未另跑全套本機smoke，新CI尚待。這處理未捕捉Promise及teardown邊界，不宣稱底層UND_ERR_SOCKET成因已完全修好。

## 2026-10-31 — Restore source publication checkpoint

Published and remote-verified private main `0de1d3ccc376dc779a1723001927aaca752a47d0`. Ten intended files;724 source candidates scanned,0 credential matches;original HEAD/index preserved. New CI41164775708 is in_progress,not yet passed. Prior41162510021 remains failure,with local evidence retained;do not relabel or rerun it. Next check only41164775708 and fix any actualremaining failure before the next UI/hosted slice. Both actualrestore commands exit0 and consistent-restore-proof.json is passed;do not repeat the100 uploads or restore. Existing deployedpilot7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47 unchanged;no production/A/DNS cutover. Edge tab1650468828 was marked handoff for continuation. No user action/credential request pending.

## 2026-10-31 — Workspace upload capability slice accepted in isolation

Previous0de1d3c CI41164775708 completed/success. Implemented Owner-scoped upload capability by workspace policy: Cloudflare16MiB/Sharp64MiB,private no-store,closed when CF processing disabled;foreign/anonymous/query guards retained. All4uploadUI paths pass workspace;copy and preparation errors use effective size with64MiBbrowsercap,originaljournals/intentsemantics retained. Four focused unit tests,root/Webstrict,scopedlint,Worker/UI build and processing-recipes10 native/API/mobile groups passed. Fixed newbatch effect workspace dependency. No schema/cloud/customer/A change;NOT hosted acceptance of new UI. See docs/WORKSPACE_UPLOAD_LIMITS.md.

Next publish/verify newsource CI,refresh exact restrictedOwner entry bundle/native boundary/preflight with that successfulCI,then controlledB staging UI/API acceptance (not another100-photo upload/restore). Existing7be9f78 pilot unchanged,production gate/otherunmetflags andautomaticdeleteOFF/dry-run/single-node preserved. Google capability/identity andGuest/version/delivery hosted work remains;no new credential request pending.

## 2026-10-31 — Upload limits source publication checkpoint

Published/remote-verified private main `de22a36c16557871a9bb24edefc095df15b32d2b`;16 intended files,726 source candidates scanned with0credentialmatches,originalHEAD/index preserved. Exact newCI41167613971 is in_progress;do not treat earlier0de1d3c/CI41164775708 success as acceptance of this newbackend/UI. Next check only41167613971,then refresh restrictedOwner native-boundary/bundle/input preflight before controlledB staging deployment and real16MiB UI acceptance. Existing7be9f78 deployedpilot remains unchanged;noA/DNS/clouddata/schema changes. Keep actual100-photo and independentconsistentrestore evidence;do not repeat them. No newcredentials/useroperation pending;Edge1650468828 markedhandoff.

## 2026-10-31 — CURRENT: query-free upload capability and evidence-based staging gate

CI41167613971/de22a36失敗原因為新增Owner query string違反既有resolved browser安全assert；改成GET /api/v1/workspaces/:workspaceId/upload-capabilities，保留無scope舊endpoint並拒絕query，原安全assert未改。修正後unit4/rootstrict/scopedlint/build/native10及fresh restrictedOwner bundle14邊界通過。詳見docs/WORKSPACE_UPLOAD_LIMITS.md。

Scoped staging checker已改為本repo/main push/指定workflow/實際successCI+精確工作檔（含untracked新source）匹配，非固定舊6709。其餘B/schema/restore/flags/Secret名/bundle/14-check限制與productDeploymentAuthorized:false保留。實際failedCI及stale-success-source兩個negative各exit1正確拒絕。CanonicalCI metadata現為失敗de22，下一輪只從真實新CI API刷新，不改success或bypass。No deploy/A/DNS/customer/schema changes;existing7be9pilot及OFF/dry-run單節點保留。新CI成功後再真實hosted16MiB驗收，不能用本機結果代替。

## 2026-10-31 — Query-free fix publication checkpoint

Published/remote-verified private main `7ee40f309add1aae08b34e3a7e5afebc0db16e7f`;10 intended files,726 source candidates scanned with0credentialmatches;originalHEAD/index retained. NewCI41171466586 is in_progress,not yet passed. de22/CI41167613971 remains actualfailure,not rerun/relabelled. Next check only41171466586;on success fetch gh API metadata {id,head_sha,status,conclusion,event,head_branch,path,repository:.repository.full_name} for this exact run into worker.local/processing-integration-ci.json,then run scoped checker against existingfresh14-check/bundle proof (rebuild only if source changes). Verify allsafe staging bindings/Secret names before B-only controlled deployment and hosted16MiB check. No deploy thisslice,existing7be9pilot unchanged;noA/DNS/customer/schema mutation. Do not repeat100photos/consistentrestore;no credentials/userinput pending. Edge1650468828 markedhandoff.

## 2026-10-31 — CURRENT: Guest entry CI transport blocker reproduced and fixed locally

CI41171466586/7ee40f3 failed in Guest入口120s timeout,not deploymentready。Focused六情境真正重現context106 pending route cleanup hang。改用既有native loopback HTTP橋、先消耗全部response body後再注入丟棄/毀損、完整關閉server/ctx及收斂錯誤；不延長CI、不重試POST。故障注入採headers後body截斷避免Chromium透明重送；Entry驗權精確1次計數限定Entry文件，Gallery合法額外GET不混算。原53assert條件保留+2loopbackguards。六情境exit0，scopedlint/format/syntax通過；只是本機，不是全CI或hosted。詳見docs/GUEST_ENTRY_TRANSPORT.md與worker.local/guest-entry-focused-proof.json/fourth.log；所有失敗保留。

僅兩個test檔與交接變更，產品7ee backend/UI未改；B/A/DNS/客戶/schema/flags全未動。下一步新source CI真正成功後才刷新staging metadata及精確preflight，部署原受限Owner pilot，驗hosted16MiB。不要重跑100圖/restore，不relabel既有failure；無憑證或使用者操作需求。

## 2026-10-31 — Guest transport source publication checkpoint

Published/remote-verified private main `6e9426297f6bc074fa6400c6f1604e0ff4fa87d5`;9 intended files,728 candidates scanned with0credentialmatches;originalHEAD/index preserved. NewCI41176275152 is in_progress,not yet passed. 7ee/CI41171466586 remains truefailure;do not rerun/relabel it. Next check only41176275152;on success refresh exactgh runmetadata into worker.local/processing-integration-ci.json and run B-only scopedpreflight against existing14-check/bundle proof,then actual controlledOwner staging deployment/16MiB acceptance. Productbackend/UI unchanged in thispatch,so do not rebuild/reupload100photos/restore without newreason. Actual deployedpilot still7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47;noA/DNS/schema/customer/flag change. Edge1650468828 markedhandoff. No credential/user operation pending.

## 2026-10-31 — CURRENT: B Owner staging refreshed; hosted16MiB acceptance passed

CI41176275152/6e942629 completed/success。真正部署B Owner-only staging新version c673b93a-401f-4c57-bfca-d0438e076031；CF下載bundle與預檢ebb9afa4...完全吻合，前後安全綁定/6Secret名/flags核對及7hosted邊界通過。當前public enabled/previewfalse，Guest等仍OFF，不是完整MVP。

真實Edge Owner session保留，介面16MiB；17MiB合成檔選取即拒、Startdisabled，remote D1前後upload/session/asset/quota帳務全同，sessions100/assets300/used8913629/reserved0。首24張縮圖decode與1000×1600直式燈箱、匿名私人thumbnail401回歸通過。只移除本機rejected項目，未傳新照片/重做100圖或restore。完整證據與回復：docs/HOSTED_UPLOAD_LIMIT_ACCEPTANCE.md，worker.local/hosted-upload-limit-proof.json；原7be9deploy/boundary另存歷史副本。

下一切片：受控Guest協作hosted promotion（先盤點hard-local/gates，限定B合成project，保留真實授權/備份/rollback條件；不能APP_ENV=local或globallyremoveguard），逐項Owner invite/Guest exchange/view/select驗收，及未配置Google登入能力顯示。所有原產品需求保留；production/private_direct_upload等未滿足readiness不改true，auto-deleteOFF/dry-run/single-node，無A/DNS/customer/schema更動。無憑證/使用者操作待辦。

## 2026-10-31 — Hosted acceptance closeout (no redundant docs-only CI)

Current remote main and actually deployed app source both remain `6e9426297f6bc074fa6400c6f1604e0ff4fa87d5`,fullCI41176275152 success;new deployedversion c673b93a-401f-4c57-bfca-d0438e076031 is verified live. This heartbeat changed only7handoff/acceptance MD files (729candidate-file scan0credentialmatches,temporaryindex preserved);keep these local changes and include them with the next realcode slice rather than trigger anotherfullCI for unchangedruntime. No newCI is pending or needed for thisdoc-only closeout. Prepared snapshot review did NOT update deploymentbranch or push. Latest sourcepub helper parent for nextcode should remain6e94262.

Next work can start directly on boundedGuest-hosted promotion/Google availability,using docs/HOSTED_UPLOAD_LIMIT_ACCEPTANCE.md and currentpassedpreflight/currentresourceproof. Do not wait for a nonexistent docsCI,repeat100uploads/restore,or deployolder7be9. PublicOwnerpilot enabled/previewfalse,Gueststillclosed,productionnotreleased. Edge1650468828 retained;no useroperation pending.

## 2026-10-31 — OAuth availability vertical slice accepted locally

Implemented the current Worker React login provider capability: GET /api/oauth/providers returns names only, using the same complete nonblank ID+Secret predicate as createAuth. Partial/unconfigured providers are absent; UI loading/error/empty states expose no sign-in buttons. Owner identity/closed registration/implicit-link denial remain unchanged. Added only this read-only path to the existing Owner-only staging wrapper;Guest stays closed.

Actual checks: focused unit3 passed;root strict and Web strict passed;Worker/UI dry-run build passed;scoped ESLint/Prettier passed. Refreshed staging entry build plus native20 checks passed (all original14 boundary checks retained,3newAPI checks,3Chromium UI checks including actual GitHub-only response and explicitly injected loading/failure). This is local workerd/D1/R2/Chromium;Images is still a presence double here,not new hosted OAuth/provider/MVP acceptance. First agent build failed from a duplicate declaration introduced while patching LoginPanel;fixed,subsequent build passed. No schema/customer/cloud/A/DNS changes this slice.

See docs/OAUTH_PROVIDER_CAPABILITIES.md and docs/GUEST_HOSTED_PROMOTION.md. Guest inventory confirms config+service+capability local guards and missing synthetic-scope allowlist;do not open flags alone. Next publish this exact code snapshot together with previously unpushed hosted-limit docs,verify its one new CI,then refresh exact source/bundle/preflight before B-only deployment and anonymous real UI verification. Existing deployedOwnerpilot remains6e94262/versionc673b93a-401f-4c57-bfca-d0438e076031 until that occurs. All production/unmet readiness,auto-deleteOFF/dry-run,single-node retained. No credential/user action pending. Native proof now has20 checks;old14-check proof is historical,not acceptance of changed source.

## OAuth publication correction

First snapshot851154e was pushed before a trailing index.ts formatting failure stopped the PowerShell batch;no deployment occurred. Formatted only that endpoint and verified Prettier success. Superseded CI41184204862 was cancelled to avoid redundant broad checks;do not report it as success. The corrected snapshot must obtain its own actual successfulCI before any B deployment. OriginalHEAD/index remain preserved.

## OAuth CI format failure (actual evidence)

CI41184244943/6f93018 completed/failure at pnpm format:check:the6updatedhandoff Markdown files had excess blank lines. Runtime/security tests were not reached in thatrun. Formatting those6files and checking all changedsource+docs before the next push;no deployment occurred. Failure log retained worker.local/ci-41184244943-failure.log. Do not relabel thisfailure or treat previous6eCI as newsource acceptance.

## 2026-10-31 — CURRENT: OAuth availability deployed and accepted on B

Corrected source `5e5ac8b751401967809902efd06b64c997a82e6a` fullCI41184396089 completed/success (all steps). Refreshed actualCI metadata,exact-source scopedpreflight and B resource checks passed;final native20 bundle SHA `3b2fd10896f2adc89a10b04a49ac43c6ddb0e25177e76e27b506190fbb3dd7f7`. Formatting changed the earlier emitted bundle hash,so the final bundle was actually rerun through20native checks before acceptance;not silently relabelled.

Actually deployed B Owner-only staging version `6ab7a8fc-247e-46f3-8858-7a5ec914c768`;downloaded bundle matches,DB/R2/Images/6Secret names and closed flags unchanged. Closed deployment was verified before restoring the existing publicOwnerpilot;previewfalse. Ten hosted boundaries passed (old7 + configuredGitHub-only providers/query400/write404). New independent IAB tab8 visibly changed from Google+GitHub to only enabledGitHub;no login click/token/newOAuth performed. Existing realEdgeOwner session reload still reads the same syntheticproject;no new upload or schema/customer/A/DNS changes. Proof worker.local/hosted-oauth-availability-proof.json and current deploy/boundary proof;old6eproof preserved with suffix-6e94262.

This is an actual hosted availability fix,not fullMVP or newGoogle/link acceptance. Guest/production and unmetreadiness stayclosed,auto-deleteOFF/dry-run,single-node. PreviousCI41184204862 was superseded/cancelled;41184244943 remains actualformatfailure,not a success. No new CI is pending. Originalworktree branch/HEAD/index preserved;734candidate scan0credentialmatches. Current remote main and runtime both5e5ac8b. These post-acceptance docs (plus Guest asset-scope/fixture detail) are local and should accompany the next realcode slice;do not trigger redundantdocs-only fullCI.

Next: implement boundedGuest staging promotion using docs/GUEST_HOSTED_PROMOTION.md. Reuse existing focusedfixture;enforce precise syntheticinvite scope in issuance/exchange plus photo+version asset lookups (asset URLs lack albumId),retain trustedIP/admission/KDF/Securecookies and all currentACL. Native staging context and real independentGuest browser acceptance precede activation;never APP_ENV=local or globallyremoveguards. Do not reupload100/restore/bootstrap or request already-savedkeys. Edge1650468828 retained for continuation;anonymousIAB8 is routine acceptance and mayclose. No useroperation pending.

## 2026-10-31 — Closed synthetic Guest flow implemented; native accepted

Implemented strict B-only STAGING_GUEST_VALIDATION (defaultOFF),exact project/singlealbum service and API/photo-version boundaries,limited link-only/view/select/submit capability+Owner UI,and separate closed Guest entry/config. Existing local behavior and disabled safe metadata recovery retained;all other local/production guards remain. Actual focused10unit,root/Webstrict,scopedlint/format,UI+Workerentrybuild,nativeGuest19groups/full56migrations and oldOwner-only20boundary pass. Native flow creates actual session/privateR2+localSharp derivatives,picks/submits,Ownerexports the same immutable submission with audit,and validates scope/revoke/logout. See docs/GUEST_HOSTED_PROMOTION.md/private localproof. No realCloudflare/OAuth/browserGuest/publicTLS/expired-entry/trustedIP-edge acceptance;Images presence double/nativeSharp are explicit. Fixture403 transport failure fixed using dispatchFetch;injected-IP limitation recorded,not silently passed.

Highest-priority next task is now audited Owner album activation:actual product has no draft→active API/UI/command,and live synthetic album is draft. No remoteSQL bypass or activation has occurred;existing active-state guards preserved. Implement compatible nextmigration+atomic activation ledger/revision/confirmation/API/UI/tests/recovery,then independent backup/restore and B adoption before activating ONLY synthetic album and opening Guest. Three password modes/otherpermissions/Google+link/versions/delivery remain MVP requirements,not removed by the bounded firstslice.

No schema/cloud/customer/A/DNS mutation thisslice;runtime remains5e5ac8b/version6ab7a8fc-247e-46f3-8858-7a5ec914c768 Owner-only. Guest entry config public/previewfalse,noCron;production unmetreadiness,OFF/dry-run,single-node unchanged. Newnative check added toCI;exactcode publication/newCI required,not previous5e success. Preserve originalworktree/index and protected backups. No credential/useraction pending.

## 2026-10-31 — Closed Guest source publication checkpoint

Published and remote-verified private main `c1c8a92f8363ab9a561535cc39747cc0fe3bdc13`;21 intended files,740 candidate-file credential scan0matches,originalHEAD/index preserved. NewCI41188887091 is in_progress,not yet accepted. Finalnative proof19checks/full56migrations and source/config/bundle hashes are current;earlier22-check run is historical. No Guestdeploy/cloud/schema/A/customer change;actual runtime still5e5ac8b/version6ab7a8fc Owner-only.

Next command: `gh run view 41188887091 --repo kinostudio/kino-pick --json status,conclusion` (outside Wrangler-isolated XDG). Fix any actualfailure;on success start the auditedOwner draft→active migration/service/API/UI slice described in GUEST_HOSTED_PROMOTION.md. Do not deploy/open Guest just because thisCI passes:live fixture is draft and there is no auditedactivation API yet. Preserve remaining password/permissions/versions/delivery/Google/link requirements;OFF/dry-run,single-node. No useroperation or credential request pending. NativeGuest config remains workers_devfalse/previewfalse/noCron. OriginalbranchHEADb14d505/index remainunchanged;publicationbranchparent for next realcode is c1c8a92. Post-publication checkpoint docs are local;include with nextcode rather than repeat docs-only CI. Edge1650468828 markedhandoff.

## 2026-10-31 — Audited album activation implemented; native13 accepted

Prior c1c8a92 CI41188887091 completed/success (allsteps). Added additive0057 album_activation_commands,atomic Owner draft→active/revision+1/fullbefore-after audit,immutable historicalreceipt/retry and reciprocal casefoldnamespace/REPLACE guards;new service/strict contract/API/defaultOFF flag and Owner confirmationUI. Capability failsclosed on OLD56/missingledger;GEToldtables remainscompatible. Separate closedOwner-onlyactivationprofile keeps allGuestflagsOFF and exactBsyntheticscope;productionnotadmitted. See docs/ALBUM_ACTIVATION.md.

Actual focused contract3+scope/flag7,root/Webstrict,scopedlint/format/UI+Workerbuild pass. Finalnativeactivation13groups pass,includingOLD56populatedparity/latefailure rollback/currentauth/CAS/replay/namespace/auditfailure andrealD1fixturehelper;oldOwnerboundary20 andclosedGuest19 on57chain pass. Legacy7fixturefiles nowactivate usingactualcommand+audit andpreserveassertions;no fake meta.changes. Earlier12proof/history andhelper/parity/UIpatch failures retained;no newrealOAuth/provider/browser/hostedactivationclaim. DefaultpersistentlocalD1 notmigrated.

B readonly actualbaseline confirmed4DB/source56/1syntheticworkspace/100photos/300assets/fixedalbumdraft/noactivationledger;existingisolatedOAuthrefresh worked,no key/useraction needed. NO cloudDDL/data/deploy/A/DNS/customer changes. LiveOwnerpilot still5e5ac8b/version6ab7a8fc;Guest/publicproduction andglobalunmetreadiness stayclosed,OFF/dry-run,singleR2. NewsourceCI stillrequired before adopting/deploying;oldc1success is not newactivationCI.

Next highestpriority:publish exactsource+verifyoneCI,thenfreshprotected56snapshot/newindependentBrestore+0057upgrade/oldrow-schema-sequence-FKparity,thenB-only57adoption andcontrolledOwner-onlyactivationdeployment/realUIaudit acceptance beforeGuestopening. Do notrerunOwnerbootstrap/100uploads/oldrestore or rawUPDATE. Appliedmigrationfiles0001–0056remainimmutable;0057notremoteadopted yet. Rollback/recovery is documentedforwardfix/auditretention,notdroporrewind newerdata.

## 2026-10-31 — Activation source publication checkpoint

Published and remote-verified private main `aa8b74368f88060897f0c586e4316fe314e28286`;32 intended files,749candidate-file credential scan0matches,originalHEAD/index preserved. NewCI41194080987 is in_progress,not yet accepted. Priorc1/CI41188887091 success stayshistorical. Finalnativeactivation13/Owner20/Guest19-on57 proofs and focusedtype/lint/build checks are local,not cloudadoption. No newcloudrestore/export/DDL/data/deploy/A/DNS mutation;liveOwnerpilot remains5e5ac8b/version6ab7a8fc andBsource56/draft.

Next command: `gh run view 41194080987 --repo kinostudio/kino-pick --json status,conclusion` outside Wrangler-isolated XDG. Fix anyactualfailure before adoption;then follow ALBUM_ACTIVATION.md for freshprotected56snapshot,newindependentBrestore+0057upgrade/parity/sourceadoption andOwner-onlyactivationpreflight/realUI. Do notapply0057withoutfreshbackup+independentrestore oropenGuestbasedonlyonnativeactivefixtures. Current0057SHA c6990971ce5110afb902e8d7187c40f52983f2c8a5c17b91e5da28e38ef3b28c;notremoteadopted. No credential/useraction pending;isolatedexistingOAuthwasroutinelyrefreshedonceafter403 andBbaselinequerypassed. Keep allprotected100photo/restore evidence;do notredo themwithoutnewmigrationbackup purpose. DefaultpersistentlocalD1 staysold;OFF/dry-run/single-node retained. Newpublicationparent is aa8b743;post-publicationcheckpointdocs local,include withnextrealwork rather than redundantdocs-only CI.

## 2026-10-31 — Hosted Owner activation and UI parity gap

Actual CI41194080987 for aa8b74368f88060897f0c586e4316fe314e28286 completed/success. Fresh protected source56 backup restored into independent B D1 24788788-7bbc-4947-b781-c858c0d4f8c1, upgraded57 and readback verified. Source0057 adoption preserved135 old product tables, old schema objects and data; FK0. Source now57 migrations;0057 is applied/immutable. Proof apps/worker/.local/staging-0057-apply-proof.json. Initial raw dump local inspection failed on table creation order before cloud mutation; corrected strict normalization/transaction/deferred-FK rehearsal succeeded. No destructive rollback or restore over customer data.

B Worker activation profile deployed version0ff58553-e642-47f5-93dc-cbd2ae36ccd7, exact aa8 bundle d2313198240bc155cc74bcf4c4600ece7f3102b2f1eba6d349b11db43b3e4cc0; actual six Secret names, sourceD1/privateR2/Images bindings, noCron and10 hosted boundary checks passed. Existing Owner-only pilot publicly reachable, previewOFF; all Guest flagsOFF, product release not authorized. New local tools/check-staging-album-activation.mjs validates CI/source/native13/cloudrestore/backuphashes/resource config; no readiness bypass. Narrow empty0057 normalizer is not suitable for post-activation backups; inspect actual new shape before any future restore rehearsal.

Real existing Edge Owner UI opened fixed synthetic album confirmation and submitted once. Actual D1 draft/revision1 -> active/revision2, command1/audit1, before/after and request/session/actor joins verified;100photos/300assets unchanged. UI shows 使用中 and removes activation button. Proof apps/worker/.local/activation-ui-before.json and activation-ui-after.json; screenshot in visualization artifacts kino-pick-owner-activation-20261031.png. This is real hosted activation, not hosted Guest acceptance or full MVP release. No new credentials/user action pending; A/DNS/customer data unchanged, automatic deletionOFF/dry-run, singleR2.

User identified visual mismatch. Confirmed independent4174 prototype experiments/gump-demo (memory-only synthetic data, no API) and deployed React apps/web/target-ui are separate frontends. Production UI has not adopted prototype shell/sidebar/theme/layout; functional acceptance is not visual parity acceptance. Preserve prototype as visual reference and migrate its presentation into existing target-ui components with real API/auth/error semantics; do not replace functional frontend with memory-only demo. Track UI parity explicitly before declaring MVP accepted. Next bounded slice: reconcile Owner workbench shell/project/album visuals against prototype, retain real upload/gallery/activation; Guest hosted scope remains separately gated. Full Google/link/Guest/collaboration/version/download/delivery/custom-domain release acceptance remains incomplete.

## 2026-10-31 — 正式前端整合原型視覺，待使用者確認

已在現有 apps/web/target-ui 整合 prototype 的深色側欄、米白主題、工作台摘要、專案卡片、全寬相簿與照片工具區；新增 studio-shell.tsx，原 API、Owner 授權、上傳、啟用、分享、保護及其他既有元件保留。摘要只使用 API 已載入本頁數量，不冒充跨分頁總計。相簿索引工具收進「進階相簿整理」。單張照片改為桌面左圖右資訊／既有工具、手機上下排列；私人 TrackedPhotoImage、scope／失效處理、pending guard、鍵盤／焦點與上一張下一張邏輯保留。沒有加入模擬評等、留言或假操作。

實際通過：最終 target-ui build、root strict TypeScript、四個 JS/TS 檔案 scoped ESLint、相關 Prettier；本機瀏覽器工作台→專案→相簿8圖→單張、下一張1→2、Escape關閉／焦點恢復、手機選單、375px無水平溢出及圖片比例檢查。1600×1200 fixture JPEG 實際渲染318.0556×238.5417，比例不變。既有 bundle >500kB 警告仍存在，這次未擴大至效能重構或全量測試。不是本輪雲端 OAuth／R2 重驗。

確認網址 http://127.0.0.1:4180/dashboard ，執行工具 tools/prototype-integration-preview.mjs；serve 真正正式前端 .static build，但 API 資料為隔離 fixtures、Sharp合成8張JPEG；明顯標示「介面確認預覽・隔離展示資料・不寫入雲端」。僅loopback，所有非GET/HEAD回403，未知API404；5個HTTP邊界檢查通過，無外部API／憑證。此預覽不能冒充真正登入／上傳驗收，也不能取代正式Worker。首次手機檢查發現預覽標示遮住燈箱header，僅修正host注入CSS後重啟並重驗，未污染production樣式。

證據 apps/worker/.local/studio-visual-integration-proof.json 含6個來源SHA256、檢查與截圖清單；visualization目錄有 kino-pick-integrated-workbench.png / album.png / photo.png / mobile.png（後三者完整檔名皆有kino-pick-integrated-前綴）。已在IAB保留可操作確認頁。沒有commit/push/deploy、DB或R2寫入；B仍aa8b743/version0ff58553-e642-47f5-93dc-cbd2ae36ccd7，A/DNS/customerdata未改。下一步依使用者版型回饋修正，再走新來源CI與既有B部署閘門，不以預覽代替MVP或解除Guest限制。自動刪除OFF/dry-run、單R2不變。

## 2026-10-31 — 統一正式前端、透明 Logo 與真實 API 介面驗收

目前預設 pnpm dev/build/start 已統一為 Worker + apps/web/target-ui；v11 Logo 無外框實心底。Next／gump-demo 僅為歷史參考，4174 只轉址4180。舊「4180 fixtures 預覽」紀錄已過期；現在 http://127.0.0.1:4180/__review/login 是正式前端搭配隔離真實 Miniflare D1/R2／57 migrations／Sharp，不是雲端 OAuth。8照片、27assets、9處理工作。不得將本機結果當 hosted 或完整MVP驗收。

逐頁外觀／操作／真實API證據與未完成項目，請以 docs/FRONTEND_INTEGRATION_ACCEPTANCE.md 及 docs/HANDOFF.md 最新節為準。保存單一產品前端，保留所有原需求與既有授權／審計／重試。攝影師metadata推薦、freehand正式schema、固定交付、帳號綁定及hosted Guest仍待完成。新來源CI與B部署閘門通過前不部署；B基線aa8b743/schema57不變，A/DNS/客戶資料未改，自動刪除OFF/dry-run、單R2。

## 2026-10-31 — 統一分享彈窗原生回歸已通過

補上本輪前端整合尚未執行的 invite-create 原生瀏覽器驗收。新增 apps/worker/tests/invite-create-focused.mjs，沿用既有57 migrations／guestDownloadChecks fixture／真實Worker與隔離D1/R2，外連一律拒絕、不讀外部憑證；執行 `cd apps/worker; node tests/invite-create-focused.mjs`。既有 runInviteCreateUiChecks 全組完成，包含375px相簿預選與僅view預設、12項權限不隱式連動、三種密碼模式、一次性secret不進storage／當前URL、未知結果關閉再開維持mounted form／原request/body、401重試後metadata recovery且DB命令不重複、capability關閉不發POST，最後FK check空。Proof apps/worker/.local/invite-create-focused-proof.json。這是本機原生測試，不是hosted Guest驗收或新雲端部署。

第一輪因page.goto等待networkidle逾時失敗；改為domcontentloaded並保留既有可見／可用控制項就緒斷言，第二輪exit0。沒有縮減既有業務／授權／復原斷言。未重跑全量套件，沒有變更migration／業務flags／客戶資料／A／B部署。下一步仍是原handoff中的正式metadata推薦／freehand／交付／帳號綁定與hosted驗收；MVP未完成。

## 2026-11-01 — 攝影師推薦與手繪正式接線；B 發佈進行中

使用者明確要求繼續整合／必要驗證後部署 B，不再等待舊版型確認。唯一產品入口仍為 Worker + target-ui；A／FILM.KINOSTUDIO／DNS不得改動。

已依指定 Cocoon-AI architecture-diagram-generator 的實際 SKILL.md 與 template.html 產出中文 HTML/SVG，含頁面／部署／資料流、來源revision與MIT授權，repo副本 docs/diagrams/kino-pick-architecture.html。靜態SVG轉PNG／結構／匯出script語法已驗證；瀏覽器file協定遭工具安全規則拒絕，未改走HTTP或其他瀏覽器繞過；匯出按鈕實際點擊仍not_checked。

新增0058 freehand guard migration（不新增表／command），既有資料與點／矩形保持，原生四次DDL失敗rollback／Guest與Owner valid-invalid geometry／FK0、實際Chromium→Worker→D1/R2畫筆寫入與邀請隔離通過；詳見FREEHAND_ANNOTATIONS_MIGRATION.md。0059加入獨立版本綁定攝影師metadata／policy／command／result及append-only audit，不混用客戶feedback；符合任一星等／色標條件，手動set／clear／inherit保留原始證據。欄位更新即儲存，未知結果維持原request重試與照片導覽pending防護。

Worker原圖metadata讀取器重用既有嚴格XML子集，透過有界R2 range與ETag／SHA／size／mime見證，支援JPEG／PNG（含有界壓縮XMP）／WebP，無Sharp runtime依賴，不回傳原始XMP或其他私人metadata。Sharp原有facade保留。32項解析測試、6組native D1 guard、10組真實API/R2／Guest布林投影／權限／審計失敗rollback通過。Proof .local/photographer-recommendations-d1-guards-proof.json 及 photographer-routes-focused-proof.json。首次policy快照順序不符、projection UPSERT誤觸insertguard及自動匯入錯查immutable upload_sessions.status等實際失敗均已修正，不計為通過；完成後改查不可變completion見證。自動import失敗不回滾已完成上傳，可由同上傳重試或原圖重讀復原。

正式UI本機已實際儲存相簿顯示／三星與紅色OR門檻、手動五星、讀取原圖XMP三星紅色、清除後不推薦、inherit還原。不是本輪雲端驗收。新的精確B協作profile／完整CI／fresh57 backup→獨立restore→58/59 upgrade／source adoption與部署尚在進行；舊B仍aa8b743/version0ff58553/schema57，Guest仍關閉。自動刪除OFF/dry-run、單R2不變。剩餘固定交付／通知、帳號綁定及完整hosted驗收保留，不宣稱MVP完成。

## 2026-11-01 — 協作發佈候選來源

完成攝影師推薦正式API／0059、私有原圖JPEG/PNG/WebP bounded XMP讀取及手動清除／還原；推薦條件ANY/OR，與Guest星等分離。自動import曾因immutable upload_sessions狀態查錯而未喚醒，已改以completion witness確認；native重放completion已驗證。0058手繪schema、雙端writer／UI主圖portal已整合；實際CUA Guest鍵盤畫線→儲存→重載保留annotation，畫布位於mainstage且只有一個image；合成測試圖，不是客戶資料或hosted證據。截圖kino-pick-main-photo-freehand-reloaded.png。

本輪最終local證據：metadata32、D1推薦六組、推薦R2/API十組、scoped協作24組、freehand既有E2E20、invite相容四測試、root/Webstrict/scopedlint/build通過；release checker self-test通過。所有通過均有實際執行；未重跑全量local suite。架構圖採指定Cocoon-AI skill/template、保留MIT，中文HTML與PNG已產生。

B獨立restore/upgrade實際通過：drill049e766a-76b0-4f5c-9c56-33e3cf565c6e，fresh source57還原後parity、升級59舊資料/schema/sequence/FK0通過，sourceWrites0。portable manifest docs/releases/collaboration-0059-restore.json；protected詳細證據apps/worker/.local/collaboration-0059-current.json。來源DB仍57、Worker仍aa8/0ff58553；下一步精確新來源CI成功後source0058/59採用，再使用新Actions scoped協作workflow部署、閉鎖readback核對、開B workers.dev及真實hosted驗收。不得將候選或local結果當完整MVP。

正式前端已統一prototype主題／透明Logo／工作台／專案相簿／單張／分享／處理設定／帳號；Next與gump-demo是歷史參考，4174轉4180。仍待hostedGuest全流程、固定核准交付／通知、Google及同身分綁定、其餘roadmap需求。scopedprofile只允許固定合成workspace/project/album，link_only及12獨立rights，不能宣稱全正式產品。A/DNS/customerdata未改，自動刪除OFF/dry-run、單R2、無Cron。

CI41221476573（7db0e21）失敗已保留：866測試通過，新增推薦D1測試依賴尚未產生的.build/index.js而ENOENT。已修為自足的native D1 minimal Worker（不需要產品bundle/assets），所有六組原DB授權/CAS/namespace/integer/append-only/audit-rollback斷言保留並focused實跑通過。另GitHub讀取失敗log helper新增安全logs模式；沒有繞過CI或改雲端schema。新的精確來源CI成功前不採用／部署。

發佈檢查補修：.gitattributes 將0058從Windows CRLF正規為Git LF，導致原始byte-hash portable manifest在Linux不一致。已逐byte驗證只差CRLF→LF、SQL完全相同；manifest分開保存rehearsedMigrationByteHashes（實際雲端演練原始值）與明示UTF-8/LF的migrationHashes，checker採同一正規化，本機self-test通過。未改0058/59 SQL、未重跑雲端演練、source仍57。新來源仍須成功CI才採用。

## 2026-11-01 — 真正的工作台重讀循環與 native UI 相容修正

CI069eac0/41221910807的unit、integration、build及既有瀏覽器步驟通過，nativeCloudflare在舊ui-browser networkidle失敗。查到產品root cause：OwnerWorkspaceShell每次render傳入新的z.union schema，useResource effect以schema為dependency造成反覆fetch/abort。已hoist為module-level stable schema，產品build/scopedlint通過；新增native基本UI斷言，初始shell＋workspace page恰好兩次GET且networksettles，避免迴歸成D1請求洪流。

測試亦已適配真實prototype操作：專案／相簿建立modal、Owner「相片詳情」與filename h3、主圖portal canvas。保留所有建立／釘選／封存／重載、pointer/geometry、privacy、CAS及未知結果重試斷言；未改產品以逃過斷言、未停用測試。九個受影響Owner/Guest browser harness及ui-browser scopedlint/format/syntax通過。

本機full native執行已通過新的workspace/project/album建立／釘選／封存與大量D1/R2/Guest版本業務；該程序在patch之前已cache舊Guestannotations module，於舊panel內找不到已移至主圖的canvas而失敗，未當成整體通過。該selector已在新來源修正，仍須新精確來源CI及fresh native結果。另loopback review-server的focused reuse因devshim cache-control為no-store而非產品private,no-store在初始headers斷言停止；未改弱產品assert、未當成功。兩次本地工具相對cwd路徑錯誤已修正，沒有產品/雲端變更。

B仍schema57／aa8 Owner pilot，獨立restore59證據保留有效；沒有採用、部署、A/DNS/customerdata操作。來源freeze後只在實際新失敗時修正，避免重複無關全量測試。

Native最終整合已實際通過321組（包括主圖portal Guest/Owner authoring／processing、comments、版本、挑片與基本UI兩次GET），末段因舊測試未展開「進階相簿整理」而找不到indexpanel停止；CI41223881336同native步驟失敗，未當成功。已更新matching-filename-index／matching-rules兩測試先展開同一gallery的真實summary；OwnerHistory測試導航更新至獨立/history頁。所有原業務斷言保留，scopedlint/format/syntax通過，等待新CI。

預先核對另一受影響路徑：processing-recipes原生政策UI改走獨立/settings、使用「新照片處理配方」精確region；focused實際10組全過，含375px政策儲存與重載。未重跑本機整套，當前所有產品程式與d274bc1相同；此批只更正四個測試路徑／disclosure及交接。B仍57/aa8，無採用或部署，A/DNS/customerdata不動。

## 2026-11-01 — 最後手機歷史頁 RWD 修正（已單獨原生通過）

CI41225377434已走到最後一個OwnerHistory browser group，其餘原生業務均通過，但375px overflow519而失敗。以同一原生D1/R2＋Chromium helper縮小重現：新增合法長無空白專案名稱後overflow643，診斷確定是ProjectDirectory list的auto grid track/min-content把li/a撐寬，非照片伸縮或時間欄位。

僅修studio-pages.css：project-list使用minmax(0,1fr)單欄、li及project-name min-width0，保留既有ellipsis且不以overflow:hidden遮住整頁。產品UI build通過；單獨focused完整OwnerHistory mobile流程在長名稱資料下通過（篩選／分頁／CSV/JSON下載／未知結果重試／撤銷等原斷言保留）。expected OWNER_HISTORY_EXPORT_FAILED是注入失敗的拒絕證據，不是成功匯出或未處理產品錯誤；整個focused退出0。詳細.local/history-mobile-focused-long-fixed.log與history-mobile-long-project-proof.json，該focused使用58schema，59完整source由新CI覆蓋。test helper加入只在失敗時列超寬元素的診斷，未放寬assert。

B source仍57、aa8 Owner-only pilot；沒有雲端遷移／部署／A/DNS/customerdata改動。此CSS修正需新精確來源CI成功後採用／部署；不重跑本機20分鐘全量。

## 2026-11-01 — B59 與 Actions 部署完成；真實 OAuth session hotfix 候選

精確source ccb118994220feb903ef5335b284dba757030bee CI41227529424全部通過。B來源0058/0059實際採用59，136既有產品表資料／schema／sequence保持、FK0；protected.local/staging-0059-apply-proof.json。Actions41229338948實際成功，Worker version a5a6451e-f1b7-42fd-b707-a6822e9b97ac／deployment4eae396f-5bc2-409d-92b2-46689e002fde。私人R2、六個Secret名稱、無Cron、OFF/dry-run/singleR2與公開workers.dev enabled/previewsfalse均核對；A/DNS/customerdata未改。

真實Edge Owner既有OAuth session在新前端繼續有效；實際從產品介面直傳一張21,409-byte、900x600合成JPEG，原生Cloudflare處理完成且圖庫可開啟。攝影師標記卻SERVICE_NOT_READY，查到新Repository誤把sessionId當UUID且lowercase；真正BetterAuth session是32碼且含大寫（僅查shape，不記錄值）。這是hosted失敗，不當成推薦功能通過。

已修為與既有album activation／image policy一致的z.string.min1.max512、不改大小寫；actor UUID處理保持。native6/API10/受限profile24全部改用mixed-case opaque session並通過；case-folded session確實拒絕。Worker build/rootstrict/scopedlint/format及release self-test通過；沒有migration變更。原已失敗的V1 metadata import可在hotfix後透過正式「重新讀取原圖資訊」恢復，新完成事件將用正確session；尚未宣稱這項已hosted驗收。

前進發佈不再硬鎖最初Owner版：docs/releases/collaboration-prior-deployment.json保存實際成功Actions收據、hash、source及version。新preflight另核對該舊Actions真正completed/success、live B精確profile／version／message匹配，然後才允許新的相同scope程式版。歷史restore57→59manifest不改、不重套migration，仍驗證59ledger/FK/私有R2/關閉入口。待新精確CI成功後close B→dispatch同workflow→收據核對→再開入口；不能拿ccb CI代替hotfix CI。

一次Cua AX輸出意外包含合成測試邀請URL，已立即透過真實Owner UI撤銷invite6ea64206-8c1e-4103-816c-e8ff38d3bcdd並讀回「已撤銷」；該invite從未建立Guest session。永久CF/R2/OAuth憑證未出現。後續避免dump分享結果AX，僅持有URL在記憶體／先隱藏結果，紀錄id與狀態。UI嘗試選24hr日期未改變實際7day值，未宣稱hosted自訂期限已驗；其餘8次限制與12獨立權限確實由回應讀回。仍須Guest真實協作／新metadata／版本與下載驗收，再接連結解除、三密碼模式、固定交付通知與其餘MVP條件。

## 2026-11-01 — Opaque session hotfix CI and Owner annotation render readiness

Source cafb2d8d0566eb089511f21983f3a1e7d3cb41d3 passed format/lint/strict/unit/integration/product build and all three freehand browser suites in CI41230619544. Native D1/R2 failed in owner-annotations-browser.mjs after switching back to the retained version: the response observation settled before React rendered either the target item or pagination control. This is a failed CI, not deploy acceptance; B remains ccb1189/a5a6451e/schema59 and public entry is unchanged. The scoped metadata native6/API10/profile24 remain locally passed; no migration/restore rerun.

Test-only stabilization waits for actual target row or pagination readiness before the existing bounded paging loop; original scope/body/privacy assertions are preserved. A new exact CI is required before code-only forward deployment. No A/DNS/customer changes.

## 2026-11-01 — Real hosted Guest collaboration and two presentation regressions

Live source ccb1189/a5a6451e: created fresh synthetic-only invitation 9046b0ff-e4e3-4844-8b9a-d9b1b7e21d41 with 12 independent rights and 8-session cap. Secret remained in memory and was removed from the Guest URL before reading the page. Separate IAB Guest session entered without a platform account. Synthetic JPEG V1 freehand, comment, four-star feedback, favorite and selected state were saved through real APIs and survived reload. Real Edge Owner read the exact invitation/version comment and annotation record. Partial proof .local/hosted-collaboration-proof.json and screenshot kino-pick-hosted-guest-freehand.png distinguish successes, failures and not_checked items.

Hosted testing found Guest lightbox horizontal arrows still navigate photos while drawing in the portal canvas: its global handler lacks the defaultPrevented guard used by Owner. Also Owner history labels freehand as deleted because its point/rectangle ternary omits the freehand label, while SVG rendering already supports the polyline. Both are being corrected without altering stored geometry or deletion semantics. CI41231888573 for ca3d752 was explicitly canceled as superseded to avoid wasting the remaining full native run. Neither canceled CI nor these partial hosted checks justify deploying unverified source. B/A/schema unchanged.

## 2026-11-01 — B hotfix deployed and real recommendation/freehand accepted; version wake gap found

Source 56288cb9ac3da6f7abaaa81efb710427181a587a passed exact full CI41233234187. Actions41234844192 succeeded; Worker version3e9c8a69-dfb2-4f74-b391-67213c9b7ccf, deploymentd7b65620-6777-47a2-8c10-f2e0aa6ae4af. Postdeploy receipt checked59/FK0/privateR2/noCron/OFF-dry-run-single; public B entry read back enabled=true/previews=false. The initial standalone entry read helper stopped before a request because its explicit B environment variable was absent; rerun with the required fixed account succeeded. No migration/restore/A/DNS/customer changes.

Actual Edge Owner OAuth now reads/writes recommendations: private R2 V1 metadata imported3stars/Red; show=true with4star threshold OR red recommends it; manual5stars, clear, restore all work while independent Guest4stars/favorite/selected persist. Owner history now labels Guest freehand correctly. Fresh hosted Guest horizontal keyboard creates a draft without changing photo. Owner freehand also saved through real API and Guest reload sees both authors; Guest cannot edit Owner row. Native preview download produced requested/generated audit pair with38286bytes; browser file persistence remains not_checked. CLI audit first failed7403, read-onlywhoami refreshed correct B OAuth, one retry succeeded; no new credentials or accountA changes.

A real manual V2 upload (21527bytes,900x600,XMP3/Red) completed original transfer but remained queued. Found missing processing wake in version-upload-routes complete: normal upload invokes processCloudflareImages while manual version only imports metadata. No Cron exists by design. This is a real hosted failure and Before/After has not yet passed. Next patch reuses the bounded existing durable processor for trusted completed normal/version upload jobs, retaining privateR2/current-head/auth/audit; no direct SQL ready-state mutation. Also ensure an older pending workspace job cannot consume the only wake intended for the just-completed photo. Retain existing V1 and queued V2; test next actual version normally after exactCI and forward deployment. Prior-deployment receipt is advanced to this actual successful56288cb release for the next code-only release.

Completion wake patch is now frozen and locally accepted: normal/V2 completion use the same waitUntil helper. Flag OFF creates no background task/DB lookup. ON resolves immutable completion witness by actor/upload (plus V2 path photo) and passes trusted workspace/asset ID to the existing processor; pending adds an optional exact-job filter and scheduled default behavior is unchanged. It cannot consume an older pending job instead of the just-completed photo. Failed/replayed writes preserve their original receipts; no schema change or new service.

Focused native D1/R2 routes13 passed (original10 retained plus3 wake groups): OFF queued; enabled V2 exact ready outputs while backlog untouched; completion replay no duplicate processing audit; wrong-photo replay404; normal V1 exact ready with both backlogs untouched. Images binding is a deterministic local fake, not real provider evidence. Worker dry-run/rootstrict/scopedlint/format pass. Root rebuilt B scoped profile and native24 passed; release self-test passed after increasing strict required photographer proof count10→13. Actual prior successful56288cb receipt is pinned. A new exact source CI and code-only B forward deployment are still required before real V3/BeforeAfter acceptance. Old synthetic V2 is retained queued; never mark it ready with direct SQL.

Additional hosted page check: Owner activity page works and shows actual metadata/policy/version/Guest rating/favorite/selection/annotation/comment/download events with UTC timestamps. Guest history link navigated to Validation unavailable: wrapper allowed the capability/data API but omitted its /guest/history HTML document. Added only that exact read-only page path; API auth and fixed-album boundary remain unchanged. Existing native24 group now also asserts HTML200/root, POST404 and /guest/history/other404; rebuilt profile and24 passed, release self-test passed. CI41236382208 for1d349f8 canceled as superseded before the final combined source, not counted as acceptance. No hosted fix yet; new exactCI/forwarddeploy still required. Do not broaden static routing to other Guest paths.

## 2026-11-01 — 最終受限 hosted 協作／版本切片已通過；完整 MVP 仍未完成

正式 source10b0b7b82a89a2e0fc041d401ac7b53c898475ab、CI41236744712 success、Actions41238436526 success、Worker526e3f16-f4dd-4567-9551-7ac7b05b8bd9／deployment066270a3-e12c-44f7-b2d6-c0445276cac4。公開入口true、previewsfalse、59/FK0/私人R2/無Cron/OFF-dry-run-single均核對。B entry首次OAuth過期失敗，whoami刷新既有B授權後一次重試成功，未建立新憑證。

真正V3 UI直傳、精確Cloudflare processing成功：original21527／preview13885／thumbnail4266 bytes，全private；自動讀回三星Red、明確切current-head revision1。Owner/Guest已比較V1與V3，Owner實際拖把手60→20、Guest鍵盤40。V1留言／雙端筆畫仍保留，V3不混入。Guest自己的history document/API已讀回7個實際事件；Ownerhistory包含所有本輪實際活動。Guest1張提交凍結，Owner封存明細仍指向原選V1而不被目前V3覆寫；CSV UI請求無錯誤，瀏覽器落地檔not_checked。舊V2仍queued，無直接SQL狀態修補。版本列表目前需重開／reload更新ready狀態，待補正式重試／就緒更新。

完整範圍與證據見 docs/HOSTED_COLLABORATION_ACCEPTANCE.md、docs/releases/hosted-collaboration-2026-11-01.json。下一個最高優先slice是既有workspace中的Owner新建project＋album與明確managed scope，保留foreign/tenant/invite拒絕，再走真實上傳啟用分享。不要重新做已通過的OAuth/bootstrap/100張/59restore/推薦/手繪/BeforeAfter；不要直接放寬所有routes或關掉guard。Google link/unlink、三種密碼模式、核准固定交付通知、保留政策UI等原需求仍未完成，不能標完整MVP。

最後交接與圖表更新保留在工作目錄，不為純文件再跑全量CI；main產品source仍10b0b7b，原HEAD b14d505與index未改。後續snapshot使用 refs/heads/codex/cloudflare-b-deployment（目前10b0b7b），先確認parent/ref與完整diff，再沿用ARTIFACTS中的kino-pick-publish-collaboration.py；不要reset/checkout清掉dirty工作。A/DNS/customerdata不動。

## 2026-11-01

- 正式相片詳情改為滿版燈箱；開啟／切換時以 albumId/photoId 同步網址，底部縮圖列沿用私有圖庫縮圖。通過 Web typecheck 與 Vite target-ui production build；未部署 B，整合圖庫後另於隔離本機瀏覽器完成視覺驗收。
- 正式相簿加入瀑布流／圖片清單、由 API 投影驅動的攝影師推薦徽章，以及 additive migration 0060 的 Owner 置頂／取消置頂、revision、稽核與 pinned-first 分頁。補上推薦保存後圖庫未刷新的事件 listener；Web strict、Prettier、Vite target-ui build、定向 D1/API 通過，並在隔離本機 Worker/D1/R2 瀏覽器實際確認推薦數 0→8、兩種檢視、置頂排序、燈箱縮圖列與網址同步。0060 尚未採用至 Cloudflare B，未做 hosted 驗收或部署。
- 重新繪製 Owner pin 圖示為斜角 pushpin SVG；瀑布流照片上用白色線框加陰影，已置頂轉 Kino 金色填滿；清單移除方框，燈箱沿用同一元件。隔離預覽目視確認兩種狀態，保持 API、DB 及置頂權限不變。
