## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison slider/side-by-side/overlay, delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

# M3a current-version foundation

Status: implementation in progress, not accepted. PHOTO_VERSIONS_ENABLED defaults OFF in all environments and rejects non-local activation. This is the foundation for the still-required manual V2 upload, filename matching and Before/After workflows, not completion of those requirements.

## Immutable version model

Retain photo_versions and photo_assets unchanged. Add a separate tenant/photo-scoped head with versionId, monotonic revision and canonical command witness. Existing and future V1 records establish revision0. A version switch is an explicitly confirmed Owner command bound to expectedCurrentVersionId and expectedRevision. Validate current Owner/session/tenant/parent state before replay and atomically at mutation. A real change updates only the head and appends photo.version_current_changed with before/after state. No-op retains revision and produces no fake change event. Commands/results and previous state witnesses resist replacement and rollback.

A switch target must belong to the same logical photo and have its private original plus successfully processed thumbnail/preview witnesses. Old assets, version metadata, selections, submission snapshots, ratings, favorites, tags, annotations and historical version references are not rewritten. The default current head preserves V1 behavior until an explicit successful switch.

## API and UI

Local-only capability: GET /api/v1/photo-versions/capabilities. Owner GET /api/v1/photos/:photoId/versions returns photoId/current/at-most24 versions/nextCursor, with scoped metadata and existing private asset gateway URLs only. POST /api/v1/photos/:photoId/versions/set-current accepts strict requestId/expectedRevision/expectedCurrentVersionId/versionId/confirm:true. Replies include current state, changed, nullable eventId and occurredAt. Replays represent the original commitment; UI must GET current state before claiming it is current.

The Owner panel lists versions and offers confirmation only for ready non-current targets. Unknown outcomes retain exact UUID/body and prevent a second intent. Do not present upload or comparison buttons until those flows work. Preserve existing gallery behavior and mobile keyboard access.

## Required integration and verification

Owner and Guest gallery lists must use the current head rather than hardcoded version_no=1. Before multiple versions are exposed, Guest non-current derivative reads need both can_view and independent can_compare_versions; current-version viewing needs only can_view. Every asset read retains current invitation/session/album/tenant checks. Full comparison APIs/UI remain a later required slice.

0036 is planned as an additive migration that seeds heads and adds canonical switch state. Verify populated row preservation, currentACL, CAS races, no-op/replay, request namespace collisions, audit rollback, duplicate/null/alternate insert guards and predecessor rollback in real D1. Test gallery head selection, non-current Guest denial, explicit Owner confirmation, uncertain retry and375px behavior. No persistent migration is applied until verified. Recovery retains all immutable records and heads, disables version mutations and uses forward repairs.

## Next required vertical work

Extend the existing upload reservation/presign/fence/checksum/processing workflow to target an explicitly chosen photo and atomically allocate the next unique version number, preserving its photo_id. Then implement mode-controlled filename matching/assisted decisions and Guest version comparison (slider, side-by-side, overlay). No feature is removed or considered complete by this foundation.

## Manual upload integration assessment (next required work)

The existing upload_completions.photo_id has a UNIQUE constraint and the completion trigger always inserts a new photo/V1. A manual V2 cannot reuse that record without changing established invariants. Plan an immutable upload_version_targets row bound at reservation and an upload_version_completions ledger for that upload session. Preserve the ordinary V1 branch and historical replay shapes; do not add target fields at completion. Reuse quota reservations, authorization, immutable object keys, fences, R2 size/MIME/hash/dimension inspection and processing jobs. Allocate next version_no atomically at completion; keep the current head unchanged until ready processing and an explicit CAS switch. No manual upload implementation is claimed by this assessment.

## Definitive conflicts after an uncertain request

For this ledger only, an exact same actor/request/body retry returning PHOTO_VERSION_REVISION_CONFLICT or PHOTO_VERSION_NOT_READY proves that command did not commit:0036 returns an existing canonical result before its revision/readiness checks. The Owner UI may clear that intent even after a transport failure, but must keep the parent navigation gate until fresh current state is read, then refresh the gallery. Keep the original intent for other ambiguous outcomes, including denied replay or unexplained request-ID conflict. Do not generalize these two terminal codes to unrelated ledgers. Cover a first request dropped before Worker execution, an intervening head switch, exact retry409 and eventual unlocked fresh gallery; the committed lost200/retry401 case must still preserve its original identity.
