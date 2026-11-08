## 2026-11-09 — 自訂分享只延後清理，不恢復其他連結

使用者明確確認：相簿已達閒置期限時，另一份尚未到期的自訂分享會延後清理，但不延長其他分享或讓已過期繼承連結恢復存取。清理保護是有效自訂截止的最大值，不是新的有效瀏覽時間；該截止到期後仍需重新檢查其他清理條件。關閉閒置清理時，相簿與未自訂期限的繼承連結不因閒置失效，自訂期限仍獨立到期。此產品決策不等同雲端備份／刪庫授權。

## 2026-10-29 — KISS and existing upload ownership

Reuse the existing resolved uploader and its per-actor/workspace/project/album Web Lock for batch admission. Avoid a separate batch-only lock or persistent lease/timer system. Native IndexedDB CAS prevents lost updates;the existing lock provides same-browser resolved-flow ownership;server authorization/CAS remains authoritative across devices. Pause work separately from the lock request signal and retain uncertain fixed intents. Run minimal relevant checks;fresh quota rejection and separate native abort-preservation evidence are sufficient here. Live lowering of a populated Chromium quota is not a product acceptance gate. Batch UI/controller remain unfinished.

## 2026-10-29 — M3i4 frozen profiles and M3i5 per-file admission

M3i4 keeps original default-v1 keys immutable and introduces seven separately indexed opt-in profiles. A profile ID always identifies one fixed canonicalization tuple; algorithm changes require a new ID. Separate rule revision plus shared project revision fence policy ABA;historical request replay preserves absent legacy matchingProfile rather than inventing a default field. Native reservation guards retain draft/active compatibility.0051 is adopted LOCAL ONLY after populated preservation/native tests, fresh backup and live parity;this does not authorize hosted activation. See MATCHING_RULES.md and HANDOFF.md.

M3i5 admits one file at a time through fresh preview, explicit choice, durable fixed intent, reservation and completion before the next file. Every reservation advances album matching sequence, so one precomputed snapshot cannot authorize a whole queue. Unknown outcomes keep original request IDs/body/target. A1,000-item metadata manifest and independent records replace neither existing single-file recovery nor server authority. Native IndexedDB transactions must commit before a network mutation;manifest/item CAS addresses lost updates, while processing ownership/session reauthorization still needs controller-level implementation. Update reads target plus manifest only;unique native indexes enforce cross-record operation/session witnesses. No new batch UI/capability is claimed until full integration passes. See RESOLVED_BATCH_UPLOADS.md.

## 2026-10-28 — M3i3 catalog context is separate from write authority

Keep matching evidence and selectable targets separate: indexed filename classification may return one aggregate/head while Assisted must still select any authorized logical photo. A signed session/scope/revision-bound24-row keyset cursor carries only read context; fresh reservation independently reads the real selected head and retains existing final CAS. Never persist a catalog token in the original request/journal or change uncertain UUID/bytes/target. Bound current rows and cursor history, retain one selected row independently and provide first-page reachability. Native target-kind and candidate controls use separate radio groups. Source0050 adds only the scoped seek index; rollout and actual acceptance are separate. See ASSISTED_CANDIDATE_CATALOG.md.

## 2026-10-28 — M3i2 full-history aggregate before removing array caps

Use the canonical default-v1 partial index to identify logical photos, then aggregate their entire immutable version history without a filename filter. Keep incoming dimensions and compatibility division order identical to the existing classifier. Return at most current-head metadata for automatic confirmation; do not represent it as materialized historical evidence. Preserve Assisted through the existing reader until its independent bounded catalog is implemented. Same-batch key writes plus same-snapshot missing-key checks cover replay/expiry gaps without mutating captured intents. No SQL timestamp shortcut clears unfinished signed work. See INDEXED_VERSION_MATCHING.md.

## 2026-10-28 — M3i1 canonical index evidence before classifier cutover

Use append-only keys of immutable upload sessions with versioned default-v1 canonicalization, not SQL lower() or mutable photo names. Establish authorized coverage and bounded24-row idempotent maintenance first. Missing keys, invalid names, unlinked versions and incomplete heads are explicit; new uploads invalidate completeness naturally. This snapshot is advisory; indexed classification must later repeat complete scoped evidence and existing sequence/head CAS. Keep current matching/Assisted behavior until that integration is verified. Future rules get distinct profiles; no silent reinterpretation. See MATCHING_FILENAME_INDEX.md.

## 2026-10-28 — Workspace Owner event history and generation semantics

Implement workspace-scoped Owner history over the append-only audit ledger,including every action envelope. Safe action-specific before/after projection is explicit; unknown and malformed detail statuses never fall back to raw JSON. Current workspace authority is required on each read/chunk; historical sessions/invitations are context,not present Guest grants. Snapshot purpose/Owner/workspace/filter/high-rowid/keyset/expiry are HMAC-bound and do not require the original Owner session to remain stored. Related invitation arrays preserve multi-member review provenance.

Each explicit CSV/JSON export attempt gets a server generation UUID. Start/completion audit means server generation,not client receipt; snapshots exclude their own newer generation events. Test completion failures must be installed BEFORE generation starts. Native transport prefetch can finish generation before a later cancellation,so deterministic early cancellation/session-expiry proof uses the actual repository/D1 stream inside a separate local/synthetic-only test Worker; HTTP/browser failure and downloads stay separately tested. No production test endpoint is mounted. See [OWNER_HISTORY.md](OWNER_HISTORY.md) and latest HANDOFF for actual acceptance status; gate remains OFF/hard-local.

