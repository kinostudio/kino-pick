import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const immutableTables = [
  'guest_tag_labels',
  'guest_tag_commands',
  'guest_tag_results',
  'guest_tag_state',
  'audit_events',
];

async function fullSnapshot(db) {
  const snapshot = {};
  for (const table of immutableTables) {
    snapshot[table] = (
      await db
        .prepare('SELECT * FROM ' + quote(table) + ' ORDER BY rowid')
        .all()
    ).results;
  }
  snapshot.foreignKeys = (
    await db.prepare('PRAGMA foreign_key_check').all()
  ).results;
  return snapshot;
}

async function insertReplace(db, table, row) {
  const columns = Object.keys(row);
  return db
    .prepare(
      'INSERT OR REPLACE INTO ' +
        quote(table) +
        '(' +
        columns.map(quote).join(',') +
        ') VALUES(' +
        columns.map(() => '?').join(',') +
        ')',
    )
    .bind(...columns.map((column) => row[column]))
    .run();
}

function commandPayload(row) {
  return JSON.stringify({
    requestId: row.request_id,
    expectedGuestId: row.expected_guest_id,
    versionId: row.version_id,
    label: row.label,
    present: row.present === 1,
  });
}

async function validCommandFixture(db) {
  const now = Date.now();
  const sql = [
    'SELECT c.*',
    'FROM guest_tag_commands c',
    'JOIN guest_sessions s ON s.id=c.session_id AND s.guest_id=c.guest_id',
    '  AND s.invite_id=c.invite_id AND s.secret_hash=c.secret_hash',
    'JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
    'JOIN guest_invites i ON i.id=c.invite_id AND i.workspace_id=c.workspace_id',
    '  AND i.project_id=c.project_id',
    'JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    'JOIN guest_invite_albums ia ON ia.invite_id=i.id',
    '  AND ia.workspace_id=c.workspace_id AND ia.project_id=c.project_id',
    '  AND ia.album_id=c.album_id',
    'JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id',
    "  AND a.project_id=c.project_id AND a.state='active'",
    'JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id',
    "  AND p.status NOT IN('archived','deleting','deleted')",
    'JOIN workspaces w ON w.id=c.workspace_id',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    '  AND i.created_by=o.user_id',
    'JOIN photos ph ON ph.id=c.photo_id AND ph.workspace_id=c.workspace_id',
    '  AND ph.project_id=c.project_id AND ph.album_id=c.album_id',
    'JOIN photo_versions v ON v.id=c.version_id AND v.workspace_id=c.workspace_id',
    '  AND v.photo_id=c.photo_id',
    'WHERE c.expected_guest_id=c.guest_id AND (i.permissions_mask & 64)=64',
    '  AND s.expires_at_ms>? AND i.expires_at_ms>?',
    '  AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)',
    '  AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)',
    'ORDER BY c.created_at_ms DESC,c.id LIMIT 1',
  ].join(' ');
  return db.prepare(sql).bind(now, now).first();
}

