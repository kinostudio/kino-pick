## 2026-11-09 正式相簿頁籤已發布；0069 期限繼承仍為本機候選

使用者核准的滑動相簿頁籤已整合正式前端，source 10e79694f5ba8cda385c5ac00986d932e04d5196，CI42527545445及自動B部署42529477580成功；Worker c53c7359-c39e-4c54-8884-813484b52069，schema67不變。真Owner已驗相簿切換、網址、上一頁／下一頁、重載及24張私人縮圖；保留墨綠／米白原配色。正式證據在 .local/album-tabs-release-20261109/docs/releases/album-tabs-hosted-acceptance.json。未驗hosted窄畫面與實機觸控。A未改。

G2接續工作樹為 .local/g2-inherited-share-0069，base490b175，尚未發布。0069候選已實作相簿世代／不可復活期限、nullable繼承契約、逐相簿授權、原密碼／metadata replay及預設OFF旗標。53項focused單元通過；全新本機D1的實際0069 runtime故障整批回滾、schema／舊列／sequence／FK parity與真Worker API runner通過，含有效custom不復活已到期繼承連結、OFF→ON→OFF、每相簿deadline及24h session上限、跨租戶／範圍拒絕。

實際D1發現expression depth100編譯限制，已將三個深層守門中的同一期限條件拆為交易內相鄰SELECT檢查，沒有移除原ACL；runner修正後通過。另修正guest-gallery期限條件漏AND，未放寬ACL；最終Human focused15組全過，含真本機D1/R2、Owner／Guest375px瀏覽及DB now+500ms時間戳拒絕且事件／audit／activity／generation不變。root strict與Vite／Worker dry-run build通過。兩次一般sandbox build因父目錄／log EPERM失敗保留，隔離允許context後成功。證據docs/releases/inherited-share-0069-local-readiness.json；不以本機合成session冒稱OAuth／hosted或完整CI。

雲端0068／0069復原與遷移、完整release gate／CI及真Owner／Guest仍未完成；具名舊restore67備份退役問題未答覆，不重問、不擅刪、不套live。期限候選不得混入已發布頁籤或宣稱完整MVP。自刪OFF/dry-run、無Cron、R2優先／Oracle30GB及A／Review／客戶資料保持。接續先修Guest回歸與原生human期限驗證，再補安全發布證據及G2其餘清理預覽。

## 2026-11-09 G2相簿天數／分享保護：本機垂直接線通過

沿.local/g2-expiry-foundation-20261109／codex/g2-expiry-foundation-20261109（起點2890c28）接續，canonical3950c24仍保全。planner現在要求每相簿天數與分享證據；有效custom期限在閒置／容量兩模式都阻擋清理，不重設有效瀏覽。Owner設定旁新增真D1分享保護摘要及獨立SVG更新按鈕，無session或達maxUses的連結仍保護；撤銷／到期不計入，查詢失敗不當作none，不改草稿、未知寫入intent或Guest權限。

72相關單元、focused retention原生／browser（含真未訪問分享日期、summary503草稿保留）、B原33組／Human側邊6組與Human focused14組、root/Web strict、product/B dry-run build及目前來源綁定通過。Profile/aria fixture差異與新增Guest使合成共用network:20觸限的失敗保留；只隔離該測試client到文件保留IP，沒有清鎖、重設或放寬產品限額。證據docs/releases/g2-share-protection-local-readiness.json；原B native record名稱與所有產品功能保留。

使用者本輪已確認：custom有效只延後清理，其他已到期連結不恢復存取；先前語義問題已解決。正式inherit mode尚未接線，0069需不可回溯的到期／世代見證，避免custom真view或政策變更使舊bearer復活；多相簿scope不可省略。此摘要不是完整清理snapshot，仍缺連續活動／容量對帳／保護與workflow/reference見證，不可填假的healthy/verified。

完整release self-test仍非成功（真0068 restore/adopt manifest缺失／ENOENT）。只有具名restore67退役與fresh live67備份／獨立68／parity／adopt的雲端授權仍待答覆；沒有重問或雲端操作。B仍58f1bee／live67，未跑本輪CI／hosted，未合併main或部署。接續正式G2期限與snapshot→適用復原守門／CI／自動B／真Owner Guest，再G3→G4→G5。GOAL active，完整MVP未完成；自刪OFF/dry-run、無Cron、R2優先／Oracle30GB、A／Review／客戶資料不變。

## 2026-11-09 G2-03有效瀏覽候選本機通過，雲端發布仍待0068授權與證據

在.local/g2-expiry-foundation-20261109／codex/g2-expiry-foundation-20261109延續G2，canonical3950c24保持乾淨。沿用既有Human View服務與正式Gallery，只有local／精確B collaboration可啟用；Owner／Guest仍逐次檢查session、租戶、相簿、版本及邀請。背景／prerender／modal底層不計次，focus恢復後可重計；prefetch與明顯bot UA在D1前拒絕，屬啟發式而非人類證明。缺舊活動或追蹤中斷仍不能當清理依據。

最終55相關單元、14組fresh D1/R2/Sharp／375px受控Chromium、原33組B-profile與新6組Human native（另FK0）、root/Web strict、Worker types、product及B dry-run build、專項release guard及兩份真proof的current source hash核對通過。測試fixture／Miniflare轉接的8輪失敗及一次誤用help造成的多餘native重跑全部保留，未放寬產品拒絕規則。CI已加入focused runner；68/ON須新proof，prior67/OFF與舊68/OFF保持相容。安全證據docs/releases/g2-human-view-local-readiness.json。

完整release self-test仍失敗；直接唯讀核對為缺真正album-retention-policy-0068-restore.json／ENOENT，不能當CI／hosted成功。B仍既有58f1bee／live67／Human OFF；候選ON並未部署。先前具名restore67退役與fresh live67備份／獨立68／parity／adopt的授權問題、custom有效連結是否只延後清理的規則問題仍待答覆，不重問、不擅刪或恢復其他連結。

接續請從此延續工作樹的已保全分支處理G2正式期限與dry-run adapter，不從根髒檔或3950重作。取得適用授權後才真68復原／adopt→完整release self-test／正常CI→自動B→真Owner／Guest；後續G3 OAuth來源管理、G4production、G5全流程保留。自刪OFF/dry-run、無Cron、R2優先／Oracle30GB、A／Review／客戶資料不變。完整MVP與G2未完成，GOAL維持active。

## 2026-11-09 G2-02期限核心及D1重建機制本機通過

0068候選分支保持3950c24乾淨未改，具名雲端授權問題仍待答覆，不重問或擅刪restore67。本輪在同倉庫隔離工作樹.local/g2-expiry-foundation-20261109／codex/g2-expiry-foundation-20261109推進G2-02：custom/inherit_album期限與24h session計算27項focused單元、domain strict、scoped lint/format通過；OFF時繼承連結不因閒置到期，也不要求活動追蹤資料，ON才需已驗證活動，null只代表無閒置期限，不是授權。全新本機D1合成資料套至68後，nullable模式重建保留154產品表舊列、8條入站FK（10欄條目）、原session與其他schema；明確NOT NULL執行期故障整批回滾、FK0。這不是0069正式migration或hosted證據，沒有新增正式授權或雲端變更。

證據docs/releases/share-expiry-foundation-local.json與docs/SHARE_EXPIRY_FOUNDATION.md。另已提出一次規則問題：有效custom連結是否只延後清理，或也延長其他繼承連結存取；待答覆前不擅自恢復舊連結。G3只讀盤點發現正式Worker仍關閉手動link/unlink，Next/Supabase測試不能代替產品；B公開provider metadata本次只列github，不是新登入驗收，見docs/G3_OAUTH_GAPS.md。接續G2正式相容migration／統一scope與期限守門、API/UI與有效瀏覽；後續G3正式OAuth綁定、G4production與G5完整真實驗收保留。A/Review/客戶資料不動，自刪OFF/dry-run、R2優先/Oracle30GB不變，GOAL維持active。

## 2026-11-09 新內建GOAL已啟動

使用者已清除舊GOAL；本次create_goal成功建立新的active總目標：沿用既有正式前端，G1已完成，依G2→G3→G4→G5完成剩餘必需功能及production線上MVP。主代理規劃與整合，具體分檔工作可交gpt-6-luna／max並行。舊paused／無法覆寫的紀錄屬歷史，不再是目前追蹤器狀態。

當前G2-01已完成本機接線與驗證：90天/OFF、Owner按需設定、獨立revision、CAS/精確重播、跨ledger操作編號與append-only audit；14項planner、17項contract/history、最終33組B-profile(schema68)、371組Cloudflare/Chromium整合、13組推薦/R2與單一原生手動清理通過，strict/build/scoped lint/format通過。既有受保護67備份的本機68相容性保留152舊表/3415列hash/schema/sequence、4相簿預設90/OFF、FK0。失敗與修正保留於docs/releases/g2-album-retention-policy-local-readiness.json；完整release self-test仍因缺真正0068 restore/adoption manifest拒絕，不能稱CI/hosted或G2已完成。B現有10個D1名額；待明確授權才可備份核對並退役舊restore67-b5181da4、fresh live67備份/獨立68/parity/adopt，後續正常CI/自動B/真Owner/Guest。未動live67/A/DNS/Review/客戶資料，未刪庫，自刪OFF/dry-run、R2優先/Oracle30GB保持。內建新GOAL保持active，接續G2→G3→G4→G5。

## 2026-11-09 目前執行目標更新為G2

G1正式發布與真Owner／Guest ZIP／通知／EXIF驗收已完成，依docs/releases/g1-0067-hosted-acceptance.json保留基線與失敗證據。當前目標依docs/MVP_RELEASE_PLAN.md最新G2：先相簿90天可調且預設OFF設定，再分享期限繼承、有效人類瀏覽背景紀錄、dry-run候選預覽；逐個Schema→Service→API→UI→Tests→Docs，必要復原／CI／自動B／hosted後才標完成。G3補驗、G4production切換、G5最終全流程保留。A／Review／客戶資料不動，自刪OFF/dry-run、R2優先／Oracle30GB維持；正式來源.local/oracle-release-20261106。內建舊GOAL仍paused且無overwrite/resume API，未假標完整MVP完成。本次僅更新目標，沒有G2程式、migration或雲端變更。

## 2026-11-08 G1正式驗收完成：live67／CI／B／真Owner與Guest

已驗來源58f1bee4a155448143dbd99becfa91d7c30e40da，完整CI42491537881／自動B42493102853成功；Worker79ef16c4-7e58-41bc-8edd-85378aac650a、schema67。Fresh-source parity→live0067採用9步exit0、獨立restore67、完整release self-test保留；不重做復原／遷移、不刪測試庫。原始failed export與ZIP截斷及D1十秒resource throttle全部保留，不把重試或local當hosted。最終兩輪query減量及B PRAGMA optimize後，以下有限真實驗收通過，不能拆分宣稱單一措施已證明根因或保證負載穩定。

使用者已明確允許建立一天／單一Synthetic photos相簿的驗收分享。Agent送出前未擋下日期回復預設，誤建INV-E5B0F1DB七天連結；未分享、未使用（雲端session0），已於15:34:54.145Z撤銷。之後以原生鍵盤＋重繪＋送出前精確guard建立正確INV-671869C8（671869c8-0ab0-42d4-820d-178e61048e3f），僅view／original-download／compare，2053，2026-11-09T15:10Z到期。UI及D1雙重核對。原邀請不變，token只在瀏覽器記憶體、隱藏一次性結果／清除fragment／清空變數，無chat/Git/log落值。這個自動化日期fill現象不等於一般人鍵盤輸入有產品bug。

真Guest正常入口登入，24張私人圖可讀且無Owner身分（/api/v1/me=AUTH_REQUIRED）；新邀請發布前成品0，發布後僅本邀請兩份。V1及V3各實看固定預覽並代表確認，Owner各只交付新邀請；D1核對2 requests各1invite／1receipt、2 deliveries各1recipient。Guest EXIF機型／鏡頭／f2.8／1/125秒／ISO200正常，Guest通知2則且不混入舊交付，Owner通知10則含新確認／發布。