## 2026-10-28 — Confirmed invitation-shared annotations

The user explicitly confirmed: 同邀請共用（比照留言）. Guests of the same sealed invitation may see each other's version-bound annotations; different invitations stay isolated even for the same album/photo/version. Sharing is read visibility, not authority to edit another Guest's annotation. Existing author-only command/CAS/audit rules stay unchanged. Keep the explicit /annotations/own reader for exact command reconciliation and add /annotations/shared for the viewer's invitation. Do not turn a single project invitation into global client history access.

Shared reads require current Guest/session/Owner/parents/grant and the independent can_annotate bit; image viewing and historical comparison remain separately authorized. Shared cursors must bind the authenticated viewer/session/invitation/photo/version and use the complete invitation watermark, separate from own/Owner cursor namespaces. Expose role-safe author labels and isMine; no peer Guest IDs, credentials, media URLs or comment bodies. Peer comment links must not bypass independent comment permission. Reuse immutable0045 tables/indexes when sufficient; no migration merely to broaden a read projection. Default-OFF/hard-local gates remain. Shared API/UI/acceptance is now implementation work; no further visibility decision is pending.

## 2026-10-28 — M3g1 coordinate and privacy boundaries

Technical choice: integer normalized_1e6 geometry in the oriented immutable preview frame, so JavaScript/SQLite canonical JSON and resize/zoom/pan roundtrips are deterministic. Point/rectangle and allowlisted colors are strict; no arbitrary SVG/CSS. Actual own-author page/watermark lookups have dedicated actor+invite+album+photo+version indexes verified with D1 EXPLAIN; this is not a hosted latency/free-tier claim.

Privacy choice remains open: user was asked whether annotations share within one invitation like comments or are author+photographer-only. No answer has been assumed. Explicit /annotations/own and author-only commands are useful under either answer; no peer reader exists. Own UI and Owner readonly viewer can continue before the answer. A future shared reader must not broaden own activity history. Optional links are only to the author's same-invitation/version comment, with separate can_comment; no text is copied or mutated. Genuine Owner annotation commands are still required separately.

0045 is source-only. Keep feature gates OFF/hard-local, deletion OFF/dry-run; future adoption requires a new current0044 backup/isolated restore and populated history parity, not reuse of an older pre0044 backup. FullM1–M5 remains active.

## 2026-10-27 — Invitation-scoped comments and current-state reconciliation

Guest comment text uses independent can_comment, not image viewing/selection/annotation/comparison bits; image gateways retain their own rights. Threads share only inside an exact sealed invitation and immutable photo version. Only the original Guest author may edit/delete/resolve/reopen. A missing/foreign author target returns normalized401 before CAS; an authorized stale revision or invalid transition returns409. Owner replies/moderation remain future work requiring a distinct Owner-authorized intent path, never a forged Guest session.

0042 retains immutable command/change/result/audit records with an audited, predecessor-guarded projection. Batch creation binds1–24 distinct logical photos in one album, one version per photo, with one stored canonical body and separately version-bound comment/audit rows. The1,000-comment per invitation/photo/version cap includes deleted tombstones; deletion does not recycle audit capacity. Result JSON is bounded at300,000 SQLite text characters; public body limits remain2,000 Unicode code points. Request conflicts are symmetric with all seven existing Guest command ledgers, while existing invalid-state error ordering is preserved. A change witness must bind the command's exact commentId, not merely author/tenant/revision; comment audits must match the complete immutable change witness. Populated upgrade checks must show no old-row rewrite.

Immutable exact historical command replay is allowed only with the same Guest/session/secret/canonical request and live authority, and may contain its historical prior body. The visible thread must therefore re-read current state using the independently authorized ?commentId= current-row filter; never merge an older receipt over a later edit/deletion. The targeted filter cannot paginate and cannot bypass invitation/photo/version eligibility. Client item merging is revision-monotone. Own activity displays revision/state only, omitting comment bodies and peer actions.

Unknown write recovery keeps one captured request per album/Guest, module memory for same-page unmount and sessionStorage metadata/body hash for full reload. No plaintext body or credentials go into browser storage. Corrupt/unavailable journal blocks replacement POST. A completed older request may clear only its own matching journal; late success/denial must not erase or overwrite a newer request. Explicit abandonment is a two-step local recovery decision, not server cancellation. Preparation locks end before network waits, so an explicitly abandoned in-flight request does not indefinitely lock a fresh intent; pending command state still serializes normal writes. Authorization/focus lifecycle and generation checks prevent stale-identity UI application. Source validation uses NFC/Unicode trimming; raw trusted SQLite writes cannot promise NFC normalization without an external normalizer.

Final full local regression passed243 Worker checks plus316 unit,61 reference integration,14 reference Chromium and types/lint/Next build.0042 was adopted locally after verified backup, with no pending migrations or FK violations; see latest HANDOFF/VERIFICATION. Targeted22-check diagnostic remains supplemental. Hosted services and native headed lifecycle delivery remain not_checked. This decision does not complete M1–M5 or enable automatic deletion.

## 2026-10-27 — Persist resolved choices in the existing reservation command