async function validStateTransitionFixture(db) {
  const now = Date.now();
  const sql = [
    'SELECT st.*,l.label,prior.id AS prior_command_id,',
    '  prior.present AS prior_present,prior.version_id AS prior_version_id,',
    '  prior.created_at_ms AS prior_created_at_ms',
    'FROM guest_tag_state st',
    'JOIN guest_tag_labels l ON l.tag_id=st.tag_id',
    '  AND l.workspace_id=st.workspace_id AND l.project_id=st.project_id',
    'JOIN guest_tag_commands current ON current.id=st.last_command_id',
    'JOIN guest_tag_results latest ON latest.command_id=current.id',
    'JOIN guest_tag_commands prior ON prior.id=latest.previous_command_id',
    'JOIN guest_tag_results previous ON previous.command_id=prior.id',
    'JOIN guest_sessions s ON s.id=current.session_id AND s.guest_id=current.guest_id',
    '  AND s.invite_id=current.invite_id AND s.secret_hash=current.secret_hash',
    'JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
    'JOIN guest_invites i ON i.id=current.invite_id AND i.workspace_id=current.workspace_id',
    '  AND i.project_id=current.project_id',
    'JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    'JOIN guest_invite_albums ia ON ia.invite_id=i.id',
    '  AND ia.workspace_id=current.workspace_id AND ia.project_id=current.project_id',
    '  AND ia.album_id=current.album_id',
    'JOIN albums a ON a.id=current.album_id AND a.workspace_id=current.workspace_id',
    "  AND a.project_id=current.project_id AND a.state='active'",
    'JOIN projects p ON p.id=current.project_id AND p.workspace_id=current.workspace_id',
    "  AND p.status NOT IN('archived','deleting','deleted')",
    'JOIN workspaces w ON w.id=current.workspace_id',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    '  AND i.created_by=o.user_id',
    'JOIN photos ph ON ph.id=current.photo_id AND ph.workspace_id=current.workspace_id',
    '  AND ph.project_id=current.project_id AND ph.album_id=current.album_id',
    'JOIN photo_versions v ON v.id=current.version_id',
    '  AND v.workspace_id=current.workspace_id AND v.photo_id=current.photo_id',
    'WHERE latest.event_id IS NOT NULL AND previous.event_id IS NOT NULL',
    '  AND current.present<>prior.present AND st.present=current.present',
    '  AND current.expected_guest_id=current.guest_id',
    '  AND (i.permissions_mask & 64)=64',
    '  AND s.expires_at_ms>? AND i.expires_at_ms>?',
    '  AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)',
    '  AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)',
    'ORDER BY current.created_at_ms DESC,current.id LIMIT 1',
  ].join(' ');
  return db.prepare(sql).bind(now, now).first();
}

