# Guest hosted promotion：相容性盤點與驗收邊界

2026-10-31。指定合成資料的封閉 Guest 入口已實作並通過本機原生驗證；尚未部署。線上仍是 Owner-only staging。

## 第一個受控切片

先完成 Owner 邀請 → Guest exchange → 私人圖庫 → 選取／提交 → Owner 匯出；沿用現有 D1 交易、session、權限與 append-only 事件。只允許既有合成驗收 workspace `bd927a6d-d5d3-4743-bbae-e4560cdda4c7`、project `08954949-ae90-4353-be2f-ae4a8f40b78d`、album `613487da-e6ff-4ada-9b66-949f21fcfa2c`。不可假設 staging 永遠沒有其他資料。

## 實際衝突

- `config.ts` 在非 local 拒絕 exchange／selection。`invite-issuance.ts`、`guest-exchange.ts` 各自也限制 local；兩個 capabilities endpoint 另外限制 local。只改旗標或 UI 無法開通。
- Guest selection、Owner selection-policy／submission／export／reopen 主要檢查 selection flag；Guest access／gallery／assets 依 session 與邀請授權，沒有合成資料 allowlist。新入口必須限制讀寫路徑與相簿，不能只限制邀請建立的畫面。
- 邀請建立目前只檢查 Owner 的有效專案／相簿。exchange 必須用 token hash 查出的實際 sealed invite 核對 workspace、project 和完整 album 範圍，不能相信請求自行帶入的 scope。
- 現有相簿為 draft；未通過前不得為測試方便改其他專案。啟用時只操作上述合成相簿，保存狀態前後證據。
- exchange route 拒絕 `CF-Worker`，僅使用 Cloudflare 提供的 `CF-Connecting-IP`；保留 canonical IP、HMAC 假名與 D1 admission。不可改讀 X-Forwarded-For 或自行補可信 IP。
- 密碼模式使用 D1-wide KDF permit；本機 scrypt 通過不代表 hosted CPU 限制通過。三種密碼模式仍是 MVP 要求，分別保存真正遠端結果；link-only 首次驗收不算密碼驗收。
- staging 必須保留真實 signing secret、Secure/HttpOnly/SameSite Cookie、Origin 檢查及封閉 Owner 註冊，不能將 APP_ENV 改 local。

## 實作／啟用順序

1. 新增預設關閉的精確 B staging validation context；配置錯誤、production、錯誤 host/account/bucket 一律拒絕。只為這個 context 逐項允許三個 capability，其他 local-only 閘不動。
2. service 先保證 invite issuance 與 exchange 的精確合成 scope，再新增獨立 Guest validation wrapper，限制 Guest album 路徑及 Owner selection/export 範圍。原 Owner-only wrapper 留作回復入口。
3. 以 native workerd/D1/R2 執行真正 staging 配置的正反案例：合成 scope 可用、其他 scope 拒絕、失效／撤銷／到期／權限／Origin／重播與 admission 不放寬；沿用既有交易及事件驗證，不新增一套假 API。
4. 真實 CI 成功、精確來源／bundle／配置核對、既有獨立 D1＋R2 snapshot restore 證據齊備後，才可受控部署 B。以獨立 Owner／Guest 瀏覽器真正驗收，保留版本、網址與證據。
5. 任一意外 scope 或授權結果立即關閉新入口，回復已驗收 Owner-only 配置；不刪除原圖、版本、歷史或測試紀錄。

目前已新增預設關閉的 STAGING_GUEST_VALIDATION、service scope、API boundary 及獨立的 closed entry/config；原 Owner-only 入口保留。未修改 schema／遠端資料，尚未驗收 hosted Guest。正式部署閘、所有原產品需求、自動刪除 OFF／dry-run、單 R2 節點不變；A／DNS 不動。

## Native fixture reuse and asset scope

Read-only follow-up found `apps/worker/tests/guest-entry-focused.mjs` as the smallest real flow fixture:full migrations + Owner session + private R2/photo fixture,then existing browser helper creates an invite,exchanges,views,selects and submits. It is currently local/HTTP with local cookie names;do not claim it tests staging Secure cookies without an explicit fixture adjustment. `owner-selection.mjs` can test exports separately but seeds its Guest session;that is not yet one continuous exchange→submit→Owner export acceptance.