0041 extends the existing immutable upload_requests payload with strict resolution and server-derived versionTarget, keeping one actor/request namespace. A new-intent BEFORE guard binds the0040 watermark and project configuration before old quota/CAS effects. Current-authorized exact accepted retry is read before new stale validation so the reservation's own marker and later project mode changes do not invent replacement work. Actual raw dimensions must match captured matching evidence at completion; mismatches retain review/quota. Frontend recovery remains mounted after Off/Manual transitions, while modeActive hides only new matching. New needs-review acceptance fixtures use a separate workspace and retain real held capacity. See RESOLVED_UPLOADS/HANDOFF for full local evidence; hosted activation stays closed.

## 2026-10-27 — Candidate watermarks are transactional invalidation, not upload grants

0040 retains all historical rows and starts existing content at watermark0. Future source writes append immutable markers in the same transaction, including pending upload opening/closing and head changes. The reader includes unfinished reservations; TTL alone cannot discard them. Relative AFTER-trigger sequence order does not establish causal action history; operation audits remain separate.

Next resolved reservations should reuse canonical immutable upload_requests/version targets where their existing namespace/replay guarantees suffice. Bind expected watermark/configuration/head and explicit choice atomically before a new reservation; preserve current-authorized exact retry of already accepted intent despite that reservation's own watermark change. This design direction is not an implemented API or public mode enablement. Keep automatic/assisted unavailable until full integration and acceptance.

## 2026-10-27 — Advisory matching snapshots do not authorize uploads

The automatic/assisted resolver first needs a single-statement current-Owner scoped D1 snapshot, not a browser-supplied candidate list. Mode and candidate metadata come from D1; normalization options stay at conservative defaults until persisted opt-in configuration is implemented. Completed per-version upload names provide aliases; after a unique logical photo is identified, classify its full immutable history so a renamed current head cannot hide a crop/dimension conflict. Keep actual returned filenames unchanged. More than1000 rows, or missing head/version evidence, means review rather than a new-photo inference.

This internal read is not a resolution ticket, mutation commitment or upload grant. Metadata revisions alone do not prove unchanged photo content. Public automatic/assisted modes stay unavailable until candidate-set concurrency, immutable decisions, explicit assisted choices, reservation-time current ACL/revalidation and unknown-result retry are implemented and tested. No new schema or feature-flag change accompanies the read layer.

## M3d external-effect intent claims underway

Read docs/OWNER_INTENT_CLAIMS.md. M3c1 remains accepted locally (188checks); fullM1–M5 stays active. Root selected external-only immutable claims plus symmetric transactional guards on all legacy Owner writers, retaining old ledgers/intentional aliases without risky backfill.0039 SQL, store and namespace inventory are isolated drafts; no active migration or persistent application. Root owns cancellation/review integration and deterministic R2-interleaving verification. Claim must commit before storage effects; unknown effects retain claim/quota; default-OFF/hard-local/deletion-dry-run safeguards stay intact.

## Confirmed comment visibility decision — 2026-10-26

The user chose: Guests on the same invitation may read each other's comments; Guests on different invitations remain isolated. Treat invite_id as the discussion boundary in addition to workspace/project/album/photo scope. An Owner reply must target that exact invitation thread; possession of another invitation for the same project/photo grants no access to its comments. Do not merge Guest identities by nickname, email or shared photo. can_comment stays independent of can_view, selection and other permissions. This decision resolves earlier pending visibility notes; other comment lifecycle/status/retention details still need an explicit implementation contract and tests. No comments feature is implemented or enabled by this documentation update.

## M2o — Guest tags in progress

Read docs/GUEST_TAGS.md for new explicit decisions: own Guest membership, independent can_tag and post-submit feedback, hidden project label catalog, Unicode normalization/resource bounds and stable expectedGuestId retry witness. Contracts/unit tests, migration/repository and UI module are delegated to separate gpt-6-luna/max agents; root owns integration and acceptance. No tags capability is accepted yet; keep defaultOFF/local-only.0033 remains last applied local migration. Full M1–M5 is active.

# Architectural / Product Decisions

## 2026-10-25 — M2j Owner submission review, export formats, and atomic round reopen

Owner review of Guest selection snapshots is scoped strictly by album and workspace ownership. Submission snapshots (`guest_selection_submissions`, `guest_selection_submission_items`, `guest_selection_submission_seals`) remain permanently immutable and version-pinned.

1. Export Formats:
   - CSV: Tabular format with photoId, originalFilename, versionNo, byteSize, and selectedAt for spreadsheets.
   - TXT: Plaintext original filenames (one per line) specifically optimized for Adobe Lightroom / Capture One search filtering.
   - JSON: Complete structured snapshot representation for downstream processing or programmatic ingestion.

2. Audited Round Reopen:
   - Requires explicit `requestId` and `expectedRoundNo` to prevent concurrent reopen races or duplicate increments.
   - D1 transition enforces `OLD.status = 'submitted' -> NEW.status = 'open'`, `NEW.round_no = OLD.round_no + 1`, `NEW.selection_revision = 0`, and `NEW.submitted_at_ms IS NULL` as governed by Migration 0026 triggers.
   - `audit_events` records `action: 'selection.reopened'` atomically in the same batch with exact `before_json` and `after_json`.
   - Previous submission snapshots and items are never modified or purged; subsequent guest modifications advance revision in round N+1 and snapshot independently.

