## 2026-11-07 代表核准與固定版本成品交付已自動部署 B 並真實驗收

最終source ac5dd7bd98ae10125f28acd8a73ed0dec72dda94，完整CI42381439868成功，既有流程自動部署42383253098成功；Worker be30a41a-f94f-4515-b601-eda1db55849a，baseline bot6980099，schema66。已明確授權退役舊restore65並保留完整備份；fresh65→獨立restore66→live parity／0066採用通過。D1約7.3MB，先前阻塞是10個DB名額，非照片或資料量滿；未刪其他DB。

真Owner在既有合成613487…相簿、a3a6…照片為V3建立兩份邀請的固定請求ecd6a2b7…；只有一位Guest代表確認，雲端唯讀核對為2個指定邀請／1筆receipt。Owner只交付INV-3061D3CE；獨立Guest實際下載V3。暫時將head3→1仍下載同一V3原圖，後還原head3／revision3；V2保持queued。三次native下載均21527bytes、SHA b26b590c55c31f7d092f2e65d400134cfb252dae3eea81c70dbbef5c2880a6c7，含撤銷後重新發布的實際檔案。

INV-40C9BFFB可看相簿但看不到交付檔名或下載控制，重播第一人的直接下載URL回GUEST_ACCESS_REQUIRED。Owner確認撤銷後，原收件人連結移除且直接重播亦拒絕；重新發布只給第一份邀請。最終保留active交付4cf01abe-0f82-45e6-b185-7426bc6b5d7e供驗收，舊167ec913…保持撤銷與歷史。雲端審計核對published2／revoked1／requested3／generated3；兩份manifest皆固定V3與唯一收件邀請，IP只檢查型別text，未輸出原值或憑證。核准在Guest登出後仍保留，沒有要求第二位確認。

實際觀察保留：部署後首次Guest核准面板讀取曾顯示一般服務錯誤，同Guest直接GET成功，透過可見重試後恢復並完成其餘流程，原因未定，不宣稱首次載入零錯誤或負載穩定。可選CLI審計首讀7403；確認B OAuth與既有D1權限、明確固定account後回讀成功，未變更／擴大憑證。先前3次CI失敗（Web narrow／OFF多讀／舊schema證據）均保留並修正；最終完整CI成功，不以失敗冒充通過。

證據docs/releases/approved-deliveries-hosted-acceptance.json、0066-restore與retired-restore65 manifests；截圖root .local/approved-delivery-{guest,owner}-hosted.png。真Owner／獨立Guest頁保留可操作，連結token只用於瀏覽器記憶體並已清除工具變數。正式候選仍在.local/oracle-release-20261106，根不同產品變更保全，勿覆蓋。

此切片完成；完整MVP未完成。下一步依MVP_RELEASE_PLAN完成ZIP／基本通知、其餘retention確認與production cutover；不要重做已通過0066復原、代表核准、固定交付、密碼或Oracle接線。未驗hosted負載／CPU記憶體數值、實機觸控、真第二租戶帳號（native跨租戶拒絕已過）。A／DNS／Review／客戶資料未改；自刪OFF/dry-run、無Cron、R2優先／Oracle30GB保持。

## 2026-11-07 代表核准＋固定版本成品交付：本機完成，B 復原名額待確認

沿用既有0054核准與原介面；一位明確授權客戶代表確認即可，Owner再明確發布給核准名單中的收件邀請。新0066僅增2 views／3 indexes／3 triggers，固定原圖版本、檔名、節點、大小、mime、SHA與核准收據，不隨目前head切換。發布／撤銷／下載沿用append-only audit；查看與原圖下載獨立，租戶／相簿／邀請／session／期限／撤銷逐次驗證。Guest只顯示自己的安全下載歷史，不回傳原始IP。單一照片一份交付，可多次發布；ZIP／通知仍待完成，非完整MVP。

實跑：18 config/boundary＋17 Guest-history單元；26本機原生B-profile組（schema66、2影像fixture）；13攝影師回歸組；5 Chromium核准／交付組，實際存檔size／SHA一致。25份交付為同一原圖的metadata測試，不是25張上傳。strict、product/profile build與scoped lint通過。負面注入GET503與publish409後恢復正常，無草稿燈箱可關閉；精確journal重試、撤銷與request-ID衝突保留。證據docs/releases/approved-deliveries-local-acceptance.json。保留先前失敗紀錄，未把失敗／mock負面回應當正式驗收。

