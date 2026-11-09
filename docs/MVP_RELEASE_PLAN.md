## 2026-11-09 G2：Owner清理來源層，6項本機通過

接續c778c13，D1RetentionAlbumFacts以同一Owner/session/workspace DB快照讀真政策/獨立policyRevision、時間、資產/版本/已回收0bytes、自訂分享與既有blocker。最終2檔6項（含真D1/R2回收、產品分享/撤銷與政策45→46→45）及strict/lint/format通過；詳見docs/G2_RETENTION_ALBUM_FACTS.md與releases/retention-album-facts-local.json。不提供新API/UI、健康或活動覆蓋flag；不是完整planner/G2。沒有新schema、CI、雲端或部署；既有待答覆授權不重試。下一步仍為活動覆蓋/完整保護引用來源與Oracle系統對帳，然後正式planner/API/UI與發布守門。A/Review/客戶資料不動，自刪OFF/dry-run，R2優先/Oracle30GB維持，GOAL active。

## 2026-11-09 G2-04：primary全節點持久收據，本機35項通過

接續118e795，在未套用proposal0070加入同源node狀態view、2個node索引、immutable global收據及審計；舊workspace收據與clock SQL已逐byte核對不變。D1NodeStorageReconciliationReceipts／recordPrimaryStorageReconciliation以真root listing生成收據，current重新授權、核對來源epoch/hash/count/bytes及從掃描開始五分鐘時效；不更新last_reconciled_at，也不把收據當cleanup grant。Oracle系統key未納入來源，因此服務與SQL都拒絕其global收據，未假稱全面對帳。

最終5檔35項（9新service、18reader/真SQLite query plan、6舊workspace schema、2真本機D1/R2）通過；lint修正後變更的9單元亦重跑通過，root strict/scoped lint/format及前端/Worker dry-run通過。Native驗真writer/current、審計scope=node/workspaceNULL、寫收據不刷新自己的epoch、預留→取消ABA與回收使舊收據失效、重新核對保留零標記及另一workspace；直接SQL負例保留。審查發現原view全node掃描及SQL鍵長守門缺口，已改每node限20,001筆＋索引，query plan明確驗證，並補DB鍵長上限；初稿／fixture／lint失敗保留。

證據docs/releases/node-storage-receipts-local.json與G2_NODE_STORAGE_RECEIPTS.md。proposal仍未進active migrations；local69／最後已驗B67，不作雲端DDL／CI／部署，不重試待答覆的B登入、具名restore或Caddy操作。既有node/core/Native證據只對應各舊來源，不能當新版完整release。下一步仍須Oracle system/未分類比對、完整活動覆蓋與Owner真snapshot／正向planner；新收據不補齊這些缺口。自刪OFF/dry-run、無Cron、R2優先／Oracle30GB，A／Review／DNS／客戶資料不動；GOAL active。

## 2026-11-09 G2-04：跨工作空間節點盤點接線，本機71項及Oracle唯讀觀測通過

接續8bd6bf3，新增D1NodeStorageInventoryRepository與reconcilePrimaryStorageNode內部入口，只准enabled bootstrap Owner；全節點registered manifest涵蓋所有workspace，SQL先限20,000物件／4MiB keys再傳payload，沿既有reclaimed→0bytes算式，要求proposal70單調epoch、hash後同epoch重新授權。既有workspace與node盤點共用bounded scanner但scope嚴格分開；node以真正R2 root list不帶prefix核對，不能拿單workspace結果冒充全節點。沒有API/UI/flag/新DDL，也沒有healthy或deletegrant；global結果尚未持久化。

最終6檔71項（41原workspace core＋11node core＋16reader mock＋3真本機D1/R2）、6個Python巡檢測試、root strict、scoped lint/format、正式前端/Worker dry-run通過。Native69＋proposal70，真primary跨兩workspace／工廠入口／陌生物件拒絕／回收保留0bytes標記／一般workspace收據與非bootstrap擁有者拒絕皆過；合法primary預留先阻擋後由產品取消。ASTRA發現workspace總reserved誤擋其他node，已改節點歸屬及all-node實際upload+processing總帳核對；真Oracle預留fixture仍被0065容量guard拒絕，未偽造health或放寬，僅單元SQL/靜態核對該分支，原生Oracle歸屬與populated upload_key_fences未驗。

另以既有SSH/桶身分在VM localhost唯讀列舉Oracle：22物件／93,292bytes，14件具UUID-prefix外觀／2系統key／6尚未分類（21,454bytes）。未帶出keys/credentials、未寫刪任何物件，也未修改待授權Caddy公開路由。這不是B DB比對或atomic/global receipt，UUID外觀不代表DB已有登記，未分類不代表可刪垃圾；內容bytes亦非VM實體磁碟用量。

證據docs/releases/node-storage-inventory-local.json與G2_NODE_STORAGE_INVENTORY.md；舊core/inventory/native來源證據保留為各舊checkpoint歷史，不套到改過的檔案。候選已驗含既有10e79694頁籤正式來源祖先，未退回舊UI。下一步仍需正確Oracle system/unclassified對帳、global持久化證據、完整活動覆蓋及Owner真snapshot/候選；不能以這份內部manifest稱G2完成。沒有重試雲端B授權／具名restore／Caddy待答覆操作，沒有DB遷移、CI或部署；A／Review／DNS／客戶資料不動，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB；GOAL active。

## 2026-11-09 G2-04：私人讀圖短期保護接線，本機35項通過

接續30175ac，在正式Owner/Guest縮圖與預覽GET共用openGalleryAsset，沿既有.asset授權→DB短期保護→原儲存/size/SHA/MIME核對→再次授權及相同資產核對→保護重驗後回傳；後段失敗取消未讀body。OFF保持原授權次數及Owner/Guest原錯誤碼。ALBUM_READ_PROTECTION_ENABLED在三個Wrangler環境及範例均OFF；沒有新API／權限、雲端變更或部署。

proposal0071新增每相簿一列、無actor/session/token的近期讀取保護；DB15分鐘TTL、14分鐘續期門檻，每分鐘至多一次實體列更新，但每張圖ON有兩個三陳述D1 batch，不能說沒有成本。最後SELECT至少839秒餘裕，容許1秒時間差而非D1延遲保證。保留完整0069刪除blocker view並加入DELETE_ACTIVE_REVIEW，防止進入deleting／開始job；已有刪除則拒絕保護。新保護不是人類瀏覽、不更新idlefrontier或審計，不是stream/presence lease；串流或已解碼照片可超過期限，無row不證明無人使用。

最終4檔35項（9service＋12共用helper/真Worker路由但mock授權repository＋13原Human契約＋1真Miniflare D1）、root strict、scoped lint/format及正式前端/Worker dry-run通過。Native全69＋proposal71、5空相簿／零照片／零R2payload；真正Owner刪除preview顯示近期使用阻擋，未到期拒絕，僅testfixture模擬到期後空相簿沿原手動流程完成刪除，舊audit/human/retention不變。未驗含真photo的既有deletingjob取得保護、照片payload刪除或hosted。ASTRA靜態審查後保留OFF錯誤對應，修正嚴格scope傳入多欄位、batch成功與最後讀取deleting檢查；先前Prettier行寬失敗已修，未冒稱負例為真Guest驗收。

證據docs/releases/album-read-protections-local.json，設計與forward恢復docs/G2_ALBUM_READ_PROTECTION.md。071仍proposal，active69／liveB67維持；不能移入migrations便直接部署，需適用的完整發布鏈、備份／獨立復原／fresh parity、CI與真Owner/Guest。既有Caddy確切變更授權、B重新登入及具名restore67備份退役仍待答覆，沒有重問／重試／繞過。下一步仍為global-node盤點、可信連續活動覆蓋與真正Owner snapshot／正向planner候選及失效；不能用這份近期阻擋證明G2完成。A／Review／DNS／客戶資料不動，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB；GOAL active。

## 2026-11-09 G2-04：Oracle 真列舉唯讀核對通過，路由套用待本次授權

接續 d884272；專用 app 憑證只留 VM，實測 loopback ListObjectsV2 回200／一物件且仍有下一頁，公開同一簽名查詢仍403，既有私人健康GET200。Review匿名/api/health401、首頁404、Caddy active，這不是Review已登入驗收。未寫照片、未輸出key/token/credentials。

ASTRA唯讀審查發現套用未綁定已審查SHA、rollback staging缺CAS及replace後fsync失敗狀態不明；Luna修前兩項及安裝失敗見證，主代理補rollback失敗見證。現在apply必須傳入精確before/candidate SHA，並行變更保留，未確認完成時保留backup/SHA而不稱成功。Windows16項跑15過／1因無O_DIRECTORY略過；同一最新來源於VM隔離臨時目錄16項全過、零略過；路由bytes與已驗Caddy候選完全一致。新證據docs/releases/oracle-listing-activation-readiness.json，先前storage-node-listing-local.json為d884272歷史來源證據。

自動核准審查在命令建立前拒絕共用Caddy持久套用/reload，理由是需要對此次確切公開邊界／共享服務影響的明確授權。已提出一次問題，未重試或繞過；真正公開兩頁簽名／竄改簽章／管理query拒絕與舊物件驗收尚未執行。沒有Caddy套用/reload、DB遷移、CI或B Worker部署；既有B授權7403與具名restore67備份退役待答覆，不能拿路由授權替代。A／Review路由／客戶照片不變，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB維持。

活動來源唯讀盤點確認：human_photo_views只證明正向上報，沒有相簿讀取lease或連續覆蓋；Owner/Guest授權session不能冒當瀏覽證據。下一步仍為受授權路由驗收、global-node盤點、真正活動覆蓋及Owner snapshot/正向候選與失效；不可永久全blocked冒稱G2完成。GOAL保持active，完整MVP未完成。

## 2026-11-09 G2-04：儲存節點列舉接線與 VM 路由候選已驗證