## 2026-10-24 — M2g Guest exchange commit and lost-response policy

Keep Guest exchange default-OFF and hard local-only until hosted native scrypt and Cloudflare edge metadata/cost are validated. Use the M2f pre-KDF D1 buckets and one global KDF slot shared with Owner issuance; no parallel Guest scrypt or TTL unlock. Verify outside the final write, release only after the original native promise settles, then use one D1 batch plus triggers to recheck current invite/Owner/scope/expiry/revocation/max-use and atomically create identity, session and request-correlated audit. The bearer is generated in memory and only its hash is stored; return it only in the HttpOnly cookie after `first-primary` proof.

Use a server-keyed HMAC request commitment; never store/recover the password or raw bearer. After an HTTP response is lost, a same-ID retry is denied without a new session or replacement secret. The committed session consumes maxUses; for maxUses=1 recovery requires revoking the invite and issuing another. Do not silently mint a second cookie/session or clear the previous use. See GUEST_EXCHANGE.md.

## 2026-10-24 — M2f bounded persistent Guest exchange admission

Use D1 single-statement fixed-window upserts with one materialized DB-time snapshot for network, network/invite, and invite dimensions. HMAC-purpose-separate trusted canonical address and private invite ID; unknown tokens consume network only. Count denials without saturation; compute retry delay from the committed snapshot. A trigger-maintained singleton caps transient bucket rows at100000, and Cron deletes oldest buckets beyond24h in bounded1000-row batches. Capacity errors fail closed. This is a foundation only: future public handler must supply CF-Connecting-IP, check current invite ACL, use shared KDF permit and issue session+max-use+audit atomically. See GUEST_ADMISSION.md.

## 2026-10-24 — M2e persistent single-slot KDF admission

Use one bounded active-slot row per D1 database plus immutable permits/releases and atomic audit. Current Owner session is required on acquisition, not on post-settlement internal release. Require explicit returned permit identity for both operations; unknown outcomes fail closed. No TTL, abort release or queue: native work may outlive its request. Crash-held capacity requires operator-proven complete quiescence before exact audited release. Local Owner issuer consumes this slot now; public Guest exchange/current Guest admission and persistent network/invite throttle remain separate pending work. See KDF_ADMISSION.md. This does not prove hosted free-tier suitability.

## 2026-10-24 — M2d one-time credential response with metadata-only reconciliation

Implement backend local issuer before Guest exchange/UI, default-OFF and hard local-only. Use one D1 command for parent/scope/seal/audit; six Owner namespaces collide before replay. HMAC binds custom-password requests without plaintext storage. Secrets require positive insert plus exact committed candidate/hash/verifier; unknown successful response cannot be recovered as a secret. Return metadata-only replay/GET, let Owner explicitly revoke/recreate, never silently issue replacement. Reuse BETTER_AUTH_SECRET domain-separated for commitment v1; rotation intentionally requires GET recovery (no retained old key or POST equivalence claim). See INVITE_ISSUANCE.md.

## 2026-10-24 — M2c native fixed scrypt and cookie-proof self-withdrawal

Choose fixed scrypt N32768/r8/p3/random16-byte salt/32-byte key with maxmem64MiB as the local credential adapter; exact version/format guards and no downgrade. OWASP lists this parameter option, Cloudflare lacks native Argon2 and documents local/hosted PBKDF2-limit differences; references and resource gates are in GUEST_CREDENTIALS.md. Keep public KDF/exchange closed until throttling/hosted concurrency acceptance. Implement self-logout without Owner/expiry dependency, since possession of that exact cookie may always withdraw its own session.0018 Guest command proof/ledger/revocation/audit is atomic; clear cookie only after confirmed success. Preserve existing data; no UI imitation or secret recovery.

## 2026-10-24 — M2b withdraw existing Guest grants before public issuance

Deliver real Owner list/revoke management over0016 before public creation/password exchange. Withdrawal remains allowed on archived/expired/unsealed targets; exact client-request replay returns the original snapshot, distinct commands after revocation409 and prompt canonical refresh. Use dedicated immutable actor/request ledger and rebind all four canonical guards with all other ledgers before local RAISE(IGNORE), because sibling SQLite trigger order is not authority. Audit consumes client request only for matching command; historical fixtures/events remain unchanged. No secret recovery or automatic issuance. See OWNER_INVITATIONS.md.

## 2026-10-24 — M2a explicit sealed Guest scope before public issuance

Use a separate Guest cookie/session resolver outside Owner-only /api/v1; no role/cookie fallback. Preserve all12 detailed rights as stable explicit bits. Additive0016 leaves all prior data/counters intact. Invite scope is assembled and sealed internally in the future atomic create command; exact album IDs are audited, no widening after seal. Session revocation proves its target via matching hash witness. Read ACL rechecks current invite/session expiry/revocations/Owner/active scope but cannot authorize later writes without atomic recheck. No public issuance until KDF/runtime/throttling/shared-command/lost-secret response semantics are validated. See GUEST_ACCESS_FOUNDATION.md.

## ADR — CF-03c3 transactional outbox, retained derivative budgets and private projection