最終3張不同新票券「首次」ZIP皆完整54145bytes、CRC零錯誤、可解壓，V1原圖32220bytes/SHA423fb462…、V3原圖21527bytes/SHAb26b590c…完全一致。三ZIP本身SHA均ce5b06276bc8422ee11c50bcc03bfbe4d938e194380669fac4fa2016dfc82711。Safe tail三GET均200/ok、無resource/D1 signals；雲端3 created／3 requested／3 generated，IP只核對text不讀值。沒有實檔自動重試或重複寫入；V3 locator等待逾時後fresh UI確認原操作完成，不冒稱低延遲。截圖root.local/g1-{new-guest-confirmed-exif,final-guest-zip,final-guest-notifications,final-owner-notifications}.png；完整安全證據docs/releases/g1-0067-hosted-acceptance.json。

本次G1發布切片完成，完整production MVP及G2-G5仍未完成：下一優先相簿90天預設OFF、連結期限繼承／有效人類瀏覽及dry-run候選的清理政策垂直切片，後續production獨立資源／網域及全流程。A／DNS／Review／客戶資料未改，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。未做hosted負載／實機觸控或保證首次零錯，較早metadata失敗保留。文件GOAL已按實際完成更新；內建舊paused GOAL無overwrite/resume API，不得假標其完整MVP objective完成。

## 2026-11-08 最終58f1bee已CI／自動B；Owner通過，Guest新分享待確認

本次fresh-source parity→live0067採用9步exit0、完整release self-test已成功。第二修正版58f1bee4a155448143dbd99becfa91d7c30e40da，完整CI42491537881及既有自動B42493102853成功；Worker79ef16c4-7e58-41bc-8edd-85378aac650a、baseline5c86a3c、schema67。只改ZIP重複預檢，不改新GET前／完成前的完整ticket與審計／ETag守門，沒有自動重試寫入。B另已完成PRAGMA optimize內部統計維護、FK0，產品資料列不變。

真Owner在最終版本讀到1200×800私人預覽、相機／鏡頭／f2.8／1/125／ISO200，確認／交付通知正常；root.local有g1-owner-{exif,notifications}-final-hosted.png。較早真Owner／Guest已實際2邀請1代表確認、單一邀請固定V1交付與通知；原V3與新V1兩原圖完整ZIP的size/SHA曾實測一致，但前兩版ZIP有截斷，全部失敗保留；捕捉D1_ERROR十秒resource throttle，不能宣稱最終ZIP已驗收。完整安全證據docs/releases/g1-0067-hosted-acceptance.json。

原Guest session已過15:02UTC，使用者回覆未保留原INV-3061D3CE分享連結；hash無法還原，不可偽造／延長session。已在原Owner頁填妥新分享但尚未建立：僅Synthetic photos相簿、link_only、查看／下載原圖／比較版本、2026-11-09T15:10Z到期。已提出一次新持續存取憑證的瀏覽器action-time確認，尚待答覆；不要重問、不要擅按建立或放寬原邀請。表單截圖root.local/g1-new-guest-invite-review.png；Owner原tab1650470566保留表單，新增Owner驗收tab1650470568、IAB Guest2可接續。新token只能在瀏覽器記憶體使用，不進chat/Git/log。

下一步收到允許後才建立新測試分享，以正常Guest入口登入，對新邀請明確指定合成固定版本確認／交付，再驗新票券首次ZIP（完整解壓／CRC／原圖SHA）、Guest通知與EXIF；若再失敗保留D1安全訊號，不能標GOAL完成。A／DNS／Review／客戶資料未改，自刪OFF/dry-run、R2優先／Oracle30GB不變。不要重做0067backup/restore/adopt或刪獨立庫；完整MVP／production切換仍未完成。文件GOAL已覆寫，內建舊GOAL仍paused且無overwrite/resume API，未假標完成。

## 2026-11-08 B查詢統計維護／Guest重登入待答覆

第二候選58f1bee，正常CI42491537881中。B live已執行官方PRAGMA optimize＋FK check，exit0，內部統計changed_db true、changes0／rows_written0、FK0；先在本機備份驗證所有產品row/schema/sequence完全一致。沒有新migration、客戶資料列或A變更，尚不能以此主張hosted ZIP修復。

現有真Guest session將於2026-11-08T15:02:00.123Z到期；CI／部署預期超過此時間。已一次要求使用者在訪客瀏覽器以原INV-3061D3CE分享連結重新進入，不要求貼token／密碼／Cookie，尚待答覆。可繼續CI、部署及Owner驗收；不可偽造／延長DB session、放寬授權或未確認新建分享憑證。若Guest尚未重新登入，不得宣稱最終候選真Guest驗收完成。請勿重問同一需求。

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

## 2026-11-08 自適應縮圖列已自動部署B並線上驗收

最終source c685c887b87885ff9f0fe0660437b8b803937cae，完整CI42400059486成功，自動部署42401987313成功；Worker d7fabc7f-b225-4b92-8031-e7fdf2295568，baseline bot7d6b5d2，schema66。縮圖依實際可用寬度顯示目前與鄰近照片，不固定五張；獨立flow row收合露上方1/3、opacity0.62，hover／真鍵盤focus展開，選中高亮。收合及展開均不覆蓋照片，保留原服務、權限、網址及草稿保護；觸控原有完整可點列維持。

真Owner在既有24張合成相簿實測1699px21張、1280px17張、375px6張；三尺寸兩態均noOverlap／thumbsFit／selectedVisible，私人預覽正常。切第17張後window移至8–24，Owner網址更新、移出收合、關閉移除photoId及重開正常。獨立Guest1280px17張、相同鄰近window／高亮／鍵盤展開／關閉通過。Guest375 hosted未驗：現有IAB tab未套用viewport override而維持1280；CI的真產品Guest375檢查已通過，不把它冒稱hosted或實機觸控。暫時viewport均reset。證據docs/releases/filmstrip-adaptive-hosted-acceptance.json；截圖root .local/filmstrip-adaptive-{owner-expanded,owner-folded,owner-mobile,guest-expanded}-hosted.png。

兩次CI失敗均保留：42395835837忽略Guest既有160px最低stage，已按實際floor修正；42397770413最後Guest navigation等networkidle逾時，僅比照Owner改DOM就緒，保留HTTP200與真實按鈕／燈箱／下載斷言。最後完整CI成功，未跳過守門。原CSS fixture加入tall tools edge後證據同步raw variant；不以fixture取代clean CI或hosted。

尚有獨立Guest讀取問題：下載／交付清單錯誤在本次部署前已見，feedback於本次重載亦顯示暫時無法載入，根因未定；不能宣稱Guest完整流程零錯或完整MVP。下一步先定位其現有capability／授權session／邀請scope的讀取失敗，保留隔離，不全域開權限。ZIP／通知／EXIF及0067仍為未發布WIP；新restore67未建立、live67未採用。舊restore66僅依明確授權完整備份核對後退役、備份保留，勿重刪或重做已通過0066。

正式來源仍.local/oracle-release-20261106；根不同產品髒檔保全，不從根stage-all或重建。此次無schema／儲存路由變更；A／DNS／Review／客戶資料未改，自刪OFF/dry-run、無Cron、R2優先9GB／Oracle30GB維持。Owner與Guest驗收頁保留，Owner為使用者輸出、Guest留接續診斷。尚未驗實機觸控／負載／CPU記憶體，ZIP等不得混入此次已驗UI發布。

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

## 2026-11-05 接續點

B 已採用 schema61（新備份／獨立復原通過），手動 R2 清理與 Owner managed 建立接線已實作；CI／部署／hosted 清理尚待完成。以 docs/HANDOFF.md 最新節、docs/MANUAL_STORAGE_DELETION.md 及實際 Git／線上版本為準，勿重做 schema60/61 復原或既有已通過功能。自動刪除 OFF、單 R2、無 Cron，A／DNS 不動。

## 當前接續點（2026-11-01）

以 HANDOFF 最新節與 docs/HOSTED_COLLABORATION_ACCEPTANCE.md 為準。B source10b0b7b／CI41236744712／Actions41238436526／version526e3f16-f4dd-4567-9551-7ac7b05b8bd9，schema59。真實OAuth、私人R2原圖／縮圖、推薦OR與即時清除還原、雙端手繪留言、Guest歷史、V3精確處理與V1/V3實際滑桿、提交／後台封存明細已驗；完整MVP仍未完成。下一步是既有workspace的Owner新建project＋album與明確managed scopes，保留foreign/tenant/invite拒絕。不要重做已通過的Owner/bootstrap/100uploads/59restore/推薦/手繪/BeforeAfter。舊合成V2保留queued，版本清單暫需重開更新；自動刪除OFF/dry-run、單R2、無Cron，A/DNS/customerdata不動。

## 產品命名

正式名稱為 **Kino Pick（奇諾選圖）**。既有內部 `@kino-pic/*`、儲存鍵、服務識別及歷史紀錄暫保留以維持相容。

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

## 2026-10-28 — M3i3 validation checkpoint (not complete acceptance)

Final target build .local/m3i3-worker-build-final2.log exited0 after both cursor-cycle and native radio-group corrections. Actual588 unit/67 files,final full strict68388,whole lint8613,61 reference integration95549,Next reference build and14 Chromium13914 pass.52-file document presence/diff checks pass. Isolated native D1 populated0049→0050 preserves119 old table hashes/schema/sequences/FK0 and chooses the new unforced covering index for the scoped BINARY ID range seek (worker .local/m3i3-catalog-plan-probe.log). Persistent local DB remains0049.

Focused final2 passed catalog setup,complete1,001-row bounded paging,Owner/session/scope/HMAC/query/expiry checks and arbitrary final-page head reservation/exact replay,then stopped at PHOTO_VERSION_NOT_READY when a synthetic alternate version was used for set-current. The guard is correct; the fixture is being changed to use a genuinely uploaded and Sharp/R2-processed alternate version. Never mark synthetic metadata ready or bypass processing. Browser radio/first-page/lost-response and full standard remain pending; no full M3i3 acceptance or0050 adoption is claimed. All hosted gates/deletion remainOFF; fullM1–M5 ACTIVE.

## 2026-10-28 — M3i3 Assisted catalog in progress

Read docs/ASSISTED_CANDIDATE_CATALOG.md. Source now includes default-OFF/hard-local Assisted catalog, signed24-row keyset pages, real chosen-head authorization outside the tiny preview map, bounded UI paging/selection and additive source migration0050. Gate OFF retains legacy Assisted behavior. Persistent local D1 remains0049; no0050 adoption, remote/customer write,commit,push or deployment.

Actual588 unit/67 files, full strict76374 and whole lint58155 exited0. Initial target build passed; a later source-only cursor-cycle fix needs rebuilt browser acceptance. Focused runtime owner is continuing actual workerd/D1/R2/Chromium tests; previous failures were test assumptions, not full acceptance. Do not claim M3i3 complete or apply0050 before complete runtime validation and fresh backup/restore/live parity. All hosted flags and automatic deletion remainOFF/dry-run. FullM1–M5 remains ACTIVE/incomplete.

## 2026-10-28 — M3i2 indexed automatic matching accepted locally

Read docs/INDEXED_VERSION_MATCHING.md and latest HANDOFF. Auto_filename uses one authorized SQL snapshot for canonical coverage, pending work, complete immutable history aggregates, mode/revisions/watermark and current head. Three reservation paths attempt derived keys in their original guarded D1 batch. Exact replay/CAS/quotas/audit are retained; other modes preserve the existing reader and all Assisted choices. Cancelled/expired uncompleted invalid keys no longer permanently block readiness. Per-album heading IDs are distinct and product labels hide internal mode codes/sequences.

Actual complete standard41146 passed345 local Worker/D1/R2/API/Chromium checks (.local/m3i2-cloudflare-second.log). Final-copy supplementary focused44905 passed13 actual checks including foreign-tenant404/no-write and375px not-ready UI; root inspected the final screenshot (worker .local/indexed-version-matching-not-ready-mobile.png).563 unit/65 files,generated strict38151/whole lint92653,final-copy Web strict82013/scoped lint49141,61 reference integration,14 reference Chromium and Next build passed. The full standard predates the final copy-only change; final focused coverage is supplementary.1,001 history fixtures are guarded synthetic metadata, not physical bulk R2 E2E; actual small-image originals/derivatives are separately verified.

