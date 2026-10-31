# B staging：工作區上傳上限實際驗收

2026-10-31。本次是受限Owner-only staging更新，不是完整MVP或production發佈。

- URL：https://kino-pic-staging.kino-pick-aaron2026.workers.dev
- 部署source：`6e9426297f6bc074fa6400c6f1604e0ff4fa87d5`；完整CI41176275152 completed/success，全部步驟無failure。
- 新Worker version：`c673b93a-401f-4c57-bfca-d0438e076031`；前版1441d058-27f1-44e8-9440-4861f88d7f47。
- B帳戶d3e930465c0df7e89b35de3ca65ea36a／D1 cdee0ac7-bf91-4852-9c17-a996c0b84f8d／私人R2 kino-pick-staging-d3e93046，IMAGES與六個secret_text名稱及旗標在部署前後核對。沒有讀出／輸出Secret值或新建Token。
- 實際CF content/v2下載bundle SHA與14-check native預檢相同：`ebb9afa4ea66993c7d8b33903ac75250eea7b555b86e435a28961806b86c896a`。先以workers_dev/preview關閉配置部署、讀回確認closed，再依原受控流程開啟同一staging。當前enabled=true/previews=false。

## 實際通過

1. 以GitHub API刷新本repo/main push/指定ci.yml的真實success metadata，再執行原限定staging checker。實際source、config、bundle、migration56與independent restore、6個Secret名稱、14native邊界與OFF flags符合；productDeploymentAuthorized仍false。
2. 7項hosted邊界：root200、匿名Owner API401、匿名init401、Guest404、registration404、foreign Origin403、encoded Guest404；失敗會自動關閉入口。本次全部通過。
3. 實際Edge既有Owner session在新部署繼續有效；重新載入後開啟測試相簿upload panel，顯示每張最多16MiB。
4. 選取本機17MiB合成JPEG，顯示「未加入 · 單張照片不可超過16MiB」，Start維持disabled。沒有按上傳。前後真正remote D1查詢的upload_sessions/upload_requests、assets、used_bytes/reserved_bytes完全相同：sessions100、assets300、used8,913,629bytes、reserved0。這證明超限未建立上傳工作；不是以假API回應驗證。
5. 清除的只是該分頁本機rejected項目，未刪R2/DB資料。既有私有圖庫首24張縮圖全decode；直式100號燈箱1000×1600正確並可關閉。匿名讀取真實私人thumbnail仍401。沒重傳100張、沒重複300物件GET或復原。

## 證據

Git忽略的worker `.local/processing-integration-ci.json`、staging-upload-validation-preflight.json、staging-upload-refresh-resources.json、staging-upload-refresh-version.json、staging-upload-validation-deploy-proof.json、staging-upload-validation-hosted-boundary.json、hosted-upload-limit-before/after.json、hosted-upload-limit-proof.json。部署stdout完整攔截到upload-refresh-deploy.log，不直接tail；未保存hosted截圖檔，UI證據為CUA可見AX/DOM解碼與remote帳務。

原7be9f78首次100圖驗收的deploy/boundary JSON已另存同名前綴`-7be9f78.json`，避免覆寫其歷史證據。既有100-photo/consistent-restore proof仍保留；未把本次邊界proof的realOwnerUploadTested:false改成新版本正向transfer驗收。

診斷：首次直接讀CF API時舊OAuth未被接受，先以既有隔離Wrangler whoami自動refresh並確認B，再核對成功；無重新登入或憑證建立要求。Python匿名client一次403（同樣拒絕），未當成Worker契約驗收；原Node HTTP路徑確認401，兩者不混為成功。無繞過TLS或安全限制。

## 界線與下一切片

實際發佈的是受限Owner pilot，CLI部署經完整CI及既有scope gate授權；不是GitHub Actions production cutover。Guest與其餘未驗feature繼續OFF，automatic delete OFF/dry-run，正式預設單R2節點。A/FILM.KINOSTUDIO、DNS、其他repo/部署、客戶資料、schema均未動。global private_direct_upload_verified等未滿足記錄仍不任意改true；hosted跨租戶/配額故障與完整Guest/版本/交付/Google link/session等驗收尚未完成。

下一步最高優先是受控Guest協作hosted切片：先盤點現有hard-local guards與native完整CI已驗條件，再制定只允許B staging合成project的明確promotion與備份/rollback門檻，逐項開Owner invitation/Guest exchange/view/select等必要流程，不能用APP_ENV=local或移除通用安全檢查；其他未完成權限仍關閉。並需處理未配置Google卻顯示可點登入的能力UI，保留原Google/GitHub單/雙來源同身分需求。pick.kinostudio.tw仍未接通，不動A。

回復：若新Owner驗收出現未授權行為，只關閉B本Worker公開/preview並讀回，保留D1/R2/審計；必要時審查前Worker版本再單獨rollback，不以舊SQL覆寫DB。本輪沒有schema變更，無需migration；不重跑Ownerbootstrap或原56migration。
