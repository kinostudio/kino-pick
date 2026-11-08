import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigration } from './apply-migration.mjs';

// Mechanism probe only: no new issuance, authorization or deployable migration.
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'expiry-rebuild-probe',
        modules: true,
        script:
          'export default {fetch(){return new Response(null,{status:404})}}',
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'expiry-rebuild-probe' },
        outboundService: async () => new Response(null, { status: 503 }),
      },
    ],
  }),
);
try {
  const db = await mf.getD1Database('DB', 'expiry-rebuild-probe');
  const files = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter(
      (name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 68,
    )
    .sort();
  assert.equal(files.length, 68);
  const applyFile = async (name) =>
    applyMigration(
      db,
      await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'),
    );
  for (const name of files.filter((name) => name < '0017'))
    await applyFile(name);
  const owner = randomUUID(),
    session = randomUUID(),
    workspace = randomUUID();
  const project = randomUUID(),
    album = randomUUID(),
    invite = randomUUID();
  const guest = randomUUID(),
    guestSession = randomUUID(),
    now = Date.now();
  const run = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .run();
  await run(
    'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
    owner,
    randomUUID(),
  );
  await run(
    'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    session,
    randomUUID(),
    owner,
    now + 3_600_000,
    now,
    now,
  );
  await run(
    'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
    workspace,
    'Synthetic expiry probe',
    owner,
  );
  await run(
    "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
    project,
    workspace,
    'Synthetic project',
  );
  await run(
    "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    album,
    workspace,
    project,
    'Synthetic album',
  );
  await run(
    "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,created_by,owner_session_id,created_at_ms) VALUES(?,?,?,?,'link_only',1,?,?,?,?)",
    invite,
    workspace,
    project,
    'a'.repeat(64),
    now + 3_600_000,
    owner,
    session,
    now,
  );
  await run(
    'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    invite,
    workspace,
    project,
    album,
  );
  await run('INSERT INTO guest_invite_seals(invite_id) VALUES(?)', invite);
  await run(
    'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
    guest,
    invite,
    'Synthetic guest',
  );
  await run(
    'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms,created_at_ms) VALUES(?,?,?,?,?,?)',
    guestSession,
    invite,
    guest,
    'b'.repeat(64),
    now + 1_800_000,
    now,
  );
  for (const name of files.filter((name) => name >= '0017'))
    await applyFile(name);

  const result = async (sql) => (await db.prepare(sql).all()).results;
  const schemaSql =
    "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type,name";
  const before = await result(schemaSql);
  const tables = before.filter((row) => row.type === 'table');
  const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
  const data = async (table, columns = '*') =>
    result('SELECT ' + columns + ' FROM ' + quote(table));
  const hash = (rows) =>
    createHash('sha256')
      .update(JSON.stringify(rows.map((r) => JSON.stringify(r)).sort()))
      .digest('hex');
  const oldHashes = new Map();
  for (const table of tables)
    oldHashes.set(table.name, hash(await data(table.name)));
  const incoming = [];
  for (const table of tables) {
    const fks = await result(
      'PRAGMA foreign_key_list(' + quote(table.name) + ')',
    );
    incoming.push(
      ...fks
        .filter((fk) => fk.table === 'guest_invites')
        .map((fk) => ({ table: table.name, id: fk.id, action: fk.on_delete })),
    );
  }
  assert.ok(incoming.length > 0);
  assert.ok(
    incoming.every((fk) => fk.action === 'NO ACTION'),
    'Cascade/restrict dependencies require a separate migration design',
  );
  const original = before.find(
    (row) => row.type === 'table' && row.name === 'guest_invites',
  ).sql;
  const oldColumns = (await result('PRAGMA table_info(guest_invites)'))
    .map((r) => quote(r.name))
    .join(',');
  const replacement = original.replace(
    "expires_at_ms INTEGER NOT NULL CHECK(typeof(expires_at_ms)='integer')",
    "expires_at_ms INTEGER CHECK(expires_at_ms IS NULL OR typeof(expires_at_ms)='integer'), expiry_mode TEXT NOT NULL DEFAULT 'custom' CHECK((expiry_mode='custom' AND expires_at_ms IS NOT NULL) OR (expiry_mode='inherit_album' AND expires_at_ms IS NULL))",
  );
  assert.notEqual(replacement, original);
  const dependent = before.filter(
    (row) =>
      row.tbl_name === 'guest_invites' &&
      ['index', 'trigger'].includes(row.type),
  );
  await db.batch(
    [
      'PRAGMA defer_foreign_keys=ON',
      'CREATE TABLE expiry_probe_copy AS SELECT * FROM guest_invites',
      'DROP TABLE guest_invites',
      replacement,
      'INSERT INTO guest_invites(' +
        oldColumns +
        ') SELECT ' +
        oldColumns +
        ' FROM expiry_probe_copy',
      ...dependent.map((row) => row.sql),
      'DROP TABLE expiry_probe_copy',
    ].map((sql) => db.prepare(sql)),
  );

  for (const table of tables) {
    assert.equal(
      hash(
        await data(
          table.name,
          table.name === 'guest_invites' ? oldColumns : '*',
        ),
      ),
      oldHashes.get(table.name),
      'Old rows changed in ' + table.name,
    );
  }
  const after = await result(schemaSql);
  assert.deepEqual(
    after.filter((r) => !(r.type === 'table' && r.name === 'guest_invites')),
    before.filter((r) => !(r.type === 'table' && r.name === 'guest_invites')),
  );
  assert.deepEqual(await result('PRAGMA foreign_key_check'), []);
  assert.equal(
    (await result('SELECT expiry_mode FROM guest_invites'))[0].expiry_mode,
    'custom',
  );
  assert.equal((await result('SELECT count(*) n FROM guest_sessions'))[0].n, 1);
  // An intentionally failed second rebuild must roll back the table and its dependent rows.
  await run('CREATE TABLE expiry_probe_fail(value INTEGER NOT NULL)');
  await assert.rejects(
    () =>
      db.batch(
        [
          'PRAGMA defer_foreign_keys=ON',
          'DROP TABLE guest_invites',
          replacement,
          'INSERT INTO expiry_probe_fail(value) VALUES(NULL)',
        ].map((sql) => db.prepare(sql)),
      ),
    /NOT NULL constraint failed/,
  );
  assert.equal(
    hash(await data('guest_invites', oldColumns)),
    oldHashes.get('guest_invites'),
  );
  assert.equal((await result('SELECT count(*) n FROM guest_sessions'))[0].n, 1);
  await run('DROP TABLE expiry_probe_fail');
  assert.deepEqual(await result(schemaSql), after);
  assert.deepEqual(await result('PRAGMA foreign_key_check'), []);
  const proof = {
    status: 'passed_local_D1_nullable_expiry_rebuild_mechanism_only',
    migrations: files.length,
    oldTablesPreserved: tables.length,
    incomingForeignKeyEntries: incoming.length,
    incomingForeignKeyConstraints: new Set(
      incoming.map((fk) => fk.table + ':' + fk.id),
    ).size,
    incomingDeleteActions: ['NO ACTION'],
    legacyInviteSessionAndAllOldRowsPreserved: true,
    otherSchemaPreserved: true,
    failedBatchRolledBack: true,
    foreignKeyViolations: 0,
    newInheritedAuthorizationEnabled: false,
    remoteCloudflare: false,
    customerDataUsed: false,
  };
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  await writeFile(
    new URL(
      '../.local/invite-expiry-rebuild-feasibility.json',
      import.meta.url,
    ),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  await mf.dispose();
}