0049 is applied LOCAL ONLY after NEW695697-byte backup SHA25600158b519d7179be6c423c4c2a36b154ee66a849fce13335674f8e9845208414, isolated restore/upgrade and fresh live parity. Adoption94446 exited0:60 CLI commands all exit0;118 old tables/schema/product sequences/same4 development rows unchanged;119 tables,new index empty,FK0,ledger49/no pending. Source49 SHA2565843c7a5fe71c8cef3eea2b0eced406e29bb866e2de01c4b625849068f4f3a16. Preserve all .local proofs and old M3h artifacts; never restore a stale snapshot over newer writes.

INDEXED_VERSION_MATCHING_ENABLED and all hosted/default gates remainOFF/hard-local; automatic deletionOFF/dry-run. No remote/customer edit,commit,push or deploy. Real OAuth/remoteR2/CORS/edge/free-tier/native-headed acceptance is not_checked. Next Task: bounded Assisted catalog pagination with current chosen-head authorization, distinct opt-in rule profiles and genuine per-file batch/recovery. Coverage-scan cost,legacy forward witnesses and expiry/preview liveness remain. Comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness are still required. FullM1–M5 remains ACTIVE/incomplete; preserve the large unrelated dirty worktree.

## 2026-10-28 — M3i1 filename index maintenance accepted locally

Read docs/MATCHING_FILENAME_INDEX.md and the latest HANDOFF. Additive source migration0049, immutable upload-session/default-v1 keys, authorized status/bounded24-row maintenance API and real local Owner gallery controls are implemented. Complete standard41317 exited0:332 local Worker/D1/R2/API/Chromium checks (.local/m3i1-cloudflare-third.log);541 unit/63 files, final strict19376/lint60259,61 reference integration,14 reference Chromium and Next reference build passed. Album gallery toggle accessibility now reflects view/collapse state; the standard run covers opening, closing and switching to a blocked album.

Persistent D1 remains0048;0049 is source/isolated-test only. Its populated upgrade preserves all118 old product table hashes/counts/schema/sequences and adds one empty table/FK0. No remote/customer edit,commit,push or deploy. MATCHING_FILENAME_INDEX_ENABLED defaultsOFF/hard-local; automatic deletion remainsOFF/dry-run. Existing matching classifier,1,000-candidate safety and Assisted target choices remain unchanged.

Next Task: same-snapshot indexed classification with complete immutable full-history/pending evidence and reserve CAS, paginated Assisted catalog, distinct opt-in rule profiles and genuine per-file batch/recovery. Maintenance readiness is advisory, not match/reservation authority. Legacy unlinked versions, count-query performance at representative scale and hosted external acceptance remain unresolved. Refine per-instance heading IDs before simultaneous panels/hosted enablement. FullM1–M5 remains ACTIVE/incomplete, including comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness. Preserve the large unrelated dirty worktree.

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

## 2026-10-28 — M3g1 annotation backend accepted; drawing UI pending

M3g1 Guest annotation backend and coordinate foundation are accepted locally. Point/rectangle geometry is normalized to integer1e6 in the oriented preview frame and immutable photo/version scope. Independent can_annotate128 never grants images/comments/selection/compare. Author-only create/update/delete/resolve/reopen, dual immutable command/state/change/result witnesses, full before/after Guest audit, exact same-session replay, lifetime cap and scoped own cursor pages are implemented. Optional own-comment links additionally require can_comment256. Public own activity exposes only annotationId/revision/state, never geometry/style/comment link/body. No drawing UI or peer list is shipped in this slice.

Actual final standard run:281 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g-cloudflare-seventh.log, session83933 exit0);406 unit/46files (.local/m3g-unit-first.log),61 reference integration/10files,14 reference Chromium(26.8s), generated strict Worker/shared/Web types (.local/m3g-types-final.log), full lint and Next/Worker builds passed. Populated0044→0045 upgrade preserves every prior table row and existing comment marker sequence, with four new tables empty/FK clean. It includes genuine guarded Guest/Owner comments plus a genuine Owner processing decision against actual private R2/Sharp ready V2. Own-author page/watermark indexes are verified by actual D1 EXPLAIN QUERY PLAN, including in the final populated full run; the separate ignored worker .local/m3g-index-probe.mjs also passed45 migrations/FK/plan assertions. This is structural query-plan proof, not hosted performance/free-tier acceptance.

0045 is source-only and NOT persistently applied; development DB remains at0044. GUEST_ANNOTATIONS_ENABLED=false in all Wrangler environments/.dev.vars.example and rejects hosted activation. No new annotation UI, local adoption/backup for0045, remote/customer modification, commit/push/deploy or real OAuth/R2/CORS/edge acceptance. Automatic deletion remains OFF/dry-run. Previous local0044 backup proof does not substitute for a NEW pre0045 backup/restore before later adoption.

Read docs/GUEST_ANNOTATIONS.md and latest HANDOFF before continuing. Next M3g2: implement actual Guest own drawing/list/lifecycle/recovery UI and authenticated Owner readonly invitation/version annotation viewer, then actual375px pointer/keyboard/resize/zoom/pan/unknown-result/lifecycle acceptance. Integrate alongside existing GuestCommentsPanel in guest-selection.tsx and guest-version-comparison.tsx; use annotation-coordinates.ts with actual oriented image natural dimensions. Pending async product question: peers of the same invitation share annotations like comments, or only author+photographer see them? Do not infer that answer from the earlier comment-sharing decision. Explicit /annotations/own is valid under both choices; own UI/Owner readonly work can continue without exposing peer data. Genuine Owner annotation authoring/processing, shared display policy, full history/exports, scalable matching, delivery/notifications/retention and remaining M1–M5/hosted acceptance are still required; never impersonate a Guest for Owner writes. Preserve dirty codex/kino-pic-foundation/base b14d505. FullM1–M5 remains active.

## 2026-10-28 — M3f2b Owner processing accepted locally

Independent Owner processing (待處理/open, 處理中/in_progress, 已處理/resolved) is now locally integrated and accepted. It preserves Guest text, lifecycle and revision; Guest body edits mark the saved decision stale, and explicit acknowledgement uses both CAS revisions. Same-invitation Guests see readonly status; other invitations stay isolated. Body-free receipts, genuine Owner audit and shared cursor markers commit atomically. Status and reply recovery share full metadata CAS and always reconcile a fresh authorized thread row before confirmation.

Actual terminal evidence:269 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3f2b-cloudflare-ninth.log, session94874 exit0);369 unit/42files (.local/m3f2b-unit-complete.log),61 reference integration/10files,14 reference Chromium(28.6s), generated strict Worker/shared/Web types (.local/m3f2b-types-fixed.log), full lint (.local/m3f2b-lint-last.log), Next production build and Worker dry-build passed.375px processing screenshot apps/worker/.local/comment-processing-mobile.png was visually inspected. Hosted OAuth/R2/CORS/edge and native headed lifecycle delivery remain not_checked.

0044 applied LOCAL ONLY after verified ignored512749-byte pre-migration backup and isolated restore.46 commands succeeded; all102 old tables retain exact row-content hashes,4 new tables start empty, total106 product tables retain the same4 development rows, FK clean/no pending migrations. Backup SHA256 c63607d764a0693498755c717639f54582f799c156195854e99c713a0fb60e44, worker .local/m3f2b-backup-integrity.json. Populated0043 upgrade also preserves actual Guest/Owner histories and existing shared marker rows/sequence. No remote/customer change, commit/push/deploy. Keep OWNER_COMMENT_PROCESSING_ENABLED=false and all hosted gates OFF/hard-local; deletion OFF/dry-run.

FullM1–M5 remains active and incomplete. Next implement independent normalized point/rectangle annotations with separate permission, immutable version/scope, genuine actors and history; then complete full Owner history/exports, scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, production processing/roles/multi-node and hosted acceptance. Read COMMENT_PROCESSING.md and latest HANDOFF before continuing. Preserve the dirty codex/kino-pic-foundation worktree at base b14d505.

## 2026-10-28 — M3f2b processing source integrated; acceptance pending

Read docs/COMMENT_PROCESSING.md and latest HANDOFF. Independent Owner processing (open/in_progress/resolved) now has 0044 schema, service/API, shared current-thread projections and Owner/Guest UI/recovery. It never mutates Guest text/lifecycle/revision. Guest text edits mark the saved decision stale; explicit same-state acknowledgement uses both CAS revisions. All processing/Owner gates remain OFF/hard-local; deletion OFF/dry-run. 0044 is NOT persistently applied yet.

Actual checks:369 unit/42files,61 reference integration,14 reference Chromium(28.6s), full generated strict types, lint, Next build and Worker dry-build passed. Populated0043 upgrade preserved all old rows and marker sequence/FKs. Complete new API/browser acceptance is pending: first run stopped on a Node-only helper import, second on an outdated public-field assertion, third on Guest lifecycle label assertions. Those test fixtures are corrected; ninth full run is active. Do not call the new feature accepted until terminal full-suite evidence exists. No commit/push/deploy or customer changes. FullM1–M5 remains active.

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

## 2026-10-27 — M3f1 Guest version comments accepted locally

This supersedes pending M3f1 checkpoints below. Read latest docs/HANDOFF.md and docs/GUEST_COMMENTS.md. Guest single/batch version comments, author-only lifecycle, invitation-shared isolation, guarded append-only history and durable exact recovery are integrated.243 full local Worker checks,316 unit tests,61 reference integration,14 reference Chromium, strict types/lint/Next build passed.0042 applied locally only (36 commands) after verified ignored430590-byte backup; no pending migrations/FK violations and new comment tables/audits are empty. All hosted feature flags remain OFF/hard-local, deletion OFF/dry-run; no remote/customer change, commit/push/deploy.

Next implement Owner comment thread read/reply/moderation with a genuine Owner intent/session path, then independent point/rectangle annotations and remaining M1–M5 work. Never impersonate a Guest for Owner replies. Keep same-invitation sharing and different-invitation isolation. FullM1–M5 is not complete; hosted OAuth/R2/CORS/edge and native headed lifecycle delivery remain not_checked.

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

## M3e Guest published version history/comparison underway

Current source adds default-OFF/hard-local GUEST_VERSION_COMPARISON_ENABLED, requiring Guest exchange and photo-version supporting gates. Guest history/API/UI requires independent can_view + can_compare_versions, not can_select. Metadata and every private image recheck current session/invite/Owner/parent ACL. Current version, baselineV1 and versions with immutable successful head-publication history are eligible; ready never-selected drafts are excluded from history and direct generic Guest asset fetch. No schema/migration or persistent data change in this read-only slice;0041 remains latest locally applied.

Contracts/backend/Lightbox UI are integrated, including a pinned ready currentVersion outside DESC24 history pages, head-bound cursors, safe role/labels metadata, slider/side-by-side/overlay, synchronized zoom/pan, letterbox and parent keyboard focus handling.288 unit tests/37files passed. Root initial full type/lint found and fixed nullable head-anchor typing and a displaced use-client directive; focused/root strict checks now pass. API fixtures create actual R2 originals/Sharp derivatives,27 published versions plus an unpublished ready draft and a neighboring photo. V2 is portrait24x48 versus V1 landscape48x24. New API/browser tests are being integrated; no final acceptance/hosted comparison claim yet. Do not mark fullM1–M5 complete. Next run full local Cloudflare regression, then final types/lint/build/docs. Same-invitation comment sharing and other-invitation isolation remain required future work.

## 2026-10-27 — Resolved single-file upload accepted locally

Read latest HANDOFF and docs/RESOLVED_UPLOADS.md. Actual Auto/Assisted preview→explicit choice→atomic existing-command reservation→signed R2 PUT→ordinary/private-version completion is integrated in Owner UI. Saved intent survives a mode change/reload and exactly retries its captured target; mismatched raw dimensions hold quota in review.220 local Worker checks,260 unit,61 reference integration,14 reference Chromium, full types/lint/Next build passed.0041 applied locally only after backup; no remote/deploy/commit/push. Matching flags remain OFF/hard-local, deletion OFF/dry-run. Next implement scalable matching/rules/batch and Guest version comparison; fullM1–M5 is unfinished. Supersedes pending checkpoints below.