Enqueue new originals inside the existing D1 completion transaction, but reserve the derivative cap only when a trusted local runner claims work. This prevents full capacity from orphaning an otherwise valid original. Token/epoch leases fence SQL; create-once stable keys and retained budgets cover late/unknown R2 writes. Only verified readback of both outputs permits atomic assets/quota/audit completion. Native decoding runs through local workerd binding proxies outside Workers with remote bindings disabled, not browser-attested manifests or a GitHub background daemon. Gallery uses current-session private gateways and version1 projection until M3 current-version semantics arrive. Preserve old app and every safety flag. Review-held reservation release needs a later audited permanent-fence/cleanup workflow, not a TTL reset. Deployment/terms/provider/backup gates remain open.

## ADR — CF-03c2 trusted local decoding before durable processing integration

Implement the addendum's local-processing path using a pinned Node-only sharp adapter behind `ImageProcessingAdapter`. Fully decode bounded JPEG/PNG/WebP to oriented sRGB pixels before generating stripped JPEG derivatives; this avoids passing arbitrary original decoding into Free Worker requests or silently enabling a paid service. A separate local CLI persists create-once outputs for operator use and real integration testing. It is not a substitute for D1/R2 job integration or a browser-imported processing proof. Local manifests carry no authority. No schema/API/Worker binding is added by this increment. Keep original upload flags OFF until trusted processing is actually wired, derivative bytes are quota-accounted, and live gates pass. Detailed limits and next job invariants are in LOCAL_IMAGE_PROCESSING.md.

## 已確定（2026-10-23）

- D-001 Web：Next.js + TS strict + Tailwind/shadcn；可調整但須 ADR。
- D-002 Auth：攝影師用 Google / GitHub OAuth（依 2026-10-23 使用者明確確認，可只綁一個或兩來源共用同一身分）；客戶有免註冊邀請模式，可選無密碼/系統產生密碼/自訂密碼。
- D-003 Storage：Cloudflare R2，originals/derivatives 私有分開；Postgres 管 metadata。
- D-004 Photo versions：可開關的 manual / auto_filename / assisted；新版本 immutability；Before/After 對照。
- D-005 Client history：append-only 含取消選取等反向行為與 UTC 時間。
- D-006 Retention：30 天未有效瀏覽、>80% 壓力最舊相簿回收、owner 可調整；預設 OFF+dry-run，保護重要相簿。
- D-007 Agent portability：AGENTS.md 單一權威，Git + HANDOFF + TASKS；不依賴對話或本地絕對路徑。

## 初始預設，可由 UI 改（不是規格未定）

- Storage soft quota 8,000,000,000 bytes，警告 70%，清理 80%，清到 65%，阻止上傳 95%。
- Inactivity 30 天、未曾有有效瀏覽的相簿基準從發佈時間/建立時間起算；bot/preload 不算；真實 owner & guest 看圖算。
- 版本模式預設 manual/assisted，避免同名誤覆寫。所有自動清理第一次需 owner 預覽 + opt-in。
- Invite 預設系統產生密碼，可選不加密或手動設定。
- 關於歷史：guest 只有自己的當前專案範圍；跨專案須經其他 grant/OTP。

## 等待商業決策（不阻礙開始開發）

- 收費方案、多租戶配額是否依訂閱自動分級（Phase 3+）。
- 30天刪除是否提供 24/72 小時通知與 grace（預設 grace=0，正式開啟時 UI 提醒不可逆）。
- 保留活動歷程/下載 log 的法律保存期限與個資刪除流程（初始預設活動事件 purge 後 365天，可調整）。
- 使用者是否需要繁體中文/英文切換、品牌白標、專屬網域。

任何設計決策變更新增 ADR，且同步修改 PRD/TEST/AGENTS（如屬全局規則）。

## 2026-10-23 Phase 0 實作決策

- 正式產品名 Kino Pick；原始附件保留，活躍文件全數更名。
- 見 `docs/adr/0002-phase0-local-boundary.md`：本機界線、工具相容性、RLS 測試範圍、Phase 1 未完成項目。

## M1-01 決策

- Server-only Supabase SSR、getUser 驗證、Google identity、HttpOnly cookie；不建立 production mock/bypass。
- 使用 publishable/legacy anon key + 使用者 session/RLS/RPC，應用不需 service-role。
- 工作空間/成員變更透過有鎖、idempotency 與 audit 的 DB RPC；私有重送 ledger 不公開。
- Auth HTTP/PGlite fixture 只放測試，真實 Google/Supabase 驗收留待設定。詳 LOCAL_AUTH.md。

## M1-02 資料一致性決策（2026-10-23）

- 先交付建立/讀取/改名，不暴露刪除、發佈或自動清理控制。狀態轉換/封存及完整 CRUD 驗收另列未完成。
- 改名使用 expectedRevision 樂觀鎖；相同名稱的新請求亦增加 revision 並保留事件。相同 requestId/payload 重送回原結果，不重寫目前狀態；不同內容回 409。
- request advisory → workspace → resource 固定鎖順序；workspace 鎖與成員變更互斥，取得鎖後才檢查現行角色，授權先於重送 ledger，防止撤權後取回舊結果。
- owner/editor/photographer 可管理內容，retoucher 僅讀。缺少/跨租戶/已撤權資源統一 NOT_FOUND，避免枚舉；現有可讀但唯讀角色修改回 FORBIDDEN_SCOPE。
- tenant/parent IDs 以 DB trigger 固定；只允許名稱修改，不接受客戶端改 workspace/project/保護/狀態。
- 審計新增 BEFORE TRUNCATE 防誤清；不宣稱可防止管理員刻意拆除保護。首次 provisioning 鎖改為 NO KEY UPDATE，保留序列化並相容 FK KEY SHARE。