接續 d1e2bb2，在 .local/g2-inherited-share-0069 加入 S3 ListObjectsV2、固定 fast-xml-parser5.12.0 及可信 server 入口 reconcileWorkspaceStorage。逐頁嚴查 namespace／bucket／prefix／count／游標與 XML；body4MiB／depth8／markup及entity各65536上限，拒絕 DTD／未宣告entity／非法字元／資料夾式列舉。SigV4/no-store/manual redirect、15秒涵蓋header+body，錯誤不印URL/body/credentials。節點在首次受epoch保護讀取後解析，只在該次scan重用；primary仍以部署驗證的命名binding為物理信任邊界，Oracle固定endpoint/bucket/credential ref，account_id僅資訊標籤。沒有新增API／UI／flag，070仍proposal、active69不變。

最終5檔31項Vitest（10 parser＋6網路mock＋13原get/head/put＋1真Workerd＋1真本機D1/R2）與10項Python工具測試、strict/lint/format及前端/Worker dry-run通過。原生驗主節點錯綁、首次clock前改綁、Oracle兩頁重用與中途metadata變動拒絕；Oracle部分是method mock，尚非真S3。實際VM唯讀確認Caddy2.6.2且舊bucket root403仍在；新工具預設只prepare，候選0600已由VM原生caddy validate通過、現行configSHA不變、未apply/reload。最新candidate/source SHA綁定見docs/releases/storage-node-listing-local.json。公開列舉尚未開通，不能宣稱Oracle或hosted對帳驗收完成。

保留pnpm store mismatch、esbuild sandbox、網路/計時/換行fixture失敗、最初VM probe exit1與後續安全診斷、初稿entity與allocation缺口及UTF8游標修正；未放寬舊產品守門、未建立新憑證。B授權7403及具名restore67備份退役仍待答覆，未重問／重試B，無DB遷移／CI／部署。下一步為受限閘道套用後實際簽名列舉與既有物件/Review驗收，以及global-node盤點、可信活動覆蓋、Owner真snapshot/候選；詳見G2_STORAGE_NODE_LISTING.md。自刪OFF／dry-run、無Cron、R2優先／Oracle30GB與A／Review已載入設定／客戶資料不變，GOAL active，完整G2／MVP未完成。

## 2026-11-09 G2-04：持久化對帳收據提案，本機8項整合通過

在 .local/g2-inherited-share-0069 接續 ed2e141，新增 proposal0070 與內部 D1StorageReconciliationReceipts。16張庫存來源表的48個觸發器推進單調epoch；讀前後指紋包含epoch，SQL原子核對授權／scope／pending／數量／bytes／掃描開始時間。收據不可覆寫並附append-only審計，時效從掃描開始算五分鐘；重讀重新授權與核對來源，不是活動覆蓋、全桶健康或刪除grant。沒有API／UI／新flag／依賴，proposal不在active migrations，0069發布鏈與B schema67不變。

最終3檔8項（6 SQL＋2真Miniflare D1/R2）、root strict、scoped lint/format通過。六個合成R2 payload／2版本／11276bytes／3頁可產生收據；既有手動清理保留immutable assets與6個零位元標記，舊收據失效，新收據按0bytes核對。另驗空prefix、未知物件、ABA、插入前競態、Owner／session／scope拒絕及缺clock503。初稿rowid覆寫漏洞、錯誤UUID身分限制與缺clock403已修；測試fixture的舊processing／fence／external-intent／manual-confirm守門失敗及首輪5秒逾時、unused import失敗保留，未移除產品守門。真API上傳、JPEG解碼、Oracle實體列舉、完整CI／hosted仍未驗。

證據 docs/releases/storage-reconciliation-receipts-local.json；設計／啟用與forward復原說明 docs/G2_STORAGE_RECONCILIATION_RECEIPTS.md。proposal升正式前需把release鏈完整擴充到新schema並重做適用備份／獨立復原／parity，不能借用0069證據。舊storage-inventory-reader-local.json為ed2e141歷史證據；改動的native測試來源以新收據證據為準。接續Oracle／global-node盤點、可信活動見證、Owner唯讀snapshot與真候選／失效驗收。既有B7403重新授權與具名restore67備份退役待答覆，不重試／不重問；本輪沒有雲端變更、CI或部署。自刪OFF／dry-run、無Cron、R2優先／Oracle30GB與A／Review／客戶資料維持，GOAL active，完整G2／MVP未完成。

## 2026-11-09 G2-04：真實schema69庫存reader接線，本機12項通過

新增apps/worker/src/storage-inventory.ts，以相同D1 batch讀Owner/session/workspace/node範圍的metadata、assets與upload fences；使用綁定參數，hash非同步後再檢查scope。核對workspace與node帳本used bytes和資產實體大小投影，合併清單不去重；錯帳、未知欄位、重複key、跨prefix或不足資料均拒絕。node固定取自原upload session／asset，不隨目前routing priority換節點。未完成reservation／有效upload grant／尚未成功的processing job／deleting job保守標記pending/unverified，不假稱都在實際執行。

已回收asset仍保留immutable metadata，透過匹配asset/node/key/size/checksum及parent job workspace/project/album的reclaimed項目按0bytes計；upload_key_fences透過原session查scope/node，亦必須列為實際0bytes標記。沒有新增optional-fence例外。ASTRA low發現payload查詢先取過量keys才JS檢查的缺口；已加同scope的UNION ALL count／UTF8總bytes／max bytes CTE，asset/fence SELECT在SQL層先擋20,000筆／4MiB／單鍵1024bytes，JS再重驗，避免大批資料先傳回Worker。

root strict／scoped lint/format與3檔12項通過：8組mocked-D1邊界、3項真正NodeSQLite SQL預傳輸bounds、1項真正Miniflare全69 migrations＋R2流程。Native以歷史fixture與guarded synthetic processing結果建立六個真R2 payload，reader→既有core匹配；Owner／session／workspace拒絕與primary/Oracle資料分區通過。透過現有真manual deletion service明確回收測試相簿後，六筆asset metadata完全保留、R2變0bytes fences、usage0，再次reader→core匹配0；reader操作本身不改audit／usage。Oracle僅驗D1 metadata隔離，不冒稱真VM列舉。NodeSQLite bounds case使用test-only TEMP view模擬異常／大量輸入，實際SELECT各回0筆asset/fence payload；不是hosted D1性能驗收。

revision仍是內容指紋，不是持久化收據或單調版本CAS。下一步0070需有原生守門的版本／receipt、受控server writer與真正Oracle/global-node盤點，並處理terminal processing fences與可信活動覆蓋，再接Owner唯讀預覽及真planner候選／失效負例。不能用普通audit JSON代替。無新migration／API／UI／flag，不更動已部署bundle，未重跑無關全量。保留首次錯測試路徑/config、root wrangler匯入與unit TS18046失敗，皆修測試入口／型別，不放寬產品驗證。

雲端B7403與具名restore67備份退役需求仍待答覆；本輪無雲端重試、正式資料變更、CI或部署。既有源碼8bf6890後接續，工作樹.local/g2-inherited-share-0069；B沿上次已驗source10e79694/schema67，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB、A／Review／客戶資料不變。證據docs/releases/storage-inventory-reader-local.json；GOAL active，完整G2／MVP尚未完成。

## 2026-11-09 G2-04：唯讀儲存對帳核心，本機42項通過

新增packages/domain/src/storage-reconciliation.ts，按workspace＋storage node核對完整平面prefix盤點與前後兩份server inventory；固定入口scope/callback，核對key/size／頁面／cursor，忙碌、漏物件、孤立物件、大小差異、重複或循環cursor、跨scope、庫存改變均拒絕。拒絕非空delimitedPrefixes，不能將資料夾列舉誤當完整盤點。只回matched metadata或blocked，不提供healthy、刪除grant或delete；不改配額、last_reconciled_at及任何產品紀錄。

兩位Luna max分別負責41項 deterministic單元與1項真本機Miniflare R2／D1 fixture。最後兩檔42項、root strict、scoped lint/format通過；真R2兩頁／2物件9bytes匹配且第三個foreign workspace物件及資料／審計不變；掃描中實際改D1 fixture revision後拒絕。D1僅為明確標示的test-only inventory schema，不冒稱已接product69 reader或Owner授權。ASTRA low唯讀找到並複查修復scope等待期間變動、regex型別轉換及超長key先編碼的問題；新增回歸均通過。首輪D1.exec fixture多語句限制與total_changes平台內部記帳假設失敗保留，改per-statement DDL及explicit fixture寫入log核對；沒有改產品來迎合測試。

此為G2必要的對帳核心，不是完整snapshot／G2完成。下一步需0070或同等有DB守門的持久化receipt／inventory版本CAS、真正product manifest reader、Oracle完整平面列舉與全節點占用範圍、可信活動覆蓋／尚可能未上報瀏覽的保守觀測，以及Owner只讀預覽。不能用普通append-only audit JSON或單改last_reconciled_at偽造已核對。此函式只涵蓋指定workspace在單節點的prefix，不等於整桶或帳戶總容量；20,000物件／4MiB key／64頁為明確one-shot界線，更大庫存先做持久化分頁job。matched結果需server以相同revision CAS保存後，再檢查新鮮度／完整性供planner使用，不能直接啟用實刪。

無新migration／API／UI按鈕／feature flag，未改production bundle，未重跑無關前端或既有全量測試。B7403與具名restore67備份退役授權仍待答覆，本輪無雲端重試、備份、建刪庫、遷移、CI或部署。B仍以上次已驗source10e79694/schema67為基線；自刪OFF/dry-run、無Cron、R2優先／Oracle30GB，A／Review／客戶資料保持。證據docs/releases/storage-reconciliation-core-local.json；GOAL active，完整MVP未完成。

## 2026-11-09 G2：compound 67→69 完整發布程式接線，本機93項通過