## M3c2b2 resolved upload vertical slice underway

0041 is active source but NOT applied persistently. Root added strict atomic expected-watermark/project-mode guards and resolution raw-dimension completion backstop, retaining old command namespace/quota/CAS/replay checks. Existing upload_requests payloads now capture resolution and optional immutable versionTarget; no new Owner ledger. New default-OFF/hard-local PHOTO_VERSION_MATCHING_ENABLED controls preview/reservation routes, configuration modes and Owner uploader. Contracts/backend/UI/journal/API/browser tests are integrated in source.259 unit tests/35files passed;41 migrations passed an isolated empty workerd/D1 syntax/FK probe. No final M3c2b2 acceptance or deployment yet.

Run19503 failed at the new origin test incorrectly expecting JSON from the existing plain-text403 middleware. Fixture corrected without weakening origin checks. Type generation exposed a too-narrow literalfalse field; WorkerEnv now omits that generated matching flag and validates its string at runtime, while production enablement is still rejected. Two unused fixture imports/helpers were removed. Run90447 passed all new HTTP/D1 cases (default-OFF, canonical replay, current ACL, race/stale/pending/audit rollback, real PNG V1→V2, explicit assisted choice/foreign-head denial, dimension mismatch review/quota preservation), then browser stopped at an assertion expecting internal versionTarget in the public request instead of choice. The test is being corrected to check server-derived canonical D1 payload.

Root found a real recovery UI gap: mode auto/assisted→Manual/Off could hide an accepted pending resolved journal. Root now mounts the uploader regardless of current mode; UI agent is adding modeActive to hide only fresh matching controls while retaining existing intent recovery. Browser acceptance is being extended to change mode after a lost accepted reservation, reload/reselect/exact replay, then restore Auto for V2. Source changes require a fresh full run. Do not claim the second run passed or apply0041 yet. Final strict/full lint and Next build remain required. Hosted flags and automatic deletion stay OFF/dry-run. FullM1–M5 remains active.

## 2026-10-27 — M3c2b1 local candidate invalidation accepted

Read latest HANDOFF/PROJECT_VERSIONING.0040 append-only internal change watermarks and same-snapshot pending reservations are implemented;209 local Worker checks,212 unit tests, strict types and full lint passed.0040 applied locally only after backup; no backfill/remote/deploy. Automatic/assisted API/settings remain unavailable. Next implement actual resolved reservation and UI using the existing immutable upload command/target path where feasible: atomic watermark/configuration/head guard, live ACL before exact historical replay, durable explicit choice and safe retry. Do not substitute another standalone read layer for that integration. All hosted flags OFF/hard-local; deletion OFF/dry-run; fullM1–M5 remains active.

## 2026-10-27 — M3c2a internal candidate read accepted locally

Read the newest HANDOFF and PROJECT_VERSIONING checkpoints. Internal one-statement current-Owner scoped candidate snapshots and conservative full-history classification are implemented;204 local Worker checks,211 unit tests, strict types and full lint passed. No schema/migration or hosted activation. The result is advisory only: automatic/assisted configuration, public resolver, durable choice/reservation revalidation and Owner UI remain unfinished. Metadata revisions alone do not capture photo/version additions; never treat a read snapshot as upload authority. Keep all flags OFF/hard-local and deletion OFF/dry-run; fullM1–M5 remains active.

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

## 2026-10-27 — M3b V2 runtime evidence; final regression in progress

Run21660 (.local/m3b-api-sixth.log) passed canonical V1 API setup, upload-disabled bypass denial, V2 fixed target/recovery/exact init replay, wrong-photo/tenant isolation, and real local R2 V2 completion with immutable private version/audit and unchanged head. It then failed a test that compared the richer recovery response to the init response. The expected shape now verifies the exact recovery metadata, authorization and original target/session; no authorization requirement changed.

Additional fixes from integration review: version uploader accepts the existing UPLOAD_OBJECT_NOT_FOUND409 before PUT; it had incorrectly expected404. The completion success notice now lives in the parent panel so list refresh cannot discard it. The Chromium fixture uses the canonical V1 authorization and joins upload_specs for MIME/hash. Browser expectations mirror these contracts. Latest Web strict typecheck and targeted UI lint passed. Full strict types, Next build,174 unit and61 reference integration passed earlier in this session.

Run27180 is LIVE at .local/m3b-api-seventh.log. Poll that handle before starting another full suite. It includes V2 audit rollback/same-ID retry, stale new-init CAS, target/completion UPDATE/DELETE/REPLACE/null guards and375px file upload/lost-completion/reload recovery via a synthetic SigV4-checked Miniflare R2 bridge. No final browser or full M3b acceptance is claimed until terminal results are inspected.0037 is not applied persistently; no remote/customer data, commit, push or deployment. All flags OFF/dry-run. Full M1–M5 remains active.

## 2026-10-27 — M3b regression and completion response correction

Current source includes the manual version upload router/service/migration and Owner UI behind default-OFF local-only gates. The UI now parses the dedicated completion endpoint's flat versionUploadCompletionSchema response, matching the API rather than an invented completion envelope. Browser verification is being added; do not claim acceptance yet.

Run .local/m3b-api-third.log terminated at a missing fixture-helper import. All five consumers now import the canonical authorized-version fixture; targeted ESLint, node syntax and formatting checks passed. Fourth run .local/m3b-api-fourth.log advanced through Guest history and version capabilities, then terminated at its new ordinary-V1 setup: the test PUT/completed without first authorizing the upload and received INVALID_STATE_TRANSITION. Repair the fixture with the normal authorization call; preserve the guard. No full M3b pass is claimed. Earlier full unit run:174 tests; latest pre-response-fix web typecheck passed. Post-response-fix typecheck log .local/m3b-web-types-response.log shows successful type generation, but the interrupted process handle is missing, so terminal exit is not proven and must be rerun.

0037 remains unapplied to persistent local/remote D1. All deletion flags remain OFF/dry-run. No hosted test, deployment, commit, push or customer data change. Next: canonical V1 setup, complete full HTTP/R2 regression, integrate isolated Chromium file-upload/recovery checks, then integrity/rollback gaps and final checks. Full M1–M5 remains active.

## M3b active integration and first regression feedback

Reviewed0037 SQL, common upload service and strict version router are now integrated into active source behind all default-OFF local gates; current TypeScript check passed. Original service backup is .local/m3b-draft/live-uploads-before-integration.ts.0037 is in active migrations but is NOT applied to persistent local/remote D1. The dedicated HTTP/R2 helper is being written; existing full regression run75668 stopped at guard-priority compatibility before version API cases.

The new valid-V2 workflow gate masked established invalid scope/dimension/identity errors. Its WHEN filter now delegates malformed basic records to the existing0011/0012/0033 guards, retaining the upload-workflow requirement for valid new V2. Isolated behavioral probe passed again after this change. The probe was pinned to baseline0001–0036 after promotion to avoid accidentally applying0037 twice. Old M3a V2 fixtures are being changed to authorized version uploads rather than bypassing the new guard; initial non-current versions will be captured-parent siblings and queued targets remain unready. No security assertions are removed.

Journal module/tests passed focused5 cases; draft UI remains unwired. M3b HTTP/R2/processing/browser/full regression acceptance remains pending. Full M1–M5 stays active; no deployment or new persistent migration.

## M3b version upload implementation underway

Read docs/VERSION_UPLOADS.md. SQL and service drafts are isolated in .local/m3b-draft; contracts are implemented but not exported into API routes. Root capability helper requires direct-upload/current-version/version-upload flags together and hard local-only activation;22 focused contract/config tests passed. Target photo/parent/intent metadata is fixed at reservation, completion must preserve photo_id and allocate an immutable next version without switching the head. Both completion ledgers must be recognized by recovery/cancel/expiry/archive/quota paths. No M3b runtime acceptance or migration application yet; M3a remains accepted locally and full M1–M5 stays active.

## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison slider/side-by-side/overlay, delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

## M3a photo versions implementation underway

Read docs/PHOTO_VERSION_HEADS.md and PHOTO_VERSIONS.md. Existing uploads and gallery queries hardcode V1; immutable rows cannot safely act as mutable current-state. Scoped workers own new0036/head service, version contracts/tests, and Owner panel respectively; root owns existing integration. PHOTO_VERSIONS_ENABLED is defaultfalse/hard-local;7 config tests passed. No new version workflow or migration acceptance is claimed. Next complete atomic head switching and gallery/current/non-current access integration, then explicit manual V2 upload and comparisons. Full M1–M5 remains active; comment visibility decision is pending independently.

## M2p final local verification — supersedes earlier pending status

Final full Worker run54253 passed157 local checks (.local/m2p-cloudflare-lifecycle.log), including history API privacy/current ACL/cursor scope, three-page fixed lifetime, deleted-photo witnesses, real Chromium pagination and explicit lifecycle-event identity clearing.134 unit/25files,61 integration/10files,14 reference Chromium, final generated Worker/web strict typecheck, lint/format, Next build and36-file documentation checks passed.375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected.

0035 was applied to local development D1 only (4 commands), and follow-up migration list is empty. Existing history was preserved. Recovery is forward-only; disable history on application rollback and retain indexes/audit. All feature flags remain OFF/hard-local and retention deletion remains OFF/dry-run. No remote/customer data, deploy, commit or push occurred.

Limit: headless Chromium did not emit native blur/visibility on bringToFront or the isolated CDP probes. The passing browser test explicitly dispatches FocusEvent blur/focus and checks current-cookie/D1 reload plus old-data clearing. Native headed desktop tab delivery and hosted E2E remain not_checked. This does not complete the full product goal. Earlier status/failure notes below are retained as historical evidence, not the current acceptance status.

Next work: immutable explicit Owner photo versions with a separately audited CAS current-version pointer; current uploads/galleries hardcode V1. Add independent non-current Guest comparison authorization before V2 exposure. Comment visibility choice remains pending; do not broaden disclosure. Filename tombstones, full history/Owner views, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 goal stays active.

## M2p own-history integration underway

Read docs/GUEST_HISTORY.md before changing Guest history. Keep GUEST_HISTORY_ENABLED defaultfalse/hard-local. Current implementation and acceptance are pending; do not claim a completed history feature. Root owns integration; scoped workers own new history backend, contract/tests and UI. Always use explicit Kino Pick workdir. Full M1–M5 remains active.

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

## M2m3 project defaults — accepted locally

Read docs/SELECTION_POLICY.md before editing policies.0031 uses durable project/album configuration state, preserves0028 history and seeds explicit overrides. Null maximum on an override means unlimited; reset-to-inherit retains the album epoch. Guest cursors bind source/album epoch and inherited project epoch in the same authorized read. New Owner routes bind CAS, current ACL, canonical commands/results/audit and all request namespaces; legacy retries preserve their original commitment. Keep duplicate-insert protection on policy results/audit and the Cron insert-if-absent observation. Shared rounds retain fixed confirmed bounds. All flags OFF/hard-local; do not apply0031 remotely or treat local checks as hosted acceptance. Local133 Worker checks,108 unit,61 integration,14 reference Chromium, strict checks and build passed.0031 applied locally only (41 commands); no pending migrations. Full M1–M5 remains active.

## M2m2 shared reviews — accepted locally

Read docs/SHARED_SELECTION.md before changing shared reviews. New subjects require explicit Owner confirmation and sealed invitation membership; never import private picks or combine Guest identities/feedback. Keep GUEST_SHARED_SELECTION_ENABLED=false and hard local-only. Metadata exposes only the caller's own guestId; mutations require expectedGuestId matching the cookie-derived identity and retain that witness across uncertain retries. Independent can_select/can_submit/can_view remain independent.0030 must preserve all existing data; keep append-only snapshots, commands, audit and forward-only recovery. Actual local backend acceptance includes two-distinct-Guest29→30, immutable submissions/history, permissions and audit rollback. Owner Chromium acceptance including native downloads has passed. Guest Chromium and the complete127-check Worker suite passed locally;0030 applied locally only (75 commands, none pending). Never claim hosted deployment passed. M1–M5 remains active.

## M2m1 current private selection policy and reopen repair

