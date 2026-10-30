import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const sessionHash = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const inviteHash = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

const insertTagCommandSql = [
  'INSERT INTO guest_tag_commands(',
  'id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,',
  'workspace_id,project_id,album_id,photo_id,version_id,label,present,payload_json',
  ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
].join(' ');

export async function guestTagCatalogChecks({ db, check, owner }) {
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession, 'Expected a current Owner session');

  const workspace = await db
    .prepare(
      'SELECT id FROM workspaces WHERE owner_user_id=? ORDER BY created_at,id LIMIT 1',
    )
    .bind(owner)
    .first();
  assert.ok(workspace, 'Expected an Owner workspace');

  const createProject = async (name) => {
    const projectId = randomUUID();
    const requestId = randomUUID();
    const payload = JSON.stringify({ workspaceId: workspace.id, name });
    await db
      .prepare(
        "INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,'project.created',?,?,?)",
      )
      .bind(owner, requestId, payload, ownerSession.id, projectId)
      .run();
    return projectId;
  };

  const createAlbum = async (projectId, name) => {
    const albumId = randomUUID();
    const requestId = randomUUID();
    const payload = JSON.stringify({ projectId, name });
    await db
      .prepare(
        "INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,'album.created',?,?,?)",
      )
      .bind(owner, requestId, payload, ownerSession.id, albumId)
      .run();
    await db
      .prepare("UPDATE albums SET state='active' WHERE id=?")
      .bind(albumId)
      .run();
    return albumId;
  };

  const createProjectFixture = async (name) => {
    const projectId = await createProject(name);
    const albumId = await createAlbum(projectId, name + ' album');
    const photoId = randomUUID();
    const versionId = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(
        photoId,
        workspace.id,
        projectId,
        albumId,
        name.toLowerCase().replaceAll(' ', '-') + '.jpg',
      )
      .run();
    await db
      .prepare(
        "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
      )
      .bind(
        versionId,
        workspace.id,
        photoId,
        owner,
        randomBytes(32).toString('hex'),
      )
      .run();
    return {
      workspaceId: workspace.id,
      projectId,
      albumId,
      photoId,
      versionId,
    };
  };

  const createInvite = async (fixture) => {
    const inviteId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000;
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',64,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        fixture.workspaceId,
        fixture.projectId,
        inviteHash(token),
        expiresAt,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, fixture.workspaceId, fixture.projectId, fixture.albumId)
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId)
      .run();
    return { inviteId, expiresAt, fixture };
  };

  const createGuest = async (invite) => {
    const guestId = randomUUID();
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const secretHash = sessionHash(secret);
    await db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(guestId, invite.inviteId, 'Guest tag catalog fixture')
      .run();
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(sessionId, invite.inviteId, guestId, secretHash, invite.expiresAt)
      .run();
    return {
      id: sessionId,
      inviteId: invite.inviteId,
      guestId,
      secretHash,
      fixture: invite.fixture,
    };
  };

  const makeTagCommand = (guest, label, present) => {
    const canonicalLabel = label.normalize('NFC').trim().normalize('NFC');
    const id = randomUUID();
    const requestId = randomUUID();
    const payload = JSON.stringify({
      requestId,
      expectedGuestId: guest.guestId,
      versionId: guest.fixture.versionId,
      label: canonicalLabel,
      present,
    });
    const statement = db
      .prepare(insertTagCommandSql)
      .bind(
        id,
        guest.guestId,
        guest.inviteId,
        guest.id,
        guest.secretHash,
        guest.guestId,
        requestId,
        guest.fixture.workspaceId,
        guest.fixture.projectId,
        guest.fixture.albumId,
        guest.fixture.photoId,
        guest.fixture.versionId,
        canonicalLabel,
        present ? 1 : 0,
        payload,
      );
    return { id, requestId, label: canonicalLabel, present, statement };
  };

  const runTagCommand = async (guest, label, present) => {
    const command = makeTagCommand(guest, label, present);
    await command.statement.run();
    const row = await db
      .prepare('SELECT result_json FROM guest_tag_results WHERE command_id=?')
      .bind(command.id)
      .first();
    assert.ok(row, 'Expected the Guest tag trigger to write a command result');
    return { command, result: JSON.parse(row.result_json) };
  };

  const catalogCount = async (projectId) =>
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM guest_tag_labels WHERE workspace_id=? AND project_id=?',
        )
        .bind(workspace.id, projectId)
        .first()
    ).n;

  const snapshotTagsAndAudit = async (projectIds) => {
    const placeholders = projectIds.map(() => '?').join(',');
    const statements = [
      db
        .prepare(
          'SELECT * FROM guest_tag_labels WHERE project_id IN (' +
            placeholders +
            ') ORDER BY project_id,label COLLATE BINARY,tag_id',
        )
        .bind(...projectIds),
      db
        .prepare(
          'SELECT * FROM guest_tag_commands WHERE project_id IN (' +
            placeholders +
            ') ORDER BY project_id,id',
        )
        .bind(...projectIds),
      db
        .prepare(
          'SELECT r.* FROM guest_tag_results r JOIN guest_tag_commands c ON c.id=r.command_id WHERE c.project_id IN (' +
            placeholders +
            ') ORDER BY c.project_id,r.command_id',
        )
        .bind(...projectIds),
      db
        .prepare(
          'SELECT * FROM guest_tag_state WHERE project_id IN (' +
            placeholders +
            ') ORDER BY project_id,guest_id,photo_id,tag_id',
        )
        .bind(...projectIds),
      db
        .prepare(
          'SELECT * FROM audit_events WHERE project_id IN (' +
            placeholders +
            ") AND action IN('tag.added','tag.removed') ORDER BY project_id,event_id",
        )
        .bind(...projectIds),
    ];
    const results = await Promise.all(
      statements.map(async (statement) => (await statement.all()).results),
    );
    return {
      labels: results[0],
      commands: results[1],
      commandResults: results[2],
      states: results[3],
      tagAudit: results[4],
    };
  };

  await check(
    'Guest tag catalog cap is project-scoped, atomic, and preserves membership semantics',
    async () => {
      const catalogProject = await createProjectFixture(
        'Guest tag catalog primary',
      );
      const otherProject = await createProjectFixture(
        'Guest tag catalog control',
      );
      const catalogInvite = await createInvite(catalogProject);
      const catalogOwnerGuest = await createGuest(catalogInvite);
      const otherGuest = await createGuest(catalogInvite);
      const otherProjectGuest = await createGuest(
        await createInvite(otherProject),
      );

      const pending = [];
      const firstCommandIds = new Map();
      const flush = async () => {
        if (pending.length === 0) return;
        await db.batch(pending.splice(0));
      };
      for (let index = 1; index <= 1000; index++) {
        const label = 'catalog-' + String(index).padStart(4, '0');
        const add = makeTagCommand(catalogOwnerGuest, label, true);
        const remove = makeTagCommand(catalogOwnerGuest, label, false);
        if (index === 1) firstCommandIds.set(label, add.id);
        pending.push(add.statement, remove.statement);
        if (pending.length >= 100) await flush();
      }
      await flush();

      assert.equal(await catalogCount(catalogProject.projectId), 1000);
      assert.equal(await catalogCount(otherProject.projectId), 0);
      const firstLabel = 'catalog-0001';
      const firstLabelRow = await db
        .prepare(
          'SELECT tag_id FROM guest_tag_labels WHERE workspace_id=? AND project_id=? AND label=?',
        )
        .bind(workspace.id, catalogProject.projectId, firstLabel)
        .first();
      assert.ok(firstLabelRow);
      assert.equal(firstLabelRow.tag_id, firstCommandIds.get(firstLabel));

      const otherProjectCommand = await runTagCommand(
        otherProjectGuest,
        'control-only-label',
        true,
      );
      assert.equal(otherProjectCommand.result.changed, true);
      assert.equal(
        await catalogCount(catalogProject.projectId),
        1000,
        'A full catalog must not charge a different project',
      );
      assert.equal(await catalogCount(otherProject.projectId), 1);

      const otherGuestStateBefore = await db
        .prepare(
          'SELECT count(*) AS n FROM guest_tag_state WHERE project_id=? AND guest_id=?',
        )
        .bind(catalogProject.projectId, otherGuest.guestId)
        .first();
      assert.equal(otherGuestStateBefore.n, 0);
      const auditBeforeNoOp = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE project_id=? AND action IN('tag.added','tag.removed')",
          )
          .bind(catalogProject.projectId)
          .first()
      ).n;
      const noOpRemoval = await runTagCommand(otherGuest, firstLabel, false);
      assert.equal(noOpRemoval.result.tagId, null);
      assert.equal(noOpRemoval.result.changed, false);
      assert.equal(noOpRemoval.result.eventId, null);
      assert.equal(await catalogCount(catalogProject.projectId), 1000);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_tag_state WHERE project_id=? AND guest_id=?',
            )
            .bind(catalogProject.projectId, otherGuest.guestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(noOpRemoval.command.requestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE project_id=? AND action IN('tag.added','tag.removed')",
            )
            .bind(catalogProject.projectId)
            .first()
        ).n,
        auditBeforeNoOp,
      );

      const projectIds = [catalogProject.projectId, otherProject.projectId];
      const beforeRejectedInsert = await snapshotTagsAndAudit(projectIds);
      const overLimit = makeTagCommand(catalogOwnerGuest, 'catalog-1001', true);
      await assert.rejects(overLimit.statement.run(), (error) =>
        String(error).includes('TAG_CATALOG_LIMIT_REACHED'),
      );
      assert.deepEqual(
        await snapshotTagsAndAudit(projectIds),
        beforeRejectedInsert,
        'The rejected 1001st label must not alter any tag or tag audit rows',
      );
      assert.equal(await catalogCount(catalogProject.projectId), 1000);

      const readded = await runTagCommand(catalogOwnerGuest, firstLabel, true);
      assert.equal(readded.result.changed, true);
      assert.equal(readded.result.tagId, firstLabelRow.tag_id);
      assert.equal(await catalogCount(catalogProject.projectId), 1000);
    },
  );
}