主代理已接 current69 localEvidence／兩版migration hash／真正compound restore、live69 schema、三個legacy DDL精確覆寫、native69及prior69收據、predeploy舊67 Worker旗標與新版D1的分離。0069收據不虛構獨立live68 adoption；歷史68證據只在prior確為68時讀取且缺件拒絕。兩位Luna max完成legacy override、收據／catalog與snapshot負例；ASTRA low兩次唯讀複查，具體發現的LIKE底線萬用字元漏物件及無關68檔阻擋均已修正。

實際採用後的完整產品catalog（排除SQLite及Cloudflare保留命名空間）將由復原工具產生sourceAfterSchemaSha256／Objects；live以同一精確GLOB查詢核對全目錄，再驗55個69物件，不能只查allowlist而漏額外物件。sqliteX自訂表／view納入資料與schema雜湊；_cf_平台metadata另列排除範圍，不聲稱驗全部provider內部資料。Guard SQL不做大小寫或字串空白摺疊來放行改動。0068/69 SQL本身未改，未新增migration。

root strict、8檔93項專項單元、scoped lint/format及最終19項實際Miniflare D1/API通過；工具local self-test由unit實際子程序執行。因native runner的catalog SQL有安全修正，已刷新其proof，未重跑無關前端、Human／B原生全量；產品bundle未改，既有Human15／B34 proof的來源仍可核對。normal localEvidence實測在缺少真正inherited-share-0069-restore.json時以ENOENT拒絕，沒有寫假manifest或冒稱完整self-test／CI通過。保留首輪receipt fixture缺新欄及測試TS2532／tuple推斷／TS7016失敗，後續未放寬strict。

下一步仍需適用雲端授權後fresh67備份→同一獨立庫68/69→fresh parity/adopt，核對實際D1 catalog與匯出表示方式；再執行完整normal self-test／CI→自動B→真Owner／Guest。G2 snapshot、容量對帳、連續活動見證及production cutover仍未完成。B7403重新授權及具名restore67備份退役問題尚待答覆，本輪無雲端重試、建刪庫、遷移或部署。自刪OFF/dry-run、無Cron、R2優先／Oracle30GB、A／Review／客戶資料維持。證據docs/releases/inherited-share-0069-release-wiring-local.json；GOAL active。

## 2026-11-09 G2：0069 原生證據產生器與本機守門接線

主代理完成當前69 profile／旗標、Human歷史67/68與69收據核對、真正inherit API證據來源綁定；兩位Luna max分檔完成producer／CI步驟與負例單元，ASTRA low唯讀檢查schema指紋防退回。最終本機product/B dry-run build、root strict、52項專項單元、inherit19項、Human focused15組、B profile34組及Human B sidecar7 native＋FK（共8組）通過；實際proof再次由新validator核對來源／bundle／migration digest。CI已加入inherit runner，但沒有執行完整CI或部署。
另已真實執行schema69手動清理：6 assets／2 versions／11276 bytes→0，FK0；migration69及runner hash均核對。目前單一unique native case通過；主代理跟進訊息造成第二次相同case亦通過，記為重複執行，不重複計功。

原生B真實找到兩項整合缺陷並修正：wrapper未列新旗標使wrong-origin由預期403變503；0069重建Guest annotation guard後舊指紋導致手繪capability false。現依guest_invites.expiry_mode schema標記選唯一完整Guest指紋，Owner指紋不變；69換回舊guard、58裝新guard及Owner守門改動均拒絕，沒有放寬租戶／邀請ACL。初次兩輪native失敗、TS2532與測試fixture／unused import失敗均保留於證據；修正後重新build及native，不使用舊bundle proof。

完整normal release checker仍未完成：current localEvidence的69 migration count／compound67→69 restore讀取、舊0066/0068三個重建物件的精確覆寫、live69完整schema檢查、prior/deploy receipt與full self-test尚需接線。不能將本次局部validator與native通過當成全release gate成功。下一步先完成上述接線，再依G2_CLEANUP_EVIDENCE.md補Owner snapshot、容量對帳與連續活動見證。

既有B7403重新授權及具名restore67備份退役問題仍待答覆；這輪沒有重試雲端、備份／建刪庫／live遷移／adopt／部署。B沿上次已驗source10e79694/schema67，自刪OFF/dry-run、無Cron、R2優先／Oracle30GB及A／Review／客戶資料保持。證據docs/releases/inherited-share-0069-native-wiring-local.json；候選仍在.local/g2-inherited-share-0069，非main，GOAL active。

## 2026-11-09 當前 G2 狀態：0069候選與正式頁籤已整合

本輪67→69工具及採用／schema守門已通過27項本機專項測試、strict與lint；證據`docs/releases/inherited-share-0069-tooling-local-readiness.json`。單次B唯讀時鐘查詢回7403，已提出一次B重新登入需求，未重試或執行雲端備份／遷移。正常69 release profile/native proof與G2-04仍待接續。

G1維持完成。G2沿`.local/g2-inherited-share-0069`接續，0069候選已保全ea7ee5b並合併main至1c763ce，正式頁籤與真實功能接線保留。53項期限單元、0069原生D1/API及Human focused15組已本機通過；合併後Web strict、build及真本機頁籤／網址／375px驗證也通過。這些不是完整CI或0069 hosted證據。

B仍為已驗頁籤source10e79694／schema67。安全發布將採同一份fresh67備份、同一獨立庫依序68→69、fresh-source parity與adoption，保留D1逐migration交易邊界，不要求一份未曾發生的live68發布。具名雲端備份／舊restore67退役授權仍待答覆，尚未操作。0069完整release profile／native proof接線與G2-04仍未完成；容量對帳、連續活動覆蓋及snapshot缺口見`docs/G2_CLEANUP_EVIDENCE.md`，不能偽填healthy／verified。自刪OFF/dry-run、無Cron、R2優先／Oracle30GB及A隔離保持。下方未完成狀態及待選規則以本段和最新HANDOFF為準，不重問已確認的「custom只延後清理、不復活舊inherit」。

## 2026-11-09 G2相簿天數／分享保護：本機垂直接線通過

沿.local/g2-expiry-foundation-20261109／codex/g2-expiry-foundation-20261109（起點2890c28）接續，canonical3950c24仍保全。planner現在要求每相簿天數與分享證據；有效custom期限在閒置／容量兩模式都阻擋清理，不重設有效瀏覽。Owner設定旁新增真D1分享保護摘要及獨立SVG更新按鈕，無session或達maxUses的連結仍保護；撤銷／到期不計入，查詢失敗不當作none，不改草稿、未知寫入intent或Guest權限。

72相關單元、focused retention原生／browser（含真未訪問分享日期、summary503草稿保留）、B原33組／Human側邊6組與Human focused14組、root/Web strict、product/B dry-run build及目前來源綁定通過。Profile/aria fixture差異與新增Guest使合成共用network:20觸限的失敗保留；只隔離該測試client到文件保留IP，沒有清鎖、重設或放寬產品限額。證據docs/releases/g2-share-protection-local-readiness.json；原B native record名稱與所有產品功能保留。

使用者本輪已確認：custom有效只延後清理，其他已到期連結不恢復存取；先前語義問題已解決。正式inherit mode尚未接線，0069需不可回溯的到期／世代見證，避免custom真view或政策變更使舊bearer復活；多相簿scope不可省略。此摘要不是完整清理snapshot，仍缺連續活動／容量對帳／保護與workflow/reference見證，不可填假的healthy/verified。

完整release self-test仍非成功（真0068 restore/adopt manifest缺失／ENOENT）。只有具名restore67退役與fresh live67備份／獨立68／parity／adopt的雲端授權仍待答覆；沒有重問或雲端操作。B仍58f1bee／live67，未跑本輪CI／hosted，未合併main或部署。接續正式G2期限與snapshot→適用復原守門／CI／自動B／真Owner Guest，再G3→G4→G5。GOAL active，完整MVP未完成；自刪OFF/dry-run、無Cron、R2優先／Oracle30GB、A／Review／客戶資料不變。

## 2026-11-09 G2-03本機候選進展

有效瀏覽正式Gallery／B限定接線及來源綁定證據已本機通過；見docs/releases/g2-human-view-local-readiness.json。55單元、14 focused、33既有B及6新Human組、strict/build與專項guard通過；CI已加入focused runner。這不是G2完成或hosted發布：live67/Human OFF保持，完整release self-test仍因缺真0068復原／adopt證據拒絕。具名退役／備份授權與期限語義問題仍待答覆；繼續G2期限及dry-run adapter，再G3→G4→G5。延續分支為codex/g2-expiry-foundation-20261109，canonical3950保全，自刪OFF/dry-run與A隔離不變。

## 2026-11-09 當前研發目標：G2 清理政策與期限繼承

**總目標：** 沿用既有正式前端與真實功能，完成剩餘必需功能及 production 切換，交付可實際操作的 Kino Pick 線上 MVP。保留全部產品規格，G1 已完成，不從初始化或0067復原重做。當前執行優先序為 G2 → G3 → G4 → G5；下方較早紀錄保留為歷史。

**已完成基線 G1：** source `58f1bee4a155448143dbd99becfa91d7c30e40da`、schema67、CI42491537881、自動B42493102853、Worker79ef16c4-7e58-41bc-8edd-85378aac650a；真Owner／Guest固定V1/V3交付、三張新票券首次ZIP解壓／CRC／原圖SHA、通知與EXIF通過。證據 `docs/releases/g1-0067-hosted-acceptance.json`。早期D1節流／截斷及其他失敗保留，不宣稱負載穩定或完整MVP完成。

### G2 執行順序及驗收條件

