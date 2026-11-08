import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const WORKSPACE_ID = 'workspace-1';
const PROJECT_ID = 'project-1';
const ALBUM_A = 'album-a';
const ALBUM_B = 'album-b';
const MAX_GENERATION = 2_147_483_647;

const migration = readFileSync(
  new URL(
    '../../apps/worker/migrations/0069_inherited_share_expiry.sql',
    import.meta.url,
  ),
  'utf8',
);
const engineStart = migration.indexOf(
  '-- An invitation binds only the generation.',
);
const engineEnd = migration.indexOf(
  '-- Existing scoped operation guards',
  engineStart,
);
if (engineStart < 0 || engineEnd < 0)
  throw new Error('0069 inherited-share SQL block not found');
const engineSql = migration.slice(engineStart, engineEnd);
const guardStart = engineSql.indexOf(
  'CREATE TRIGGER album_inherited_transitions_guard',
);
const bootstrapStart = engineSql.indexOf(
  "SELECT 'bootstrap:'||album_id||':'||album_id",
);
const bootstrapInsertStart = engineSql.lastIndexOf(
  'INSERT INTO album_inherited_share_transitions(',
  bootstrapStart,
);
const bootstrapEnd =
  engineSql.indexOf('FROM next_album_inherited_share_state;', bootstrapStart) +
  'FROM next_album_inherited_share_state;'.length;
if (
  guardStart < 0 ||
  bootstrapStart < 0 ||
  bootstrapInsertStart < 0 ||
  bootstrapEnd < 'FROM next_album_inherited_share_state;'.length
) {
  throw new Error('0069 inherited-share SQL boundaries not found');
}

