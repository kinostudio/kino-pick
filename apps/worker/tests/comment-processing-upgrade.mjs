import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ownerCommentResultSchema } from '../../../packages/contracts/src/owner-comments.ts';

/**
 * Add real Owner-reply and Guest-edit history to a database already seeded by
 * seedPreOwnerCommentHistory and migrated through 0043. Every projection,
 * audit row, and shared marker is produced by its normal D1 command triggers.
 */
export async function seedPreProcessingHistory({ db, owner, photoId }) {
  assert.ok(db && owner && photoId);

  const ownerSession = await db
    .prepare(
      "SELECT s.id FROM owner_sessions s JOIN owners o ON o.user_id=s.userId AND o.enabled=1 WHERE s.userId=? AND s.expiresAt>unixepoch('subsec')*1000 ORDER BY s.expiresAt DESC,s.id DESC LIMIT 1",
    )
    .bind(owner)
    .first();
  assert.ok(
    ownerSession?.id,
    'processing upgrade requires a live Owner session',
  );

  const guest = await db
    .prepare(
      "SELECT c.id AS commentId,c.invite_id AS inviteId,c.author_guest_id AS guestId,c.workspace_id AS workspaceId,c.project_id AS projectId,c.album_id AS albumId,c.photo_id AS photoId,c.version_id AS versionId,c.revision,c.state,c.last_command_id AS lastCommandId,cmd.session_id AS guestSessionId,cmd.secret_hash AS secretHash FROM guest_comments c JOIN guest_comment_commands cmd ON cmd.id=c.last_command_id JOIN guest_sessions s ON s.id=cmd.session_id AND s.guest_id=cmd.guest_id AND s.invite_id=cmd.invite_id AND s.secret_hash=cmd.secret_hash JOIN guest_invites i ON i.id=c.invite_id WHERE c.photo_id=? AND c.state='open' AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000 AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id) AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id) ORDER BY c.updated_at_ms DESC,c.id DESC LIMIT 1",
    )
    .bind(photoId)
    .first();
  assert.ok(
    guest,
    'processing upgrade requires the live Guest comment fixture',
  );
  assert.equal(guest.photoId, photoId);
  assert.ok(Number.isSafeInteger(guest.revision) && guest.revision >= 1);

  const ownerRequestId = randomUUID();
  const ownerReplyIdForInsert = randomUUID();
  const ownerPayload = {
    requestId: ownerRequestId,
    operation: 'reply',
    inviteId: guest.inviteId,
    photoId: guest.photoId,
    versionId: guest.versionId,
    parentCommentId: guest.commentId,
    expectedParentRevision: guest.revision,
    body: 'Owner reply before processing migration ' + randomUUID(),
  };
  await db
    .prepare(
      'INSERT INTO owner_comment_commands(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,invite_id,photo_id,version_id,parent_comment_id,reply_id,operation,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      randomUUID(),
      owner,
      ownerSession.id,
      ownerRequestId,
      guest.workspaceId,
      guest.projectId,
      guest.albumId,
      guest.inviteId,
      guest.photoId,
      guest.versionId,
      guest.commentId,
      ownerReplyIdForInsert,
      'reply',
      JSON.stringify(ownerPayload),
    )
    .run();
  const ownerResult = await db
    .prepare(
      'SELECT result_json FROM owner_comment_results WHERE actor_id=? AND request_id=?',
    )
    .bind(owner, ownerRequestId)
    .first();
  assert.ok(ownerResult?.result_json);
  const ownerReply = ownerCommentResultSchema.parse(
    JSON.parse(ownerResult.result_json),
  );
  assert.equal(ownerReply.operation, 'reply');
  assert.equal(ownerReply.item.authorType, 'owner');
  assert.equal(ownerReply.item.parentCommentId, guest.commentId);
  assert.equal(ownerReply.item.revision, 1);
  const ownerReplyId = ownerReply.item.commentId;
  const ownerEventId = 'owner-comment-reply:' + ownerReplyId + ':1';

  // The original pre-0043 fixture intentionally keeps only a one-way hash of
  // the Guest session secret. Reuse that authenticated session/hash in a real
  // Guest command-ledger insert so 0042 validates and emits its normal history.
  const guestRequestId = randomUUID();
  const guestCommandId = randomUUID();
  const editedBody = 'Guest edit before processing migration ' + randomUUID();
  const guestRequestJson = JSON.stringify({
    requestId: guestRequestId,
    expectedGuestId: guest.guestId,
    commentId: guest.commentId,
    expectedRevision: guest.revision,
    operation: 'edit',
    body: editedBody,
  });
  await db
    .prepare(
      "INSERT INTO guest_comment_commands(id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,workspace_id,project_id,album_id,operation,request_json,targets_json) VALUES(?,?,?,?,?,?,?,?,?,?,'edit',?,'[]')",
    )
    .bind(
      guestCommandId,
      guest.guestId,
      guest.inviteId,
      guest.guestSessionId,
      guest.secretHash,
      guest.guestId,
      guestRequestId,
      guest.workspaceId,
      guest.projectId,
      guest.albumId,
      guestRequestJson,
    )
    .run();

  const guestAfter = await db
    .prepare(
      'SELECT body,state,revision,last_command_id FROM guest_comments WHERE id=?',
    )
    .bind(guest.commentId)
    .first();
  assert.deepEqual(guestAfter, {
    body: editedBody,
    state: 'open',
    revision: guest.revision + 1,
    last_command_id: guestCommandId,
  });
  const guestEditEventId =
    'guest-comment:' + guest.commentId + ':' + (guest.revision + 1);
  const guestResult = await db
    .prepare(
      'SELECT result_json FROM guest_comment_results WHERE guest_id=? AND request_id=?',
    )
    .bind(guest.guestId, guestRequestId)
    .first();
  assert.ok(guestResult?.result_json);
  const guestReceipt = JSON.parse(guestResult.result_json);
  assert.equal(guestReceipt.items[0].body, editedBody);
  assert.equal(guestReceipt.items[0].revision, guest.revision + 1);

  const markers = await db
    .prepare(
      'SELECT source_kind,source_event_id,seq FROM comment_thread_changes WHERE source_event_id IN(?,?) ORDER BY seq',
    )
    .bind(ownerEventId, guestEditEventId)
    .all();
  assert.deepEqual(
    markers.results.map(({ source_kind, source_event_id }) => [
      source_kind,
      source_event_id,
    ]),
    [
      ['owner', ownerEventId],
      ['guest', guestEditEventId],
    ],
  );
  assert.ok(markers.results[1].seq > markers.results[0].seq);

  const counts = await db
    .prepare(
      'SELECT (SELECT count(*) FROM owner_comment_commands WHERE actor_id=? AND request_id=?) AS owner_commands,(SELECT count(*) FROM owner_comment_replies WHERE id=?) AS owner_replies,(SELECT count(*) FROM owner_comment_changes WHERE reply_id=? AND event_id=?) AS owner_changes,(SELECT count(*) FROM owner_comment_results WHERE actor_id=? AND request_id=?) AS owner_results,(SELECT count(*) FROM guest_comment_commands WHERE guest_id=? AND request_id=?) AS guest_commands,(SELECT count(*) FROM guest_comment_changes WHERE comment_id=? AND event_id=?) AS guest_changes,(SELECT count(*) FROM guest_comment_results WHERE guest_id=? AND request_id=?) AS guest_results,(SELECT count(*) FROM audit_events WHERE event_id IN(?,?)) AS audits,(SELECT count(*) FROM comment_thread_changes WHERE source_event_id IN(?,?)) AS markers',
    )
    .bind(
      owner,
      ownerRequestId,
      ownerReplyId,
      ownerReplyId,
      ownerEventId,
      owner,
      ownerRequestId,
      guest.guestId,
      guestRequestId,
      guest.commentId,
      guestEditEventId,
      guest.guestId,
      guestRequestId,
      ownerEventId,
      guestEditEventId,
      ownerEventId,
      guestEditEventId,
    )
    .first();
  assert.deepEqual(counts, {
    owner_commands: 1,
    owner_replies: 1,
    owner_changes: 1,
    owner_results: 1,
    guest_commands: 1,
    guest_changes: 1,
    guest_results: 1,
    audits: 2,
    markers: 2,
  });

  return {
    inviteId: guest.inviteId,
    guestId: guest.guestId,
    guestSessionId: guest.guestSessionId,
    ownerSessionId: ownerSession.id,
    photoId: guest.photoId,
    versionId: guest.versionId,
    commentId: guest.commentId,
    ownerRequestId,
    ownerReplyId,
    ownerEventId,
    guestRequestId,
    guestEditEventId,
    guestRevision: guestAfter.revision,
    markerSeqs: markers.results.map((row) => row.seq),
    counts,
  };
}
