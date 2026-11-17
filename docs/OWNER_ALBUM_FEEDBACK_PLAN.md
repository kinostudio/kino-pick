# Owner album-wide feedback plan

Status: schema/API/UI implemented locally; native API checks passed. Chromium pointer acceptance is blocked by the mobile navigation hit target; retries stopped after repeated failures. The specifically approved live70 backup and independent B restore to 0071 passed; live remains70. The release chain is still blocked by the recorded UI acceptance failure. Not released or hosted-accepted.

2026-11-16 user confirmed that Owner-authored album feedback is visible to every valid share that can view the album. Guest-authored content retains the already implemented invite isolation. The additive migration is `0071_owner_album_feedback.sql`; 0070 is unchanged. The user explicitly approved the specified live schema70 backup destination and independent B restore. Both completed successfully after that approval; the earlier rejected action itself performed no export. See `docs/releases/owner-feedback-0071-independent-restore.json`.

## Product scope

- An Owner can create a comment or annotation on a photo without selecting a customer invite.
- Each Owner item has one canonical album audience. It is visible through every sealed, unexpired, unrevoked invite that includes the album and grants `can_view`.
- `can_comment` and `can_annotate` continue to control Guest writes. They do not hide Owner-authored feedback from an invite that can view the photo.
- Owner authoring is allowed with zero active invites. A later valid invite can read the canonical item; an expired or revoked invite cannot.
- Guest-authored comments, replies, and annotations remain scoped to their original invite. Never copy them to other invites or merge separate invite conversations.
- Comments and annotations stay attached to the exact immutable `photoId` and `versionId` selected from the current photo context. A newer version does not move existing feedback. Reject or refresh a stale write if the current version changed while the editor was open.

## Existing contract gap

- `packages/contracts/src/owner-comments.ts` only accepts Owner `reply`, `edit_reply`, and `delete_reply`. A reply requires a `parentCommentId`; Owner-authored items must have a parent. The read query and response page require one `inviteId`.
- `apps/worker/src/owner-comments.ts` authorizes and reads through that invite and its guest parent comment. It cannot create a top-level album-wide Owner comment.
- Owner-authored annotations already exist, but `packages/contracts/src/owner-annotation-authoring.ts` requires `inviteId` on every command and item. `apps/worker/src/owner-annotation-authoring.ts` and `owner-annotation-author-read.ts` join the selected invite and scope writes and reads to it.
- The current Owner panels and their local journals use invite-scoped context. Choosing the first invite or reusing a Guest row would silently change the audience and can expose one customer's content to another.
- This checkout's numbered migrations end at `apps/worker/migrations/0070_invite_labels.sql`; the next candidate is `0071`. Recheck the release tree and any concurrently prepared migration before assigning the number.

## Minimal safe vertical slice

1. Add canonical album-scoped Owner comment and annotation records in migration `0071`, with explicit `scope = album` (do not encode album scope as a fake invite or nullable invite). Keep an exact photo/version reference, Owner identity, revision/CAS, idempotent command receipt, and append-only change/audit evidence. Do not duplicate a row for every invite.
2. Add Owner-only read/write service paths that authorize the Owner against the album and verify that the photo/version belongs to it. Require current-version confirmation on create; edit/delete must match the original album/photo/version and expected revision. Preserve existing invite-scoped Owner replies and annotation commands unchanged.
3. Extend Guest read projections to add only canonical album-scoped Owner items after the request's own invite has passed its existing sealed, expiry, revocation, album, and `can_view` checks. Keep Guest-authored rows filtered by that exact invite. Mark each returned item with an explicit origin/scope discriminator so an album Owner item cannot be confused with an invite-local Guest item.
4. Keep the existing invite-local Guest write paths and permission checks. A Guest reply to an Owner broadcast comment must not attach to a different invite's conversation; leave broadcast comments read-only to Guests in this slice unless a separately scoped reply model is specified. Do not link an album Owner annotation to an invite-local Guest comment; the first slice should leave that link null or add an explicit album-Owner-comment reference.
5. Update Owner UI to use the photo's current version and a single album-wide Owner composer/editor; no invite selector. Preserve the existing invite-scoped Guest conversation/annotation details until they can be shown without combining their content. Put permission changes in the share UI.
6. Extend the Owner comment/annotation journals with the explicit album scope in their keys and metadata. Pending writes must never replay under an invite or under a different photo/version. Continue showing uncertain/conflict states and require refresh before retry when the current version or revision changed.
7. Add focused service/contract tests and one browser flow covering: zero active invites, two active invites both read the same canonical Owner item, a revoked/expired invite cannot read it, different Guest comments remain isolated, stale-version and stale-revision writes fail, and existing `can_comment`/`can_annotate` Guest-write denials still hold. No broad suite rerun is needed beyond the release gate.

## Files the implementation is expected to reach

- Schema and audit: `apps/worker/migrations/0071_owner_album_feedback.sql`, plus the migration catalog/release-proof inputs required by this checkout.
- Contracts: `packages/contracts/src/owner-comments.ts`, `guest-comments.ts`, `owner-annotation-authoring.ts`, and the Guest/Owner annotation response contracts.
- Worker: Owner comment and annotation routes/services/readers, Guest comment and annotation read projections, and Owner history/audit projection where the existing event types require it.
- Web: `apps/web/target-ui/owner-comments.tsx`, `owner-annotations.tsx`, `owner-annotation-editor.tsx`, and their Owner journals; Guest comment/annotation renderers only where the response scope discriminator needs handling.
- Verification: focused contract and native Worker tests for these boundaries, plus one browser flow. Preserve all existing invite-isolation and permission assertions.

## Not included

- Replicating Owner rows into every invite, changing any Guest write permission, exposing Guest content across invites, or using an invite as an Owner broadcast surrogate.
- Notifications, bulk permission edits, or automatic reassignment of feedback when a new photo version becomes current.
- Any claim that Owner album-wide comments or annotations are available before the migration, services, Guest reads, journals, UI, and focused acceptance are implemented together.