## D-008 — Google / GitHub 可單一或雙來源同身分

2026-10-23 使用者明確確認，可只綁定一個或同時綁定兩者作為同一身分，取代 Google-only 產品限制。使用成熟 Supabase SDK，不自行實作 OAuth 協定，不以 Email/顯示名稱在應用合併帳號。Provider link 回呼前後 user.id 必須一致，workspace 權限不因新增來源而擴張。預設 manual link 關閉，須 app/Supabase 兩邊設定。外部 Auth 與 app 審計無跨服務 transaction，callback 失敗不嘗試刪除已綁身份。Supabase automatic linking 與新增補充文件的 closed/Owner-only/嚴格不依 Email linking 要求為待評估差異，詳 AUTH_SPEC/LOCAL_AUTH。

## D-009 — Hosting adaptation precedes any Auth/DB cutover

2026-10-23 compatibility assessment: retain the existing stack as reference. First evaluate a pinned vinext hosting PoC in an isolated worktree; do not equate static compatibility with runtime proof. D1/Auth replacement has separate identity/role/transaction and data migration gates. PostgreSQL RLS/locks/RPC cannot be mechanically replaced by a successful SQLite UPDATE/batch: zero affected rows need explicit conflict semantics before audit/idempotency. The isolated SQLite model is test-only, not a production authorization substitute. Details and official sources: ADR-Cloudflare-Free-First.md. No requirement for photography/guest/version/retention was removed.

## D-010 — Album protection precedes state/deletion execution

2026-10-23: first deliver owner-only album isPinned/legalHold controls, keeping draft/active/archived state unchanged. Editors/photographers/retouchers can read flags but cannot change them. Clearing either existing flag requires an explicit confirmUnprotect boolean plus UI acknowledgement, revision CAS and append audit. Non-owners cannot replay old owner success after ownership loss. Deleting/deleted albums reject new changes. This does not enable retention, delete assets, reset activity clocks, grant guests, or implement the full project review state machine. State/protection/deletion must eventually share workspace/resource lock order; preservation of these flags is a required eligibility gate, not a standalone cleanup implementation.

## D-011 — Archive is reversible metadata, initially empty and idle only

Owner-only archive/restore, with UI acknowledgement and API revision/requestId, is separate from deletion and the full review state machine. Project draft/delivered and album draft are the initial origins; store original state in DB rather than assume draft on restore. Block nonempty photos/busy children, parent archive blocks child transitions, do not cascade child state changes. Archived content is readable, names/new child writes frozen, owner protection stays editable. Preserve human-view clocks. Legacy archived data without recorded origin fails closed. Future upload/review/delivery/retention tables must be integrated into shared locks/idle checks before expanding support. No generic status editing, guest/download grant behavior, automatic cleanup or physical deletion is implied.

## D-012 — Explicit Cloudflare/Owner target adopted, staged compatibility preserved

User now explicitly authorizes the architecture addendum: Workers/Static Assets/Hono, D1/Drizzle, Better Auth Google/GitHub closed Owner, R2 single-node default and Cron, GitHub CI/CD. Supersedes the earlier non-adoption interpretation; does not authorize deletion of existing behavior/data or production cutover without acceptance. Original document preserved at supplied filename; canonical reviewed copy at CODEX_ARCHITECTURE_ADDENDUM.md. New D1 node default9GB is internal only; old PG8GB unchanged. No free-tier/terms guarantee, cross-account enablement or automatic deletion.

First foundation is actually local executable, while old Next/PG functions stay intact. Auto-review rejected directly disabling old production Supabase login as a possible outage; no old Auth modification was applied. Safer integration preserves the reference and uses a new deployment guard that rejects release until a reviewed cutover. No work is blocked on external keys for local implementation; actual cloud/provider/data/security gates remain pending.

## ADR — CF-02a D1 workspace command transaction

Use a single INSERT with SQL guard/apply triggers for this first D1 business operation. D1 batch rollback on SQL failure alone does not make a zero-row mutation an authorization error; the trigger must abort invalid current Owner/session before historical replay, and audit failure must abort state plus request ledger. Result snapshots preserve original response across retries. Keep reference Next/Supabase UI and business endpoints operational while target repositories mature. CF-02a is backend-only; project/album/CAS/protection/archive and shared operation request namespace plus existing React UI adapter remain next before claiming CF-02 complete.

## ADR — D1 shared request command namespace and content triggers

Migration0004 introduces one `(actor,requestId)` operation namespace across workspace/project/album commands. This preserves old workspace retries by copying original request snapshots and audit linkage. SQL BEFORE guards check enabled Owner/current unexpired session and current tenant before replay; AFTER triggers atomically apply CAS/state changes, persist immutable response snapshots and append-only audit. SQL failure rolls back all writes. Project/album parentage is composite tenant-scoped; archive checks actual photo catalog and never deletes files. Target policy remains Owner-only.

The existing Next UI still reads/writes Supabase/PostgreSQL. Do not claim target UI parity until an authenticated same-origin hosting/API bridge is selected and browser tested; do not expose service credentials to browser code.

## ADR — D1 tenant parent integrity