export async function guestTagIntegrityChecks({ db, check }) {
  await check(
    'Guest tag immutable ledgers reject primary, alternate-key, and null-ID replacement',
    async () => {
      const before = await fullSnapshot(db);
      assert.deepEqual(
        before.foreignKeys,
        [],
        'tag integrity requires a clean foreign-key baseline',
      );

      const command = await validCommandFixture(db);
      assert.ok(
        command,
        'requires a tag command whose current Guest, invite, permission, owner, album, photo, and version are valid',
      );
      const freshLabel = 'i' + randomUUID().replaceAll('-', '');
      const freshRequestId = randomUUID();
      const primaryCommand = {
        ...command,
        id: command.id,
        request_id: freshRequestId,
        label: freshLabel,
        present: 0,
        created_at_ms: Date.now(),
      };
      primaryCommand.payload_json = commandPayload(primaryCommand);
      await assert.rejects(
        insertReplace(db, 'guest_tag_commands', primaryCommand),
        /IMMUTABLE_GUEST_TAG_COMMAND/u,
        'same command ID with a fresh valid request must not replace history',
      );

      const alternateCommand = {
        ...command,
        id: randomUUID(),
        label: 'a' + randomUUID().replaceAll('-', ''),
        present: 0,
        created_at_ms: Date.now(),
      };
      alternateCommand.payload_json = commandPayload(alternateCommand);
      await assert.rejects(
        insertReplace(db, 'guest_tag_commands', alternateCommand),
        /REQUEST_ID_CONFLICT/u,
        'same Guest request ID with changed intent must conflict',
      );

      const nullCommand = {
        ...command,
        id: null,
        request_id: randomUUID(),
        label: freshLabel + '-null',
        present: 0,
        created_at_ms: Date.now(),
      };
      nullCommand.payload_json = commandPayload(nullCommand);
      await assert.rejects(
        insertReplace(db, 'guest_tag_commands', nullCommand),
        /NOT NULL/u,
        'valid authorized command with a null ID must be rejected',
      );

      const result = await db
        .prepare(
          'SELECT * FROM guest_tag_results WHERE event_id IS NOT NULL ORDER BY occurred_at_utc,command_id LIMIT 1',
        )
        .first();
      assert.ok(result, 'requires an immutable tag change result fixture');

      const primaryResult = {
        ...result,
        result_json: JSON.stringify({ tampered: true }),
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_results', primaryResult),
        /IMMUTABLE_GUEST_TAG_RESULT/u,
        'same result command ID must not replace immutable result JSON',
      );

      const alternateResult = {
        ...result,
        command_id: randomUUID(),
        result_json: JSON.stringify({ tampered: true }),
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_results', alternateResult),
        /IMMUTABLE_GUEST_TAG_RESULT/u,
        'same event ID with a fresh command ID must not replace another result',
      );

      const nullResult = {
        ...result,
        command_id: null,
        event_id: null,
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_results', nullResult),
        /IMMUTABLE_GUEST_TAG_RESULT/u,
        'result with a null command ID must be rejected',
      );

      const label = await db
        .prepare(
          'SELECT * FROM guest_tag_labels WHERE workspace_id=? AND project_id=? ORDER BY created_at_ms,tag_id LIMIT 1',
        )
        .bind(command.workspace_id, command.project_id)
        .first();
      assert.ok(label, 'requires a project tag catalog fixture');

      const primaryLabel = {
        ...label,
        label: 'c' + randomUUID().replaceAll('-', ''),
        created_at_ms: Date.now(),
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_labels', primaryLabel),
        /IMMUTABLE_GUEST_TAG_LABEL/u,
        'same catalog ID with changed label must not replace the catalog row',
      );

      const alternateLabel = {
        ...label,
        tag_id: randomUUID(),
        created_at_ms: Date.now(),
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_labels', alternateLabel),
        /IMMUTABLE_GUEST_TAG_LABEL/u,
        'same project label with a fresh catalog ID must not replace the catalog row',
      );

      const nullLabel = {
        ...label,
        tag_id: null,
        label: 'n' + randomUUID().replaceAll('-', ''),
        created_at_ms: Date.now(),
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_labels', nullLabel),
        /INVALID_GUEST_TAG_LABEL|NOT NULL/u,
        'catalog row with a null ID must be rejected',
      );

      assert.deepEqual(
        await fullSnapshot(db),
        before,
        'failed replacement attempts must leave all tag tables, audit, and foreign keys unchanged',
      );
    },
  );

  await check(
    'Guest tag state rejects replacement and historical predecessor rollback',
    async () => {
      const before = await fullSnapshot(db);
      const state = await validStateTransitionFixture(db);
      assert.ok(
        state,
        'requires a live Guest tag state with a prior meaningful add/remove command',
      );

      const stateRow = {
        invite_id: state.invite_id,
        guest_id: state.guest_id,
        workspace_id: state.workspace_id,
        project_id: state.project_id,
        album_id: state.album_id,
        photo_id: state.photo_id,
        tag_id: state.tag_id,
        present: state.present,
        last_version_id: state.last_version_id,
        updated_at_ms: state.updated_at_ms,
        last_command_id: state.last_command_id,
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_state', stateRow),
        /IMMUTABLE_GUEST_TAG_STATE/u,
        'same membership primary key must not replace its state witness',
      );

      const nullTagState = {
        ...stateRow,
        tag_id: null,
      };
      await assert.rejects(
        insertReplace(db, 'guest_tag_state', nullTagState),
        /INVALID_GUEST_TAG_STATE_WITNESS|NOT NULL/u,
        'membership state with a null tag ID must be rejected',
      );

      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_tag_state SET present=?,last_version_id=?,updated_at_ms=?,last_command_id=? ' +
              'WHERE invite_id=? AND guest_id=? AND photo_id=? AND tag_id=?',
          )
          .bind(
            state.prior_present,
            state.prior_version_id,
            state.prior_created_at_ms,
            state.prior_command_id,
            state.invite_id,
            state.guest_id,
            state.photo_id,
            state.tag_id,
          )
          .run(),
        /INVALID_GUEST_TAG_STATE_WITNESS/u,
        'a historical command cannot resurrect an older membership state',
      );

      assert.deepEqual(
        await fullSnapshot(db),
        before,
        'failed state operations must leave all tag tables, audit, and foreign keys unchanged',
      );
    },
  );
}
