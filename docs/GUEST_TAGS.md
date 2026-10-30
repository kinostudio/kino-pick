# Guest tags — M2o implementation contract

Status: integrated backend/API/UI/browser/integrity acceptance passed in the148-check local Worker suite.0034 applied locally only; hosted acceptance is not checked. GUEST_TAGS_ENABLED defaults false and may only be enabled in local test environments.

## Identity, scope and behavior

can_tag (bit64) independently authorizes reads and mutations for known photo IDs. Gallery controls also require can_view. Membership belongs to one invite, Guest and logical photo; never combine different Guests or import private tags into shared reviews. Each changed membership records the exact submitted version witness. GET returns only the caller's memberships, never the project catalog or other Guests' labels.

Tag add/remove remains independent feedback after a selection submission, like ratings/favorites: frozen selection snapshots do not change. This explicitly supersedes the older generic submitted-round edit denial for tags only; it does not reopen selection or authorize comments/annotations. Guest mutation expectedGuestId must equal cookie-derived identity, including uncertain retries.

## Labels and resource limits

Labels normalize Unicode NFC, trim surrounding whitespace, retain case and reject empty labels and Unicode Cc/Cf characters. Maximum40 Unicode codepoints. Catalog labels are immutable and unique within workspace/project; catalog identity does not grant visibility. Maximum1000 catalog entries per project and20 active tags per invite/Guest/photo, enforced atomically. Removed memberships retain history. Removing an unknown label does not allocate catalog entries. No implicit rename or replace-all: changing A to B consists of two explicit operations with their own audit events; partial success is visible.

## API

- GET /api/guest/tags/capabilities returns enabled only.
- GET /api/guest/albums/:albumId/tags?photoId=... accepts1–24 distinct UUIDs. Returns guestId and items containing photoId and own tags (tagId,label,versionId,updatedAt). Any out-of-scope photo denies the complete batch.
- PUT /api/guest/albums/:albumId/photos/:photoId/tags accepts strict requestId,expectedGuestId,versionId,label,present. Exact origin and16KiB body bounds apply.
- Result contains guestId,photoId,tagId (nullable for absent-label remove),label,present,requested versionId,changed,eventId (nullable no-op),occurredAt. After success clients read current state because an exact replay may return historical results.

Same-presence requests are no-ops even with a different version witness: retain membership provenance, write an immutable command/result, emit no invented change event. Changes append tag.added/tag.removed with before/after membership, UTC, actor, authorization session, request and workspace/project/album/photo/version context atomically. Current complete ACL precedes replay and is rechecked with result reads. Namespace conflicts are symmetric across Guest ledgers. Known no-ops, limits and changed-intent errors never modify history or quota.

## Acceptance and recovery

Required: independent permission matrix, tenant/photo/version/identity denial, current revoked/expired/disabled Owner denial before exact replay, limits under concurrency, audit-failure rollback, immutable command/result/catalog conflicts, state predecessor replay defense, populated migration preservation, and actual Grid/Lightbox add/remove/unknown-retry browser flows. No feature is accepted until these execute. Label filter must clearly state scope; no current-page subset may be presented as an album-wide result.

Forward-only migration recovery. Keep catalog, command/result/audit and membership provenance; disable GUEST_TAGS_ENABLED before rolling back application code. No deletion or remote migration is authorized by this implementation note.

A first definite tag-cap409 may show the limit and require a current-state refresh before another operation. After any potentially committed response, retain the exact pending intent even when later requests fail; never turn an uncertain request into a fresh UUID automatically.