Read docs/SELECTION_POLICY.md before editing limits, selection page/cursors, submit or Owner reopen.0028 adds album-level minimum/maximum/revision and immutable Owner policy command/results; counts remain per invite/Guest/album. Defaults1/unlimited preserve old behavior. Policy updates require confirmation/CAS/current authorization and reject a maximum below any open draft. Guest pages include current selectionPolicy and independent canSubmit, and cursors bind policyRevision. Database checks new-key cap and submit min/max atomically; version changes/deselection and exact replay stay valid. Shared review subjects and the two-distinct-Guest29→30 race are still required; same-Guest sessions prove only private concurrency.

0029 supersedes M2j's zero-revision reopen: new retained rounds initialize at1 with selection.reopened.after_json evidence. Legacy open round>1 revision0 is advanced with a system selection.round_initialized event; sealed snapshots and old audit/results are retained. Historical replay may still return original0; GET selection gives current revision. Keep all flags OFF/hard-local; never roll code back to a zero-revision issuer with selection enabled. Local acceptance passed123 Worker checks,95 unit,61 integration and14 reference Chromium E2E, Next build and strict checks. See HANDOFF/VERIFICATION for actual commands and limits. Full M1–M5 and hosted gates remain incomplete.

## M2l current independent ratings/favorites

Read docs/GUEST_FEEDBACK.md before changing feedback schema, actions, queries or UI. can_rate(bit16) and can_favorite(bit32) are independent; API reads require only their own right, while the gallery UI still needs can_view. State belongs to the invite/Guest/logical photo with an exact version witness. Same-value no-ops retain an immutable result without a fake change event. Selection submission freezes its snapshot only; feedback stays independently mutable. Migration0027 atomically writes command/result/state/audit, preserves old data and enforces a previous_command_id chain against historical-witness rollback. Keep symmetric cross-ledger request conflicts, current ACL before replay, exact uncertain intent, bounded24-ID reads and shared Grid/Lightbox state. GUEST_FEEDBACK_ENABLED is defaultfalse and hard local-only. Local acceptance passed117 Worker checks,91 unit,61 integration and14 reference Chromium E2E; strict checks/build and final details are in HANDOFF/VERIFICATION. Retain full M1–M5 scope, immutable history and forward-only recovery.

## M2k current invitation entry flow

Read docs/INVITATION_FLOW.md before changing creation/share/exchange UI or capability routes. Owner creation lives inside the existing invitation manager and must preserve pending intent and one-time secrets when collapsed. All 12 rights stay independent; unavailable actions must be labelled. Share tokens belong only in /guest/albums/:id/enter#token=<bearer>, never path/query/storage/logs. main.tsx consumes and cleans the fragment once before StrictMode renders. Unknown Owner results keep the same UUID/exact payload even if a later retry is denied; metadata recovery never redisplays secrets. Unknown Guest exchanges must not automatically create another session; use explicit current-cookie access checks. Preserve synchronous duplicate-submit guards and success-navigation bypass of the unload warning. Defaults remain OFF and hard local-only; hosted acceptance remains open. Current local acceptance:112 Worker checks,88 unit,61 integration,14 reference-app Chromium tests, Next build, strict typecheck/lint, format,31-spec checker and diff check passed. Worker UI coverage is in test:cloudflare; final details are in HANDOFF/VERIFICATION. No migration is required; never remove existing0019/0022/0026 history.

## M2j current Guest selection flow

Read docs/GUEST_SELECTION.md before changing Guest selection reads, mutations, submissions, Owner review/export/reopen, permissions, schema or audit. The local Guest page browses the authorized album in 24-photo pages and hydrates its selected-state map across all selection cursors. Batch changes are sequential and limited to the currently visible page. On a stale revision or partial mutation failure, refresh from D1 before allowing further edits; never assume a multi-request batch is atomic. Logout retries must reuse the same stable request ID. Submit and reopen confirmation dialogs must retain keyboard focus, support Escape and Tab, and have no keyboard-inaccessible path. Owner routes list/detail/export submission snapshots; only the latest submitted round may be reopened. Successful CSV/TXT/JSON exports append `download.generated` before attachment response, without filenames/content; this proves server generation, not client receipt, and audit insertion must fail closed. GET /api/guest/albums/:albumId/selection exposes only own photo/version IDs under independent can_select (bit 8), without filenames/assets/audit/retention writes. PUT is version-bound and requires can_select. POST /api/guest/albums/:albumId/selection/submit requires independent can_submit (bit 512), takes no client photo list, and snapshots D1's exact selected versions. Owner reopen requires explicit confirmation and current Owner/session/album scope; preserve old sealed snapshots. Migrations 0024–0026 enforce current ACL, immutable snapshot seals and scope-stable, audited round transitions; the sequence is forward-only. All flags default off and reject non-local enablement. Full Guest permission-combination coverage, configurable selection limits, remaining action/history APIs and hosted service/deployment acceptance remain open. Verified local commands: test:cloudflare 109; test:unit 88; test:integration 61 after timeout correction; typecheck; lint; Next production build; 14 Next/reference Chromium E2E tests; format:check; 30-file handoff checker; diff check. Worker target UI browser flows are in test:cloudflare. Hosted services and deployment remain unchecked. Preserve all append-only data and never roll migrations back destructively.

# Shared Agent Rules — Kino Pick（奇諾選圖）

## M2h historical Guest gallery boundary

Read `docs/GUEST_GALLERY.md` before changing Guest photo reads, permissions, derivative delivery or retention. `GET /api/guest/albums/:albumId/photos` and `GET /api/guest/photos/:photoId/versions/:versionId/assets/:kind` use only the Guest cookie and repeat the current exact sealed album/session/Owner/state/expiry/revocation/`can_view` checks. The requested album must itself be in scope; preserve the same-query distinction between an authorized empty album and denied album. Only private verified thumbnail/preview JPEGs are streamed (size/checksum/output-slot checked, at most8MiB); never expose original keys or add Owner auth to Guest paths. Reads do not write audit events or refresh valid-human-view retention. M2j includes a local-only Guest selection screen and Owner submission review/detail/export/reopen UI/API; all remain behind the default-off, hard-local flag, and untested independent permission combinations remain a release gate.

## M2g historical Guest exchange boundary

Read `docs/GUEST_EXCHANGE.md` before changing Guest exchange or KDF behavior. Migration0022 and `POST /api/guest/exchange` are implemented for local workerd only; `GUEST_EXCHANGE_ENABLED=false` in every Wrangler environment and example secret file, and the Worker rejects enabling it outside `APP_ENV=local`. Guest and Owner scrypt share one D1-wide slot with immutable acquire/release/audit and no TTL. Rate/credential/scope/max-use denials share one generic401. Final eligibility, session, max-use and request-correlated audit are atomic. Session bearer is stored only as a hash and returned once via HttpOnly cookie after `first-primary` commit proof. A lost HTTP response cannot recover or reissue it; it may consume maxUses. Do not enable hosted exchange until native KDF cost/cancellation and real edge metadata are validated.

M2f historical: read docs/GUEST_ADMISSION.md.0021 adds reusable D1-clock counters/HMAC pseudonyms for network, network+invite and invite; unknown tokens consume network only. Limits count denials; singleton capacity caps bucket rows at100000 and Cron prunes oldest expired transient rows. The route contract is now implemented behind the local-only default-OFF gate; no hosted Guest exchange is enabled.

M2e historical: read docs/KDF_ADMISSION.md.0020 adds Owner admission; M2g adds the Guest immutable ledger and both share the same D1-wide single slot. Confirm acquisition before work, await the original native promise before release, fail closed on unknown outcomes. Never add TTL/time-based recovery or enable an older issuer bypassing the lock. Only quiesced operator repair may append the exact permit release. Hosted CPU remains unverified; all exchange flags stay false.

M2d historical: read docs/INVITE_ISSUANCE.md.0019 adds default-OFF/local-only Owner issuer and secret-free original-request recovery; six Owner ledgers must conflict before replay. Only a positive D1 insert plus candidate/token/verifier match may reveal fresh secrets. Never return secrets on replay, persist plaintext or auto-create a replacement after unknown outcome. BETTER_AUTH_SECRET rotation requires recovery GET, not old POST commitment replay. M2g adds local-only Guest exchange backend; creation/share UI and hosted KDF/throttle/concurrency acceptance remain open.

M2c historical: read docs/GUEST_CREDENTIALS.md.0018 adds Guest self-logout command/proof/request audit and strict NEW scrypt verifier shape; existing data unchanged. M2g adds exchange behind local-only/default-OFF gate. Keep exact-length/NUL/newline rejection, no algorithm downgrade, and preserve logout revocations/audit on rollback. Owner0017 guards remain unchanged; hosted CPU/concurrency remains unverified.

M2b historical: read docs/OWNER_INVITATIONS.md plus GUEST_ACCESS_FOUNDATION.md before Guest work.0017 adds current-Owner list/revoke API/UI and immutable cross-ledger request commands; preserve canonical guards with global conflicts before local replay.0016 Guest scope/session resolver remains. Later milestones add issuance, exchange, KDF throttling and logout; Guest gallery/actions remain absent. Never use a prior resolver snapshot to authorize writes; repeat ACL atomically with state/event. Preserve all current revocations and existing Owner-only /api/v1 gates.

> 本檔是 **Codex 與 Google Antigravity 共用的最高層專案指引**。不得由不同 AI 各維護一份相互矛盾的規格。

## 執行次序

1. 每次工作開始：閱讀 `docs/CODEX_ARCHITECTURE_ADDENDUM.md`、`README.md`、`docs/HANDOFF.md`、`docs/TASKS.md`、`docs/DECISIONS.md`，再閱讀本次功能對應的 docs。
2. 先檢查目前檔案、Git 狀態與未提交變更；尊重其他代理已完成的程式，不重建、不覆蓋。
3. 按 `docs/ROADMAP.md` 垂直切片實作：DB migration → API → UI → 測試 → 文件更新。每次以一個可驗證範圍為限。
4. 變更公共合約、資料表、權限、儲存政策前須先讀 `docs/STORAGE_RETENTION.md`，並同步修改 docs 和測試。不能以程式碼與規格長期不一致的狀態宣告完成。
5. 工作結束：執行可用的 lint/typecheck/test/build；更新 `docs/TASKS.md`、`docs/HANDOFF.md`，註明通過/失敗/未執行原因。不得虛構成功的測試。

## 安全與資料底線

- TypeScript strict；禁止 `any` 逃避型別。所有外部輸入以 Zod 驗證。資料庫必須開啟 RLS 或在可信伺服端實施等效租戶授權，兩者以測試證明。
- R2 Bucket 永遠保持私有。禁止將原圖公開網址、R2 主密鑰、Supabase service role key 送至瀏覽器。
- 影像上傳採臨時授權，驗證 object key、MIME magic bytes、大小、租戶配額、上傳狀態與 ownership；完成回報不得盲目信任客戶端。
- 任何照片被刪除、替換或提交挑片時要有 transaction/狀態鎖與可重試機制。所有會破壞資料的任務必須支援 dry-run。
- 客戶的每次挑選、取消、星等、收藏、標籤、標註、留言、版本核准等事件以 append-only log 紀錄；不能僅保留最後狀態。
- 無密碼分享連結是 bearer credential；不可讓擁有單一相簿連結的訪客自動看見其他專案。
- 用具唯一 object key 的新版本／衍生圖，絕不在 R2 原地覆寫舊版。版本切換須可追溯。
- 自動刪除必須 opt-in、先 dry-run、提供預估釋放量與刪除原因；依法須保留的內容不受自動清理影響。
- 不向 Git 提交 `.env`、API key、Cookie、下載連結、客戶影像。使用 `.env.example` 與專案密鑰管理。

## 技術基線