1. **G2-01 相簿清理設定：** 每相簿閒置天數可調、預設90天；自動清理Toggle預設OFF。完成schema → service → API → 原介面設定 → 必要最小測試 → docs。區分閒置政策、分享存取期限與真正刪除，不將設定保存當作已開啟自動刪除。
2. **G2-02 分享期限繼承：** 明確保存「自訂到期」與「繼承相簿」兩種模式。自訂連結各自照設定到期，未到期的有效自訂連結會延後相簿清理；不會因較短連結期限而提前清理相簿。未指定天數則繼承相簿；關閉相簿閒置清理時，相簿與繼承連結不因閒置自動到期，自訂期限仍有效。客戶頁顯示該分享連結的實際期限。
3. **G2-03 有效瀏覽與背景紀錄：** 以已授權的有效人類瀏覽更新活動基準，排除預抓、縮圖、輪詢、bot與系統作業。按每相簿同一瀏覽器計一位訪客，每次瀏覽及下載另留UTC歷史；原始IP依使用者已確認規則保留，不對Guest暴露。完成必要隔離及時間邊界驗證後，才開通對應背景紀錄；此目標更新本身不開flag。
4. **G2-04 清理預覽：** 先交付deterministic planner與Owner dry-run候選預覽，顯示原因、受保護／釘選／最低保留／有效連結／進行中作業及版本引用阻擋。保留80%啟動、清至65%或無候選的容量政策；配額耗盡拒絕上傳，不刪受保護資料。未知或不完整證據時排除候選。沿用既有明確確認的手動清理／重試與審計，不能由preview直接偷偷啟用Cron或自動實刪。

**G2 完成守門：** 上述規則有可運作的正式UI/API與資料持久化；必要最小演算法、原生D1及租戶／相簿／邀請負例通過。若新增migration，先完成該版必要的受保護備份、獨立復原、fresh-source parity與復原說明；新敏感備份／不可復原刪除需具備適用授權，不能挪用舊版本證據。完整CI通過後由既有流程自動部署B，再以真Owner／Guest驗收設定、期限顯示與dry-run；自動刪除保持OFF。保存URL、source／Worker／schema、測試與hosted證據，更新TASKS／HANDOFF／CHANGELOG後才標完成。

### G3 → G5 保留里程碑

- **G3 必需功能實作及補驗：** 正式Worker尚未提供使用者手動OAuth綁定／安全解綁，不能把Next/Supabase參考端fixture當正式功能。先補正式Owner來源管理與最後來源保護，再依TEST_ACCEPTANCE補真Google／GitHub同身分、Guest獨立權限、協作／版本／下載及隔離／撤銷／期限證據；保留已驗功能與全部產品需求，不重跑無關全量本機測試。完整CI仍是發布守門。
- **G4 Production：** 獨立D1／R2、既有測試資料受控搬移、備份復原、Owner／OAuth origin、`pick.kinostudio.tw`切換與復原計畫。只在適用授權內處理必要的新增DNS設定，不改A／FILM／Review既有部署，不把staging等同production。
- **G5 最終簽核：** 同一實際發布版本的Owner建立專案相簿→私人上傳與衍生圖→分享→Guest挑片／協作→代表核准→固定版本／ZIP交付→通知；包含權限負例及必要真實下載雜湊，保存production網址、版本與交接。未驗／缺憑證／負載／實機範圍清楚列出。

**執行與保護：** 主代理處理規劃、複雜問題、安全、雲端變更與整合；可將明確分檔任務交`gpt-6-luna`／`reasoning_effort:max`並行，複雜阻點可交`gpt-6-astra`／low顧問。保全其他髒變更；正式來源仍`.local/oracle-release-20261106`。A／Review／客戶資料不動，自刪OFF/dry-run、正式單R2節點、R2優先／Oracle30GB維持；不擴大憑證或繞過未滿足的授權／復原／CI守門。

**內建GOAL：** 使用者清除舊目標後，本次已成功建立新的active總目標，依本文件G2→G3→G4→G5執行。下方舊paused／無overwrite API紀錄屬歷史；不從初始化或0067復原重做，完整MVP未達成前不標完成。

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

## 2026-11-08 歷史GOAL：G1發布切片（已完成）

在既有 Kino Pick release checkout 完成 fresh-source parity，僅比對完全一致後套用 Cloudflare B 的 live0067；通過完整 release self-test 與正常 CI 後自動部署 B，再以真實 Owner／獨立 Guest 驗收固定版本 ZIP、站內通知與相機資訊，保存 URL、source SHA、Worker/schema 版本、備份／復原及 hosted 證據。不得影響 A／FILM／DNS／Review，不擴大租戶／相簿／邀請權限；自刪維持 OFF/dry-run、R2 優先／Oracle30GB。

完成條件：live0067 與獨立 drill 精確一致；release gate 與 CI 真正成功；既有自動部署成功；Owner／Guest 真實功能及拒絕案例通過；TASKS／HANDOFF／CHANGELOG 更新並保存私人 GitHub。缺任一項不得標為完成，不能以 local／restore-only／checkpoint 取代發布驗收。G2→G5完整產品需求保留為後續工作。

內建 GOAL API 現查仍為舊 objective、paused，僅有 create/get/status-update，無 overwrite/resume；不得假標完成繞過。此文件中的目標已覆寫為使用者本次明確指示，人工研發依此繼續，工具狀態如實保留。

## 2026-11-08 新版研發GOAL與並行執行計畫

G1最新：B live66完整備份與獨立restore67升級／完整性核對已通過（6步exit0、152表／3414列、FK0）。本次未adopt live、未部署；下一步仍須fresh-source parity及adoption gate，不能以restore-only證據宣稱發布成功。

**主要GOAL：接續目前已驗證的Kino Pick，在Cloudflare B完成剩餘核心功能與安全發布，交付可實際操作的線上MVP。** 保留完整產品規格，不重建專案或重做已通過切片。正式驗收終點是production獨立資源／HTTPS網址與真實Owner／Guest全流程證據，不是prototype、local mock或只有CI成功。

內建GOAL追蹤器仍是舊M1→M5、paused。使用者已明確要求重新安排並繼續；本次create_goal實際回覆「unfinished goal」而拒絕覆寫。現有工具只可建立或標記完成／阻塞／暫停，不能修改未完成objective或解除paused；不得假標完成繞過。此版本化計畫為當前執行依據，人工續作不中斷，追蹤器狀態如實保留。

| 次序 | 工作與完成條件                                                                                                                                                                  | 負責                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| G1   | 固定版本ZIP／站內通知／相機資訊：沿用WIP、補齊原生權限覆蓋，0067獨立backup→restore→upgrade→parity；安全gate、CI、自動B、真Owner／Guest含實際ZIP下載與雜湊核對                   | 主代理整合／0067；LUNA gate、EXIF與通知原生測試並行 |
| G2   | 清理政策與UX確認：期限繼承／有效人類瀏覽／保護／最低保留／候選預覽及重試的剩餘驗收；自動刪除保持OFF、dry-run，任何不可復原實刪只用明確授權隔離資源                              | 主代理拆分具體切片後交LUNA                          |
| G3   | 逐項核對TEST_ACCEPTANCE與產品必需功能：補缺漏的帳號綁定、Guest權限、協作／版本／下載、跨scope與撤銷／期限證據；避免無關全量重測                                                 | 主代理選阻點，LUNA負責有明確檔案範圍的補件          |
| G4   | production資源／資料復原與cutover：獨立D1/R2、現有測試資料受控搬移、Owner／OAuth origin與pick.kinostudio.tw切換方案；A只在已有明確授權範圍處理必要DNS，不改FILM／Review既有服務 | 主代理負責架構／資安／外部變更判斷                  |
| G5   | 最終驗收：同一實際發布版本的Owner→上傳／相簿→分享→Guest挑片／協作→核准→固定版本與ZIP交付→通知；保存URL／SHA／Worker／schema／復原點／真實證據並交接                             | 主代理簽核，LUNA執行具體回歸任務                    |

**完成守門：** 必需驗收皆有可核對證據，未完成／mock／缺憑證／實機未驗明列；不移除產品需求、不擴大租戶／相簿／邀請權限、不把local等同hosted。GOAL達成才可標完成；完整規格中的後續項與MVP發佈順序分開記錄。

**執行規則：** 主代理思考規劃、處理複雜問題與安全／整合；具體任務使用gpt-6-luna、reasoning_effort:max，可三線並行且分檔案責任。各代理不是唯一編輯者，不可覆蓋他人WIP。必要最小單元／原生／browser驗證後正常CI→B自動部署→真實驗收→更新TASKS／HANDOFF／CHANGELOG。schema變更附migration與復原說明；缺外部授權時只提出一次清楚操作，不繞過守門。

**保護基線：** source f455d00／B Worker cac5baee-757a-4504-b98f-bb9b8ecc2f07／schema66；A／FILM.KINOSTUDIO／Review／客戶資料不動，自刪OFF／dry-run、無Cron、R2優先9GB／Oracle30GB。GOAL起始WIP已保全至release checkout的.local/goal-replan-20261108-preserved，包含tracked patch與21個untracked來源，不含ignored憑證。不要重做0066、密碼／代表核准／固定交付／縮圖／Oracle已驗切片。

### G2 已確認缺口與最小交付順序（只讀盤點）

1. 每相簿90天可調、預設OFF的閒置政策保存及Owner設定：現有純planner仍預設30天，尚未接D1／UI，不能稱已完成90天政策。
2. 分享期限繼承：現有邀請契約要求明確expiresAt，不能表示「未指定則繼承相簿」；需保存明確期限／繼承的差異，未到期的明確連結延後清理，OFF時繼承連結不自動到期。
3. 真實有效瀏覽與dry-run候選：human-view目前local-only，retention Cron只記not_implemented。先做D1安全快照與候選預覽，保護／最低保留／忙碌／引用不足時fail-closed；維持自刪OFF，不直接啟用排程刪除。

