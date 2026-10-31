# 工作區上傳上限能力

2026-10-31。本輪為source／隔離native驗收，尚未更新雲端部署。既有Owner-only staging仍7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47。

`GET /api/v1/workspaces/<UUID>/upload-capabilities` 沿用Owner session及工作區授權讀取目前processing policy，用同一個processingSourceLimit取得Cloudflare16MiB／Sharp64MiB；不複製backend admission規則。Cloudflare處理flag未啟用時enabled=false。回應private,no-store；未知／別人scope404、匿名401、任何query400。舊無workspace呼叫保留64MiB相容回應，不是上傳授權；實際reservation始終由DB政策及配額守衛裁決。

一般相簿、版本上傳、解析上傳與解析批次復原都傳入自己的workspace。一般相簿文案與prepareImage超限錯誤使用server limit與瀏覽器64MiB上限較小值；超限在讀header、解碼／hash／網路前拒絕。解析批次effect在workspace改變時撤銷並重新讀取，保留原journal、fixed intent與session隔離。能力為當次UI載入快照；政策之後改變仍由server重新驗證，不宣稱提供跨分頁即時推播。

實際驗證：新增Vitest4項通過（精確scope/signal/no-store URL、舊call相容、17MiB來源對16MiB先行拒絕、server超大宣告仍守64MiB）；root/Web strict通過；scoped ESLint通過。首輪新增effect缺workspace依賴的warning已修正；單檔Prettier未過後格式修正。Worker/targetUI build與現有processing-recipes native10組通過，本次加入D1授權政策64→16、off時disabled、匿名／異scope／duplicate/unknown query拒絕及legacy相容asserts。native375px組仍驗政策UI儲存，不冒稱已看過hosted新16MiB文案或真實Cloudflare enabled上傳。

證據worker `.local/upload-limit-types.log`、`upload-limit-web-types.log`、`upload-limit-build.log`、`upload-limit-native.log`。整合使用既有Sharp-backed Images double，不重做已通過的100張真實雲端照片／backup restore，也未改schema或正式資料。

前一source0de1d3c的CI41164775708 completed/success，證明Guest測試route cleanup修正已通過該次全CI；不是本輪新upload source的CI。下一步推送新source、確認其CI後，重跑restricted Owner entry的必要native boundary以產生新bundle proof，依新成功CI與精確backend/UI inputs更新原有scope preflight，再受控部署B staging，檢查真實Owner16MiB回應、介面、oversize不建立reservation及原100張圖庫。不可用舊6709/7be9 proof或production guard bypass部署新backend。

Google未配置的有效登入能力顯示、雙來源綁定/session、Guest協作／版本／metadata推薦／交付與其他hosted安全驗收仍待。production gate、自動刪除OFF/dry-run及單節點保留，A／DNS未動。

## 2026-10-31 — CI regression fixed without weakening the invariant

CI41167613971/de22a36真正失敗在resolved upload browser的 `Owner API calls must not use query strings`。這是既有安全慣例，不是放寬測試的理由；已將client改為上面的workspace路徑，舊無scope endpoint保留，兩者共用原授權/recipe handler且拒絕query。原resolved browser斷言完全未改，根因是本輪新增URI設計違反既有約定。

修正後unit4、rootstrict、scopedlint、真實Worker/UI build及processing-recipes native10組重新通過；另restricted Owner dry-run bundle的14項native/static拒絕邊界通過。這些native為隔離workerd/D1及明確Images double，不宣稱新的hosted16MiB UI已驗收。Log：worker `.local/upload-limit-path-types.log`、`upload-limit-path-build.log`、`upload-limit-path-native.log`、`upload-limit-path-owner-build.log`、`upload-limit-path-owner-boundary.log`；原CI failure保存於ci-41167613971-failure.log。

`tools/check-staging-upload-validation.mjs`不再寫死舊6709SHA/run。它必須驗本倉庫main push、指定ci.yml、完整成功CI及目前精確backend/UI/package/lock內容；用獨立index加入工作檔含新檔作比較，保留使用者index。所有B-only/56migration/獨立restore/14邊界/bundle/config/Secret名稱/defaultflags及productDeploymentAuthorized:false仍保留。用真實失敗de22CI與真實舊成功0deCI各跑一次：兩者都正確拒絕，後者明確因source不符拒絕。Canonical processing-integration-ci.json目前保留實際失敗de22metadata，禁止手改success；新source CI完成後以gh API刷新所有安全metadata欄位，再重新跑閘門與精確bundle檢查。

本輪尚無雲端部署或客戶資料變更。下一步唯一新CI通過後才做受控B staging與實際16MiB UI/API驗收；不重做100照片/restore，不擴張其他hosted功能或改A。
