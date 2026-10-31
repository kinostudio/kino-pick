# Guest入口測試傳輸修正

2026-10-31。本輪只改測試helper與增加可單獨執行的runner；未改產品API/UI、schema、雲端資料、正式feature gate或A。

CI41171466586/7ee40f3在Guest fragment入口情境明確120秒timeout。新增只輸出context序號／去除UUID的path／階段的opt-in trace，在本機同六情境實際重現最後context106清理時仍有pending routes，停在unrouteAll(wait)。保留原失敗trace並僅停止該隔離測試PID樹，沒有碰使用者Edge或其他服務；未延長CI timeout或重試POST。

## 修正

- 沿用guest-downloads-browser既有的127.0.0.1 HTTP橋模式，取代page.route→worker.fetch→route.fulfill的攔截。Browser使用原生HTTP與cookie；所有API仍真正進隔離workerd/D1/R2，無fake成功API。
- 每個Worker response先讀完body，再決定送出、丟棄或故意破壞JSON。原lost/corrupt分支曾在讀body前return，會留下已提交POST的回應stream；此資源生命週期缺陷已修正。這是code-supported問題，不能單憑程式碼說是所有UND_ERR_SOCKET的唯一成因。
- 遺失且無cookie情境改成HTTP headers後的body截斷，刻意不傳Set-Cookie。初版raw TCP reset令Chromium在傳輸層自動重送POST，實際測試捕捉到2次而失敗；修正故障注入後，原精確1次POST／已提交但結果未知／單一session與無cookie斷言通過。不是新增產品retry或將2次改成允許。
- 六情境各自關閉context／停止HTTP server並等待in-flight handler，所有錯誤仍累積為測試失敗；worker dispatch有20秒signal，沒有增加原120秒總預算。所有server只許http://127.0.0.1，兩項新assert防誤綁其他host。
- 圖庫面板會合法再次GET /access；原全頁global=1斷言依React時序而不穩定。現在明確改成entryAccessRequests/entryAccessStatuses，只計真正文件仍是/enter時發出的授權檢查（其fetch正等待這次response，尚不能導航）；Gallery的真實GET照常送backend。保留精確1與401/200檢查，沒有改成>=1。其他原assert條件保留。

## 真正執行的驗證

在apps/worker目錄（先有現有Worker/UI build），執行 `KINO_GUEST_ENTRY_TRACE=1 node tests/guest-entry-focused.mjs`；PowerShell用$env設定。runner重用既有guestDownloadChecks(fixtureOnly)建立處理完成的私有照片，兩個真實Worker分別開/關Guest exchange，同隔離D1/R2、完整56 migrations、合成Owner session。無真實OAuth、R2 provider或客戶資料。

六情境最後全部通過並正常exit0：disabled、invalid fragment、link-only進圖庫/挑片提交/異scope拒絕、錯密碼後明確修正、已提交但無cookie遺失回應、已提交且有cookie但JSON毀損後明確驗權。node syntax、兩檔scoped ESLint與Prettier通過。AST比對原53個assert條件仍在（Entry欄位更名後相同），新增2個loopback guard。沒有另跑整套已過單元測試或把本機結果當全CI成功。

成功證據：worker `.local/guest-entry-focused-http-fourth.log`及`guest-entry-focused-proof.json`，有helper／既有Worker bundle／成功log SHA、cases6、remoteProvider:false。之前before掛起、HTTP first/second/third失敗日誌皆保留，非通過：first包含TCP透明重送，second/third揭露Gallery額外GET計數競態；一次從錯cwd啟動在讀bundle前ENOENT，未進測試或寫雲端。

## 下一步

發布此測試修正後，確認唯一新CI（含原完整cloudflare smoke）的實際結果，不能直接重標7ee或先部署。通過才刷新Owner-only staging gate的真實CI metadata／精確來源比對，再受控部署B及hosted16MiB驗收。產品source相對7ee沒有改動，既有fresh14 boundary/bundle proof可依checker核對，不需重傳100圖或重做已通過一致備份復原。production gate、其他未驗feature、自動刪除OFF/dry-run、正式單R2節點及A/DNS都保留。
