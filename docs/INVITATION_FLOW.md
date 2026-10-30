# M2k — Owner invitation creation and Guest entry

## M2l capability extension

Owner invitation capabilities now include feedbackEnabled. The composer describes rating/favorite as available only when the local feedback gate is enabled; all12 rights remain independent and stored exactly. Guest feedback capability is separately public/non-secret and issues no session. See GUEST_FEEDBACK.md for the new rating/favorite APIs/UI and additive0027 migration; all issuer/exchange/selection/feedback defaults stay OFF. Earlier M2k acceptance below is historical.

Status: implemented locally; pnpm test:cloudflare passed112 local checks including connected entry, selection and submission. This slice connects the existing local issuer/exchange services to the Worker UI; it does not enable hosted deployment.

## Owner creation and scope

The project invitation composer reads `/api/v1/invites/capabilities` under the current Owner session. It offers creation only when local issuance and exchange are both available. The endpoint returns non-secret availability and application input limits; it never issues credentials. Album choices use the existing 24-row project album cursor and retain up to 24 selected active albums across pages.

The form preserves all 12 independent permission booleans. View is the only default grant. Reserved actions remain visibly described as unavailable rather than being advertised as working. The three modes are link_only, generated_password and custom_password. A custom password is never trimmed or echoed; shared browser/server validation preserves exact well-formed UTF-8, 12–256 UTF-16 units and at most 1024 bytes. Expiry is converted from the local date/time input to UTC; maxUses is null or 1–10000. Server D1 guards remain authoritative for scope, state, expiry and limits.

One user submission captures a request UUID and exact payload in memory. Unknown outcomes keep that intent locked: retry the same intent or use the metadata-only creation recovery GET. A metadata-only result proves a committed invitation but cannot restore credentials. It must not silently create a replacement. An Owner can inspect/revoke the committed invite and consciously begin another operation.

## Share link and transient credentials

Only a proven initial credential-winning `secretAvailable:true` response can produce links. A `secretAvailable:false` response must show metadata only. Each chosen album has a link of the form `/guest/albums/:albumId/enter#token=<bearer>`. The token belongs exclusively in the URL fragment, never in the request path or query string. Multiple album links may share the invitation token, but each destination remains subject to the actual sealed D1 scope. No custom password is included in the link.

The browser keeps result secrets in transient component memory only. It does not put tokens/passwords into localStorage, sessionStorage, logs or analytics. Copy controls have a manual fallback. Leaving/reloading loses those credentials; the UI warns while a request is unresolved or initial secrets are visible. The backend still stores only hashes/verifiers/commitments and never reissues a lost secret.

## Guest entry and unknown exchange outcomes

The Guest entry route bypasses Owner authentication. `main.tsx` consumes the strictly validated single token fragment once, before rendering React, then removes the fragment from the address bar. Missing or malformed fragments cannot trigger exchange. The page reads `/api/guest/capabilities` and provides a real nickname and optional exact password form only when exchange is enabled. It sends the existing strict same-origin POST with credentials, no-store and no-referrer. Link-only requests omit the password.

A validated successful response leads to the selected Guest album. Wrong credentials and expired/revoked/out-of-scope links use the same generic denial. An ambiguous network/server outcome never starts another session automatically. The page can explicitly check the current Guest cookie using the album access GET and enter only if that current can_view authorization succeeds. If no cookie exists, the committed session may have consumed maxUses; the Guest must reopen the full link or contact the photographer as appropriate. The UI cannot reconstruct a lost one-time cookie or grant cross-project history.

## Gates, recovery and acceptance

Both issuer and exchange flags remain false in all Wrangler environments and examples. Runtime non-local enablement remains rejected. Capability reads do not weaken API gates, issue sessions or mutate audit/state. No migration is required: UI uses existing 0019/0022 command and session invariants, and existing selection routes remain separately gated.

Code rollback can hide the new UI while retaining all invitations, sessions, revocations and audit. Never drop immutable history or reset maxUses to compensate for a lost HTTP response. Full hosted OAuth/edge header/KDF/R2/CORS/resource and backup/restore acceptance remains unverified. Ratings, favorites, tags, annotations, comments, full history, versions, delivery and retention remain required.

Parent acceptance passed112 local checks and covers actual Owner form modes and scope, one-time secret display, exact retry/recovery after dropped responses, fragment/network/storage privacy, Guest link/password login, malformed/disabled/foreign denials, unknown-response handling, and 375px layout against local workerd/D1/R2. Synthetic trusted source headers are test fixtures, not proof of Cloudflare edge behavior.