以上為程式只讀盤點，未新增雲端驗收；既有純planner的釘選／保護／最低保留及80%→65%測試不是正式端到端清理證據。G1先完成安全發布，再逐項處理G2，不移除原需求。

## 2026-11-08 GOAL與目前進度差異（本次核對）

GOAL追蹤紀錄仍為舊KINO Pic／M1→M5且paused；本次依使用者新指示手動續作，未偽稱已更改追蹤器狀態。研發與發佈進度以最新程式、CI／部署及真實驗收證據判斷，不從M1重新開始。

| 項目        | 已有證據                                                                                | 仍有差距                                                        |
| ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 身分        | 真GitHub Owner登入／bootstrap／登出                                                     | Google與雙來源完整hosted證據待補                                |
| 資料與儲存  | live schema66、獨立復原／遷移、私人R2／預覽圖庫、Oracle溢位                             | 新0067尚未獨立雲端復原／採用；production資源切換未完成          |
| Guest與版本 | 分享密碼、部分協作／版本、代表核准與固定V3交付；本次清單恢復補強／三次真Guest重載及下載 | 原瞬時讀取事故根因未證實；未驗真第二租戶、負載或實機觸控        |
| 交付與通知  | 固定版本成品原圖下載及審計                                                              | ZIP／站內通知／相機資訊仍為本機WIP，尚未發布                    |
| 清理        | 有演算法／隔離清理及防護驗證，OFF／dry-run保留                                          | 完整政策確認與剩餘正式驗收待完                                  |
| 發佈        | B staging與CI後自動部署可用                                                             | production隔離資源、pick.kinostudio.tw切換與完整MVP終點尚未達成 |

本輪source f455d0018b16c61bd7e6cdfd95718c2d346f5373／CI42410930478／B deploy42412803984。詳見docs/releases/guest-read-resilience-hosted-acceptance.json；後續功能與產品需求全部保留，MVP順序不代表刪除功能。

## 2026-11-07 代表核准與固定版本成品交付已自動部署 B 並真實驗收

最終source ac5dd7bd98ae10125f28acd8a73ed0dec72dda94，完整CI42381439868成功，既有流程自動部署42383253098成功；Worker be30a41a-f94f-4515-b601-eda1db55849a，baseline bot6980099，schema66。已明確授權退役舊restore65並保留完整備份；fresh65→獨立restore66→live parity／0066採用通過。D1約7.3MB，先前阻塞是10個DB名額，非照片或資料量滿；未刪其他DB。

真Owner在既有合成613487…相簿、a3a6…照片為V3建立兩份邀請的固定請求ecd6a2b7…；只有一位Guest代表確認，雲端唯讀核對為2個指定邀請／1筆receipt。Owner只交付INV-3061D3CE；獨立Guest實際下載V3。暫時將head3→1仍下載同一V3原圖，後還原head3／revision3；V2保持queued。三次native下載均21527bytes、SHA b26b590c55c31f7d092f2e65d400134cfb252dae3eea81c70dbbef5c2880a6c7，含撤銷後重新發布的實際檔案。

INV-40C9BFFB可看相簿但看不到交付檔名或下載控制，重播第一人的直接下載URL回GUEST_ACCESS_REQUIRED。Owner確認撤銷後，原收件人連結移除且直接重播亦拒絕；重新發布只給第一份邀請。最終保留active交付4cf01abe-0f82-45e6-b185-7426bc6b5d7e供驗收，舊167ec913…保持撤銷與歷史。雲端審計核對published2／revoked1／requested3／generated3；兩份manifest皆固定V3與唯一收件邀請，IP只檢查型別text，未輸出原值或憑證。核准在Guest登出後仍保留，沒有要求第二位確認。

實際觀察保留：部署後首次Guest核准面板讀取曾顯示一般服務錯誤，同Guest直接GET成功，透過可見重試後恢復並完成其餘流程，原因未定，不宣稱首次載入零錯誤或負載穩定。可選CLI審計首讀7403；確認B OAuth與既有D1權限、明確固定account後回讀成功，未變更／擴大憑證。先前3次CI失敗（Web narrow／OFF多讀／舊schema證據）均保留並修正；最終完整CI成功，不以失敗冒充通過。

證據docs/releases/approved-deliveries-hosted-acceptance.json、0066-restore與retired-restore65 manifests；截圖root .local/approved-delivery-{guest,owner}-hosted.png。真Owner／獨立Guest頁保留可操作，連結token只用於瀏覽器記憶體並已清除工具變數。正式候選仍在.local/oracle-release-20261106，根不同產品變更保全，勿覆蓋。

此切片完成；完整MVP未完成。下一步依MVP_RELEASE_PLAN完成ZIP／基本通知、其餘retention確認與production cutover；不要重做已通過0066復原、代表核准、固定交付、密碼或Oracle接線。未驗hosted負載／CPU記憶體數值、實機觸控、真第二租戶帳號（native跨租戶拒絕已過）。A／DNS／Review／客戶資料未改；自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。

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

## 2026-11-07 B 密碼分享已驗收

既有Owner管理的單相簿現可用無密碼、五位數系統密碼及自訂密碼分享；附密碼開關預設OFF，ON僅放fragment，Guest進入後移除並預填。沿用固定scrypt與限流、租戶／相簿／邀請守門，production/default並未全域開放。Source55af3ca／CI42353228572／自動deploy42354807451，真Owner及獨立Guest兩模式通過，詳見docs/releases/password-sharing-hosted-acceptance.json與HANDOFF最新節。此切片完成，完整MVP與production cutover仍未完成。

# Kino Pick 線上 MVP 發佈與接續計畫

## 當前接續點（2026-11-01）

以 HANDOFF 最新節與 docs/HOSTED_COLLABORATION_ACCEPTANCE.md 為準。B source10b0b7b／CI41236744712／Actions41238436526／version526e3f16-f4dd-4567-9551-7ac7b05b8bd9，schema59。真實OAuth、私人R2原圖／縮圖、推薦OR與即時清除還原、雙端手繪留言、Guest歷史、V3精確處理與V1/V3實際滑桿、提交／後台封存明細已驗；完整MVP仍未完成。下一步是既有workspace的Owner新建project＋album與明確managed scopes，保留foreign/tenant/invite拒絕。不要重做已通過的Owner/bootstrap/100uploads/59restore/推薦/手繪/BeforeAfter。舊合成V2保留queued，版本清單暫需重開更新；自動刪除OFF/dry-run、單R2、無Cron，A/DNS/customerdata不動。

更新：2026-10-31。此文件是目前執行順序；原 PRD／ROADMAP 的產品需求與安全條件保留，不因 MVP 分期被刪除。既有歷史紀錄不等同當前完成狀態。

## 驗收終點

在 Cloudflare B 發佈 Kino Pick 的實際 Worker 前端及 API，提供可存取的 HTTPS 網址，使用真實授權帳號與獨立客戶瀏覽器完成以下流程，保存版本、網址、時間與驗收證據。4174 prototype、合成 OAuth、本機 workerd、R2 單次 PUT 或 CI 綠燈各自都不足以宣告線上 MVP。

1. Google／GitHub 任一或雙來源綁定同一內部身分；僅預先授權 Owner 能進後台，不以第一個登入者或相同 Email 自動授權／合併。連結、解除及 session 撤銷可用。
2. 建立 workspace／專案／相簿，真實批次上傳至少100張測試圖到私人 R2；產生可用縮圖／預覽、分頁 Grid、單張燈箱。容量不足拒絕上傳，跨 scope 拒絕讀取。攝影師推薦的 metadata／門檻／手動調整需接正式服務，不能只有 demo。
3. Owner 建立三種密碼模式及期限的邀請，客戶免註冊進入；逐項 view/select/rate/favorite/tag/annotate/comment/download 等權限由 API 驗證。挑片張數上限、即時評等／收藏／標籤、提交與後台匯出可用。
4. 留言、圈選及手繪綁定固定照片版本；同邀請共用、跨邀請隔離。immutable 版本、可選同檔名判定、手動版本、Before/After 滑桿／並排／疊圖與歷史可實際操作。
5. 其中一位明確授權客戶代表核准固定版本，使用固定交付清單完成成品下載、基本通知與原規格要求的交付／ZIP；完整 append-only 操作歷史可追蹤。下載走正式按鈕／連結及權限／審計，右鍵限制僅是 UI 行為，不能宣稱防止截圖或擷取已送達的圖片。
6. 儲存政策／有效人類瀏覽／配額可檢視，保護／最低保留／使用中相簿及歷史版本不誤刪；先完成 dry-run 與政策確認流程。自動刪除保持 OFF，清理重試與實刪另在明確允許的隔離測試資源驗收，未完成不得宣稱自動清理可用。
7. 代表性 D1/R2 備份復原、跨租戶與邀請拒絕、撤銷／到期、Cookie／Origin、濫用限流、費用與設定邊界有真實證據；手機與桌機主要流程可用。正式 D1/R2 與 staging 分離，不把測試資料混入正式服務。

## 初始盤點結論與流程修正（歷史狀態；以最新接續點為準）

