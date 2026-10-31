import { randomUUID } from 'node:crypto';

// Trusted native fixture setup; the 0057 D1 command guard and audit still run.
export async function activateDraftAlbumFixture(db, albumId) {
  if (typeof albumId !== 'string' || albumId.length === 0)
    throw new Error('A fixture album ID is required');

  const scope = await db
    .prepare(
      'SELECT a.id,a.workspace_id,a.project_id,a.state,a.revision,' +
        'w.owner_user_id AS owner_id ' +
        'FROM albums a JOIN workspaces w ON w.id=a.workspace_id ' +
        'WHERE a.id=?',
    )
    .bind(albumId)
    .first();

  if (!scope) throw new Error('No fixture album scope');
  if (scope.state === 'active') return null;
  if (scope.state !== 'draft')
    throw new Error('Only a draft fixture album can be activated');

  const ownerSession = await db
    .prepare(
      'SELECT s.id AS session_id FROM owners o ' +
        'JOIN owner_sessions s ON s.userId=o.user_id ' +
        "AND s.expiresAt>unixepoch('subsec')*1000 " +
        'WHERE o.user_id=? AND o.enabled=1 ' +
        'ORDER BY s.expiresAt DESC,s.id DESC LIMIT 1',
    )
    .bind(scope.owner_id)
    .first();

  if (!ownerSession) throw new Error('No live Owner session for fixture album');

  const expectedRevision = Number(scope.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new Error('Fixture album revision is invalid');

  const requestId = randomUUID().toLowerCase();
  await db
    .prepare(
      'INSERT INTO album_activation_commands(' +
        'actor_id,request_id,session_id,workspace_id,project_id,album_id,' +
        'expected_revision,confirm_activate,created_at_ms' +
        ') VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      scope.owner_id,
      requestId,
      ownerSession.session_id,
      scope.workspace_id,
      scope.project_id,
      scope.id,
      expectedRevision,
      1,
      Date.now(),
    )
    .run();

  const activated = await db
    .prepare('SELECT id,state,revision FROM albums WHERE id=?')
    .bind(scope.id)
    .first();
  const command = await db
    .prepare(
      'SELECT count(*) AS count FROM album_activation_commands ' +
        'WHERE actor_id=? AND request_id=? AND album_id=?',
    )
    .bind(scope.owner_id, requestId, scope.id)
    .first();
  const audit = await db
    .prepare(
      'SELECT count(*) AS count FROM audit_events ' +
        "WHERE event_id=? AND request_id=? AND album_id=? AND action='album.activated'",
    )
    .bind(
      'album-activation:' + scope.owner_id + ':' + requestId,
      requestId,
      scope.id,
    )
    .first();

  if (
    !activated ||
    activated.state !== 'active' ||
    Number(activated.revision) !== expectedRevision + 1 ||
    Number(command?.count) !== 1 ||
    Number(audit?.count) !== 1
  ) {
    throw new Error('Audited fixture album activation did not complete');
  }
  return {
    commandCount: Number(command.count),
    auditCount: Number(audit.count),
  };
}
