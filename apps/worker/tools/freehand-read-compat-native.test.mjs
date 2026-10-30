import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  decideAnnotationReadCompatibility,
  preflightFreehandAnnotationRead,
} from '../src/freehand-read-compat.ts';

const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  ownerSession: '12121212-1212-4121-8121-121212121212',
  otherOwner: '13131313-1313-4131-8131-131313131313',
  workspace: '22222222-2222-4222-8222-222222222222',
  project: '33333333-3333-4333-8333-333333333333',
  album: '44444444-4444-4444-8444-444444444444',
  invite: '55555555-5555-4555-8555-555555555555',
  otherInvite: '56565656-5656-4565-8565-565656565656',
  photo: '66666666-6666-4666-8666-666666666666',
  version: '77777777-7777-4777-8777-777777777777',
  guest: '88888888-8888-4888-8888-888888888888',
  guestSession: '99999999-9999-4999-8999-999999999999',
  otherGuest: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  otherGuestSession: 'abababab-abab-4bab-8bab-abababababab',
  sameInviteGuest: 'acacacac-acac-4cac-8cac-acacacacacac',
  sameInviteGuestSession: 'adadadad-adad-4dad-8dad-adadadadadad',
};
const guestSecretHash = 'a'.repeat(64);
const otherGuestSecretHash = 'b'.repeat(64);
const sameInviteGuestSecretHash = 'c'.repeat(64);
const future = Date.now() + 3_600_000;
const db = new DatabaseSync(':memory:');

function run(sql, ...bindings) {
  return db.prepare(sql).run(...bindings);
}

db.exec(
  [
    'PRAGMA foreign_keys = ON;',
    'CREATE TABLE owners(user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);',
    'CREATE TABLE owner_sessions(id TEXT PRIMARY KEY, userId TEXT NOT NULL, expiresAt INTEGER NOT NULL);',
    'CREATE TABLE workspaces(id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL);',
    'CREATE TABLE projects(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, status TEXT NOT NULL);',
    'CREATE TABLE albums(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, state TEXT NOT NULL);',
    'CREATE TABLE guest_invites(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, permissions_mask INTEGER NOT NULL, created_by TEXT NOT NULL, expires_at_ms INTEGER NOT NULL);',
    'CREATE TABLE guest_invite_seals(invite_id TEXT PRIMARY KEY);',
    'CREATE TABLE guest_invite_albums(invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL);',
    'CREATE TABLE guest_sessions(id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, guest_id TEXT NOT NULL, secret_hash TEXT NOT NULL, expires_at_ms INTEGER NOT NULL);',
    'CREATE TABLE guest_identities(id TEXT PRIMARY KEY, invite_id TEXT NOT NULL);',
    'CREATE TABLE guest_invite_revocations(invite_id TEXT PRIMARY KEY);',
    'CREATE TABLE guest_session_revocations(session_id TEXT PRIMARY KEY);',
    'CREATE TABLE photos(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL);',
    'CREATE TABLE photo_versions(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, photo_id TEXT NOT NULL);',
    'CREATE VIEW guest_annotation_eligible_versions AS SELECT v.id AS version_id, v.photo_id, p.workspace_id, p.project_id, p.album_id FROM photo_versions v JOIN photos p ON p.id=v.photo_id;',
    'CREATE TABLE guest_annotations(id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL, photo_id TEXT NOT NULL, version_id TEXT NOT NULL, author_guest_id TEXT NOT NULL, state TEXT NOT NULL, geometry_json TEXT);',
    'CREATE TABLE owner_annotations(id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL, photo_id TEXT NOT NULL, version_id TEXT NOT NULL, author_user_id TEXT NOT NULL, state TEXT NOT NULL, geometry_json TEXT);',
    'CREATE TABLE guest_annotation_changes(seq INTEGER NOT NULL, guest_id TEXT NOT NULL, invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL, photo_id TEXT NOT NULL, version_id TEXT NOT NULL);',
    'CREATE TABLE owner_annotation_changes(seq INTEGER NOT NULL, actor_id TEXT NOT NULL, invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL, photo_id TEXT NOT NULL, version_id TEXT NOT NULL);',
    'CREATE TABLE owner_annotation_processing_changes(seq INTEGER NOT NULL, invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL, photo_id TEXT NOT NULL, version_id TEXT NOT NULL);',
  ].join('\n'),
);