- 可用基礎：既有 React/Vite Worker 目標、Hono、Better Auth、D1、私人 R2 adapter 與大量本機測試；GitHub 私人倉庫及 B 專屬 Actions Secret 已有交接證據。保留 Next 參考端，不另建專案。
- 目前未上線：2026-10-31 使用隔離 Wrangler 帳戶唯讀查詢 staging Secret 名稱，回覆 Worker kino-pic-staging 不存在；這不能證明帳戶沒有其他 Worker，也不能證明已有 runtime Secrets。
- 本輪起初 staging APP_URL 是 configure-staging.invalid；隨後已核實 B 帳戶並建立 kino-pick-aaron2026.workers.dev 子網域，設定預定 origin：https://kino-pic-staging.kino-pick-aaron2026.workers.dev 。workers_dev與版本入口仍false；Worker隨後已建立封閉503憑證容器，網址不是已上線產品服務。54份來源 migration 不是54份已套用遠端 migration；production 綁定仍是 placeholder。
- 原 readiness 七項全部 false；config.ts 掃描到28種 LOCAL_ONLY 拒絕。每個功能須經 hosted 相容性審查／驗收再轉正，禁止全域移除 APP_ENV 檢查或一鍵全開。
- tools/check-cloudflare-deployment.mjs 永遠拒絕，即使所有 boolean 為 true；它是原本刻意關閉的 foundation guard，不是可執行的最終驗收。只可在有 scope、版本、schema、provider、restore 與安全證據的 cutover 中替換，不能為綠燈繞過。
- 圖片處理目前可信任的 Sharp runner 是本機能力；後台處理順序控制是 prototype。上線必須交付真正 Cloudflare 優先的處理 adapter／失敗與配額策略，Oracle 維持候選，不假設 VM 已開機或 Workers 能直接跑 native Sharp。
- 修正先前流程：不繼續無限擴充本機細節；每輪只處理最高優先的一個上線缺口，以 Schema→Service→API→UI→必要 Tests→Docs 閉環交付。文件改動不重跑20分鐘全量測試；合併可執行變更後再跑適當 CI。

## 執行順序與通過條件

| 順序         | 交付                                                                                 | 通過才進下一步                                                                     |
| ------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| R0（本輪）   | 統一驗收清單、唯讀 release:inventory、恢復原 heartbeat                               | 可重現列出未完成條件；不洩漏 Secret；不把本機證據當 hosted                         |
| R1（下一個） | B staging HTTPS origin、Google/GitHub callback 與私密設定、固定 Owner bootstrap      | 真實 Owner 登入／雙來源身分及陌生使用者拒絕；不先開放其他 hosted 功能              |
| R2           | 隔離 staging schema 與代表性資料 backup→restore→migration→parity；原圖／版本引用一致 | 檢查 FK、審計、計數與物件校驗；復原到新 DB，不覆蓋客戶資料；草稿 SQL 不自動套用    |
| R3           | 真實私人直傳、Cloudflare 優先的縮圖／預覽處理、配額及圖庫                            | 真正100張上傳／縮圖／分頁／燈箱，重試不重複／不洩漏原圖，額度失敗有實際行為        |
| R4           | Guest 挑片與協作、版本對比、攝影師推薦正式接線                                       | 上述權限隔離、同邀請共享及固定版本行為通過 hosted 流程                             |
| R5           | 核准／固定交付／下載／通知、儲存後台 dry-run、安全拒絕                               | 完整客戶流程與稽核證據；未完成項目不可用無效按鈕假裝可用                           |
| R6           | 受控 cutover、production 獨立資源、GitHub Actions 發佈、fresh browser smoke          | 記錄 URL／Git SHA／部署版本／資料庫版本／復原點；真正線上驗收通過才標 MVP 發佈完成 |

R1-01 已完成子網域準備：B 帳戶 GET 驗證正確、現有 Workers 數0、原子網域 GET404/code10007，之後 PUT 建立及 GET 讀回 kino-pick-aaron2026 均成功。原瀏覽器是 A 登入，保持不動，使用隔離 Wrangler 憑證向官方 API 查詢／建立，未輸出 Token。下一步完成 OAuth 私密設定與 Owner bootstrap。

固定 callback：

- Google：https://kino-pic-staging.kino-pick-aaron2026.workers.dev/api/auth/callback/google
- GitHub：https://kino-pic-staging.kino-pick-aaron2026.workers.dev/api/auth/callback/github

GitHub OAuth 本次確認已收到並完成：Kino Pick Staging App3979161已建立，Client Secret及隨機session secret已保存本機忽略設定與B staging加密Secret；wildcard／Device Flow關閉，原CMS App未修改。B kino-pic-staging已初始化為無任何公開入口／產品綁定的503憑證容器；這不是可用網站或真實登入驗收。Owner bootstrap SQL僅已準備，尚未套用。詳見 [STAGING_AUTH_PROVISIONING.md](STAGING_AUTH_PROVISIONING.md)，勿重複建立憑證或覆寫容器。憑證值只放 Secret／忽略的本機檔案，不放聊天、Git 或日誌。建立新持續存取憑證若瀏覽器規則需要即時確認，先準備好具體權限與目的再請求。

缺外部條件時，記錄精確原因與一次使用者操作需求，繼續不依賴該條件的 schema restore／adapter／安全測試；不得重複呼叫不存在的 Worker 或要求無關帳戶重新登入。

## 可執行盤點與驗證

- pnpm release:inventory：唯讀 JSON 摘要，預設 staging；--stage production 可檢查正式設定。
- pnpm release:inventory --check：來源設定或記載的 acceptance 尚未完成時 exit1。這是預期阻擋，不是測試程式失敗；exit0 也只代表來源盤點通過，從不授權部署或宣稱 hosted 測試通過。
- node --test tools/release-inventory.test.mjs：四項防止誤報／敏感值輸出的檢查。
- 不讀 Secret 值、不連雲端、不寫資料庫、不移動 migration；localOnlyErrors 為待審查清單，未啟用的後續功能可繼續保留 hard-local，不要求為了盤點綠燈刪掉安全保護。
- 原部署 guard 與所有 OFF/dry-run 設定保留。付費與免費額度以正式配置前的官方當期資料核對，不預設免費一定足夠。

## 自動接續

既有 kino-pic heartbeat 已恢復 ACTIVE，維持61分鐘週期與同一個聊天，名稱更新為 Kino Pick 線上 MVP 接續研發。每輪讀本文件、AGENTS、GEMINI、最新 HANDOFF 及 Git；執行一個實際切片並交接。無變化／無可執行事項不重複通知；有完成、失敗、實質進展或需使用者操作才通知。最終完成後暫停 heartbeat，保留網址與驗收證據，不持續無限開發。

## 2026-10-31 — 目前已通過的基礎驗收

R1固定Owner與真實GitHub登入／登出、R2 staging54migration與獨立雲端D1復原已完成；精確證據與復原界線見 [STAGING_DATABASE_AUTH_ACCEPTANCE.md](STAGING_DATABASE_AUTH_ACCEPTANCE.md)。臨時公開驗收入口已關閉，尚非產品發佈；Google／同身分綁定完整驗收與含R2物件的復原仍待。下一個執行切片R3私人直傳及Cloudflare實際縮圖處理；B獨立登入需求已提出一次，等待回覆，不重問。

## 2026-10-31 — Current R3 handoff

B login and bucket-only R2 credential creation/storage are completed with user approval. Real S3 PUT200/replay412/hash-matching GET200 and signed CORS allow204/foreign403 pass. Native Images binding also generated and verified two private synthetic derivatives via real remote development. See latest HANDOFF for exact proofs and limits. These are capability checks, not product/100-photo/hosted MVP acceptance; public entry remains closed and private_direct_upload_verified remains false. No further key/login request is pending. Next implement the genuine Cloudflare recipe/adapter plus compatible durable-job migration; retain immutable Sharp recipe, quota/source/output guards and draft-SQL exclusion. Keep A untouched, auto-delete OFF/dry-run. gh works outside Wrangler-isolated XDG; prior CI41118459908 completed/success.

## 2026-10-31 — Selected production domain

User selected `https://pick.kinostudio.tw`; DNS is in A/FILM.KINOSTUDIO. Do not transfer kinostudio.tw, change root nameservers or modify existing A deployments. Existing staging OAuth/CORS origin remains unchanged until the new hostname is actually configured and tested. A cross-account Workers custom domain cannot be treated as a same-account attachment or assumed to work with an ordinary CNAME. Prepare a narrowly scoped hostname-only entry plan and resolve its required A permissions before configuration; no A/domain change has occurred. Website/API/D1/R2 processing remains targeted to B.

## 2026-10-31 — CURRENT: B staging56; upload/processing/gallery integration accepted in isolation

Supersedes prior55-only checkpoint:0055 remains immutable;0056 adds reciprocal Owner request namespace and bounded Cloudflare IO-review guards. Actual B staging AND independent rehearsal DB now have56 migrations; fresh private backup/parity/FK0 passed,135 existing product tables unchanged and public/preview entryfalse. Details/recovery: docs/STAGING_PROCESSING_ACCEPTANCE.md; protected `.local/staging-0056-apply-proof.json`. No A/DNS/customer/default-local mutation.

Final focused20 unit checks and10 isolated native/API/mobile groups pass, including atomic migration rollback, old job preservation, Owner policy persistence/replay/collisions/tenant denial,16MiB quota-safe refusal, V1/V2 completion-aware busy lock, Cloudflare recipe claims and review fences, three transient failures→IO review with reservation retained, private derivative/gallery finalization and375px save/reload. The integration uses a Sharp-backed Images double; earlier real Cloudflare adapter probe is separate. Worker/UI build,root/Web strict and scopedlint pass; full-chain test harnesses now use official split+atomicbatch for the larger migration. Production/cloud flag defaultsOFF and release gate remainsclosed.

Next concrete task: push this source, verify its single CI run, then create a narrowly gated hostedOwner B upload validation with native Images/private R2/gallery/100 test photos and D1/R2-consistent restore. The updated product Worker itself has NOT been deployed; remote schema success is not hosted product acceptance. Preserve missing Google/link/session/Guest/version/delivery/security requirements and do not mark MVP released. User-selected production hostname is pick.kinostudio.tw in A; existing staging callbacks stay unchanged. Prepare hostname-only entry routing without root/NS/existing A deployment changes and resolve exact permissions before applying. No repeated credential/login request needed.

## 2026-10-31 — CURRENT: 真實 hosted Owner／100 張 R2＋Images 圖庫驗收通過