D1 migration0005 adds immutable project/album parent fields and validates the full photo→album→project→workspace tuple at insert. Composite project FKs alone do not prove that an album belongs to the same project, so the Worker must keep this guard when photo metadata writes arrive. No direct object uploads are enabled by this migration.

## ADR — audit event IDs, not globally unique request IDs

Audit `request_id` is actor supplied and may repeat across independent accounts; a global `(action,request_id)` uniqueness rule creates cross-tenant denial of service. Migration0006 preserves all historical audit columns and event IDs while using `event_id` as the only log uniqueness key. Exactly-once business mutations remain enforced by the actor-scoped request command ledger. Before large production logs exist, rehearse the table copy with a verified backup.

Migration0007 repairs all audit-writing trigger definitions after migration0006's SQLite table rebuild. This follows a real isolated upgrade failure where bootstrap/session triggers retained stale table bindings; the corrected path is tested by creating a session after the rebuild and verifying its audit event. Rehearse both clean and already-upgraded D1 states before remote migration.

## ADR — CF-03b signed uploads and capability fencing

The Worker reserves quota before issuing a short-lived signed PUT. The signature binds a server-generated immutable object key, exact content length, MIME, SHA-256 checksum and R2 create-once `If-None-Match: *`. Completion verifies private R2 metadata/checksum and supported image magic before one D1 transaction writes photo/version/original-asset rows, converts reserved bytes to used bytes, records the idempotent result and appends audit. A mismatched object enters `needs_review` and keeps capacity reserved until an explicit safe remediation exists.

Presigned URLs remain reusable bearer capabilities until expiration, so cancel/expiry alone cannot release capacity. An unused authorized key is atomically occupied by a durable conditional fence before the D1 release; if any object occupies the key, leave the reservation for review. Fence detection must verify server-only marker properties, not rely on client-writable custom metadata alone. Local workerd/D1/R2 implementation is not proof of live R2/CORS; the feature flag stays off in every environment until real bucket tests and image decoding/thumbnail gates pass. Migrations 0009/0010 are additive/forward-repair only; preserve both and use forward fixes or restore a verified snapshot, never a down migration after data exists.

## ADR — CF-02c same-origin React target UI

Keep the Next/Supabase application as the rollback/reference while the new D1 surface is incomplete. For the first target browser slice, bundle a small Vite React shell into Worker Static Assets and import existing workspace/content form components through local Next navigation shims. This keeps one same-origin Better Auth cookie and D1 API path without exposing credentials or moving server-side Postgres access into the browser. This is an incremental target entry, not adoption of the separate vinext PoC or a full UI rewrite. Rollback is code-only because this slice adds no schema migration.

## ADR — CF-03a D1 reservation before direct upload

Reserve expected bytes in D1 before introducing any client-to-R2 authorization. Migration0008 uses a separate `upload_requests` ledger while extending the existing command guard so an actor cannot reuse a request ID across upload and content operations. The create/cancel/expiry state, workspace and aggregate-node counters, request result, and audit are committed together. A pending session blocks project/album archive. Fifteen-minute expiry is safe only while no R2 URL has been issued; the future signer must add in-flight grace and R2 HEAD or confirmed cleanup before quota release. Cloudflare documents that a presigned URL is reusable until expiry, so future PUT signing must use the R2 atomic create-once condition, bind size/type/checksum where supported, and configure bucket CORS. This increment intentionally returns no object key or URL and has no upload UI. Migration rollback is forward-only and preserves counters/history. See links in DEPLOYMENT.md.

## ADR — CF-03c1 browser-first previews and bounded independent headers

Follow the addendum: [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap) performs full local decode before bounded-file hash/transient preview. No transformation service or assumption that large decoding fits Free Workers. Browser64MiB limits are distinct from the backend single-part capability.

Server independently inspects bounded structural headers and0012 stores encoded dimensions atomically while preserving legacy NULLs. Header validation/browser decode are not trusted server full-decode proof. Persistent derivative quota/jobs and gallery follow; upload flags stay OFF until processing/live gates pass. Retry retains IDs and confirms before PUT, disabled init cannot reserve, and expiration reconciles current status. Original Next app remains the regression reference.

## 2026-10-24 — CF-03c4b abandoned reservation invariant

Use a real abandoned/reserved0 terminal state, not an overlay leaving needs_review16MiB after aggregate release. Rebuild both jobs and output children to preserve D1 FK integrity. Permanent create-only output fences precede a guarded immutable Owner command whose transaction changes job/two counters/audit. Active primary node required; readonly/unknown/occupied fail closed. Exact retries remain authorized and replay across parent archive. No return to pre0015 writers/status schemas; forward repair and permanent fence lifecycle exclusions are mandatory.

## 2026-10-24 — CF-03c5 recover intent, not bearer capabilities

Use20-item/64KiB strict local metadata journal with seven-day last-write recovery window, actor/resource key and exclusive Web Lock. Never persist File/preview/R2 authorization. Query original init ID without mutation to recover ambiguous init; verify canonical scope/hash, then explicit file reselection for PUT. Per-item generations/full-scope component keys stop stale callbacks; expected-actor header binds browser mutations across shared-cookie changes. Preserve original authorization expiry; no implicit renewal or new intent. No schema change. Next guest-session vertical slice retains all upload/production gates.

## 2026-10-26 — M2k fragment-only invitation entry