run('INSERT INTO owners VALUES(?,1)', ids.owner);
run(
  'INSERT INTO owner_sessions VALUES(?,?,?)',
  ids.ownerSession,
  ids.owner,
  future,
);
run('INSERT INTO workspaces VALUES(?,?)', ids.workspace, ids.owner);
run("INSERT INTO projects VALUES(?,?,'reviewing')", ids.project, ids.workspace);
run(
  "INSERT INTO albums VALUES(?,?,?,'active')",
  ids.album,
  ids.workspace,
  ids.project,
);
for (const inviteId of [ids.invite, ids.otherInvite]) {
  run(
    'INSERT INTO guest_invites VALUES(?,?,?,?,?,?)',
    inviteId,
    ids.workspace,
    ids.project,
    128,
    ids.owner,
    future,
  );
  run('INSERT INTO guest_invite_seals VALUES(?)', inviteId);
  run(
    'INSERT INTO guest_invite_albums VALUES(?,?,?,?)',
    inviteId,
    ids.workspace,
    ids.project,
    ids.album,
  );
}
for (const [guestId, inviteId] of [
  [ids.guest, ids.invite],
  [ids.otherGuest, ids.otherInvite],
  [ids.sameInviteGuest, ids.invite],
]) {
  run('INSERT INTO guest_identities VALUES(?,?)', guestId, inviteId);
}
for (const [sessionId, guestId, inviteId, secretHash] of [
  [ids.guestSession, ids.guest, ids.invite, guestSecretHash],
  [
    ids.otherGuestSession,
    ids.otherGuest,
    ids.otherInvite,
    otherGuestSecretHash,
  ],
  [
    ids.sameInviteGuestSession,
    ids.sameInviteGuest,
    ids.invite,
    sameInviteGuestSecretHash,
  ],
]) {
  run(
    'INSERT INTO guest_sessions VALUES(?,?,?,?,?)',
    sessionId,
    inviteId,
    guestId,
    secretHash,
    future,
  );
}
run(
  'INSERT INTO photos VALUES(?,?,?,?)',
  ids.photo,
  ids.workspace,
  ids.project,
  ids.album,
);
run(
  'INSERT INTO photo_versions VALUES(?,?,?)',
  ids.version,
  ids.workspace,
  ids.photo,
);

let annotationSequence = 0;
function insertGuestAnnotation(inviteId, authorGuestId, geometry) {
  annotationSequence += 1;
  const id =
    String(annotationSequence).padStart(8, '0') +
    '-0000-4000-8000-000000000001';
  run(
    'INSERT INTO guest_annotations VALUES(?,?,?,?,?,?,?,?,?,?)',
    id,
    inviteId,
    ids.workspace,
    ids.project,
    ids.album,
    ids.photo,
    ids.version,
    authorGuestId,
    'open',
    JSON.stringify(geometry),
  );
  run(
    'INSERT INTO guest_annotation_changes VALUES(?,?,?,?,?,?,?,?)',
    annotationSequence,
    authorGuestId,
    inviteId,
    ids.workspace,
    ids.project,
    ids.album,
    ids.photo,
    ids.version,
  );
}

let ownerChangeSequence = 0;
function insertOwnerAnnotation(inviteId, authorUserId, geometry) {
  ownerChangeSequence += 1;
  const id =
    String(100_000 + ownerChangeSequence).padStart(8, '0') +
    '-0000-4000-8000-000000000001';
  run(
    'INSERT INTO owner_annotations VALUES(?,?,?,?,?,?,?,?,?,?)',
    id,
    inviteId,
    ids.workspace,
    ids.project,
    ids.album,
    ids.photo,
    ids.version,
    authorUserId,
    'open',
    JSON.stringify(geometry),
  );
  run(
    'INSERT INTO owner_annotation_changes VALUES(?,?,?,?,?,?,?,?)',
    ownerChangeSequence,
    authorUserId,
    inviteId,
    ids.workspace,
    ids.project,
    ids.album,
    ids.photo,
    ids.version,
  );
}