B 的 Owner-only staging 已實際部署，來源 `7be9f78496103076f110a4f9e58e96788265f1da`，Worker version `1441d058-27f1-44e8-9440-4861f88d7f47`；CI41154235653 completed/success。真實 GitHub Owner 登入後，以產品介面建立測試 workspace/project/album，五批各20張合成JPEG經瀏覽器私人R2直傳及原生Cloudflare Images完成。100 jobs succeeded、300 assets、reserved0；全部300個物件GET/byte/SHA檢查通過，200衍生JPEG完整解碼、320/2048尺寸及比例、metadata移除與10張EXIF6方向通過。實際Edge圖庫24→48→72→96→100、100個唯一檔名／全部縮圖載入；直式1000×1600與下一張橫式1600×1000燈箱、關閉操作通過。匿名私人縮圖401，原7項hosted邊界通過。

這是受限 staging Owner 流程，非完整MVP。`private_direct_upload_verified`仍不提升為完整發佈就緒：跨租戶／配額故障hosted、含R2的備份復原及Guest等要求仍需完成。詳細scope/證據/復原下一步見 docs/HOSTED_100_PHOTO_ACCEPTANCE.md。D1已有新受ACL保護的匯出，尚未獨立restore，R2物件尚未備份。public staging目前enabled、previewfalse；其他產品feature仍OFF，無Cron／production／A／DNS改動。既有production gate保持closed，自動刪除OFF/dry-run，單R2節點。

下一切片：先完成這100張資料的D1＋R2一致備份與獨立復原，再修正Cloudflare政策16MiB但UI顯示64MiB／未設定Google仍顯示可點登入的能力宣告，依序完成真實雙OAuth綁定與Guest/版本/交付hosted驗收。不要重傳100張、重建Owner、重套0055/0056或重問憑證。保留原worktree/index與未提交變更。

## 2026-10-31 — CURRENT: 100-photo snapshot 獨立D1＋R2資料復原通過

B 新D1 bcf68fb8-0079-4c8d-b2a0-745c1aa97a26 與新私人桶kino-pick-restore100-20261031已真正還原完整snapshot。136表／2782列／726triggers／56migrations的schema、逐表hash、sequence與FK0通過；300物件自本機受保護備份還原並讀回SHA全吻合，共8,913,629bytes。原DB／原桶無寫入刪除，無A/DNS/Worker部署變更。已解決真實export的表／唯一索引／trigger載入順序問題，正常app guards及0055/0056保留。詳見docs/HOSTED_SNAPSHOT_RESTORE.md；以private consistent-restore-proof.json為準，不修改原匯出checkpoint的false狀態。

此為資料復原，不是恢復站runtime切換、新桶上傳簽名設定或完整MVP。CI41162510021真實failure：Guest測試helper未捕捉Miniflare socket rejection；新修正CI未通過前不能標green。先完成此最小CI route lifecycle修正，再接Cloudflare16MiB/登入能力UI與Google/Guest/版本/交付hosted驗收；不要重傳100張、重跑已過的復原、重建Owner或重問既有憑證。production gate及自動刪除仍OFF/dry-run，正式預設單R2節點。

## 2026-10-31 — Workspace upload capability slice accepted in isolation

Previous0de1d3c CI41164775708 completed/success. Implemented Owner-scoped upload capability by workspace policy: Cloudflare16MiB/Sharp64MiB,private no-store,closed when CF processing disabled;foreign/anonymous/query guards retained. All4uploadUI paths pass workspace;copy and preparation errors use effective size with64MiBbrowsercap,originaljournals/intentsemantics retained. Four focused unit tests,root/Webstrict,scopedlint,Worker/UI build and processing-recipes10 native/API/mobile groups passed. Fixed newbatch effect workspace dependency. No schema/cloud/customer/A change;NOT hosted acceptance of new UI. See docs/WORKSPACE_UPLOAD_LIMITS.md.

Next publish/verify newsource CI,refresh exact restrictedOwner entry bundle/native boundary/preflight with that successfulCI,then controlledB staging UI/API acceptance (not another100-photo upload/restore). Existing7be9f78 pilot unchanged,production gate/otherunmetflags andautomaticdeleteOFF/dry-run/single-node preserved. Google capability/identity andGuest/version/delivery hosted work remains;no new credential request pending.

## 2026-10-31 — CURRENT: Guest entry CI transport blocker reproduced and fixed locally

CI41171466586/7ee40f3 failed in Guest入口120s timeout,not deploymentready。Focused六情境真正重現context106 pending route cleanup hang。改用既有native loopback HTTP橋、先消耗全部response body後再注入丟棄/毀損、完整關閉server/ctx及收斂錯誤；不延長CI、不重試POST。故障注入採headers後body截斷避免Chromium透明重送；Entry驗權精確1次計數限定Entry文件，Gallery合法額外GET不混算。原53assert條件保留+2loopbackguards。六情境exit0，scopedlint/format/syntax通過；只是本機，不是全CI或hosted。詳見docs/GUEST_ENTRY_TRANSPORT.md與worker.local/guest-entry-focused-proof.json/fourth.log；所有失敗保留。

僅兩個test檔與交接變更，產品7ee backend/UI未改；B/A/DNS/客戶/schema/flags全未動。下一步新source CI真正成功後才刷新staging metadata及精確preflight，部署原受限Owner pilot，驗hosted16MiB。不要重跑100圖/restore，不relabel既有failure；無憑證或使用者操作需求。

## 2026-10-31 — CURRENT: B Owner staging refreshed; hosted16MiB acceptance passed

CI41176275152/6e942629 completed/success。真正部署B Owner-only staging新version c673b93a-401f-4c57-bfca-d0438e076031；CF下載bundle與預檢ebb9afa4...完全吻合，前後安全綁定/6Secret名/flags核對及7hosted邊界通過。當前public enabled/previewfalse，Guest等仍OFF，不是完整MVP。

真實Edge Owner session保留，介面16MiB；17MiB合成檔選取即拒、Startdisabled，remote D1前後upload/session/asset/quota帳務全同，sessions100/assets300/used8913629/reserved0。首24張縮圖decode與1000×1600直式燈箱、匿名私人thumbnail401回歸通過。只移除本機rejected項目，未傳新照片/重做100圖或restore。完整證據與回復：docs/HOSTED_UPLOAD_LIMIT_ACCEPTANCE.md，worker.local/hosted-upload-limit-proof.json；原7be9deploy/boundary另存歷史副本。

下一切片：受控Guest協作hosted promotion（先盤點hard-local/gates，限定B合成project，保留真實授權/備份/rollback條件；不能APP_ENV=local或globallyremoveguard），逐項Owner invite/Guest exchange/view/select驗收，及未配置Google登入能力顯示。所有原產品需求保留；production/private_direct_upload等未滿足readiness不改true，auto-deleteOFF/dry-run/single-node，無A/DNS/customer/schema更動。無憑證/使用者操作待辦。

## 2026-10-31 — OAuth availability vertical slice accepted locally

Implemented the current Worker React login provider capability: GET /api/oauth/providers returns names only, using the same complete nonblank ID+Secret predicate as createAuth. Partial/unconfigured providers are absent; UI loading/error/empty states expose no sign-in buttons. Owner identity/closed registration/implicit-link denial remain unchanged. Added only this read-only path to the existing Owner-only staging wrapper;Guest stays closed.

Actual checks: focused unit3 passed;root strict and Web strict passed;Worker/UI dry-run build passed;scoped ESLint/Prettier passed. Refreshed staging entry build plus native20 checks passed (all original14 boundary checks retained,3newAPI checks,3Chromium UI checks including actual GitHub-only response and explicitly injected loading/failure). This is local workerd/D1/R2/Chromium;Images is still a presence double here,not new hosted OAuth/provider/MVP acceptance. First agent build failed from a duplicate declaration introduced while patching LoginPanel;fixed,subsequent build passed. No schema/customer/cloud/A/DNS changes this slice.

See docs/OAUTH_PROVIDER_CAPABILITIES.md and docs/GUEST_HOSTED_PROMOTION.md. Guest inventory confirms config+service+capability local guards and missing synthetic-scope allowlist;do not open flags alone. Next publish this exact code snapshot together with previously unpushed hosted-limit docs,verify its one new CI,then refresh exact source/bundle/preflight before B-only deployment and anonymous real UI verification. Existing deployedOwnerpilot remains6e94262/versionc673b93a-401f-4c57-bfca-d0438e076031 until that occurs. All production/unmet readiness,auto-deleteOFF/dry-run,single-node retained. No credential/user action pending. Native proof now has20 checks;old14-check proof is historical,not acceptance of changed source.

## 2026-10-31 — CURRENT: OAuth availability deployed and accepted on B

Corrected source `5e5ac8b751401967809902efd06b64c997a82e6a` fullCI41184396089 completed/success (all steps). Refreshed actualCI metadata,exact-source scopedpreflight and B resource checks passed;final native20 bundle SHA `3b2fd10896f2adc89a10b04a49ac43c6ddb0e25177e76e27b506190fbb3dd7f7`. Formatting changed the earlier emitted bundle hash,so the final bundle was actually rerun through20native checks before acceptance;not silently relabelled.

Actually deployed B Owner-only staging version `6ab7a8fc-247e-46f3-8858-7a5ec914c768`;downloaded bundle matches,DB/R2/Images/6Secret names and closed flags unchanged. Closed deployment was verified before restoring the existing publicOwnerpilot;previewfalse. Ten hosted boundaries passed (old7 + configuredGitHub-only providers/query400/write404). New independent IAB tab8 visibly changed from Google+GitHub to only enabledGitHub;no login click/token/newOAuth performed. Existing realEdgeOwner session reload still reads the same syntheticproject;no new upload or schema/customer/A/DNS changes. Proof worker.local/hosted-oauth-availability-proof.json and current deploy/boundary proof;old6eproof preserved with suffix-6e94262.

