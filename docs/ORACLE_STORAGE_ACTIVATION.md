# Oracle 正式儲存接線（2026-11-06）

> **目前狀態（2026-11-06 最新）：** B 已成功部署3832118／version37e159cf，schema65。Owner啟用30GB的單一指令已提交為requested1／revision1，但VM健康同步失敗，effective=false，仍不分流。R2原額度未改、hosted VM上傳未驗；下文較早的e6／requested0描述為歷史準備紀錄，以本節與HANDOFF最新節為準。

## 已完成與尚未開通

Oracle VM 的專用儲存服務已實際建立。B 最小權限登入已恢復，備份／獨立復原／fresh parity／0063–0065 採用全部通過；B 現為 schema65。兩項 Oracle Secret 已安全保存到 B，secret-only baseline 為 `ed43c23d-ae6c-4b73-b5d8-d1916a180e37`，程式來源仍 e6d4d68，設定與公開入口資產不變。**網站 Oracle 分流尚未啟用**，正在整理受控 CI／正式程式部署；Owner 指定工作區已審計配置39GB（R2 9GB＋Oracle30GB），節點已登記；不必重問登入或重跑已通過的復原。

| 項目                | 驗證狀態                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| VM 常駐 S3 相容服務 | SeaweedFS 4.52，獨立非登入帳號，systemd 常駐                                                                      |
| 邏輯容量            | 30,000,000,000 bytes；真實 29→30 GB 調整及讀回通過                                                                |
| 實體容量隔離        | 新 regular-file ext4 image 33,000,000,000 bytes，實體預配置已核對；沒有格式化 `/dev/sdb`                          |
| 主機空間底線        | 20 GB；驗收時約 122.7 GB 可用，不是永久保證                                                                       |
| 健康／配額同步      | VM systemd timer 每 60 秒；實際 unit Result=success、ExecMainStatus=0                                             |
| HTTPS 與私人直傳    | `drive.kinostudio.tw/kino-pick-overflow/`；真簽名 PUT、SHA、讀取、匿名拒絕、回收 fence 通過                       |
| CORS                | 僅 B staging origin；其他 origin 無允許標頭，公開桶管理路徑 403                                                   |
| 新上傳分配          | source0065＋原生 D1 fixture 已驗：R2 優先、滿時 VM、釋放 R2 reservation 後下一筆回到 R2、既有 VM session 不改節點 |
| B D1／Worker        | 已採用 schema65；程式尚未更新，source 仍 e6d4d68，secret-only baseline ed43c23d                                   |

## 容量與分配

### 最新容量守門與小型實體回收

健康 `freeBytes` 已同時受主機與 loop-mounted ext4 可用空間約束：`min(hostFreeBytes, 20,000,000,000 + max(0, innerAvailableBytes - 536,870,912))`。實際同步 proof `docs/releases/oracle-filesystem-free-guard.json` 記錄 host free `122,740,424,704` bytes、image filesystem available `32,279,691,264` bytes、回報 `51,742,820,352` bytes；專用 health sync exit0，儲存、timer、Review 與 Caddy services 均 active。這證明外層仍有約122.7GB時，健康值不再只照報外層空間。五個標準函式庫單元測試在 root 與 release clone 均通過。此 proof 沒有改配額或照片，且明確標記 30GB near-full vacuum 與 reboot 尚未檢查。

小型實體回收見證的公開 proof 為 `docs/releases/oracle-physical-reuse-small.json`。同一 job `de75f317-7cb5-4098-b094-17c4405b0dd1` 的首次嘗試因 `reclaim_threshold_not_met` 失敗，root checkout 私有紀錄 `.local/oracle-volume-reuse-live-first.json` 保留此結果；之後沿用同一見證續跑，第一輪 physical vacuum 回收 `5,251,072` bytes，最後一輪再回收 `1,052,672` bytes，payload 最終為0，兩個物件仍是永久零位元 fence，survivor SHA 未變。邏輯刪除以 fence 保留安全邊界；實體空間要等非同步 collection vacuum 才會釋放。這次只測6,291,456-byte合成 payload，不能外推為30GB near-full、檔案系統擴大或 reboot 驗收。

補充真混合接線驗收：`.local/oracle-live-pipeline-first.log` exit0，proof `.local/oracle-live-pipeline-4ec43921-00c3-457c-a4f2-de4d6007b853.json`。隔離 D1／本機 R2 配合真 HTTPS Oracle，兩筆 metadata reservation 模擬 R2 9GB 滿額後，實傳 147,993-byte PNG 到 VM，完成原圖驗證、LocalSharp 縮圖／預覽、三資產 node／SHA 及 Owner gallery 私人預覽讀取；取消 R2 reservation 後下一筆新 session 回 R2、重送既有 session 仍 VM。原圖與兩衍生圖共213,767 bytes 曾保留為私有驗收證據，後已用固定 proof hash／同一 cleanup journal 回收成永久零位元 fence，三項 HEAD verified；不是 hosted B／真 OAuth／大檔 R2 實傳。清理證據 `.local/oracle-witness-cleanup.json`，不再有這三個未計入的合成 payload。

