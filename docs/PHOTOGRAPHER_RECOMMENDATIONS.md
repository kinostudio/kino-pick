# Photographer recommendations

This feature lets an Owner surface photos that match photographer metadata rules. It reads only embedded XMP rating and label values from an immutable original. It does not make an AI judgment and it does not change Guest selections or feedback.

## Recommendation rules

Each album has one Owner-controlled visibility flag, an optional minimum rating from 1 to 5, and an optional set of label colors (`red`, `yellow`, `green`, `blue`, `purple`). Matching is fixed to **any** condition:

- Recommend when the effective rating is at least `minRating`, or
- Recommend when the effective label is one of `allowedLabels`.

If both criteria are unset, criteria produce no recommendations. If the album flag is hidden, the Guest projection returns `photographerRecommended: false` for every photo. A per-photo Owner decision can explicitly recommend or exclude a photo and overrides the criteria while visibility remains controlled by the album.

The effective rating and label come from the Owner’s manual value when set, otherwise from imported XMP evidence. A manual `clear` suppresses an imported value; `inherit` uses the imported value. The returned record keeps `imported`, `manual`, and `effective` fields separate so an Owner can see their provenance. This data is independent of Guest ratings, comments, favorites, and selection submissions.

## Metadata source and limits

The parser recognizes embedded XMP in JPEG, PNG, and WebP containers. It extracts only `xmp:Rating`, `xmp:Label`, and the parser’s small evidence record. It does not retain or return the raw XMP packet or unrelated metadata such as GPS. Unsupported or invalid values remain explicit field states instead of becoming a guessed rating or color. Label matching accepts the five configured English color names exactly; a custom Lightroom label name is not inferred to be a color.

The Owner import request carries only the photo, version, request ID, and expected metadata revision. The Worker obtains the immutable original asset ID, object key, MIME type, size, and checksum from D1; it requires the asset to be `private`, checks the R2 object size, MIME, and SHA-256, and performs bounded range reads pinned to the observed ETag. A client cannot submit raw metadata or claim imported provenance. Import records are bound to the exact `photo_versions` row and source checksum; changing the current photo head does not move metadata to a different version.

Upload completion schedules the same trusted import path for a new original. The Owner can also request an import for an existing photo/version. A retry with the same request is idempotent. Re-importing identical evidence is a no-op; importing updated evidence for a version keeps its manual overrides intact.

## API contract

All endpoints require an authenticated current Owner session. Writes also require the configured same-origin `Origin`, `application/json`, and matching `X-Kino-Expected-Actor` and `X-Kino-Expected-Session` headers. Query strings are limited to the documented cursor or version ID.

| Method and path                                                            | Purpose                                                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/photographer-recommendations/capabilities`                    | Returns `{ "enabled": boolean }`.                                                                                                    |
| `GET /api/v1/albums/{albumId}/photographer-recommendations`                | Returns the current policy and at most 24 current-head photo records; accepts an optional photo UUID `cursor`.                       |
| `PUT /api/v1/albums/{albumId}/photographer-recommendations`                | Sets album visibility and the fixed-any criteria.                                                                                    |
| `GET /api/v1/photos/{photoId}/photographer-metadata?versionId={versionId}` | Reads the current head by default, or the requested version for Owner history.                                                       |
| `PUT /api/v1/photos/{photoId}/photographer-metadata`                       | Sets manual rating/label inheritance and the manual recommend/exclude decision for the current head.                                 |
| `POST /api/v1/photos/{photoId}/photographer-metadata/import`               | Imports server-verified metadata for the specified version. The body contains only `requestId`, `expectedRevision`, and `versionId`. |

Album writes use `{ requestId, expectedRevision, visible, minRating, allowedLabels }`. Per-photo writes use `{ requestId, expectedRevision, expectedHeadRevision, versionId, rating, label, decision }`. `expectedRevision` protects the metadata record; `expectedHeadRevision` binds an edit to the current version head and prevents a head-change/head-return race. New revisions must be integers. Stale writes return a conflict and leave state unchanged.

Recommendation page records expose source identity and separated imported/manual/effective values to the Owner. The Guest gallery receives only the optional boolean `photographerRecommended`, after the existing secret-ACL photo filtering. It receives no raw star rating, label, asset identity, checksum, import timestamp, or provenance.

## Storage and recovery

Migration `0059_photographer_recommendations.sql` is additive. It adds an Owner command ledger, append-only results, one policy row per album, and one version-bound metadata row per photo/version. D1 guards verify the current enabled Owner and session, album/workspace/project scope, live resource state, current head for manual edits, source asset/version/checksum/MIME for imports, revision CAS, audit pairing, and request-ID namespace separation from the existing Owner ledgers. SQLite checks reject fractional values for integer rating and revision fields.

Capability detection checks all four feature tables and the required guard triggers. On the prior schema, or on a partial migration, capability is false and feature reads fail closed instead of breaking the gallery. `PHOTOGRAPHER_RECOMMENDATIONS_ENABLED` defaults to `false`; the Worker configuration permits enabling it only in local or explicitly scoped staging validation.

Recovery is forward-only: turn `PHOTOGRAPHER_RECOMMENDATIONS_ENABLED` off and retain the commands, results, evidence, and audit rows. Repair with a new additive migration if needed. Do not delete the source asset, photo version, metadata evidence, or audit history as a rollback step. No migration should be applied to a persistent database until the release owner completes the separate backup, parity, and deployment checks.

## Local verification boundary

The focused native D1 guard test is:

```powershell
pnpm.cmd exec vitest run tests/unit/photographer-recommendations-d1-guards.test.ts
```

It covers full-0059 capability and 0058 fail-closed reads, current Owner/session/resource scope, policy revision CAS and exact replay, no-op audit behavior, request-ID namespace collision in both directions, fractional rating rejection, append-only guards, and atomic rollback when audit insertion is injected to fail. The separate focused Worker route runner exercises the actual local Worker, D1, and R2 bindings for import and Owner/Guest route behavior.

These are isolated local checks. They do not establish B/Cloudflare deployment, remote or customer R2/D1 behavior, production migration application, or live-site acceptance. Real photographer files and custom metadata catalogs also remain outside these checks.