This is an actual hosted availability fix,not fullMVP or newGoogle/link acceptance. Guest/production and unmetreadiness stayclosed,auto-deleteOFF/dry-run,single-node. PreviousCI41184204862 was superseded/cancelled;41184244943 remains actualformatfailure,not a success. No new CI is pending. Originalworktree branch/HEAD/index preserved;734candidate scan0credentialmatches. Current remote main and runtime both5e5ac8b. These post-acceptance docs (plus Guest asset-scope/fixture detail) are local and should accompany the next realcode slice;do not trigger redundantdocs-only fullCI.

Next: implement boundedGuest staging promotion using docs/GUEST_HOSTED_PROMOTION.md. Reuse existing focusedfixture;enforce precise syntheticinvite scope in issuance/exchange plus photo+version asset lookups (asset URLs lack albumId),retain trustedIP/admission/KDF/Securecookies and all currentACL. Native staging context and real independentGuest browser acceptance precede activation;never APP_ENV=local or globallyremoveguards. Do not reupload100/restore/bootstrap or request already-savedkeys. Edge1650468828 retained for continuation;anonymousIAB8 is routine acceptance and mayclose. No useroperation pending.

## 2026-10-31 — Closed synthetic Guest flow implemented; native accepted

Implemented strict B-only STAGING_GUEST_VALIDATION (defaultOFF),exact project/singlealbum service and API/photo-version boundaries,limited link-only/view/select/submit capability+Owner UI,and separate closed Guest entry/config. Existing local behavior and disabled safe metadata recovery retained;all other local/production guards remain. Actual focused10unit,root/Webstrict,scopedlint/format,UI+Workerentrybuild,nativeGuest19groups/full56migrations and oldOwner-only20boundary pass. Native flow creates actual session/privateR2+localSharp derivatives,picks/submits,Ownerexports the same immutable submission with audit,and validates scope/revoke/logout. See docs/GUEST_HOSTED_PROMOTION.md/private localproof. No realCloudflare/OAuth/browserGuest/publicTLS/expired-entry/trustedIP-edge acceptance;Images presence double/nativeSharp are explicit. Fixture403 transport failure fixed using dispatchFetch;injected-IP limitation recorded,not silently passed.

Highest-priority next task is now audited Owner album activation:actual product has no draft→active API/UI/command,and live synthetic album is draft. No remoteSQL bypass or activation has occurred;existing active-state guards preserved. Implement compatible nextmigration+atomic activation ledger/revision/confirmation/API/UI/tests/recovery,then independent backup/restore and B adoption before activating ONLY synthetic album and opening Guest. Three password modes/otherpermissions/Google+link/versions/delivery remain MVP requirements,not removed by the bounded firstslice.

No schema/cloud/customer/A/DNS mutation thisslice;runtime remains5e5ac8b/version6ab7a8fc-247e-46f3-8858-7a5ec914c768 Owner-only. Guest entry config public/previewfalse,noCron;production unmetreadiness,OFF/dry-run,single-node unchanged. Newnative check added toCI;exactcode publication/newCI required,not previous5e success. Preserve originalworktree/index and protected backups. No credential/useraction pending.

## 2026-10-31 — Audited album activation implemented; native13 accepted

Prior c1c8a92 CI41188887091 completed/success (allsteps). Added additive0057 album_activation_commands,atomic Owner draft→active/revision+1/fullbefore-after audit,immutable historicalreceipt/retry and reciprocal casefoldnamespace/REPLACE guards;new service/strict contract/API/defaultOFF flag and Owner confirmationUI. Capability failsclosed on OLD56/missingledger;GEToldtables remainscompatible. Separate closedOwner-onlyactivationprofile keeps allGuestflagsOFF and exactBsyntheticscope;productionnotadmitted. See docs/ALBUM_ACTIVATION.md.

Actual focused contract3+scope/flag7,root/Webstrict,scopedlint/format/UI+Workerbuild pass. Finalnativeactivation13groups pass,includingOLD56populatedparity/latefailure rollback/currentauth/CAS/replay/namespace/auditfailure andrealD1fixturehelper;oldOwnerboundary20 andclosedGuest19 on57chain pass. Legacy7fixturefiles nowactivate usingactualcommand+audit andpreserveassertions;no fake meta.changes. Earlier12proof/history andhelper/parity/UIpatch failures retained;no newrealOAuth/provider/browser/hostedactivationclaim. DefaultpersistentlocalD1 notmigrated.

B readonly actualbaseline confirmed4DB/source56/1syntheticworkspace/100photos/300assets/fixedalbumdraft/noactivationledger;existingisolatedOAuthrefresh worked,no key/useraction needed. NO cloudDDL/data/deploy/A/DNS/customer changes. LiveOwnerpilot still5e5ac8b/version6ab7a8fc;Guest/publicproduction andglobalunmetreadiness stayclosed,OFF/dry-run,singleR2. NewsourceCI stillrequired before adopting/deploying;oldc1success is not newactivationCI.

Next highestpriority:publish exactsource+verifyoneCI,thenfreshprotected56snapshot/newindependentBrestore+0057upgrade/oldrow-schema-sequence-FKparity,thenB-only57adoption andcontrolledOwner-onlyactivationdeployment/realUIaudit acceptance beforeGuestopening. Do notrerunOwnerbootstrap/100uploads/oldrestore or rawUPDATE. Appliedmigrationfiles0001–0056remainimmutable;0057notremoteadopted yet. Rollback/recovery is documentedforwardfix/auditretention,notdroporrewind newerdata.

## 2026-10-31 — Hosted Owner activation and UI parity gap

Actual CI41194080987 for aa8b74368f88060897f0c586e4316fe314e28286 completed/success. Fresh protected source56 backup restored into independent B D1 24788788-7bbc-4947-b781-c858c0d4f8c1, upgraded57 and readback verified. Source0057 adoption preserved135 old product tables, old schema objects and data; FK0. Source now57 migrations;0057 is applied/immutable. Proof apps/worker/.local/staging-0057-apply-proof.json. Initial raw dump local inspection failed on table creation order before cloud mutation; corrected strict normalization/transaction/deferred-FK rehearsal succeeded. No destructive rollback or restore over customer data.

B Worker activation profile deployed version0ff58553-e642-47f5-93dc-cbd2ae36ccd7, exact aa8 bundle d2313198240bc155cc74bcf4c4600ece7f3102b2f1eba6d349b11db43b3e4cc0; actual six Secret names, sourceD1/privateR2/Images bindings, noCron and10 hosted boundary checks passed. Existing Owner-only pilot publicly reachable, previewOFF; all Guest flagsOFF, product release not authorized. New local tools/check-staging-album-activation.mjs validates CI/source/native13/cloudrestore/backuphashes/resource config; no readiness bypass. Narrow empty0057 normalizer is not suitable for post-activation backups; inspect actual new shape before any future restore rehearsal.

Real existing Edge Owner UI opened fixed synthetic album confirmation and submitted once. Actual D1 draft/revision1 -> active/revision2, command1/audit1, before/after and request/session/actor joins verified;100photos/300assets unchanged. UI shows 使用中 and removes activation button. Proof apps/worker/.local/activation-ui-before.json and activation-ui-after.json; screenshot in visualization artifacts kino-pick-owner-activation-20261031.png. This is real hosted activation, not hosted Guest acceptance or full MVP release. No new credentials/user action pending; A/DNS/customer data unchanged, automatic deletionOFF/dry-run, singleR2.

User identified visual mismatch. Confirmed independent4174 prototype experiments/gump-demo (memory-only synthetic data, no API) and deployed React apps/web/target-ui are separate frontends. Production UI has not adopted prototype shell/sidebar/theme/layout; functional acceptance is not visual parity acceptance. Preserve prototype as visual reference and migrate its presentation into existing target-ui components with real API/auth/error semantics; do not replace functional frontend with memory-only demo. Track UI parity explicitly before declaring MVP accepted. Next bounded slice: reconcile Owner workbench shell/project/album visuals against prototype, retain real upload/gallery/activation; Guest hosted scope remains separately gated. Full Google/link/Guest/collaboration/version/download/delivery/custom-domain release acceptance remains incomplete.

## 2026-10-31 — 統一正式前端、透明 Logo 與真實 API 介面驗收

目前預設 pnpm dev/build/start 已統一為 Worker + apps/web/target-ui；v11 Logo 無外框實心底。Next／gump-demo 僅為歷史參考，4174 只轉址4180。舊「4180 fixtures 預覽」紀錄已過期；現在 http://127.0.0.1:4180/__review/login 是正式前端搭配隔離真實 Miniflare D1/R2／57 migrations／Sharp，不是雲端 OAuth。8照片、27assets、9處理工作。不得將本機結果當 hosted 或完整MVP驗收。

逐頁外觀／操作／真實API證據與未完成項目，請以 docs/FRONTEND_INTEGRATION_ACCEPTANCE.md 及 docs/HANDOFF.md 最新節為準。保存單一產品前端，保留所有原需求與既有授權／審計／重試。攝影師metadata推薦、freehand正式schema、固定交付、帳號綁定及hosted Guest仍待完成。新來源CI與B部署閘門通過前不部署；B基線aa8b743/schema57不變，A/DNS/客戶資料未改，自動刪除OFF/dry-run、單R2。

## 2026-11-01 — 當前接續點

使用者已要求必要驗證後直接部署B，無須重問原型版型確認。攝影師推薦／XMP原圖讀取與0058手繪、0059metadata正式接線已實作並有本機native／API／瀏覽器證據；仍未採用到B。請讀HANDOFF最新節、PHOTOGRAPHER_RECOMMENDATIONS.md、FREEHAND_ANNOTATIONS_MIGRATION.md，以及 docs/diagrams/kino-pick-architecture.html。先完成精確B協作profile／來源CI／fresh57獨立還原升級parity，再source採用與部署；不能拿本機證據當hosted驗收。B尚schema57，A/DNS/customerdata不動，OFF/dry-run/singleR2。
