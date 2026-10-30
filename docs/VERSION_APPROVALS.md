# Version confirmation and delivery: implementation boundary

## Existing requirements

The client must be able to confirm an exact retouched version,with `review_round_id` / `approved_version_id` retained for delivery. Immutable originals/versions,tenant isolation,private Guest sessions and append-only actor/session/request/UTC history remain required. Current-head download is not final published delivery.

## Current evidence

Guest version comparison exists. Owner version history and CAS current-head switching exist;an equivalent Owner comparison canvas remains unfinished. The12 persisted Guest permission bits end at can_compare_versions and mask4095;none represents approval. Shared selection reviews have sealed invitation membership and immutable command/result/audit patterns,but their selection authority must not be reused as version approval authority.

## Authorization and target direction

Use explicit Owner-authorized confirmation requests tied to exact photo/version and scoped invitations;an additive sealed relation avoids rebuilding the old mask table or implicitly granting approval to viewers. Establish live Owner/Guest session and invite album scope before replay or mutation. Capture exact head revision at request creation;never move an old receipt to a newer version automatically. Record each Guest identity separately,even when an invite is shared. Preserve original receipts and request IDs on retries. No new approval endpoint,permission,table or button is implemented by this inventory.

## Pending product decision

The user did not understand the initial compound permission/aggregation question. It was clarified as:when several clients review the same retouched photos,is one representative confirmation sufficient,or must every designated client confirm? A simplified question remains pending. No answer or aggregate project/delivery policy has been inferred. Exact-version individual receipts can be designed independently;automatic publication/whole-project approved transitions must wait for an explicit rule. For an all-client rule,the implementation must also define the fixed designated identity set;new anonymous visitors cannot silently change the denominator.

## Next vertical slice

Define immutable request and individual confirmation contracts,implement native D1 scope/target/request-ID guards and same-body retry,then the actual Owner/Guest UI with a focused positive/denial/replay race test. Final delivery should publish a fixed authorized manifest;later head changes must not change already-published bytes. ZIP/background generation,notifications,expiry/revocation and retention protection remain required and unfinished.

## Confirmed product decision — supersedes the pending section above (2026-10-29)

The user chose「其中一人代表確認即可」:any one authorized client may confirm as a representative. A request must define its authorized invitation set and fixed photo/version;one valid Guest confirmation is sufficient,while the individual identity/session/UTC/request remains recorded. New visitors do not change the required number. New heads do not inherit old approvals. The earlier question is resolved;do not ask it again. Next implement the immutable request/membership and confirmation record,with explicit Owner authorization independent of existing viewing/selection/comparison permissions.

## 2026-10-29 local implementation status

Owner-authorized immutable invitation-scoped requests and one-Guest exact-version receipts are implemented locally behind the default-OFF local-only capability. The historical sections above describe prior state. New heads do not inherit confirmation. Source migration0054, API and UI have isolated native/API checks; persistent upgrade, browser acceptance, immutable delivery manifests, hosted provider configuration and production E2E remain pending. Roll back code by disabling the capability and preserving all approval/version/audit data; rehearse backup/restore and prefer forward schema repair before any persistent migration.
