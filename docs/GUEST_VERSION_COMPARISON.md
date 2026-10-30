## 2026-10-27 — Optional independent comment panel

M3f1 embeds a separately gated GuestCommentsPanel for the selected After version. Comparison/history controls and image GETs remain read-only. Only explicit comment actions with GUEST_COMMENTS_ENABLED and independent can_comment write through the separate comment API; they never alter picks/ratings/favorites/tags or version heads. Same-invitation comment sharing and other-invitation isolation are enforced. M3e readonly regression keeps the comment flag OFF; combined comparison/comment behavior is verified by M3f1's actual243-check full suite. Both flags remain OFF/hard-local in shipped settings. See GUEST_COMMENTS for current lifecycle/recovery and missing Owner/annotation work.

# Guest published-version history and comparison (M3e)

Status: integrated source for a read-only, local-only feature. GUEST_VERSION_COMPARISON_ENABLED defaults false in every Wrangler environment and .dev.vars.example; configuration rejects non-local enablement and requires GUEST_EXCHANGE_ENABLED plus PHOTO_VERSIONS_ENABLED. No D1 schema or migration was added; 0041 remains the latest locally applied migration.

## Capability and permissions

GET /api/guest/version-comparison/capabilities returns only {enabled:boolean}; it is an availability hint, not an invitation grant. The UI shows Compare only when enabled and current album access grants both can_view and can_compare_versions. can_select is not required. The history API independently checks both rights.

## Published history and assets

GET /api/guest/albums/:albumId/photos/:photoId/versions?cursor=:opaque returns {albumId,photoId,head:{versionId,revision},currentVersion,versions,nextCursor}. Versions are descending, at most 24 per page; a ready currentVersion is pinned separately and can be outside the page. The opaque cursor binds photoId, current head version ID and revision, and last version number. A changed head returns 409 GUEST_VERSION_HISTORY_CHANGED and the UI clears old previews pending explicit reload.

History includes only ready versions that are current, baseline V1, or recorded by an immutable successful head-publication result with changed:true. Readiness requires private original and succeeded processing with the exact private thumbnail and preview slots. A ready version that is neither current nor baseline V1 and has never been published as a head is hidden from history and the generic Guest asset route. History metadata uses bounded safe labels and the fixed createdByLabel 攝影師; it contains no actor IDs, storage keys, credentials, originals or signed URLs.

Every history and image request rechecks current Guest session, exact sealed invitation/album scope, enabled Owner, active parents, deadlines, revocations and the required permission. Current-head bytes require can_view; non-current published-version bytes additionally require can_compare_versions. The generic byte route serves only thumbnail/preview and verifies the private output slot, MIME, size and checksum. Reads do not mutate state, append audit or refresh retention.

## Comparison UI

The Guest Lightbox supports slider, side-by-side and overlay. Before/After choices use loaded eligible versions; zoom and pan stay synchronized. Images use contain/letterbox and differing dimensions or aspect ratios are called out. Keyboard slider control and returning focus to the parent Lightbox are supported. There is no heatmap or difference score. Denied, stale and failed reads clear prior imagery and require explicit retry or reload.

## Recovery

Turn GUEST_VERSION_COMPARISON_ENABLED off to disable the feature. Preserve immutable version/head/history and invite/session/revocation/audit records; keep asset reads private and retain live ACL and output-integrity checks. Do not treat this local slice as hosted or deployed.

## Local verification

Final run7 passed228 local Cloudflare checks, including new API and375px Chromium comparison (.local/m3e-cloudflare-seventh.log).288 unit tests/37files, generated strict types, lint, Next build and targeted formatting also passed. Run6 previously passed new comparison checks but failed later in the exchange test; sequential request/response validation retained all denial assertions and run7 passed. The underlying transport cause is unproven. Hosted OAuth, remote R2/CORS, edge and deployment remain not_checked. See GUEST_VERSION_COMPARISON.md and HANDOFF.md.

Next Guest work includes the confirmed comment scope: comments are shared within one invitation and isolated between different invitations. Full M1–M5 and hosted acceptance remain open.
