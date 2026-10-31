# 相簿啟用：草稿 → 使用中

2026-10-31。本機原生驗證通過；0057 尚未套用到 B，也未部署新程式或啟用遠端相簿。

## 行為與 API

- Owner 明確確認後，只有目前為 draft、revision 相同、專案未封存且仍屬於目前有效 Owner session 的相簿可變 active；revision 恰好加一。
- `GET /api/v1/albums/:albumId/activation-capabilities` 回傳 `{enabled:boolean}`；需先通過 Owner 授權。旗標關閉、非草稿或新 ledger 尚不存在時為 false，避免舊56 schema顯示無效按鈕。
- `POST /api/v1/albums/:albumId/activate` 接受嚴格的 `{requestId,expectedRevision,confirmActivate:true}`，回傳 `{album}`。query／錯誤 Origin 拒絕；request UUID 正規化為小寫。重試保留同一 requestId 和 expectedRevision。
- 同一筆已提交的要求回傳歷史 audit receipt，後續改名／保護設定不改寫原收據；新 request 對已啟用相簿、過期版本與重用 request body 衝突拒絕。每次重試都重新檢查目前 Owner session 和 ownership。
- 啟用只改生命週期，不會自動建立邀請、發送連結或給 Guest 權限。上傳完成也不自動啟用。

## Schema 與安全邊界

`0057_album_activation_commands.sql` 為 additive migration：新增 append-only activation ledger、原子 state＋完整 before/after `album.activated` audit、case-folded Owner request namespace 雙向防碰撞；保留既有56migration及所有舊表資料與原schema物件。

raw ledger UPDATE／DELETE／重複 INSERT／REPLACE 拒絕；API replay 由 service 讀已提交的不可變收據，不用 REPLACE 或忽略真正錯誤。draft→active state guard 要求真正 command 與 revision+1；audit 寫入失敗則 state／command 一起回滾。舊測試的直接啟用準備碼改用真實 D1 command helper；原有 denial assertions保留，兩個單列更新斷言改查實際 command row count，不假造 meta.changes。

`ALBUM_ACTIVATION_ENABLED` 預設 false。只准 local 或既有精確 B staging context；production／其他帳戶、桶與 origin 拒絕。`wrangler.activation-validation.jsonc` 使用現有 Owner-only entry，Guest 旗標全 OFF，public／previewfalse、無路由／Cron。僅此 profile 開啟 activation，且 scoped middleware 限定既有合成相簿；原 Owner upload-only profile保持activationOFF。

## 介面與驗證

實際 Worker UI 對 draft／editable相簿先查 capability；未確認可用前不顯示操作按鈕。使用明確確認面板；網路未知結果保留原 intent，僅由使用者重試，不自動 POST。回應核對固定scope、active及原expectedRevision+1後才刷新正式資源；不在前端假造active。衝突要求重新讀取，401／403停止操作。

本輪實際通過：activation contract3單元、scope／flag7單元、root／Web strict、scoped lint／format、UI與Workerentrybuild；native activation13groups（OLD56 populated upgrade parity／晚期失敗rollback、授權、CAS、immutable replay、namespace、auditfailure與真實fixturehelper）；Owner-only20、Guest19（完整57migration）回歸。Images為presence double；native圖像fixture另使用LocalSharp，不是新的真實Cloudflare Images驗收。UI已接線與型別／建置驗證，實際瀏覽器確認／未知結果操作尚未驗收。

失敗紀錄保留：早期UI重複setter、native parity誤將新增空ledger視為舊資料改變、追加helper測試時誤用db變數，均已修正並由最終驗證通過；不算產品或雲端成功。原12group proof為較早狀態，最終13group proof在 worker.local/album-activation-local-proof.json。Guest migration57 proof與舊56/c1證據分開解讀。

## 套用與復原順序

1. 新來源的完整CI成功，核對0057與nativeproof hash。原CI41188887091僅代表c1c8a92，不可替新activation來源背書。
2. 新鮮受ACL保護的B staging56匯出；在新的獨立B D1還原該snapshot，先確認schema／逐表hash／sequence／FK parity，再升級0057並核對所有原資料不變。
3. 確認目標B及指定sourceD1、關閉驗收入口防止並行寫入，再採用0057到staging；保存前後匯出／hash／ledger57／FK與獨立升級parity。不得用直接 UPDATE 啟用相簿。
4. 精確來源／bundle／配置／Secret名稱／實際CI與資料復原證據齊備後，先部署仍拒絕Guest的Owner-only activation profile。以真實Owner介面只啟用指定合成相簿，驗audit／重試，保存新snapshot與必要復原證據後才接續hosted Guest驗收。
5. 程式回退先關activation旗標並回復已驗收Owner入口；0057 additive schema與所有command/audit保留。已成功active狀態不能靠舊備份或裸SQL抹回draft；需經另行驗證的forward correction。只有在隔離復原站演練資料回復，不能用會覆蓋較新寫入的舊快照降版正式／客戶資料。

本輪B唯讀確認：4個D1、source56／1個合成workspace／100photos／300assets／指定album仍draft／無activationtable。尚未建立新cloudrestore、匯出新備份、套用0057或改部署；R2、自動刪除OFF／dry-run、單節點、A／DNS／客戶資料不變。