- Web：Next.js App Router、React、TypeScript、Tailwind、shadcn/ui、TanStack Query、Zod。
- 新部署目標（使用者 2026-10-23 明確授權）：Cloudflare Workers/Static Assets + Hono + D1/Drizzle + Better Auth Google/GitHub；REGISTRATION_MODE=closed、明確 Owner bootstrap、同一固定 users.id，禁止 Email 隱式合併。自訂 guest session 保持獨立。Worker 的 Vite/React target UI 只呼叫 same-origin API；API session / D1 仍是授權事實來源。
- 現有可運作參考：apps/web Next + Supabase/PostgreSQL、packages/db PG migrations 與原回歸保留至等效遷移驗收；舊 Auth 未被假稱已改為 Owner-only。
- Frontend 不無理由重寫：既有 React/Next UI 優先重用；CF-02c 的 Worker 入口以 Vite 靜態 React bundle 重用 workspace 與內容表單，Next reference 和獨立 vinext hosting PoC 仍保留。此入口只覆蓋已列明的 workspace/project/album 操作，不等於完整 UI 或產品 cutover。
- Storage：Cloudflare R2（private）；workers for image delivery and image processing；Queues / Cron for background tasks。
- Monorepo：pnpm workspaces；有需要時以 Turborepo 輔助，但不要為了工具化過度複雜。
- 測試：Vitest / Testing Library / Playwright；權限、事件 log 與自動刪除優先測試。
- Coding：採清晰分層和單一職責，資料存取只能走 repository/service；避免 UI 直接接觸高權限金鑰。

## 跨代理共用

