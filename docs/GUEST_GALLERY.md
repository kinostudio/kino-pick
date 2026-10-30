## 2026-10-27 — Version comment integration accepted locally

The gallery embeds independent batch comment composition; the current Lightbox and selected After comparison version embed same-invitation comment threads. Guest comment capability/authorization is separate from picks/image comparison. All writes use the comment command path and do not modify selection, rating, favorite or tag state. Rendering uses safe filenames/version labels, not database IDs. Comment reads/targeted-current reads do not append audit or refresh retention. See GUEST_COMMENTS; Owner comment workflows and annotations remain unfinished.243 full local Worker checks passed, with hosted feature flags still OFF.

# Guest read-only gallery and private derivatives (M2h)

Status: the original M2h gallery and later M3a current-head reads are local-only. M3e adds gated Guest published-version history/comparison; see GUEST_VERSION_COMPARISON.md. These remain default-OFF and are not hosted customer access.

## Routes

- GET /api/guest/albums/:albumId/photos/:photoId/versions?cursor=:opaque returns published-ready history and a separately pinned currentVersion, with at most24 versions per page when the M3e local gate is enabled. See GUEST_VERSION_COMPARISON.md.
- `GET /api/guest/albums/:albumId/photos?cursor=:opaque` returns `{photos, nextCursor}`. Each photo contains `id`, `versionId`, `filename`, dimensions, creation time, processing state, and nullable same-origin thumbnail/preview paths. A query returns up to24 records; an extra row determines whether the next cursor exists. The M2h baseline read V1; M3a later changed the gallery to the current head. M3e adds published-version history and comparison; see GUEST_VERSION_COMPARISON.md.
- `GET /api/guest/photos/:photoId/versions/:versionId/assets/thumbnail` and `.../preview` stream a private derivative inline. Other kinds, including `original`, are rejected. There is no download endpoint or R2 presigned URL exposure. A `can_view` grant permits rendering the preview bytes; it does not create a separate download entitlement. A recipient who can view an image can still capture what their browser receives.

Both routes require only the configured Guest cookie (`__Host-kino_guest` over HTTPS; `kino_guest` for configured local HTTP). Owner cookies do not authorize these routes. Every request repeats current authority; no earlier access response is a reusable write capability.

## Live scope decision

The D1 query checks the secret hash, Guest identity/session, invite, scope seal and exact invite-album relation; current enabled Owner; active album; project not archived/deleting/deleted; unexpired session and invite using the database clock; absent session/invite revocations; and the independent `can_view` bit. The requested album is constrained in both the page query and its empty-page sentinel in the same SQL statement. This matters when an invitation grants other albums: a foreign album must return the same `401 GUEST_ACCESS_REQUIRED` as other unavailable scope, while an authorized album with zero photos returns `{photos:[],nextCursor:null}`.

The page is keyset ordered by `(created_at,id)` descending. Cursor decode and IDs are validated; unknown or duplicate query parameters return `400 INVALID_INPUT`. An invalid, expired, revoked, out-of-scope, no-view, inactive, or unavailable session/resource returns a non-enumerating `401 GUEST_ACCESS_REQUIRED`.

## Derivative integrity and response privacy

The asset lookup requires the photo, version, workspace, album, original asset, successful processing job, private derivative row and exact output slot to agree. It allows only JPEG thumbnails/previews. The Worker reads from the private R2 binding and verifies actual object size equals the recorded size, actual SHA-256 equals the recorded checksum, stored content type is `image/jpeg`, and size is no more than8MiB. Missing or mismatched objects fail with `503 ASSET_UNAVAILABLE`; the body is cancelled on mismatch. Successful responses are `image/jpeg`, inline, `private, no-store`, `Referrer-Policy: no-referrer`, same-origin CORP and `Vary: Cookie`, with no Set-Cookie.

No storage key, credential or bearer appears in the JSON response. The page/asset reads do not mutate state or append an audit event. They do not update `album.valid_viewed` and cannot be counted as the product's effective-human-browsing retention heartbeat. Thumbnail fetching is not a download audit.

## M2h scope and remaining boundaries

- Guest portal/gallery UI, login/exchange UI, permission explanation or navigation.
- Selection, rating, favorite, tags, comments, annotations, submission, download grants or append-only action history.
- Read/browse audit, valid-human-view heartbeat, cross-project history or stronger client-portal grant.
- `can_download_preview` / `can_download_original` download endpoint, current/latest-version selection, versions UI or Before/After comparisons were absent in M2h and are now added in M3e.
- Hosted OAuth, Cloudflare edge metadata/cache behavior, external R2/CORS, hosted KDF cost/cancellation or production deployment acceptance.

## Local verification and recovery

`pnpm test:cloudflare` exercises synthetic D1/R2 and the Worker. The test covers 25-photo pagination, empty/foreign album distinction, `can_view` without other rights, exact JPEG bytes/checksum/size, no-store and same-origin headers, and anonymous/no-view/revoked/foreign-photo/original denial. It does not use customer data or external credentials.

Final run7 passed228 local Cloudflare checks, including new API and375px Chromium comparison (.local/m3e-cloudflare-seventh.log).288 unit tests/37files, generated strict types, lint, Next build and targeted formatting also passed. Run6 previously passed new comparison checks but failed later in the exchange test; sequential request/response validation retained all denial assertions and run7 passed. The underlying transport cause is unproven. Hosted OAuth, remote R2/CORS, edge and deployment remain not_checked. See GUEST_VERSION_COMPARISON.md and HANDOFF.md. No schema changed; to disable comparison turn its flag off, retain immutable version/head/history and invitation/session/audit records, and preserve live private-asset ACL/output checks.
