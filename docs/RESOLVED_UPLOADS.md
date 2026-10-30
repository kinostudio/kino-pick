## M3i2 automatic indexed path

See INDEXED_VERSION_MATCHING.md. With independent local INDEXED_VERSION_MATCHING_ENABLED plus all prerequisite gates, auto_filename preview/reserve recompute a single scoped SQL snapshot and full-history aggregate. The unchanged response candidates array contains at most the unique current-head display/authorization candidate in this path; candidatesTruncated reflects completeness of decision evidence, not enumeration of the entire album. The authoritative decision includes every immutable version through aggregate evidence. Never pass this head-only array to the materialized matcher as if it were full history. Nonautomatic snapshots fall back to the existing reader, preserving Assisted target selection. Project/matching-watermark/head CAS and exact replay ordering remain. Unknown index completeness returns filename_index_not_ready and permits no fresh reservation. Actual local acceptance is345 standard checks plus13 supplementary final-copy checks; see HANDOFF. No hosted deployment is implied.

# Resolved uploads — automatic and assisted matching

Status: M3c2b2 single-file vertical slice accepted locally:220 Worker checks,260 unit,61 reference integration,14 reference Chromium, strict types/lint/Next build passed.0041 applied locally only after backup. No hosted enablement or deployment is claimed. Read HANDOFF/VERIFICATION for exact evidence and remaining scope.

## Scope and gates

The existing Owner album workbench now offers a real matching uploader for `auto_filename` and `assisted` projects. New writes require all five local flags: DIRECT_UPLOAD_ENABLED, PHOTO_VERSIONS_ENABLED, PHOTO_VERSION_UPLOADS_ENABLED, PROJECT_VERSIONING_CONFIGURATION_ENABLED and PHOTO_VERSION_MATCHING_ENABLED. All Wrangler environments default the flags OFF. Matching enablement in staging/production is rejected. Google/GitHub share the current internal Owner identity; Guest sessions cannot call these routes.

Project mode settings return four available modes only when the matching capability is enabled. The existing mode revision, confirmation, immutable command/result, audit and current-Owner guards remain. Off/Manual retain their original behavior. Original `POST /api/v1/uploads/init` deliberately creates an independent photo; the UI labels that manual override explicitly. API clients that want version matching must use the resolved workflow below. No path implicitly changes the current visible photo version.

## Public contract

- GET `/api/v1/upload-resolution/capabilities` returns `{enabled}`. This is a feature capability, not a hosted credential or R2 CORS acceptance result. The UI also checks the existing direct-upload capability.
- POST `/api/v1/albums/:albumId/upload-resolution` accepts strict `{file}` and returns scope, persisted mode/revision, changeSequence, decision, completeness and authorized deduplicated photo candidates. It is advisory and does not reserve quota.
- POST `/api/v1/albums/:albumId/resolved-uploads` accepts strict `{requestId,file,expectedChangeSequence,expectedProjectRevision,expectedMode,choice,confirm:true}` and returns201 `{uploadSession,target}`. Route scope is server-derived; caller workspace/project IDs, candidates, mode options and object keys are forbidden.

`file` contains originalFilename, expectedBytes, contentType, lowercase SHA256 and raw encoded dimensions `{width,height}`. Image bounds remain32768 per side/80M pixels and server upload bounds5,363,466,240bytes; browser preprocessing remains limited to64MiB. Before EXIF-oriented bitmap display, encodedWidth/encodedHeight are captured for the matching contract.

`choice` is `{kind:'new_photo'}` or `{kind:'new_version',photoId,parentVersionId,expectedRevision}`. Skip is a UI choice with no reservation request. Identical completed hashes return duplicate and cannot create another resolved upload. Auto accepts only the unique automatic suggestion. Assisted accepts an explicitly confirmed new photo or authorized existing logical-photo head, including crop/name ambiguity review, while rejecting incomplete/invalid evidence and same-name unfinished uploads. The returned new-version target captures its original mode, parent/revision and `changeType:'new_retouch'`.

