# 0069 安全發布接續

目前為候選工具開發，B仍為schema67。不得把單一validator、自測fixture或restore-only proof當作完整release self-test／CI／hosted。

## 復原與採用

- 同一份fresh67受保護備份、同一個獨立庫，標準D1 migrations依序68→69，再fresh-source parity及adoption。兩版migration均綁定raw／LF canonical SHA與連續ledger。
- D1逐migration交易，整鏈不宣稱原子。若68成功、69失敗，停止並保留實際狀態；forward fix前重新核對來源，不用舊67 snapshot覆蓋新資料。依據：[Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。
- 舊67表逐欄／列、schema、sequence、FK照原標準保全。只有guest_invites、guest_invite_albums以完整舊欄投影驗資料，另外驗舊列custom、scope generation NULL及精確新增欄位；不能整表免驗。
- 0068配置updated_at_ms、0069 bootstrap.created_at_ms是新生成的兩個時鐘欄。各批須為正整數且批內一致，落在該庫遷移前後實測DB時鐘窗，68時間不晚於69，窗長至多30分鐘。其餘每欄精確比對；保留原始匯出、原時間及SHA。
- 69使用independentDrillParityVerified及bootstrapTimeComparison明列兩欄與independent/source窗口，不能寫exactIndependentDrillParity假稱全值相同。CLI receipts包含四次唯讀DB時鐘取樣；缺少或失敗時不能採用。

具名雲端備份／舊restore67退役授權仍待答覆。這份文件與工具修改不授權執行雲端命令、建立／刪除D1或修改live。

## 本機完整發布程式接線已補齊，雲端守門仍未驗

2026-11-09：current69 localEvidence、compound manifest、三個legacy DDL覆寫、完整live產品catalog雜湊、prior67/68/69與新receipt已接線，8檔93項專項單元與strict通過。真採用manifest新增sourceAfterSchemaSha256／Objects，由受驗工具產生；缺件時normal checker確實拒絕。完整self-test／CI／hosted未驗，不可拿synthetic unit fixture替代雲端證據。下列為必須保留的守門契約，程式接線不等於雲端驗收完成。

1. 新schema驗54個持久CREATE物件，加上guest_invite_albums完整ALTER後DDL。復原／live完整產品schema parity須攔住多餘copy或新物件；以同一catalog SQL及真adoption的完整產品schema digest核對，不只查已知名稱。精確GLOB排除sqlite_*及_cf_*保留空間；sqliteX自訂物件必須納入。
2. 舊0066 SQL比對只將approved_delivery_publish_guard、approved_delivery_live_guests改用0069；其餘6個物件保留。舊0068只覆寫album_retention_policy_command_apply，其他物件保留。ZIP4個物件仍精確用0067。
3. 手動清理native必須schema69並綁0069 hash，因為阻擋view已重建。B profile保留原33項及既有隔離，增加inherit capability成為34項，驗full69、當前flags與來源；另需真正執行inherit的API／D1 proof，不以B基本流程代替。
4. Human focused須full69 migration digest、目前bundle與runner；B sidecar也加入0069來源hash並保留原6項native，另加DB未來時間戳拒絕，現為7項native＋FK。推薦與衍生圖既有來源守門保留。
5. Predeploy依舊67/OFF receipt驗前版Worker，依真67→69 adoption驗live D1已69。歷史68/OFF、68/ON仍按各自契約驗；不能要求一份不存在的live68 adoption。
6. 新receipt須帶真實compound restore與上述proof。既有完整self-test的負例、正常CI、自動B、真Owner／Guest期限與dry-run驗收後，才能稱G2發布；不能只執行本機新validator測試。

自刪OFF/dry-run、無Cron、R2優先／Oracle30GB及A／Review隔離保持。G2清理snapshot缺口另見G2_CLEANUP_EVIDENCE.md。
