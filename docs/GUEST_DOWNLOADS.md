# Guest current-version downloads

Status: focused local workerd/D1/R2/Sharp and Chromium acceptance passed. Default feature remains OFF; hosted deployment is not verified. This is a current-ready-version download slice, not final delivery publication or a client-approved delivery package.

Reuse existing Guest sessions, independent `can_download_preview` / `can_download_original` permission bits, private R2 storage, current photo version heads and append-only audit. Neither download permission grants `can_view` or historical version comparison. The catalogue is bounded to 24 rows plus a keyset lookahead; attachment responses stream private files with no-store and UTF-8 filenames. The browser uses native attachment links, not full-file Blob buffering.

Routes:

- `GET /api/guest/albums/:albumId/downloads?cursor=UUID`
- `GET /api/guest/photos/:photoId/versions/:versionId/downloads/:kind` (`preview` or `original`)

`download.requested` records the authorized attempt. `download.generated` records a verified file prepared for streaming, not proof that a client received or saved all bytes. Both repeat current Guest authorization; audit failure must prevent bytes from being returned. Download activity does not reset effective human-view retention timestamps. Owner export audit payloads remain compatible.

`GUEST_DOWNLOADS_ENABLED` defaults false and rejects hosted activation. Migration `0052_guest_media_download_audit.sql` is adopted LOCAL ONLY: persistent local D1 is on0052 after fresh backup,isolated restore/upgrade and live parity. Hosted adoption is not verified. The migration adds a media-download audit guard without modifying customer rows. Recovery: disable the feature first; if necessary drop only `guest_media_download_audit_guard`, retaining existing audit/assets. Never restore an older backup over subsequent writes.

KISS verification: one target build, scoped lint/types and a focused permission/attachment/audit authorization test. No full regression suite, live OAuth, hosted deployment or real customer data checks are claimed. Final delivery approval, publication manifests, ZIP packages and notifications remain separate unfinished work.

## Local acceptance (2026-10-29)

Three API groups and one375px native Chromium flow passed (runner exit0): independent bits2/4 without view; actual private preview/original attachment bytes/SHA; paired requested/generated audit fields; native forged insert denial; generated-audit failure503 with no file; opposite/view-only/foreign/unshared/revoked access denial; native saved-file size/SHA match and logout cleanup. One real LocalSharp image fixture; no1000-file or production claim. Evidence: `apps/worker/.local/guest-downloads-focused-seventh.log` and `guest-downloads-focused-acceptance.json`. Earlier failed runs revealed a fixture schema mismatch,a real missing-column SQL bug,and test-only TS import/native download interception problems;they remain retained as failures.

Final target build, root strict and scoped lint pass. Nine scoped contract tests and Web types passed previously. No broad regression suite was repeated.0052 local adoption passed separately:8 CLI commands,123 unchanged product tables,4 unchanged development rows,one added guard,ledger52,no pending migrations. See latest HANDOFF for backup/restore/parity evidence;no remote adoption claim.