雲端阻塞：B實際回覆D1數量已滿，新的獨立0066復原庫未建立，未套用live0066、未部署本次功能。已完整匯出舊獨立測試庫kino-pick-restore65-20261106（04966465-e0f7-4cd8-9c32-7065034406cd），本機獨立還原65／FK0；2979263 bytes、152表／3039列、SHA e4e44ce7f81cc6b6ecd9feefcc2970c43c1f2cc6b069cb85209007246d539aff，符合原0065 proof。已提出一次刪除此舊測試資源的確認，尚未答覆；不可擅刪、不可繞過復原gate。備份在release clone的apps/worker/.local/approved-deliveries-0066-20261107/preserved-prior-restore65.sql（受ACL保護）。

下一步：收到明確允許後只退役上述舊復原庫；以固定B工具node tools/rehearse-approved-deliveries.mjs --restore產生fresh65備份並遠端獨立復原/升級，成功後--adopt做live parity再只套0066。真正manifest出現後跑release self-test→正常CI→自動B部署→真Owner／獨立Guest核准及固定V3下載、head切換驗收。工具使用隔離Wrangler config；失敗停止不覆寫live。復原優先forward fix；不要將舊snapshot覆蓋新資料，任何回滾先關新flags並保留審計與資產，不能刪歷史換綠燈。

B目前仍是source55af3ca／CI42353228572／deploy42354807451／version616e7a23-cd3f-4738-bc55-82da5c226ad9，schema65。正式候選在.local/oracle-release-20261106；根不同產品變更保全，A／DNS／Review／客戶資料未改，自刪OFF/dry-run、R2優先／Oracle30GB保持。尚未驗新CI／hosted／ZIP通知／負載／實機觸控。

# Version confirmation and delivery: implementation boundary

## Existing requirements

The client must be able to confirm an exact retouched version,with `review_round_id` / `approved_version_id` retained for delivery. Immutable originals/versions,tenant isolation,private Guest sessions and append-only actor/session/request/UTC history remain required. Current-head download is not final published delivery.

## Current evidence

Guest version comparison exists. Owner version history and CAS current-head switching exist;an equivalent Owner comparison canvas remains unfinished. The12 persisted Guest permission bits end at can_compare_versions and mask4095;none represents approval. Shared selection reviews have sealed invitation membership and immutable command/result/audit patterns,but their selection authority must not be reused as version approval authority.

## Authorization and target direction

Use explicit Owner-authorized confirmation requests tied to exact photo/version and scoped invitations;an additive sealed relation avoids rebuilding the old mask table or implicitly granting approval to viewers. Establish live Owner/Guest session and invite album scope before replay or mutation. Capture exact head revision at request creation;never move an old receipt to a newer version automatically. Record each Guest identity separately,even when an invite is shared. Preserve original receipts and request IDs on retries. No new approval endpoint,permission,table or button is implemented by this inventory.

## Pending product decision

The user did not understand the initial compound permission/aggregation question. It was clarified as:when several clients review the same retouched photos,is one representative confirmation sufficient,or must every designated client confirm? A simplified question remains pending. No answer or aggregate project/delivery policy has been inferred. Exact-version individual receipts can be designed independently;automatic publication/whole-project approved transitions must wait for an explicit rule. For an all-client rule,the implementation must also define the fixed designated identity set;new anonymous visitors cannot silently change the denominator.

## Next vertical slice

Define immutable request and individual confirmation contracts,implement native D1 scope/target/request-ID guards and same-body retry,then the actual Owner/Guest UI with a focused positive/denial/replay race test. Final delivery should publish a fixed authorized manifest;later head changes must not change already-published bytes. ZIP/background generation,notifications,expiry/revocation and retention protection remain required and unfinished.

## Confirmed product decision — supersedes the pending section above (2026-10-29)

The user chose「其中一人代表確認即可」:any one authorized client may confirm as a representative. A request must define its authorized invitation set and fixed photo/version;one valid Guest confirmation is sufficient,while the individual identity/session/UTC/request remains recorded. New visitors do not change the required number. New heads do not inherit old approvals. The earlier question is resolved;do not ask it again. Next implement the immutable request/membership and confirmation record,with explicit Owner authorization independent of existing viewing/selection/comparison permissions.

## 2026-10-29 local implementation status

Owner-authorized immutable invitation-scoped requests and one-Guest exact-version receipts are implemented locally behind the default-OFF local-only capability. The historical sections above describe prior state. New heads do not inherit confirmation. Source migration0054, API and UI have isolated native/API checks; persistent upgrade, browser acceptance, immutable delivery manifests, hosted provider configuration and production E2E remain pending. Roll back code by disabling the capability and preserving all approval/version/audit data; rehearse backup/restore and prefer forward schema repair before any persistent migration.