The existing authorization, create-once signed PUT, upload status, cancellation, recovery and ordinary/version completion endpoints remain responsible for bytes and lifecycle. Preview is not a signature, grant or verified content assertion.

## Atomic persistence

0041 reuses the existing actor/request namespace and immutable `upload_requests` payload. A strict `resolution` object records expectedChangeSequence, expectedProjectRevision, expectedMode, choice, raw dimensions and confirm; a server-derived `versionTarget` captures an existing-photo target. No separate resolution ledger or per-resource lock is introduced.

A new-request BEFORE INSERT guard checks the current per-album0040 watermark and project mode/revision before any reservation/quota/audit mutation. Existing head CAS and all prior namespace/ACL/quota/immutable target guards still run. A reservation itself increments the watermark, so an exact accepted retry is looked up under current authority before a new stale check. Concurrent identical UUIDs coalesce; distinct UUIDs from one preview have one reservation winner. Different payload reuse is a request conflict. No response uncertainty allocates a replacement UUID.

The two0038 mode guards are replaced only to permit four supported values. The0037 upload guard changes only its top-level key count to admit one strict resolution object; all predecessor checks are retained. No historical row, alias, result, event or target is rewritten.

## Completion and recovery

Matching dimensions are client evidence until completion. The server reads bounded private R2 headers and validates actual bytes/hash/MIME/magic plus raw dimensions. Both ordinary and version completions compare the observed raw dimensions with the saved resolution. A mismatch writes the existing UPLOAD_METADATA_MISMATCH review flag, returns UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH422, retains quota and withholds the new version/assets/finalization. A SQL workflow guard independently rejects mismatched completed dimensions. Full pixel decoding remains the separate processing pipeline; structural completion is not a trusted full decode or hosted edge processing result.

The UI journals only actor/workspace/project/album, exact request bodies and UUIDs, file fingerprints and the returned immutable target. It stores no bytes, object keys, signed URLs, bearer/session secrets or R2 credentials. Scoped Web Locks serialize same-context work. Reload requires the original matching file. Unknown reservation, authorization, PUT or completion results retry/check the original work; unknown intent cannot be skipped/discarded to allocate a replacement. A needs-review result retains the journal and stops PUT/reservation retries.

Changing project mode to Off/Manual does not hide an existing resolved journal: modeActive disables only fresh matching actions. Saved work may resume under current ACL with its original captured mode and target. Historical replay still denies a disabled Owner or archived parent. The current head remains unchanged after a private retouch version completes. Expired/invalid local journals block new work and require operator recovery; age alone does not prove a remote request never committed.

## Verification and limits

Require real local workerd/D1/R2 tests for feature defaults, mode confirmation, canonical replay, stale preview and same-name races, failed-audit rollback, private V2/head preservation, explicit assisted choices/foreign target denial and raw-dimension review. Browser acceptance must use checked synthetic SigV4 PUTs,375px layout, lost accepted reservation, mode switch, reload/reselect and exact replay. Record full suite terminal results, not just progress lines. Synthetic local OAuth/R2 providers do not prove hosted OAuth/CORS/edge behavior or free-tier capacity.

Candidate lookup currently returns an authorization anchor and at most1001 data rows, classifying only1000 complete immutable-version/pending-upload rows. It conservatively reviews incomplete sets. Scalable canonical-name lookup, persisted opt-in case/JPG-JPEG/suffix rules and multi-file batch matching remain required; UI/API do not advertise these unfinished options. Malformed historical names conservatively require review. Matching considers complete history of a uniquely identified logical photo so renamed current heads cannot hide crop changes.

## Forward recovery

Disable matching/configuration writes, retain0040/0041 guards, immutable resolution payloads, targets, marker history, physical fences, review flags, quota and audit, and repair forward. Do not downgrade to an application that ignores completion dimensions or invents new work after unknown results. Do not drop the tables/triggers under active readers/handlers. Take a pre-migration ignored local backup; restore only into an isolated verified recovery copy. No remote/customer migration is authorized by these local tests. Automatic deletion stays OFF/dry-run.