- 所有事實以 Git 檔案為準，不依賴單一 AI 的對話上下文。
- Antigravity 應讀本 `AGENTS.md`；`GEMINI.md` 僅做導引。勿把 `.agents/workflows/` 當成唯一工作流程（舊 workflows 在部分新版已有遷移變動）。
- 永遠以相對路徑寫文件，不綁 Windows `C:\` 或特定電腦路徑；命令另說明 Windows PowerShell / macOS Linux 差異。
- 若有兩個 AI 同時工作，採獨立 Git worktree/branch；不得在同一工作樹同時修改同一檔案。
- 決策需記 `docs/DECISIONS.md`，交接需記 `docs/HANDOFF.md`，改動需記 `docs/CHANGELOG.md`。

## 交付格式（每次工作完成後）

- 完成哪些功能、修改檔案、migration 影響、執行指令與結果、已知問題、下一個最小任務。
- 完成標準以 `docs/TEST_ACCEPTANCE.md` 為準，不得用 UI mock 代替 API / DB 真實功能。

## Cloudflare 遷移執行規則

- 目標與現況以 docs/ARCHITECTURE.md、AUTH_SPEC.md、STORAGE_SPEC.md、DEPLOYMENT.md、HANDOFF.md 為準；同一 repository，不建立另一套無關產品。docs/docsCODEX_ARCHITECTURE_ADDENDUM.md 為使用者原附件，保留原狀；標準整合副本為 docs/CODEX_ARCHITECTURE_ADDENDUM.md。
- D1 migrations 在 apps/worker/migrations；不得把 packages/db/migrations 的 PG SQL 直接套到 D1，也不得覆寫其 checksum。D1 無 RLS/PG RPC，trusted Worker 必須驗 Owner/Guest/tenant，狀態/audit/CAS/replay 必須重建等效不變量並實測。
- Owner 不依第一個登入者或 email 建立。Bootstrap 只接受管理員外部驗證過的 provider subject，固定內部 UUID；CLI attestation 不等於 CLI 已向外部驗證。首次交易成功後鎖住 bootstrap；未完成 fresh reauth/last-provider guard 的 link/unlink 入口維持關閉。
- 單 private R2 node 預設啟用，credential_ref 不等於明碼。跨帳號須未來明確管理員啟用並確認條款/帳單；禁止宣稱多帳號免費疊加。新 D1 node 9GB 為內部配額；舊 PG 8GB 不自動改寫。
- Cron 每五分鐘處理過期 upload reservation：尚未簽發授權的 reservation 可直接回收；已簽發 R2 URL 的 reservation 必須先對同一 immutable key 建立並記錄原子 conditional fence，只有 fence 成功才可釋放 quota，TTL/HEAD miss 單獨不足以回收。每日 retention 事件仍是無刪除觀察，不是完整 retention preview。自動刪除 OFF/dry-run ON；完整 planner/locks/jobs/保護與重試驗證前不得開啟。不要由 Worker 中繼大圖或假設免費 Worker 可處理任意原圖/熱區。
- 每次涉及新目標必跑 pnpm test:cloudflare（實際 workerd/D1/R2＋測試 provider）；保留原 lint/type/unit/integration/build/browser checks。測試外部替身不是正式 Google/GitHub/R2 端到端驗收。
- GitHub Actions 僅 CI/CD；受控 deploy workflow 在 foundation 仍被 readiness guard 拒絕，不可為了讓 workflow 綠燈繞過 gate。正式 provider/資料搬遷/備份復原/上傳/費用驗證後另交付切換。不得推送/部署或碰客戶資料，除非該步驟已被明確授權。

- CF-02a now exposes D1 workspace create/read only (migration0003, repository, real local rollback/replay/page tests). Next UI/reference is unchanged. Before adding other D1 mutation types, extend workspace_commands to a shared actor/request/operation namespace and preserve current authorization before replay. CF-02 product/UI equivalence remains pending.

- CF-02b adds D1 projects/albums, shared `(actor,requestId)` ledger, revision/audit/protection/archive APIs (migration0004). migration test proves a live0003 workspace replay snapshot survives the upgrade. Existing Next/Supabase UI remains on its reference backend; implement same-origin UI port/browser acceptance as CF-02c before claiming CF-02 complete. New photos table is metadata-only; no upload/version API.

- D1 migration0006 rebuilds `audit_events` and preserves records to remove global `(action,request_id)` uniqueness; actor command ledger provides idempotency and `event_id` uniqueness protects each event. Before remote use, snapshot and rehearse the full table copy on a representative DB.

- Audit migrations0006/0007: remove global action/request collision by copying historical rows, then explicitly rebind all audit-writing triggers. Apply both together before traffic; large-table backup/restore rehearsal is required. The temporary legacy-name table in0007 is empty repair scaffolding, not retained audit storage.
- CF-03b migrations0009/0010 add Owner-only direct R2 authorization and verified completion locally. The signer binds create-once key, exact size/type/SHA-256; completion verifies R2 metadata/checksum/magic before immutable photo/version/asset records and quota conversion. A signed URL may be replayed until expiry, so cancellation/expiry must durably fence its key before releasing reservation; a missing HEAD or TTL alone is insufficient. Production/staging/local flags default off, and local Miniflare/browser evidence is not live R2/CORS validation. See latest HANDOFF, API_CONTRACT, STORAGE_SPEC and DEPLOYMENT.

## CF-03c1 historical upload boundary

Migration0012 stores raw encoded dimensions in new immutable versions/completions/audit; historical unknown dimensions stay NULL. Completion reads <=256KiB headers and checks32768 per side/80M pixels plus provider size/MIME/hash. This is structural inspection, not full pixel decoding. Browser preprocessing decodes bounded files, hashes <=64MiB, and produces transient320px JPEG previews. Init and authorize both require enabled/configured signing; every Wrangler flag stays OFF. Persistent derivatives/quota/jobs, trusted server decoding, gallery and reload-resume remain required next work. Current evidence is in HANDOFF/VERIFICATION; older no-upload notes are historical.

## CF-03c2 local processing boundary (historical; integration below)

`packages/image-processing` is Node-only: real sharp full decoding, scoped source verification, orientation/sRGB and metadata-stripped thumbnail/preview plus a create-once local CLI. Never import native sharp into a Worker or browser bundle. Local manifests are not processing attestations and must never be accepted from clients to authorize assets. D1 outbox/lease/derivative quota, private R2 writes and gallery remain unintegrated. Before that integration read LOCAL_IMAGE_PROCESSING.md: reserve before output writes, preserve reservation on unknown outcomes/lease expiry, use stable create-once output keys and atomic asset/audit/usage finalization. No new migration or remote data change in CF-03c2; all safety flags remain unchanged.

## CF-03c3 current durable processing boundary

Read `docs/PROCESSING_PIPELINE.md` before changing processing/storage/gallery. Migration0013 atomically enqueues NEW originals (no legacy backfill), creates fixed immutable output slots, and reserves16MiB against workspace/node only on claim. Token/epoch and D1-clock leases govern CAS finalization; unknown writes/expiry/review keep reservations. Final assets/actual usage/audit commit together. The explicit Node local runner uses `getPlatformProxy(remoteBindings:false)` and the native adapter; it is never invoked by a public manifest endpoint, request Worker or GitHub Actions daemon. Production runner/live resources remain gates. Owner gallery serves only verified thumbnail/preview through current-session scope and checksum checks; private originals remain unexposed. No valid-view heartbeat or destructive review cleanup yet. Future remediation must fence every possible output key before releasing capacity. Every upload/multi-account/autodelete flag remains OFF and dry-run ON; preserve0013/history/counters on rollback, repair forward.

CF-03c3 forward migration0014 repairs archive upload/processing busy guards: current Owner/session authorization must precede resource-state inspection, while existing actor/request IDs defer to replay/conflict guards. Do not restore the faulty guards on rollback. Regression covers archive→restore→new pending work→historical replay, conflicting payloads and invalid sessions.

## CF-03c4a historical processing review boundary

Read PROCESSING_REVIEW.md. Review GET/UI is advisory and read-only; derive exact slots from D1 and recheck current authorization after storage inspection. The trusted conditional fence helper has no API/CLI/Cron write caller and never releases quota. Keep both permanent fence keys forever, including lifecycle exclusions. Before releasing capacity add a real abandoned terminal state plus guarded immutable Owner/session/request resolution ledger, symmetric global request conflicts, atomic two-level quota/audit and populated-FK migration tests. Never leave a needs_review16MiB job after decrementing aggregate reservations.

## CF-03c4b current review resolution

0015 adds abandoned and an immutable globally scoped Owner/session/request resolution ledger. Both primary output keys must have exact permanent empty fences before atomic reserved0/two-level release/audit. Keep fences forever (including lifecycle exclusions), preserve originals and used bytes, hold capacity on occupied/unknown/readonly. Read PROCESSING_REVIEW.md before changing this. Pre0015 writer/UI rollback is incompatible; stop runners and repair forward or restore a verified consistent DB/R2 snapshot. Next upload reload-resume.

## CF-03c5 upload recovery boundary

Read UPLOAD_RECOVERY.md. Persist allowlisted metadata/operation UUIDs only before mutation, never File/preview/signed URL/auth secrets. Actor/full-scope Web Lock and queue generation guard stale callbacks; browser mutation actor expectation is enforced by Worker. Restore via original init ID canonical read, then explicit file reselection/hash verification before PUT.7-day window is last-write metadata inactivity, not renewed upload authority or automatic physical deletion. Fail closed on journal write failure, scope mismatch or expired authority; no implicit new reservation or quota release.0015 remains latest; next M2 D1 invitation/guest-session/independent rights/cross-project tests.

## 2026-10-29 — CURRENT: human-photo heartbeat accepted locally; one-client approval confirmed

This appended entry supersedes earlier same-day statements that no heartbeat endpoint exists or that the one-versus-all question is pending. Owner/Guest visible-photo heartbeat is implemented through0053 native append-only witnesses/monotonic album activity/audit,scoped repositories/APIs and existing Gallery grid/Lightbox image wrappers. Default HUMAN_VIEW_TRACKING_ENABLED=false/hard-local.0053 SOURCE ONLY;default persistent D1 stays0052. Auto-deleteOFF/dry-run;no R2/quota mutation or deployment.

Final isolated `apps/worker/.local/human-views-focused-final.log` exited0:3 API groups +2 controlled375px Owner/Guest browser flows using the real existing upload/R2/Sharp fixture. Exact immediate rolling dedupe/deadline,authority/origin/visibility denials,forged actor/audit/projection/log guards and injected audit rollback pass. Management list/unloaded/hidden/subsecond/blur do not count;continuous visible images count;preview shares cooldown. Headless focus/visibility is controlled,not native headed or actual five-minute wall-clock recapture proof.11 scoped contract tests,13 retention safety tests,final Worker/UI build,generated bindings,root/Web strict and scoped lint pass. Acceptance:worker .local/human-views-acceptance.json. Failed DDL parentheses/test-JS-hold/Web-regex strict logs remain preserved. No broad suite was repeated.

New safety requirement: activityEvidenceVerified is mandatory in pure retention input;unknown legacy/offline/untracked periods exclude with activity_unverified. Missing last-view data must not imply never viewed. Heartbeat alone does not provide continuous coverage,state-change/policy/reference completeness or deletion authority. See docs/HUMAN_PHOTO_VIEWS.md for exact files,evidence,recovery and gaps.

User confirmed「其中一人代表確認即可」:any one authorized client may confirm a fixed version. This resolves the prior question;do not ask again or require every anonymous visitor. Next implement explicit Owner-authorized immutable request/invitation/Guest confirmation and fixed delivery manifests;retain full retention policy UI/preview/persistence/locks/recheck/retry and remaining M1-M5/hosted scope. Before0053 persistent adoption use fresh backup/isolated upgrade/live parity. Preserve unrelated dirty edits;no commit,push or deploy.

## 2026-10-29 — CURRENT follow-up: append-only REPLACE and equal-clock safety accepted

This extends/supersedes the earlier three-group human-view checkpoint:the final focused native run `apps/worker/.local/human-views-replace-safety.log` exited0 with4 API groups +2 controlled375px Owner/Guest browser flows.0053 now rejects duplicate event_id OR request_id before INSERT,so SQLite REPLACE cannot bypass append-only delete guards. Projection upsert is attempted only for an advancing frontier;two valid same-millisecond events both remain in log/audit while the maximal timestamp/UUID witness stays canonical. Native replacement/event/request/projection and equal-clock cases pass. Final test fixture selects the known non-frontier witness for timing stability;scoped lint passes. Evidence `apps/worker/.local/human-views-replace-acceptance.json` preserves the earlier checkpoint and its log rather than rewriting evidence.

0053 still SOURCE ONLY;default D1 stays0052,tracking OFF/hard-local,automatic deletionOFF/dry-run. activityEvidenceVerified must cover the policy's decision window;missing legacy/offline data is never proof of inactivity. Future deletion must separately protect in-flight authorized reads/downloads and the first1s visibility qualification window,without renewing the30-day timestamp for preloads. No physical deletion/hosted acceptance claim. User's one-authorized-client representative version approval rule is confirmed and next for implementation;fullM1-M5 remains active/incomplete. All existing document history and unrelated dirty changes are preserved.

## 2026-10-29 — Version confirmation handoff

Current details and verification are in docs/HANDOFF.md. Owner-authorized one-Guest fixed-version approval is local-only/default OFF; 0054 remains source-only. Isolated D1, API and Chromium checks passed; no hosted provider E2E or persistent migration. Do not enable without 0053/0054 backup/restore and parity rehearsal; retain immutable version and audit history. Continue delivery manifest and safe retention work.

## 2026-10-29 — Album sharing handoff

See docs/HANDOFF.md. Album cards can open the existing invite composer with an active album preselected. A focused isolated browser test covers exact scope and pending/one-time-secret preservation; full smoke after this UI change and hosted provider verification remain pending. Keep incomplete delivery SQL draft outside auto-applied migrations.

## 2026-10-29 — Before/After handoff

Guest slider direct drag and idle hint are implemented and locally tested; Owner comparison, hosted authorization/provider E2E and complete regression remain pending. See docs/HANDOFF.md for exact gate and validation boundary. Preserve private preview access and independent Guest comparison rights.

## 2026-10-29 — Owner comparison handoff

Owner and Guest now share the visual comparison canvas with separate authorized data loaders. Owner pinned currentVersion and cursor/tenant safeguards and the isolated 13-check Owner browser/API run are documented in docs/HANDOFF.md. Keep default-OFF local gates, immutable versions, Guest privacy and no-deletion protections; full regression/hosted acceptance and delivery remain open.

## 2026-10-31 — GitHub / Cloudflare B deployment connection

The private repository is https://github.com/kinostudio/kino-pick. Only this repository has the B deployment secrets. User explicitly approved a no-expiry account-owned token scoped to B: Workers Scripts Write, D1 Read, R2 Storage Read and Account Settings Read. Actual Actions resource verification run41114135793 passed. Do not copy credentials into source or broaden access to A/FILM.KINOSTUDIO.

Source publishing uses a separate codex/cloudflare-b-deployment snapshot ref; the existing codex/kino-pic-foundation worktree/index is preserved. The physical folder remains KINO Pic because Windows refused its rename; product display name is Kino Pick. The exact annotation_freehand_geometry_v1.sql fixture stays review-only under migration-proposals and is included for isolated tests; other incomplete migration drafts stay excluded.

The website has not been deployed. Existing closed cutover guard and hard-local/default-OFF feature gates still apply. Next complete real OAuth/Owner bootstrap, staged schema/backup/restore and hosted security/provider acceptance before a reviewed cutover; resource connectivity alone is insufficient. See docs/HANDOFF.md for final CI evidence and remaining tasks.

## 2026-10-31 — Current execution objective

Follow docs/MVP_RELEASE_PLAN.md and latest HANDOFF: publish and verify an actual online Kino Pick MVP on Cloudflare B, preserving all product/security requirements. Existing61-minute heartbeat is ACTIVE; every run must deliver the highest-priority concrete release slice with minimal necessary validation, not only documentation or repeated full tests. Current R0 source inventory is complete; next R1-01 HTTPS origin/OAuth/Owner bootstrap. Keep closed cutover guard until evidence-backed replacement; do not remove hard-local guards globally, modify A/FILM.KINOSTUDIO, print secrets or apply draft SQL.

## 2026-10-31 — Staging OAuth handoff

GitHub OAuth App3979161 and its approved Secret are saved locally (ignored,ACL-protected) and in B staging encrypted bindings. kino-pic-staging is currently an infrastructure-only503 container with no public/preview URL,data binding or product code; never run auth-provisioning config over the future app. This is not real OAuth or online MVP acceptance. Read docs/STAGING_AUTH_PROVISIONING.md and latest HANDOFF; next isolated schema/restore/parity then prepared Owner bootstrap and controlled auth validation. No repeat approval or Secret request. Preserve existing closed product gate and A/CMS resources.

## 2026-10-31 — Current cloud foundation accepted

Read docs/STAGING_DATABASE_AUTH_ACCEPTANCE.md/latest HANDOFF. B staging54 migrations,one fixed Owner,independent cloudD1 restore134-table parity and realGitHub login/logout are verified. Public auth rehearsal URL is closed again;not product/MVP. Do not rerunOwnerbootstrap or provisioning;preserve immutable migration/audit and A. NextR3 needs pending isolatedB IAB login for S3 signing credentials (CLI tokenmetadata403;prior testfiledeleted);do not repeat request. Work independently on realCloudflare Images adapter/newrecipe rather than pretending localSharp can run inWorker. Original product/production gate remains closed;Google/link/fullsession/R2consistentrestore and productflows remain pending.

## 2026-10-31 — Current R3 handoff

B login and bucket-only R2 credential creation/storage are completed with user approval. Real S3 PUT200/replay412/hash-matching GET200 and signed CORS allow204/foreign403 pass. Native Images binding also generated and verified two private synthetic derivatives via real remote development. See latest HANDOFF for exact proofs and limits. These are capability checks, not product/100-photo/hosted MVP acceptance; public entry remains closed and private_direct_upload_verified remains false. No further key/login request is pending. Next implement the genuine Cloudflare recipe/adapter plus compatible durable-job migration; retain immutable Sharp recipe, quota/source/output guards and draft-SQL exclusion. Keep A untouched, auto-delete OFF/dry-run. gh works outside Wrangler-isolated XDG; prior CI41118459908 completed/success.

## 2026-10-31 — R3 actual Cloudflare Images adapter implemented

Previous source21fa484 CI41135636903 completed/success (all steps including isolated auth validation). Implemented the existing image-processing interface with distinct cloudflare-images-jpeg-82-v1 recipe; extracted/reused animation checks without changing Sharp behavior. Strict snapshot/hash/raw dimensions,16MiB internal source cap, sequential bounded output streams/cancellation, progressive-scan metadata stripping and provider-error sanitization are implemented. New7+old10 focused tests pass; scoped lint/rootstrict pass. Real B remote-development now invokes this adapter and returned200 with two private checked derivatives; proof worker.local/cloudflare-images-adapter-result.json. Probe stopped; no product/DB/A changes. See docs/CLOUDFLARE_IMAGE_PROCESSING.md for limits and exact next migration/recipe integration. It is not registered in the product: existing64MiB upload ceiling and immutable Sharp job recipe must be reconciled explicitly before activation. No normal-size hosted/100-photo/MVP claim; product gate and auto-delete remainOFF. This slice contains no migration to apply or customer-data change.

## 2026-10-31 — R3 compatible processing migration adopted in B staging

Read docs/STAGING_PROCESSING_ACCEPTANCE.md.0055 now exists and was applied ONLY to B staging after fresh backup, isolated native populated8-group acceptance and an independent cloud restore+upgrade. Remote staging ledger55;133 original product tables unchanged,FK0,schema equals independent upgraded cloud DB66bba5de-c020-40a5-b8a0-f2431bc8f781. Public entryfalse;default local persistent D1 still0052. Never regenerate/overwrite applied0055 or run the old54-only rehearsal against the55 source tree.

New persisted per-workspace Owner policy API/UI, exact-recipe claims/review keys,16MiB Cloudflare admission and bounded durable upload-wake/Cron integration are implemented; cloud runtime defaultsOFF/production activation guarded.20 scoped unit tests,8 native/API/mobile groups,rootstrict/scopedlint and Worker/UI build passed; real cloud full upload/Images/gallery100-photo flow remains pending. Fresh protected exports and proof paths/recovery/failed diagnostics are in the acceptance doc. Main product gate and unfulfilled readiness remainclosed;auto-deleteOFF/dry-run,single-node. Previous cdddc19 CI41139959773 passed;new source requires one CI run. User selected pick.kinostudio.tw and confirmed DNS in A;no A/DNS change has been made. Next gated hostedOwner upload/Images/gallery acceptance and D1/R2-consistent restore; do not rerunOwnerbootstrap or request keys already saved.

## 2026-10-31 — CURRENT: B staging56; upload/processing/gallery integration accepted in isolation

Supersedes prior55-only checkpoint:0055 remains immutable;0056 adds reciprocal Owner request namespace and bounded Cloudflare IO-review guards. Actual B staging AND independent rehearsal DB now have56 migrations; fresh private backup/parity/FK0 passed,135 existing product tables unchanged and public/preview entryfalse. Details/recovery: docs/STAGING_PROCESSING_ACCEPTANCE.md; protected `.local/staging-0056-apply-proof.json`. No A/DNS/customer/default-local mutation.

Final focused20 unit checks and10 isolated native/API/mobile groups pass, including atomic migration rollback, old job preservation, Owner policy persistence/replay/collisions/tenant denial,16MiB quota-safe refusal, V1/V2 completion-aware busy lock, Cloudflare recipe claims and review fences, three transient failures→IO review with reservation retained, private derivative/gallery finalization and375px save/reload. The integration uses a Sharp-backed Images double; earlier real Cloudflare adapter probe is separate. Worker/UI build,root/Web strict and scopedlint pass; full-chain test harnesses now use official split+atomicbatch for the larger migration. Production/cloud flag defaultsOFF and release gate remainsclosed.

Next concrete task: push this source, verify its single CI run, then create a narrowly gated hostedOwner B upload validation with native Images/private R2/gallery/100 test photos and D1/R2-consistent restore. The updated product Worker itself has NOT been deployed; remote schema success is not hosted product acceptance. Preserve missing Google/link/session/Guest/version/delivery/security requirements and do not mark MVP released. User-selected production hostname is pick.kinostudio.tw in A; existing staging callbacks stay unchanged. Prepare hostname-only entry routing without root/NS/existing A deployment changes and resolve exact permissions before applying. No repeated credential/login request needed.

## 2026-10-31 — Owner hosted-upload validation prepared; CI hold enforced

Added a closed-by-default B-only staging upload validation entry/config, reusing actual product Owner auth/API/UI with only direct upload/Cloudflare processing enabled. Guest routes/registration/production/foreign host+Origin are rejected;no original feature guard is removed. Actual dry-run/rootstrict/scopedlint pass and14 isolated route/static/denial checks pass. Images is a presence double here;not a provider/hosted upload result. Read docs/STAGING_UPLOAD_VALIDATION.md.

Added scoped tools/check-staging-upload-validation.mjs coupling adopted56/independent restore,Secret names,exact tested bundle and successful core CI plus unchanged backend/UI via temporary index. Actually ran it: CI41147833540 at6709d0b is stillin_progress,so gate correctly refused. No deploy/public-entry/DB/R2/A/DNS change this heartbeat. Prepared source is local/unpushed pending the existing CI outcome;preserve it. Next check only that run,fix any actualfailure,then refresh safe CI metadata and proceed with exact scoped preflight/publication/controlled hosted Owner validation. No new credential/login/useroperation is required now. Do not claim MVP release or private_direct_upload_verified.

## 2026-10-31 — Core CI finalized; restricted Owner upload preflight passed

CI41147833540 completed/success for6709d0b with no failed steps. Refreshed actual safe CI metadata and ran scoped tools/check-staging-upload-validation.mjs:passed_owner_upload_staging_preflight. Backend/UI inputs match accepted CI through a temporary index;config/source/bundle match the14-check native validation and adopted56/independent-restore proof. No production deployment is authorized by this gate. The new Owner-only entry/config/checker are ready for exact source publication and CLOSED B deployment,then metadata/denial checks before controlled public staging validation. Do not call this hosted product or100-photo acceptance yet;existing main product/production guard and readiness remainunchanged. A/DNS unchanged. Native Owner boundary check added to CI without rerunning broad suites locally.

## 2026-10-31 — CURRENT: 真實 hosted Owner／100 張 R2＋Images 圖庫驗收通過

B 的 Owner-only staging 已實際部署，來源 `7be9f78496103076f110a4f9e58e96788265f1da`，Worker version `1441d058-27f1-44e8-9440-4861f88d7f47`；CI41154235653 completed/success。真實 GitHub Owner 登入後，以產品介面建立測試 workspace/project/album，五批各20張合成JPEG經瀏覽器私人R2直傳及原生Cloudflare Images完成。100 jobs succeeded、300 assets、reserved0；全部300個物件GET/byte/SHA檢查通過，200衍生JPEG完整解碼、320/2048尺寸及比例、metadata移除與10張EXIF6方向通過。實際Edge圖庫24→48→72→96→100、100個唯一檔名／全部縮圖載入；直式1000×1600與下一張橫式1600×1000燈箱、關閉操作通過。匿名私人縮圖401，原7項hosted邊界通過。

這是受限 staging Owner 流程，非完整MVP。`private_direct_upload_verified`仍不提升為完整發佈就緒：跨租戶／配額故障hosted、含R2的備份復原及Guest等要求仍需完成。詳細scope/證據/復原下一步見 docs/HOSTED_100_PHOTO_ACCEPTANCE.md。D1已有新受ACL保護的匯出，尚未獨立restore，R2物件尚未備份。public staging目前enabled、previewfalse；其他產品feature仍OFF，無Cron／production／A／DNS改動。既有production gate保持closed，自動刪除OFF/dry-run，單R2節點。

下一切片：先完成這100張資料的D1＋R2一致備份與獨立復原，再修正Cloudflare政策16MiB但UI顯示64MiB／未設定Google仍顯示可點登入的能力宣告，依序完成真實雙OAuth綁定與Guest/版本/交付hosted驗收。不要重傳100張、重建Owner、重套0055/0056或重問憑證。保留原worktree/index與未提交變更。

## 2026-10-31 — Current restore handoff

Read docs/HOSTED_SNAPSHOT_RESTORE.md and latest HANDOFF: actual independent B D1/R2 snapshot data restore passed;source DB/bucket/A unchanged. This is not runtime cutover or fullMVP. Preserve protected backups,all guards,OFF/dry-run and single-node default;never tail raw Wrangler export output (signed URLs). CI41162510021 failed in Guest browser dispatch;complete the narrow test lifecycle fix/new CI before proceeding. No credential/user action pending.

## 2026-10-31 — Current upload capability handoff

Read docs/WORKSPACE_UPLOAD_LIMITS.md/latest HANDOFF. Previous0de1d3c CI41164775708 passed;newworkspace16/64MiB API/UI source passed focused4unit/native10/root-Webstrict/scopedlint/build but is not deployed. Next verify its single CI then refresh exact scoped staging boundary/bundle/preflight before deployment;never bypass product gate or reuse old backend proof. Retain real100-photo/consistentrestore evidence andA unchanged.

## 2026-10-31 — Current Guest CI blocker handoff

Read docs/GUEST_ENTRY_TRANSPORT.md/latest HANDOFF.7ee CI41171466586 failed Guest entry timeout;native six-case focused runner reproduced the route cleanup hang and now passes using body-drained loopback HTTP,keeping53assertconditions and precise singlePOST. NewfullCI stillrequired beforeB staging. Productbackend/UI unchanged;noA/customer/schema/flag changes. Preserve100-photo/restore evidence;no credential/user action pending.

## 2026-10-31 — Current hosted Owner acceptance

Read docs/HOSTED_UPLOAD_LIMIT_ACCEPTANCE.md/latest HANDOFF.6e94262 fullCI41176275152 passed and B restrictedOwner pilot deployed as c673b93a-401f-4c57-bfca-d0438e076031 with exactbundle/7hostedboundary proof. RealOwner16MiB UI/17MiB rejection+unchangedquota/privateGrid/portrait/anon401 passed. Guest/production gates remainclosed,auto-deleteOFF/dry-run,single-node;A/DNS/customer/schema untouched. Next boundedGuest-hosted promotion and Google availability UI;do not reupload100/restore/Ownerbootstrap or globallyremoveguards.

## 2026-10-31 — Current OAuth availability handoff

Read docs/OAUTH_PROVIDER_CAPABILITIES.md and latest HANDOFF. Current Worker login now advertises only fully configured providers;shared backend predicate,read-only endpoint and closed loading/error UI implemented. Unit3/root-Webstrict/build/scopedlint and native20 boundary+Chromium checks passed locally;not yet new hosted acceptance. New exact-source CI/publication required before B redeploy. Existing publicOwnerpilot6e94262/c673b93a remains unchanged,Guest/production closed. Guest service/scope promotion inventory is docs/GUEST_HOSTED_PROMOTION.md;never open rawflags or setlocal onhost. PreserveA/DNS/customerdata,OFF/dry-run,single-node and previous100-photo/restore proof. No credential/user action pending.

## 2026-10-31 — Current hosted OAuth availability

Read latestHANDOFF/OAUTH_PROVIDER_CAPABILITIES.md.5e5ac8b fullCI41184396089 passed;B Owner-only version6ab7a8fc-247e-46f3-8858-7a5ec914c768 deployed with exactbundle/10liveboundary checks. IndependentanonymousIAB GitHub-only UI and existingEdgeOwner session passed. No newOAuth/Google/link or fullMVP claim. Guest/production remainclosed,OFF/dry-run,single-node,A/DNS/customerdata unchanged. Next boundedGuest service+asset scope using GUEST_HOSTED_PROMOTION.md;no newCI/credential/user action pending. Include current local acceptance docs with nextcode,avoid docs-only CI.

## 2026-10-31 — Current closed Guest handoff

Read latestHANDOFF/GUEST_HOSTED_PROMOTION.md. Scoped Guest services/API/UI and closed entry/config implemented;unit10/nativeGuest19/full56migration and Ownerfallback20/root-Webstrict/build/scopedlint pass. Not deployed,not hostedGuest. Product lacks audited draft→active album operation;next implement compatible activation migration/service/API/UI/recovery before any real Guestopening. No directSQL bypass. ActualOwnerpilot remains5e5ac8b/6ab7a8fc,Guest/production closed,OFF/dry-run,single-node,A/DNS/customerdata unchanged. NewexactsourceCI stillrequired;no credentials/useraction pending.

## 2026-10-31 — Current activation implementation

Read ALBUM_ACTIVATION.md/latestHANDOFF. c1CI41188887091 passed. New0057/service/API/OwnerUI/defaultOFF flag andclosedOwner-onlyactivationprofile implemented;native13/Owner20/Guest19-on57,contract3/gate7/root-Webstrict/build/scopedlint pass. No remoteDDL/deploy/activation yet;Bstill56/draft/100photos/300assets,Ownerpilot5e/6ab7a8fc. NextnewsourceCI thenfreshisolatedcloudrestore+0057upgrade/parity/adoption andrealOwnerUIactivation;neverrawUPDATE. PreserveA/DNS/customerdata,allproductrequirements,OFF/dry-run,single-node;no credential/useraction pending. Do notredeployGuest until auditedactivationandhostedgates fulfilled.

## 2026-10-31 — Current real activation and UI parity handoff

Read latest HANDOFF. aa8b743 CI41194080987 success; actual B independent restore+0057upgrade/source adoption passed, source now57 immutable migrations. B Owner-only activation version0ff58553-e642-47f5-93dc-cbd2ae36ccd7 exactbundle verified,10hostedboundary checks passed. Real Owner UI activated only fixedsyntheticalbum draft/rev1 toactive/rev2,command1/audit1;100photos/300assets unchanged. GuestflagsOFF, noCron,OFF/dry-run,singleR2,A/DNS/customerdata untouched. FullMVP incomplete. User flagged prototype/live UI mismatch:4174 experiments/gump-demo is independent memory-only mock;deployed apps/web/target-ui has realAPI but lacks prototype visual shell. Next reconcile existing functional target-ui presentation with prototype;never substitute demo for realauth/data. Preserve all functional/Guest/security gates and protected proofs. No credential/useraction pending. Include ops/docs in next real source publication;avoid redundant docs-onlyCI.

## 2026-10-31 — Prototype visual integration review

正式 target-ui 已整合工作台／專案相簿／單張照片的prototype主題與版型，保留原API與授權／工具元件。build/rootstrict/scopedlint/format與本機桌面、375px導航和圖片比例檢查通過。確認 http://127.0.0.1:4180/dashboard 為serve正式build的隔離fixtures唯讀預覽，非雲端驗收；工具tools/prototype-integration-preview.mjs，證據.local/studio-visual-integration-proof.json。詳見latestHANDOFF。使用者要求先看版型；尚未push/deploy，B仍aa8/0ff58553，Guest閉鎖、OFF/dry-run/singleR2、A/DNS/customerdata不變。先依版型回饋修正，再新來源CI與B部署閘門，勿把此預覽當正式MVP。

## 2026-10-31 — 統一正式前端、透明 Logo 與真實 API 介面驗收

目前預設 pnpm dev/build/start 已統一為 Worker + apps/web/target-ui；v11 Logo 無外框實心底。Next／gump-demo 僅為歷史參考，4174 只轉址4180。舊「4180 fixtures 預覽」紀錄已過期；現在 http://127.0.0.1:4180/__review/login 是正式前端搭配隔離真實 Miniflare D1/R2／57 migrations／Sharp，不是雲端 OAuth。8照片、27assets、9處理工作。不得將本機結果當 hosted 或完整MVP驗收。

逐頁外觀／操作／真實API證據與未完成項目，請以 docs/FRONTEND_INTEGRATION_ACCEPTANCE.md 及 docs/HANDOFF.md 最新節為準。保存單一產品前端，保留所有原需求與既有授權／審計／重試。攝影師metadata推薦、freehand正式schema、固定交付、帳號綁定及hosted Guest仍待完成。新來源CI與B部署閘門通過前不部署；B基線aa8b743/schema57不變，A/DNS/客戶資料未改，自動刪除OFF/dry-run、單R2。

## 2026-11-01 — 當前接續點

使用者已要求必要驗證後直接部署B，無須重問原型版型確認。攝影師推薦／XMP原圖讀取與0058手繪、0059metadata正式接線已實作並有本機native／API／瀏覽器證據；仍未採用到B。請讀HANDOFF最新節、PHOTOGRAPHER_RECOMMENDATIONS.md、FREEHAND_ANNOTATIONS_MIGRATION.md，以及 docs/diagrams/kino-pick-architecture.html。先完成精確B協作profile／來源CI／fresh57獨立還原升級parity，再source採用與部署；不能拿本機證據當hosted驗收。B尚schema57，A/DNS/customerdata不動，OFF/dry-run/singleR2。