Guest image URLs are `/api/guest/photos/:photoId/versions/:versionId/assets/:kind`,without albumId. Any scoped staging wrapper MUST resolve photo+version to the fixed synthetic workspace/project/album server-side before forwarding,alongside the existing session/permission checks. An album-path allowlist alone is insufficient. Entry uses `/guest/albums/:albumId/enter#token=...`;keep bearer in fragment and never log/copy it into evidence.

## 2026-10-31 — Closed implementation and native acceptance

- `staging-guest-scope.ts` requires exact B account/bucket/origin and explicit opt-in;only exchange/selection gain this narrow hosted exception. Other local-only gates remain intact.
- Issuance is one fixed project/album,link-only,view/select/submit only. Exchange checks persisted sealed invite's full scope/mask after admission and before KDF/session writes. Disabled-flag safe metadata replay/recovery remains unchanged.
- `staging-guest-boundary.ts` limits Guest routes,photo+version asset rows,logout scope,and Owner invitation/policy/submission/recovery/revocation paths. Product live ACLs still decide actual access.
- Capability DTO optionally exposes validationScope;the current Owner invitation UI disables unrelated albums/password modes/unsupported permissions and refuses invalid pending selections. Its types/build pass;actual browser invitation UX remains not_checked.
- Separate `wrangler.guest-validation.jsonc` has workers_dev=false,previewfalse,no routes or Cron. It is NOT deployed. Existing default configs/Owner-only fallback remainclosed to Guest.
- Focused scope+existing Guest exchange10 tests,root/Webstrict,scopedlint/format and UI/entry builds passed. Native Guest19 groups with full56migrations passed:real staged HTTPS-origin API session/invite/privateR2+localSharp/selection/submission/same Ownerexport/audit/revocation. Old Owner-only native20 also passed. No new remote provider/OAuth/browser/publicTLS acceptance.

Actual failed attempts are retained locally:direct getWorker transport downgraded the validated HTTPS origin and returned403;valid-path dispatchFetch fixed the fixture without weakening the wrapper. Miniflare injects canonical CF-Connecting-IP,so missing/invalid-IP probe cannot control that input;trusted-IP edge behavior and expired-entry timing remain not_checked here. No assertion was converted into a fake successful provider result.

Proof: worker.local/staging-guest-validation-local-proof.json;checks19,bundle697d5b5fcd9f633f6cd1592f36a15d810074f9b46ab3f8127cd6e855f89f6df9. Native fixture directly seeds active albums only in ephemeral D1;this is not an audited hosted activation.

## Blocking product gap: audited album activation

There is no current Owner/API/UI operation for draft→active. Creation defaults draft;upload completion does not activate;archive/restore only returns to draft. Existing invite/seal/session active-state guards are correct and remain unchanged. Therefore do not deploy/open Guest merely because the above native active fixture passes.

Next vertical slice must add explicit Owner activation with expected revision,confirmation,current ownership/non-archived project checks,atomic before/after append-only audit and request replay protection. The old request_commands CHECK excludes activation;use a compatible migration/dedicated command ledger with namespace protection,full populated native migration/rollback checks,and fresh isolated cloud backup/restore before B adoption. Activate only the named synthetic album through that tested audited API,then perform independent hosted Guest acceptance. Never direct remote UPDATE or repurpose archive/restore. Google/link/three password modes/other independent permissions/versions/delivery and fullMVP requirements remain pending.

Final KISS harness retains19checks after trimming optional duplicate/extra branches;the earlier22-check run also passed but is historical. Final proof explicitly marks trustedClientIP and expiredInvite behavior not_checked;current retained regression coverage includes secure logout/session revocation,not the removed optional invite-revocation branch.

## Activation implementation checkpoint

The previously missing draft→active operation is now implemented locally in0057/service/API/OwnerUI;the cloud source remains56/draft. The gap is no longer missing source code,but freshcloudrestore/upgrade/adoption plus exactCI/deployment/realUI acceptance. Follow ALBUM_ACTIVATION.md/latestHANDOFF before anyGuestopening. NativeGuest19 nowpasses57chain;the earlierc1native56proof remains historical.