Connect the existing D1 issuer/exchange to the Worker UI without changing their one-time credential semantics. Owner creation is offered only when issuer and exchange capabilities are both locally available. Explicit scope and all 12 independent permissions remain separate from UI availability. Each selected album receives a URL using `/guest/albums/:albumId/enter#token=<bearer>`; album IDs in a URL never grant access by themselves.

The bootstrap consumes the fragment once before React StrictMode renders and immediately removes it from the address bar. No token goes in path/query, persistent browser storage, logs, or custom-password echoes. Unknown Owner creation outcomes retain the original payload/UUID and use exact retry or metadata recovery. Unknown Guest exchange outcomes do not automatically issue a new UUID/session; a read-only current-cookie access check can recover navigation if the cookie actually arrived. This avoids duplicate max-use consumption while preserving existing lost-secret constraints.

Capabilities expose only availability/application bounds, never credentials or session issuance. Deployment flags stay default-off and hard local-only; existing migrations/immutable history are unchanged. Hosted KDF, edge trust and resource gates remain open.

## 2026-10-26 — M2l logical-photo feedback and independent lifecycle

Ratings/favorites are per invite/Guest/logical photo, with an exact version witness for each meaningful change. A new version and selection submission do not erase or freeze these separate values; submitted selection items remain immutable. No-op requests retain immutable results without changing the last meaningful witness or adding a false state-change event.

Use one feedback command ledger for both actions, independent permission bits and bounded known-photo batch reads. Preserve current authorization before replay. Add symmetric AFTER INSERT conflict guards to legacy command tables so a namespace conflict aborts all their state/audit effects without relying on sibling BEFORE-trigger order; feedback itself checks legacy keys before insertion. Keep all feature availability default-off/hard-local while hosted capacity and remaining product actions are incomplete. See GUEST_FEEDBACK.md.

Feedback state guards also require an immutable previous_command_id chain, not just an old valid result or timestamp. This prevents direct state rollback using historical witnesses, including same-millisecond value cycles.

## 2026-10-26 — M2m1 private bounds before explicit shared subjects

Preserve per-invite/Guest private state and immutable submission snapshots. Add album-level min/max/revision policy with Owner confirmation, CAS and immutable audit/replay; default1/unlimited leaves old behavior unchanged. Reject lowering maximum below open private drafts rather than deleting selections. Enforce additions and submit in D1, bind read cursors to policyrevision, and keep all feature flags OFF/hard-local. Shared selection must use a future explicit review subject and opt-in; two same-Guest sessions are only private concurrency evidence, not the specified two-customer shared29→30 acceptance. Project defaults and shared modes remain required. See SELECTION_POLICY.md.

## 2026-10-26 — Ready revision for retained reopened selections

A reopened nonempty draft starts at revision1 so it can be resubmitted unchanged under the existing positive-revision immutable submission constraint.0029 repairs only legacy open round>1 revision0 with an append-only system initialization event; sealed snapshots and old reopen events/results remain intact. New audited transitions must explicitly carry revision1; historical replays use their original0. This is an epoch initialization, not a fabricated Guest selection event. Rebuilding the submission parent table is unnecessary and would increase FK/history migration risk. See SELECTION_POLICY.md and new actual D1 acceptance.

## 2026-10-26 — Explicit opt-in shared subjects and actor witnesses

Shared picks belong to a separately sealed review subject within one album, not to merged Guest accounts. Owner must acknowledge selected invitation memberships. Existing private endpoints/state/feedback stay isolated, and Guests explicitly enter the shared page. Per-round bounds and a global revision support serialized capacity and one immutable submission; Owner reopening keeps old snapshots and accepts explicit next-round bounds. expectedGuestId is only a required self-identity witness for pending intent; server authority remains the live HttpOnly cookie/session and SQL ACL. Owner replay reads repeat current authorization. Stream exports use bounded24-row pages, correlated requested/generated audit and error before successful EOF on failed completion evidence. The feature remains default-OFF and hard local-only. Project inherited defaults remain M2m3 and hosted resource/backup/provider/CI/deployment gates stay open.

## 2026-10-26 — Durable inherited policy epochs and REPLACE defense

M2m3 preserves0028 tables and creates current configuration state/ledger instead of deleting old rows or rewriting history. Album inherit/override transitions retain an epoch even when effective numbers match. Legacy request commitments persist separately so current project changes cannot alter unknown-result retries. Project defaults apply live only to inheriting private albums; shared rounds keep explicit bounds.

Policy result and audit tables reject duplicate insertion as well as update/delete: SQLite REPLACE may bypass delete triggers when recursive triggers are off ([SQLite conflict semantics](https://www.sqlite.org/lang_conflict.html#replace)). Cron retains idempotency through a single insert-if-absent statement; no replacement or automatic deletion is enabled. This is a bounded review of these tables, not a completed audit of every historical ledger.

## 2026-10-29 — Confirmed: one authorized client can approve a fixed version

User answer:「其中一人代表確認即可」. Owner defines the authorized reviewers/invitations for a version-confirmation request;any one authorized Guest may confirm as a representative. Preserve individual actor/session/UTC/request and exact photo/version witnesses. Do not require every anonymous visitor,derive approval authority from viewing/selection/comparison,or transfer approval to a new version. This supersedes the earlier pending one-versus-all question. Implementation remains unfinished;do not ask the same question again.
