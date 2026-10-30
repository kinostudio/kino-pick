import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';

const canComment = 256;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashGuestSession = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const hashInviteToken = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

/**
 * Seed real, guarded Guest comment history against an actual ready V2 before
 * migration 0043 is applied. The caller supplies the isolated upgrade D1 and
 * R2 stores; no trigger is disabled and no projection or audit row is forged.
 */
export async function seedPreOwnerCommentHistory({
  db,
  storage,
  owner,
  photoId,
}) {
  assert.ok(db && storage && owner && photoId);
  assert.equal(typeof storage.put, 'function');
  assert.equal(typeof storage.get, 'function');

  const ownerSession = await db
    .prepare(
      "SELECT s.id FROM owner_sessions s JOIN owners o ON o.user_id=s.userId AND o.enabled=1 WHERE s.userId=? AND s.expiresAt>unixepoch('subsec')*1000 ORDER BY s.expiresAt DESC,s.id DESC LIMIT 1",
    )
    .bind(owner)
    .first();
  assert.ok(
    ownerSession?.id,
    'upgrade fixture requires a current enabled Owner session',
  );

  const photo = await db
    .prepare(
      "SELECT p.workspace_id,p.project_id,p.album_id,pr.versioning_mode,pr.revision AS project_revision,pr.versioning_command_id,a.state AS album_state,h.version_id AS current_version_id,h.revision AS head_revision,v1.id AS v1_id FROM photos p JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=? JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id JOIN albums a ON a.id=p.album_id AND a.workspace_id=p.workspace_id AND a.project_id=p.project_id JOIN photo_version_heads h ON h.photo_id=p.id AND h.workspace_id=p.workspace_id AND h.project_id=p.project_id AND h.album_id=p.album_id JOIN photo_versions v1 ON v1.photo_id=p.id AND v1.workspace_id=p.workspace_id AND v1.version_no=1 WHERE p.id=? AND pr.status NOT IN('archived','deleting','deleted') AND a.state NOT IN('archived','deleting','deleted')",
    )
    .bind(owner, photoId)
    .first();
  assert.ok(
    photo,
    'upgrade fixture must be an active Owner photo with its V1 head',
  );
  assert.equal(photo.current_version_id, photo.v1_id);
  if (photo.versioning_mode === 'off') {
    const requestId = randomUUID();
    const payload = JSON.stringify({
      projectId: photo.project_id,
      expectedRevision: Number(photo.project_revision),
      mode: 'manual',
      confirm: true,
    });
    await db
      .prepare(
        'INSERT INTO project_versioning_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,expected_revision,before_mode,mode,confirm,previous_command_id,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        randomUUID(),
        owner,
        ownerSession.id,
        requestId,
        'project.versioning_mode.set',
        photo.workspace_id,
        photo.project_id,
        Number(photo.project_revision),
        'off',
        'manual',
        1,
        photo.versioning_command_id,
        payload,
        Date.now(),
      )
      .run();
  }

  const bytes = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 73, g: 121, b: 167 },
    },
  })
    .png()
    .toBuffer();
  const sourceHash = sha256(bytes);
  const version = await appendAuthorizedVersionFixture({
    db,
    owner,
    photoId,
    parentVersionId: photo.current_version_id,
    versionNo: 2,
    sha256: sourceHash,
    byteSize: bytes.byteLength,
    mime: 'image/png',
    width: 16,
    height: 16,
  });
  assert.equal(version.version_no, 2);

  await storage.put(version.objectKey, new Uint8Array(bytes), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: Buffer.from(sourceHash, 'hex'),
  });
  const jobs = new D1ImageProcessingRepository(db);
  const objects = new R2ProcessingObjectStore(storage);
  const processed = await runImageProcessingJob({
    jobId: version.asset_id,
    jobs,
    objects,
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processed.status, 'succeeded');

  const derivativeRows = await db
    .prepare(
      "SELECT asset_kind,state,mime,object_key,byte_size,checksum_sha256 FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
    )
    .bind(version.version_id)
    .all();
  assert.deepEqual(
    derivativeRows.results.map((row) => row.asset_kind),
    ['preview', 'thumbnail'],
  );
  for (const derivative of derivativeRows.results) {
    assert.equal(derivative.state, 'private');
    assert.equal(derivative.mime, 'image/jpeg');
    const object = await storage.get(derivative.object_key);
    assert.ok(object, 'Sharp derivative must exist in isolated R2');
    assert.equal(object.size, derivative.byte_size);
    assert.equal(object.httpMetadata?.contentType, 'image/jpeg');
    const derivativeBytes = Buffer.from(await object.arrayBuffer());
    assert.equal(sha256(derivativeBytes), derivative.checksum_sha256);
  }

  const headCommandId = randomUUID();
  const headRequestId = randomUUID();
  const headPayload = JSON.stringify({
    requestId: headRequestId,
    expectedRevision: Number(photo.head_revision),
    expectedCurrentVersionId: photo.current_version_id,
    versionId: version.version_id,
    confirm: true,
  });
  await db
    .prepare(
      "INSERT INTO photo_version_head_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,expected_revision,expected_current_version_id,version_id,confirm,payload_json,created_at_ms) VALUES(?,?,?, ?,'photo.version.current.set',?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      headCommandId,
      owner,
      ownerSession.id,
      headRequestId,
      photo.workspace_id,
      photo.project_id,
      photo.album_id,
      photoId,
      Number(photo.head_revision),
      photo.current_version_id,
      version.version_id,
      1,
      headPayload,
      Date.now(),
    )
    .run();

  const published = await db
    .prepare(
      'SELECT h.version_id,h.revision,h.last_command_id,r.event_id,r.result_json FROM photo_version_heads h JOIN photo_version_head_results r ON r.command_id=h.last_command_id WHERE h.photo_id=?',
    )
    .bind(photoId)
    .first();
  assert.equal(published?.version_id, version.version_id);
  assert.equal(published?.revision, Number(photo.head_revision) + 1);
  assert.equal(published?.last_command_id, headCommandId);
  const headResult = JSON.parse(published.result_json);
  assert.equal(headResult.changed, true);
  assert.equal(headResult.current.versionId, version.version_id);
  const headAudit = await db
    .prepare(
      'SELECT actor_type,actor_id,session_id,action,request_id FROM audit_events WHERE event_id=?',
    )
    .bind(published.event_id)
    .first();
  assert.deepEqual(headAudit, {
    actor_type: 'user',
    actor_id: owner,
    session_id: ownerSession.id,
    action: 'photo.version_current_changed',
    request_id: headRequestId,
  });

  const eligible = await db
    .prepare(
      'SELECT workspace_id,project_id,album_id,photo_id,version_id FROM guest_comment_eligible_versions WHERE photo_id=? AND version_id=?',
    )
    .bind(photoId, version.version_id)
    .first();
  assert.deepEqual(eligible, {
    workspace_id: photo.workspace_id,
    project_id: photo.project_id,
    album_id: photo.album_id,
    photo_id: photoId,
    version_id: version.version_id,
  });

  const inviteId = randomUUID();
  const inviteTokenHash = hashInviteToken(randomBytes(32).toString('hex'));
  const inviteExpiresAt = Date.now() + 60 * 60 * 1000;
  await db
    .prepare(
      "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
    )
    .bind(
      inviteId,
      photo.workspace_id,
      photo.project_id,
      inviteTokenHash,
      canComment,
      inviteExpiresAt,
      owner,
      ownerSession.id,
    )
    .run();
  await db
    .prepare(
      'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    )
    .bind(inviteId, photo.workspace_id, photo.project_id, photo.album_id)
    .run();
  await db
    .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
    .bind(inviteId)
    .run();

  const guestId = randomUUID();
  const sessionId = randomUUID();
  const sessionSecretHash = hashGuestSession(randomBytes(32).toString('hex'));
  await db
    .prepare(
      'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
    )
    .bind(guestId, inviteId, 'Upgrade fixture guest')
    .run();
  await db
    .prepare(
      'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
    )
    .bind(
      sessionId,
      inviteId,
      guestId,
      sessionSecretHash,
      Math.min(inviteExpiresAt, Date.now() + 30 * 60 * 1000),
    )
    .run();

  const commentId = randomUUID();
  const createCommandId = randomUUID();
  const createRequestId = randomUUID();
  const createBody = 'NFC 註記：版本 V2';
  const target = [{ commentId, photoId, versionId: version.version_id }];
  const createRequest = {
    requestId: createRequestId,
    expectedGuestId: guestId,
    operation: 'create',
    targets: [{ photoId, versionId: version.version_id }],
    body: createBody,
  };
  await db
    .prepare(
      "INSERT INTO guest_comment_commands(id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,workspace_id,project_id,album_id,operation,request_json,targets_json) VALUES(?,?,?,?,?,?,?,?,?,?,'create',?,?)",
    )
    .bind(
      createCommandId,
      guestId,
      inviteId,
      sessionId,
      sessionSecretHash,
      guestId,
      createRequestId,
      photo.workspace_id,
      photo.project_id,
      photo.album_id,
      JSON.stringify(createRequest),
      JSON.stringify(target),
    )
    .run();

  const createdComment = await db
    .prepare(
      'SELECT id,body,state,revision,author_guest_id,invite_id,photo_id,version_id FROM guest_comments WHERE id=?',
    )
    .bind(commentId)
    .first();
  assert.deepEqual(createdComment, {
    id: commentId,
    body: createBody,
    state: 'open',
    revision: 1,
    author_guest_id: guestId,
    invite_id: inviteId,
    photo_id: photoId,
    version_id: version.version_id,
  });

  const editCommandId = randomUUID();
  const editRequestId = randomUUID();
  const editedBody = 'NFC 已編輯：版本 V2';
  const editRequest = {
    requestId: editRequestId,
    expectedGuestId: guestId,
    commentId,
    expectedRevision: 1,
    operation: 'edit',
    body: editedBody,
  };
  await db
    .prepare(
      "INSERT INTO guest_comment_commands(id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,workspace_id,project_id,album_id,operation,request_json,targets_json) VALUES(?,?,?,?,?,?,?,?,?,?,'edit',?,'[]')",
    )
    .bind(
      editCommandId,
      guestId,
      inviteId,
      sessionId,
      sessionSecretHash,
      guestId,
      editRequestId,
      photo.workspace_id,
      photo.project_id,
      photo.album_id,
      JSON.stringify(editRequest),
    )
    .run();

  const editedComment = await db
    .prepare(
      'SELECT id,body,state,revision,author_guest_id,invite_id,photo_id,version_id FROM guest_comments WHERE id=?',
    )
    .bind(commentId)
    .first();
  assert.deepEqual(editedComment, {
    id: commentId,
    body: editedBody,
    state: 'open',
    revision: 2,
    author_guest_id: guestId,
    invite_id: inviteId,
    photo_id: photoId,
    version_id: version.version_id,
  });

  const realHistory = await db
    .prepare(
      "SELECT (SELECT count(*) FROM guest_comment_commands WHERE invite_id=?) AS commands,(SELECT count(*) FROM guest_comments WHERE id=?) AS comments,(SELECT count(*) FROM guest_comment_changes WHERE comment_id=?) AS changes,(SELECT count(*) FROM guest_comment_results WHERE invite_id=?) AS results,(SELECT count(*) FROM audit_events WHERE action IN('comment.create','comment.edit') AND guest_session_id=? AND photo_id=? AND version_id=?) AS audits",
    )
    .bind(
      inviteId,
      commentId,
      commentId,
      inviteId,
      sessionId,
      photoId,
      version.version_id,
    )
    .first();
  assert.deepEqual(realHistory, {
    commands: 2,
    comments: 1,
    changes: 2,
    results: 2,
    audits: 2,
  });

  const witnesses = await db
    .prepare(
      'SELECT ch.operation,ch.revision,ch.event_id,e.actor_type,e.actor_id,e.session_id,e.guest_session_id,e.action FROM guest_comment_changes ch JOIN audit_events e ON e.event_id=ch.event_id WHERE ch.comment_id=? ORDER BY ch.revision',
    )
    .bind(commentId)
    .all();
  assert.deepEqual(witnesses.results, [
    {
      operation: 'create',
      revision: 1,
      event_id: 'guest-comment:' + commentId + ':1',
      actor_type: 'guest',
      actor_id: guestId,
      session_id: null,
      guest_session_id: sessionId,
      action: 'comment.create',
    },
    {
      operation: 'edit',
      revision: 2,
      event_id: 'guest-comment:' + commentId + ':2',
      actor_type: 'guest',
      actor_id: guestId,
      session_id: null,
      guest_session_id: sessionId,
      action: 'comment.edit',
    },
  ]);

  const results = await db
    .prepare(
      'SELECT c.operation,r.result_json FROM guest_comment_commands c JOIN guest_comment_results r ON r.command_id=c.id WHERE c.invite_id=? ORDER BY c.created_at_ms,c.id',
    )
    .bind(inviteId)
    .all();
  assert.equal(results.results.length, 2);
  const createResult = JSON.parse(
    results.results.find((row) => row.operation === 'create').result_json,
  );
  const editResult = JSON.parse(
    results.results.find((row) => row.operation === 'edit').result_json,
  );
  assert.equal(createResult.items[0].body, createBody);
  assert.equal(createResult.items[0].revision, 1);
  assert.equal(editResult.items[0].body, editedBody);
  assert.equal(editResult.items[0].revision, 2);
  assert.equal(createResult.items[0].isMine, true);
  assert.equal(editResult.items[0].isMine, true);

  return {
    inviteId,
    guestId,
    sessionId,
    photoId,
    versionId: version.version_id,
    commentId,
    createCommandId,
    editCommandId,
    headCommandId,
  };
}