const nativeD1 = {
  prepare(sql) {
    return {
      bind(...bindings) {
        return {
          async first() {
            return db.prepare(sql).get(...bindings) ?? null;
          },
        };
      },
    };
  },
};

async function preflight(scope) {
  return preflightFreehandAnnotationRead(nativeD1, scope);
}
function assertAuthorizedFreehand(result) {
  assert.equal(result.kind, 'authorized');
  assert.equal(result.containsFreehand, true);
  return result;
}
function freehandGeometry(offset = 0) {
  return {
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points: [
      { x: offset, y: offset },
      { x: offset + 1, y: offset + 1 },
    ],
  };
}
function rectangleGeometry() {
  return {
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
}

const guestOneScope = {
  secretHash: guestSecretHash,
  albumId: ids.album,
  photoId: ids.photo,
  versionId: ids.version,
};
const otherInviteScope = {
  secretHash: otherGuestSecretHash,
  albumId: ids.album,
  photoId: ids.photo,
  versionId: ids.version,
};

// No annotations means an authorized legacy feed is compatible.
const initial = await preflight({ kind: 'guest-shared', ...otherInviteScope });
assert.equal(initial.kind, 'authorized');
assert.equal(initial.containsFreehand, false);

// Freehand beyond the ordinary 24+1 page window is still found by full preflight.
for (let index = 0; index < 25; index += 1) {
  insertGuestAnnotation(ids.invite, ids.guest, rectangleGeometry());
}
insertGuestAnnotation(ids.invite, ids.guest, freehandGeometry());
const guestOwn = assertAuthorizedFreehand(
  await preflight({ kind: 'guest-own', ...guestOneScope }),
);
assert.equal(guestOwn.scopeKind, 'guest-own');
assert.ok(guestOwn.watermarks.guest >= 26);

const guestShared = assertAuthorizedFreehand(
  await preflight({ kind: 'guest-shared', ...guestOneScope }),
);
assert.equal(guestShared.scopeKind, 'guest-shared');
assert.ok(guestShared.watermarks.guest >= 26);
assert.equal(guestShared.watermarks.owner, 0);
assert.equal(guestShared.watermarks.processing, 0);

// Own feed excludes a different Guest in the same invitation; shared feed includes it.
const sameInviteOwnOnly = await preflight({
  kind: 'guest-own',
  secretHash: sameInviteGuestSecretHash,
  albumId: ids.album,
  photoId: ids.photo,
  versionId: ids.version,
});
assert.equal(sameInviteOwnOnly.kind, 'authorized');
assert.equal(sameInviteOwnOnly.containsFreehand, false);
insertGuestAnnotation(ids.invite, ids.sameInviteGuest, freehandGeometry(5));
assert.equal(
  (
    await preflight({
      kind: 'guest-own',
      secretHash: sameInviteGuestSecretHash,
      albumId: ids.album,
      photoId: ids.photo,
      versionId: ids.version,
    })
  ).containsFreehand,
  true,
);
assert.equal(
  (await preflight({ kind: 'guest-shared', ...guestOneScope }))
    .containsFreehand,
  true,
);

// Owner scope sees only current-actor rows; shared sees Owner rows from the same invite.
const ownerScope = {
  kind: 'owner-own',
  ownerId: ids.owner,
  sessionId: ids.ownerSession,
  inviteId: ids.invite,
  albumId: ids.album,
  photoId: ids.photo,
  versionId: ids.version,
};
const ownerGuestListScope = { ...ownerScope, kind: 'owner-guest-list' };
const ownerGuestList = assertAuthorizedFreehand(
  await preflight(ownerGuestListScope),
);
assert.equal(ownerGuestList.scopeKind, 'owner-guest-list');
assert.ok(ownerGuestList.watermarks.guest >= 26);
assert.equal(ownerGuestList.watermarks.processing, 0);
const ownerGuestListOtherInvite = await preflight({
  ...ownerGuestListScope,
  inviteId: ids.otherInvite,
});
assert.equal(ownerGuestListOtherInvite.kind, 'authorized');
assert.equal(ownerGuestListOtherInvite.containsFreehand, false);
const ownerBeforeRows = await preflight(ownerScope);
assert.equal(ownerBeforeRows.kind, 'authorized');
assert.equal(ownerBeforeRows.containsFreehand, false);
insertOwnerAnnotation(ids.invite, ids.otherOwner, freehandGeometry(8));
assert.equal((await preflight(ownerScope)).containsFreehand, false);
assert.equal(
  (await preflight({ kind: 'guest-shared', ...guestOneScope }))
    .containsFreehand,
  true,
);
insertOwnerAnnotation(ids.invite, ids.owner, freehandGeometry(10));
const ownerOwn = assertAuthorizedFreehand(await preflight(ownerScope));
assert.equal(ownerOwn.scopeKind, 'owner-own');
assert.ok(ownerOwn.watermarks.owner > 0);

// Another invitation over the same photo/version remains isolated.
const otherInviteNoRows = await preflight({
  kind: 'guest-shared',
  ...otherInviteScope,
});
assert.equal(otherInviteNoRows.kind, 'authorized');
assert.equal(otherInviteNoRows.containsFreehand, false);
insertGuestAnnotation(ids.otherInvite, ids.otherGuest, freehandGeometry(12));
assert.equal(
  (
    await preflight({
      ...ownerGuestListScope,
      inviteId: ids.otherInvite,
    })
  ).containsFreehand,
  true,
);
assert.equal(
  (
    await preflight({
      kind: 'guest-shared',
      ...otherInviteScope,
    })
  ).containsFreehand,
  true,
);

// Missing, wrong and revoked Guest sessions, and invalid Owner sessions, disclose no boolean.
assert.deepEqual(
  await preflight({
    kind: 'guest-own',
    secretHash: 'd'.repeat(64),
    albumId: ids.album,
    photoId: ids.photo,
    versionId: ids.version,
  }),
  { kind: 'denied' },
);
run('INSERT INTO guest_session_revocations VALUES(?)', ids.guestSession);
const revokedGuest = await preflight({
  kind: 'guest-shared',
  ...guestOneScope,
});
assert.deepEqual(revokedGuest, { kind: 'denied' });
assert.deepEqual(decideAnnotationReadCompatibility(false, revokedGuest), {
  kind: 'denied',
});
const invalidOwnerSession = await preflight({
  ...ownerScope,
  sessionId: 'abababab-abab-4bab-8bab-abababababab',
});
assert.deepEqual(invalidOwnerSession, { kind: 'denied' });
assert.deepEqual(
  decideAnnotationReadCompatibility(false, invalidOwnerSession),
  { kind: 'denied' },
);

// Returned watermarks let later route wiring detect a change between the
// preflight statement and the separate page read.
const beforeMutation = await preflight({
  kind: 'guest-shared',
  ...otherInviteScope,
});
assert.equal(beforeMutation.kind, 'authorized');
insertOwnerAnnotation(ids.otherInvite, ids.owner, rectangleGeometry());
const afterMutation = await preflight({
  kind: 'guest-shared',
  ...otherInviteScope,
});
assert.equal(afterMutation.kind, 'authorized');
assert.ok(afterMutation.watermarks.owner > beforeMutation.watermarks.owner);

console.log(
  JSON.stringify({
    legacyFreehandBeyondPageDetected: true,
    sameInviteOwnAndSharedScopes: true,
    crossInviteIsolation: true,
    invalidSessionDoesNotExposeBoolean: true,
    scopeWatermarksReturned: true,
  }),
);
db.close();