本測試只將 VM 私人 policy 從 revision0 推進到 **revision1／30GB**；B policy 保持 revision0／requested_enabled=0。B 首次有效設定採 revision1／30GB 即可吻合，勿倒退 VM revision 或藉直接改寫歷史消除差異。

最終 `.local/oracle-post-integration-state.json` 證明 systemd 已實際消費並保存 revision1／30GB、健康仍新鮮、33GB image 仍實配，Review 與新服務／timer 皆 active。

每個新 reservation 重新讀取節點帳本，計入原圖、16 MiB 衍生圖預算與尚未認列的處理預算，不把 immutable 歷史 reservation 重複加總。R2 容量已知且足夠時直接選 R2，不依賴 Oracle 在線。只有 R2 確實不足，才檢查 Oracle 的啟用意向、固定節點身分、120 秒內健康證據、掛載、容量同步、實體 free floor 與配額。

0065 的 SQL 在同一 reservation transaction 再驗一次容量，阻止競態超配或 R2 已有空間時直接分配 Oracle。重送沿用已記錄的 session 節點；不因 R2 後來騰空或網路失敗搬移既有上傳。workspace 商業配額仍獨立，不因有 VM 就繞過；B 啟用時須對平台 Owner 的指定 workspace 明確配置可用額度並審計，不得無差別提高其他租戶配額。

後台設定先保存受授權的固定 requestId／revision 命令，再以 ETag CAS 發布私人 `_kino/system/storage-policy.json`。VM 只接受固定欄位的 1–100 十進位 GB、單調 revision，應用桶配額後發布精確五欄健康物件。同步未完成時不得顯示已生效或接新 VM 上傳。降低邏輯額度不縮小 ext4 image，也不刪照片。

## 運作邊界與復原

- 專用服務、image、設定及日誌位於 `/opt/kino-pick-storage`、`/srv/kino-review/.kino-pick-storage.ext4`、`/etc/kino-pick-storage`。應用憑證與 bootstrap 憑證分開，root600；只有桶專用應用身分安全保存到忽略且 ACL 限制的本機設定，未輸出值。
- HTTP／gRPC 八個埠 15333–15336、25333–25336 全部只監聽 127.0.0.1。Caddy 只加專屬物件 path，保留原 Host/path；保留 root-only 原設定備份，先 validate 再 reload。Review API／standby／failover／Caddy 驗收時皆 active；A 與 DNS 未改。
- 暫停新 VM 分配時關閉 admission，不刪節點、credentials、資產、歷史或 fence，也不能關閉已有 VM 檔案的 resolver。VM 故障會影響其照片讀取；這是容量擴充，**不是備份或高可用副本**。
- schema 0063–0065 已通過新鮮 B 備份、獨立 restore／upgrade、舊資料與 FK 比對、fresh live parity 並採用；回條 `docs/releases/oracle-storage-0065-restore.json`。接續現有 CI／受控部署，未來 schema 變更仍須同等復原驗證。復原優先關閉新分配及 forward fix，不 DROP 歷史或把舊備份覆蓋新資料。
- 自動刪除仍 OFF／dry-run，沒有新增 Cloudflare Cron；VM timer 僅同步容量與健康，不清理照片。

## 證據與失敗紀錄

- `.local/oracle-capacity-live-proof-final.json`：真 VM 配額、實配 image、unit、loopback 與 Review 服務。
- `.local/oracle-live-storage-proof.json`、`oracle-live-storage-test.log`：單一新合成 PNG 的真 HTTPS／SHA／fence；不是 hosted app 或真 OAuth 驗收。
- `.local/oracle-live-cors-test.log`：真 HTTPS CORS 與桶管理路徑拒絕；另一個 primitive test 未在此重跑，不合計 skipped 為通過。
- `.local/oracle-admission-native-final-third.log`、`apps/worker/.local/oracle-storage-admission-native-proof.json`：最終 selector 的原生 D1 七群組；20 筆 metadata reservation／取消，Oracle S3 mock，沒有實體大檔上傳。
- `.local/oracle-policy-and-adapter-tests.log`：三檔八 tests；另有 processing-node 兩 tests 通過，不與舊重複執行結果累加。
- `.local/oracle-admission-final-build-elevated.log`：本機 target UI／Worker dry-run 通過。首次 build 因 sandbox 父目錄讀取拒絕失敗，保留原 log，不列為成功。

保留首次 mountpoint 回傳碼、quota PUT 204、ext4 discard 造成 sparse image、selector planner 誤用及第一次 native 失敗紀錄。已分別修正為 GNU mountpoint 32、接受並讀回 204、nodiscard／補齊實配、明確容量判斷；不能把早期失敗當驗收通過。檔案系統動態擴大／重開機、混合節點完整清理及 B hosted 流程尚未驗收。