const INPUT_FIXTURE_SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE albums(
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(id,project_id,workspace_id)
);
CREATE INDEX albums_guest_scope ON albums(workspace_id,project_id,id);
CREATE TABLE projects(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
INSERT INTO projects VALUES('project-1','workspace-1');
CREATE TABLE album_activation_commands(
  album_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, request_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL
);
CREATE TABLE album_retention_policy_configurations(
  album_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
  cleanup_allowed INTEGER NOT NULL, inactive_days INTEGER NOT NULL,
  revision INTEGER NOT NULL, last_command_id TEXT
);
CREATE TABLE album_retention_policy_commands(
  id TEXT PRIMARY KEY, album_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL
);
CREATE TABLE album_human_activity(
  album_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
  last_valid_viewed_at_ms INTEGER NOT NULL, view_event_id TEXT NOT NULL
);
CREATE TABLE human_photo_views(
  event_id TEXT PRIMARY KEY, album_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL, viewed_at_ms INTEGER NOT NULL
);
CREATE TABLE invite_creation_commands(
  invite_id TEXT NOT NULL, project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL
);
CREATE TABLE guest_invites(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
  expiry_mode TEXT NOT NULL, expires_at_ms INTEGER
);
CREATE TABLE guest_invite_albums(
  invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
  album_id TEXT NOT NULL, inherit_generation INTEGER
);
`;

type AlbumSpec = {
  id: string;
  ageDays?: number;
  policy?: { cleanupAllowed: boolean; inactiveDays: number } | null;
};

type StateRow = {
  generation: number;
  phase: string;
  expires_at_ms: number | null;
  inputs_json: string;
  last_transition_id: string;
};

type InputRow = {
  phase: string;
  inputs_json: string;
  expires_at_ms: number | null;
};
type InviteExpiryRow = {
  expiry_valid: number;
  expires_at_ms: number | null;
  expiry_mode: string;
};

const openDatabases: DatabaseSync[] = [];
let serial = 0;

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

function row<T>(
  database: DatabaseSync,
  sql: string,
  ...values: (string | number | null)[]
): T {
  return database.prepare(sql).get(...values) as T;
}

function inputFixture(specs: AlbumSpec[]): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  openDatabases.push(database);
  database.exec(INPUT_FIXTURE_SCHEMA);

  for (const spec of specs) {
    const createdAt = row<{ created_at: string }>(
      database,
      "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now',?) AS created_at",
      `${-(spec.ageDays ?? 0)} days`,
    ).created_at;
    database
      .prepare('INSERT INTO albums VALUES(?,?,?,?)')
      .run(spec.id, WORKSPACE_ID, PROJECT_ID, createdAt);
    if (spec.policy !== null) {
      database
        .prepare(
          `INSERT INTO album_retention_policy_configurations(
        album_id,workspace_id,project_id,cleanup_allowed,inactive_days,revision,last_command_id
      ) VALUES(?,?,?,?,?,0,NULL)`,
        )
        .run(
          spec.id,
          WORKSPACE_ID,
          PROJECT_ID,
          spec.policy?.cleanupAllowed ? 1 : 0,
          spec.policy?.inactiveDays ?? 90,
        );
    }
  }
  return database;
}

function installEngine(database: DatabaseSync): void {
  database.exec(engineSql);
}

function state(database: DatabaseSync, albumId: string): StateRow {
  return row(
    database,
    `SELECT generation,phase,expires_at_ms,inputs_json,last_transition_id
      FROM album_inherited_share_states WHERE album_id=?`,
    albumId,
  );
}

function inputs(database: DatabaseSync, albumId: string): InputRow {
  return row(
    database,
    `SELECT phase,inputs_json,expires_at_ms
      FROM effective_album_inherited_share_expiry WHERE album_id=?`,
    albumId,
  );
}

function inviteExpiry(
  database: DatabaseSync,
  inviteId: string,
  albumId: string,
): InviteExpiryRow {
  return row(
    database,
    `SELECT expiry_valid,expires_at_ms,expiry_mode FROM effective_guest_invite_album_expiry
      WHERE invite_id=? AND album_id=?`,
    inviteId,
    albumId,
  );
}

function inviteExpiryQueryPlan(
  database: DatabaseSync,
  inviteId: string,
  albumId: string,
): { detail: string }[] {
  return database
    .prepare(
      `EXPLAIN QUERY PLAN
      SELECT expires_at_ms FROM effective_guest_invite_album_expiry
      WHERE invite_id=? AND album_id=? AND expiry_valid=1`,
    )
    .all(inviteId, albumId) as { detail: string }[];
}

function expectStateTracksCanonicalInputs(
  database: DatabaseSync,
  albumId: string,
): void {
  expect(state(database, albumId).inputs_json).toBe(
    inputs(database, albumId).inputs_json,
  );
}

function appendPolicyTransition(
  database: DatabaseSync,
  albumId: string,
  cleanupAllowed: boolean,
  inactiveDays: number,
): void {
  const commandId = `policy-command-${++serial}`;
  database
    .prepare(
      `INSERT INTO album_retention_policy_commands(
    id,album_id,workspace_id,project_id,created_at_ms
  ) VALUES(?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))`,
    )
    .run(commandId, albumId, WORKSPACE_ID, PROJECT_ID);
  database
    .prepare(
      `UPDATE album_retention_policy_configurations
    SET cleanup_allowed=?,inactive_days=?,revision=revision+1,last_command_id=?
    WHERE album_id=?`,
    )
    .run(cleanupAllowed ? 1 : 0, inactiveDays, commandId, albumId);
  database
    .prepare(
      `INSERT INTO album_inherited_share_transitions(
    id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,
    generation,phase,expires_at_ms,inputs_json
  ) SELECT 'policy:'||?||':'||n.album_id,'policy',?,n.album_id,n.workspace_id,n.project_id,
      n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
    FROM next_album_inherited_share_state n WHERE n.album_id=?`,
    )
    .run(commandId, commandId, albumId);
}

function appendHumanFrontier(database: DatabaseSync, albumId: string): void {
  const eventId = `human-view-${++serial}`;
  const viewedAt = row<{ viewed_at_ms: number }>(
    database,
    "SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS viewed_at_ms",
  ).viewed_at_ms;
  database
    .prepare('INSERT INTO human_photo_views VALUES(?,?,?,?,?)')
    .run(eventId, albumId, WORKSPACE_ID, PROJECT_ID, viewedAt);
  database
    .prepare(
      `INSERT INTO album_human_activity(
    album_id,workspace_id,project_id,last_valid_viewed_at_ms,view_event_id
  ) VALUES(?,?,?,?,?) ON CONFLICT(album_id) DO UPDATE SET
    workspace_id=excluded.workspace_id,project_id=excluded.project_id,
    last_valid_viewed_at_ms=excluded.last_valid_viewed_at_ms,view_event_id=excluded.view_event_id
  `,
    )
    .run(albumId, WORKSPACE_ID, PROJECT_ID, viewedAt, eventId);
  database
    .prepare(
      `INSERT INTO album_inherited_share_transitions(
    id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,
    generation,phase,expires_at_ms,inputs_json
  ) SELECT 'human:'||?||':'||n.album_id,'human',?,n.album_id,n.workspace_id,n.project_id,
      n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
    FROM next_album_inherited_share_state n
    WHERE n.album_id=? AND EXISTS(SELECT 1 FROM album_human_activity h
      WHERE h.album_id=n.album_id AND h.view_event_id=?)`,
    )
    .run(eventId, eventId, albumId, eventId);
}

function appendActivation(database: DatabaseSync, albumId: string): void {
  const actorId = `owner-${++serial}`;
  const requestId = `activation-${serial}`;
  database
    .prepare(
      `INSERT INTO album_activation_commands(
    album_id,workspace_id,project_id,actor_id,request_id,created_at_ms
  ) VALUES(?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))`,
    )
    .run(albumId, WORKSPACE_ID, PROJECT_ID, actorId, requestId);
  database
    .prepare(
      `INSERT INTO album_inherited_share_transitions(
    id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,
    generation,phase,expires_at_ms,inputs_json
  ) SELECT 'activation:'||?||':'||?||':'||n.album_id,'activation',?||':'||?,
      n.album_id,n.workspace_id,n.project_id,n.prior_transition_id,n.generation,
      n.phase,n.expires_at_ms,n.inputs_json
    FROM next_album_inherited_share_state n WHERE n.album_id=?`,
    )
    .run(actorId, requestId, actorId, requestId, albumId);
}

function issueInheritedInvite(
  database: DatabaseSync,
  inviteId: string,
  albumIds: string[],
): void {
  const payload = JSON.stringify({
    projectId: PROJECT_ID,
    albumIds,
    expiryMode: 'inherit_album',
  });
  database
    .prepare(
      `INSERT INTO invite_creation_commands(
    invite_id,project_id,payload_json,created_at_ms
  ) VALUES(?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))`,
    )
    .run(inviteId, PROJECT_ID, payload);
  database
    .prepare(
      `INSERT INTO album_inherited_share_transitions(
    id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,
    generation,phase,expires_at_ms,inputs_json
  ) SELECT 'issuance:'||?||':'||n.album_id,'issuance',?,n.album_id,n.workspace_id,
      n.project_id,n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
    FROM next_album_inherited_share_state n
    WHERE n.album_id IN (SELECT value FROM json_each(?)) AND n.project_id=?`,
    )
    .run(inviteId, inviteId, JSON.stringify(albumIds), PROJECT_ID);

  database
    .prepare(
      `INSERT INTO guest_invites(id,workspace_id,project_id,expiry_mode,expires_at_ms)
    VALUES(?,?,?,'inherit_album',NULL)`,
    )
    .run(inviteId, WORKSPACE_ID, PROJECT_ID);
  for (const albumId of albumIds) {
    database
      .prepare(
        `INSERT INTO guest_invite_albums(
      invite_id,workspace_id,project_id,album_id,inherit_generation
    ) SELECT ?,workspace_id,project_id,album_id,generation
      FROM album_inherited_share_states WHERE album_id=?`,
      )
      .run(inviteId, albumId);
  }
}

function seedInviteProjection(
  database: DatabaseSync,
  inviteId: string,
  albumId: string,
  expiryMode: 'inherit_album' | 'custom' = 'inherit_album',
): void {
  const expiresAt =
    expiryMode === 'custom'
      ? row<{ value: number }>(
          database,
          "SELECT CAST(unixepoch('subsec')*1000 AS INTEGER)+3600000 AS value",
        ).value
      : null;
  database
    .prepare(
      `INSERT INTO guest_invites(id,workspace_id,project_id,expiry_mode,expires_at_ms)
    VALUES(?,?,?,?,?)`,
    )
    .run(inviteId, WORKSPACE_ID, PROJECT_ID, expiryMode, expiresAt);
  database
    .prepare(
      `INSERT INTO guest_invite_albums(
    invite_id,workspace_id,project_id,album_id,inherit_generation
  ) SELECT ?,?,?,?,CASE WHEN ?='inherit_album' THEN generation ELSE NULL END
    FROM album_inherited_share_states WHERE album_id=?`,
    )
    .run(inviteId, WORKSPACE_ID, PROJECT_ID, albumId, expiryMode, albumId);
}

describe('0069 inherited-share SQL engine (isolated SQLite model; not product/native ACL or hosted performance proof)', () => {
  it('keeps OFF grants valid with NULL expiry and no human-tracking rows', () => {
    const database = inputFixture([
      { id: ALBUM_A, policy: { cleanupAllowed: false, inactiveDays: 90 } },
    ]);
    installEngine(database);
    issueInheritedInvite(database, 'invite-off', [ALBUM_A]);
    appendActivation(database, ALBUM_A);

    expect(state(database, ALBUM_A)).toMatchObject({
      generation: 1,
      phase: 'off',
      expires_at_ms: null,
    });
    expect(inviteExpiry(database, 'invite-off', ALBUM_A)).toMatchObject({
      expiry_mode: 'inherit_album',
      expiry_valid: 1,
      expires_at_ms: null,
    });
    expect(
      row<{ count: number }>(
        database,
        'SELECT count(*) AS count FROM album_human_activity',
      ).count,
    ).toBe(0);
    expect(
      row<{ kinds: string }>(
        database,
        `SELECT group_concat(DISTINCT source_kind) AS kinds FROM album_inherited_share_transitions`,
      ).kinds,
    ).toContain('bootstrap');
    expectStateTracksCanonicalInputs(database, ALBUM_A);
    expect(JSON.parse(state(database, ALBUM_A).inputs_json)).toEqual([
      0, 90, 0, 1,
    ]);
  });

  it('closes and rotates an old OFF grant; later human activity or OFF policy cannot revive it', () => {
    const database = inputFixture([
      {
        id: ALBUM_A,
        ageDays: 2,
        policy: { cleanupAllowed: false, inactiveDays: 1 },
      },
    ]);
    installEngine(database);
    issueInheritedInvite(database, 'invite-old-generation', [ALBUM_A]);
    seedInviteProjection(database, 'custom-stays-valid', ALBUM_A, 'custom');
    const before = state(database, ALBUM_A);

    appendPolicyTransition(database, ALBUM_A, true, 1);
    expect(state(database, ALBUM_A)).toMatchObject({
      generation: before.generation + 1,
      phase: 'closed',
    });
    expect(
      inviteExpiry(database, 'invite-old-generation', ALBUM_A).expiry_valid,
    ).toBe(0);
    expect(
      inviteExpiry(database, 'custom-stays-valid', ALBUM_A).expiry_valid,
    ).toBe(1);

    appendHumanFrontier(database, ALBUM_A);
    expect(state(database, ALBUM_A)).toMatchObject({
      generation: before.generation + 1,
      phase: 'finite',
    });
    expect(
      inviteExpiry(database, 'invite-old-generation', ALBUM_A).expiry_valid,
    ).toBe(0);
    expect(
      inviteExpiry(database, 'custom-stays-valid', ALBUM_A).expiry_valid,
    ).toBe(1);

    appendPolicyTransition(database, ALBUM_A, false, 1);
    expect(state(database, ALBUM_A)).toMatchObject({
      generation: before.generation + 1,
      phase: 'off',
    });
    expect(
      inviteExpiry(database, 'invite-old-generation', ALBUM_A).expiry_valid,
    ).toBe(0);
    expect(
      inviteExpiry(database, 'custom-stays-valid', ALBUM_A).expiry_valid,
    ).toBe(1);
    expectStateTracksCanonicalInputs(database, ALBUM_A);
  });

  it('extends an active finite human frontier in the same generation, with a shared input fingerprint', async () => {
    const database = inputFixture([
      {
        id: ALBUM_A,
        policy: { cleanupAllowed: true, inactiveDays: 1 },
      },
    ]);
    installEngine(database);
    issueInheritedInvite(database, 'invite-finite', [ALBUM_A]);
    const initialState = state(database, ALBUM_A);
    const initialExpiry = inviteExpiry(
      database,
      'invite-finite',
      ALBUM_A,
    ).expires_at_ms;
    expect(initialState.phase).toBe('finite');

    await new Promise((resolve) => setTimeout(resolve, 10));
    appendHumanFrontier(database, ALBUM_A);

    const extended = state(database, ALBUM_A);
    expect(extended).toMatchObject({
      generation: initialState.generation,
      phase: 'finite',
    });
    expect(extended.inputs_json).not.toBe(initialState.inputs_json);
    expect(extended.expires_at_ms).toBeGreaterThan(initialExpiry ?? 0);
    expect(inviteExpiry(database, 'invite-finite', ALBUM_A)).toMatchObject({
      expiry_valid: 1,
    });
    expect(inviteExpiry(database, 'invite-finite', ALBUM_A).expires_at_ms).toBe(
      extended.expires_at_ms,
    );
    expect(
      row<{ inherit_generation: number }>(
        database,
        `SELECT inherit_generation FROM guest_invite_albums WHERE invite_id='invite-finite'`,
      ).inherit_generation,
    ).toBe(extended.generation);
    expectStateTracksCanonicalInputs(database, ALBUM_A);
  });

  it('fails closed for a missing policy or a human frontier with mismatched scope', () => {
    const noPolicy = inputFixture([{ id: ALBUM_A, policy: null }]);
    installEngine(noPolicy);
    seedInviteProjection(noPolicy, 'invite-no-policy', ALBUM_A);
    expect(state(noPolicy, ALBUM_A).phase).toBe('unknown');
    expect(
      inviteExpiry(noPolicy, 'invite-no-policy', ALBUM_A).expiry_valid,
    ).toBe(0);

    const mismatch = inputFixture([
      {
        id: ALBUM_B,
        policy: { cleanupAllowed: true, inactiveDays: 1 },
      },
    ]);
    mismatch
      .prepare(`INSERT INTO human_photo_views VALUES(?,?,?,?,?)`)
      .run(
        'wrong-scope-view',
        ALBUM_B,
        WORKSPACE_ID,
        'other-project',
        row<{ now_ms: number }>(
          mismatch,
          "SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms",
        ).now_ms,
      );
    mismatch
      .prepare(`INSERT INTO album_human_activity VALUES(?,?,?,?,?)`)
      .run(
        ALBUM_B,
        WORKSPACE_ID,
        'other-project',
        row<{ now_ms: number }>(
          mismatch,
          "SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms",
        ).now_ms,
        'wrong-scope-view',
      );
    installEngine(mismatch);
    seedInviteProjection(mismatch, 'invite-mismatch', ALBUM_B);
    expect(state(mismatch, ALBUM_B).phase).toBe('unknown');
    expect(
      inviteExpiry(mismatch, 'invite-mismatch', ALBUM_B).expiry_valid,
    ).toBe(0);
    expectStateTracksCanonicalInputs(mismatch, ALBUM_B);
  });

  it('rejects forged causes, replayed ledger rows, and direct state mutation', () => {
    const database = inputFixture([{ id: ALBUM_A }]);
    installEngine(database);
    issueInheritedInvite(database, 'invite-guarded', [ALBUM_A]);
    const issued = row<{
      id: string;
      source_kind: string;
      source_id: string;
      album_id: string;
      workspace_id: string;
      project_id: string;
      prior_transition_id: string | null;
      generation: number;
      phase: string;
      expires_at_ms: number | null;
      inputs_json: string;
      created_at_ms: number;
    }>(
      database,
      `SELECT * FROM album_inherited_share_transitions
      WHERE source_kind='issuance' AND source_id='invite-guarded'`,
    );

    expect(() =>
      database
        .prepare(
          `INSERT INTO album_inherited_share_transitions(
      id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,
      generation,phase,expires_at_ms,inputs_json,created_at_ms
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          issued.id,
          issued.source_kind,
          issued.source_id,
          issued.album_id,
          issued.workspace_id,
          issued.project_id,
          issued.prior_transition_id,
          issued.generation,
          issued.phase,
          issued.expires_at_ms,
          issued.inputs_json,
          issued.created_at_ms,
        ),
    ).toThrow(/IMMUTABLE_INHERITED_SHARE_TRANSITION/);

    expect(() =>
      database
        .prepare(
          `INSERT INTO album_inherited_share_transitions(
      id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,
      generation,phase,expires_at_ms,inputs_json
    ) SELECT 'human:forged:'||n.album_id,'human','forged',n.album_id,n.workspace_id,
        n.project_id,n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
      FROM next_album_inherited_share_state n WHERE n.album_id=?`,
        )
        .run(ALBUM_A),
    ).toThrow(/INHERITED_SHARE_CAUSE_REQUIRED/);
    expect(() =>
      database
        .prepare(
          `UPDATE album_inherited_share_states
      SET generation=generation+1 WHERE album_id=?`,
        )
        .run(ALBUM_A),
    ).toThrow(/INHERITED_SHARE_TRANSITION_REQUIRED/);
  });

  it('makes MAX-generation rotation permanently exhausted without replaying prior operations', () => {
    const database = inputFixture([
      {
        id: ALBUM_A,
        ageDays: 2,
        policy: { cleanupAllowed: true, inactiveDays: 36_500 },
      },
    ]);
    database.exec(engineSql.slice(0, guardStart));
    const initial = inputs(database, ALBUM_A);
    expect(initial.phase).toBe('finite');

    // This is an explicit historical-engine fixture at MAX, not 2.1 billion simulated transitions.
    database
      .prepare(
        `INSERT INTO album_inherited_share_transitions(
      id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,
      generation,phase,expires_at_ms,inputs_json
    ) VALUES('historical-max','bootstrap','historical-snapshot',?,?,?,NULL,?,'finite',?,?)`,
      )
      .run(
        ALBUM_A,
        WORKSPACE_ID,
        PROJECT_ID,
        MAX_GENERATION,
        initial.expires_at_ms,
        initial.inputs_json,
      );
    database
      .prepare(
        `INSERT INTO album_inherited_share_states(
      album_id,workspace_id,project_id,generation,phase,expires_at_ms,inputs_json,last_transition_id
    ) VALUES(?,?,?,?,'finite',?,?, 'historical-max')`,
      )
      .run(
        ALBUM_A,
        WORKSPACE_ID,
        PROJECT_ID,
        MAX_GENERATION,
        initial.expires_at_ms,
        initial.inputs_json,
      );
    database.exec(engineSql.slice(guardStart, bootstrapInsertStart));
    database.exec(engineSql.slice(bootstrapEnd));
    issueInheritedInvite(database, 'invite-max-generation', [ALBUM_A]);

    appendPolicyTransition(database, ALBUM_A, true, 1);
    expect(state(database, ALBUM_A)).toMatchObject({
      generation: MAX_GENERATION,
      phase: 'exhausted',
      expires_at_ms: null,
    });
    expect(
      inviteExpiry(database, 'invite-max-generation', ALBUM_A).expiry_valid,
    ).toBe(0);

    appendPolicyTransition(database, ALBUM_A, false, 1);
    expect(state(database, ALBUM_A)).toMatchObject({
      generation: MAX_GENERATION,
      phase: 'exhausted',
      expires_at_ms: null,
    });
    expect(
      inviteExpiry(database, 'invite-max-generation', ALBUM_A).expiry_valid,
    ).toBe(0);
  });

  it('binds a multi-album invite to each album generation independently', () => {
    const database = inputFixture([
      {
        id: ALBUM_A,
        ageDays: 2,
        policy: { cleanupAllowed: false, inactiveDays: 1 },
      },
      {
        id: ALBUM_B,
        ageDays: 0,
        policy: { cleanupAllowed: false, inactiveDays: 1 },
      },
    ]);
    installEngine(database);
    issueInheritedInvite(database, 'invite-two-albums', [ALBUM_A, ALBUM_B]);

    appendPolicyTransition(database, ALBUM_A, true, 1);

    expect(state(database, ALBUM_A)).toMatchObject({
      generation: 2,
      phase: 'closed',
    });
    expect(state(database, ALBUM_B)).toMatchObject({
      generation: 1,
      phase: 'off',
    });
    expect(
      inviteExpiry(database, 'invite-two-albums', ALBUM_A).expiry_valid,
    ).toBe(0);
    expect(inviteExpiry(database, 'invite-two-albums', ALBUM_B)).toMatchObject({
      expiry_valid: 1,
      expires_at_ms: null,
    });
  });

  it('plans the scoped invite-expiry lookup without a global album scan', () => {
    const database = inputFixture([
      { id: ALBUM_A, policy: { cleanupAllowed: false, inactiveDays: 90 } },
    ]);
    installEngine(database);
    issueInheritedInvite(database, 'invite-query-plan', [ALBUM_A]);

    const plan = inviteExpiryQueryPlan(database, 'invite-query-plan', ALBUM_A);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.some(({ detail }) => /^SCAN a\b/i.test(detail))).toBe(false);
    expect(
      inviteExpiry(database, 'invite-query-plan', ALBUM_A).expiry_valid,
    ).toBe(1);
  });
});
