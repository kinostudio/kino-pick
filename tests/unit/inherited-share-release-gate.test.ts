import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
const {
  validateInheritedShare0069RestoreManifest,
  validateInheritedShare0069Schema,
} = createRequire(import.meta.url)(
  '../../tools/check-staging-collaboration-release.mjs',
) as {
  validateInheritedShare0069RestoreManifest: (
    manifest: unknown,
    migrations: unknown,
  ) => void;
  validateInheritedShare0069Schema: (rows: unknown, sql: string) => void;
};

const directory = resolve('apps/worker/migrations');
const source = readFileSync(
  resolve(directory, '0069_inherited_share_expiry.sql'),
  'utf8',
);
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const migrations = [
  '0068_album_retention_policy_configuration.sql',
  '0069_inherited_share_expiry.sql',
].map((name) => {
  const bytes = readFileSync(resolve(directory, name));
  return {
    name,
    sha256: digest(bytes),
    canonicalSha256: digest(bytes.toString('utf8').replaceAll('\r\n', '\n')),
  };
});

// Synthetic validator input only; never saved or accepted as a real restore proof.
const fixture = () => ({
  status: 'passed_independent_0069_restore_and_B_adoption',
  accountId: 'd3e930465c0df7e89b35de3ca65ea36a',
  sourceDatabaseId: 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d',
  restoreDatabaseId: '11111111-2222-4333-8444-555555555555',
  sourceSchemaVersion: 67,
  targetSchemaVersion: 69,
  sourceWritesDuringRestore: 0,
  migrationTransactionScope: 'per_migration',
  backupSha256: '1'.repeat(64),
  restoredSha256: '2'.repeat(64),
  upgradedSha256: '3'.repeat(64),
  sourceAfterSha256: '4'.repeat(64),
  oldTablesPreserved: true,
  exactSchemaAndRowsMatchSource: true,
  independentDrillParityVerified: true,
  bootstrapTimeComparison: {
    mode: 'per_database_chain_window',
    columns: [
      {
        table: 'album_retention_policy_configurations',
        column: 'updated_at_ms',
      },
      { table: 'album_inherited_share_transitions', column: 'created_at_ms' },
    ],
    independent: {
      beforeMs: 1000,
      afterMs: 2000,
      policySeedMs: 1500,
      shareBootstrapMs: 1600,
    },
    source: {
      beforeMs: 3000,
      afterMs: 4000,
      policySeedMs: 3500,
      shareBootstrapMs: 3600,
    },
  },
  commandsAllSucceeded: true,
  policyDefaultsVerified: true,
  legacyInviteColumnsPreserved: true,
  legacyScopeColumnsPreserved: true,
  legacyInviteModesVerified: true,
  legacyScopeGenerationsVerified: true,
  inheritedStateBootstrapVerified: true,
  foreignKeyViolations: 0,
  existingAlbumCount: 1,
  legacyInviteCount: 0,
  legacyInviteAlbumCount: 0,
  migrations: structuredClone(migrations),
  commands: [
    'backup-source67',
    'create-independent69-drill',
    'restore-empty-independent67',
    'verify-independent67',
    'read-independent69-clock-before',
    'upgrade-independent69',
    'read-independent69-clock-after',
    'verify-independent69',
    'fresh-source-parity',
    'read-source69-clock-before',
    'adopt-source67',
    'read-source69-clock-after',
    'verify-source69',
  ].map((label) => ({ label, exitCode: 0 })),
});

describe('0069 compound restore admission', () => {
  it('accepts exact 67→68→69 validator input including empty legacy grants', () => {
    expect(() =>
      validateInheritedShare0069RestoreManifest(fixture(), migrations),
    ).not.toThrow();
  });

  it.each([
    ['restore-only', { status: 'passed_independent_0069_restore_upgrade' }],
    ['wrong account', { accountId: 'a'.repeat(32) }],
    ['live drill', { restoreDatabaseId: fixture().sourceDatabaseId }],
    ['wrong source', { sourceSchemaVersion: 68 }],
    ['concurrent source changes', { sourceWritesDuringRestore: 1 }],
    ['pretended chain atomicity', { migrationTransactionScope: 'whole_chain' }],
    ['missing digest', { sourceAfterSha256: '' }],
    ['changed old invite data', { legacyInviteColumnsPreserved: false }],
    ['changed scope data', { legacyScopeColumnsPreserved: false }],
    ['changed old modes', { legacyInviteModesVerified: false }],
    ['bound historical scopes', { legacyScopeGenerationsVerified: false }],
    ['unverified state bootstrap', { inheritedStateBootstrapVerified: false }],
    ['foreign key failure', { foreignKeyViolations: 1 }],
    [
      'scope without any legacy invite',
      { legacyInviteCount: 0, legacyInviteAlbumCount: 1 },
    ],
    ['missing parity', { independentDrillParityVerified: false }],
    ['misleading exact parity claim', { exactIndependentDrillParity: true }],
  ])('rejects %s', (_name, change) => {
    expect(() =>
      validateInheritedShare0069RestoreManifest(
        { ...fixture(), ...change },
        migrations,
      ),
    ).toThrow();
  });

  it('rejects reversed, incomplete, or different migration hashes', () => {
    for (const changed of [
      [...migrations].reverse(),
      migrations.slice(1),
      migrations.map((value) => ({ ...value, sha256: 'f'.repeat(64) })),
    ]) {
      expect(() =>
        validateInheritedShare0069RestoreManifest(
          { ...fixture(), migrations: changed },
          migrations,
        ),
      ).toThrow(/MIGRATION_HASH/);
    }
  });

  it('rejects failed, missing, reordered, or additional command receipts', () => {
    const commands = fixture().commands;
    for (const changed of [
      commands.map((value) => ({ ...value, exitCode: 1 })),
      commands.slice(0, -1),
      [...commands].reverse(),
      [...commands, { label: 'unreviewed-command', exitCode: 0 }],
    ]) {
      expect(() =>
        validateInheritedShare0069RestoreManifest(
          { ...fixture(), commands: changed },
          migrations,
        ),
      ).toThrow(/COMMANDS/);
    }
  });

  it('rejects broader timestamp exemptions or an unmeasured clock mode', () => {
    const proof = fixture();
    for (const comparison of [
      { ...proof.bootstrapTimeComparison, mode: 'host_clock' },
      { ...proof.bootstrapTimeComparison, columns: [] },
      {
        ...proof.bootstrapTimeComparison,
        columns: [
          ...proof.bootstrapTimeComparison.columns,
          { table: 'guest_invites', column: 'created_at_ms' },
        ],
      },
    ]) {
      expect(() =>
        validateInheritedShare0069RestoreManifest(
          { ...proof, bootstrapTimeComparison: comparison },
          migrations,
        ),
      ).toThrow(/BOOTSTRAP_CLOCK/);
    }
  });

  it('requires both database windows to bound ordered bootstrap timestamps', () => {
    for (const key of ['independent', 'source'] as const) {
      const proof = fixture();
      const window = proof.bootstrapTimeComparison[key];
      for (const clock of [
        { ...window, beforeMs: 0 },
        { ...window, policySeedMs: window.beforeMs - 1 },
        { ...window, shareBootstrapMs: window.afterMs + 1 },
        { ...window, shareBootstrapMs: window.policySeedMs - 1 },
        { ...window, afterMs: window.beforeMs + 30 * 60_000 + 1 },
        { ...window, policySeedMs: Number.NaN },
      ]) {
        expect(() =>
          validateInheritedShare0069RestoreManifest(
            {
              ...proof,
              bootstrapTimeComparison: {
                ...proof.bootstrapTimeComparison,
                [key]: clock,
              },
            },
            migrations,
          ),
        ).toThrow(/CLOCK_WINDOW/);
      }
    }
  });
});

describe('0069 exact final schema objects', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(directory)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort())
    db.exec(readFileSync(resolve(directory, name), 'utf8'));
  afterAll(() => db.close());
  const names = new Set(
    [
      ...source.matchAll(
        /^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+(\w+)/gm,
      ),
    ]
      .map((match) => match[1])
      .filter((name) => name !== 'kino_guest_invites_0069_copy'),
  );
  names.add('guest_invite_albums');
  const rows = (
    db
      .prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL')
      .all() as Array<{ type: string; name: string; sql: string }>
  )
    .filter(({ name }) => names.has(name))
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
    );

  it('matches actual empty SQLite schema after migrations 1–69', () => {
    expect(rows).toHaveLength(55);
    expect(() => validateInheritedShare0069Schema(rows, source)).not.toThrow();
  });

  it('rejects missing, additional, or changed live schema objects', () => {
    for (const changed of [
      rows.slice(1),
      [
        ...rows,
        { type: 'table', name: 'rogue', sql: 'CREATE TABLE rogue(id)' },
      ],
      rows.map((row, index) =>
        index === 0 ? { ...row, sql: row.sql + ' -- altered' } : row,
      ),
    ]) {
      expect(() => validateInheritedShare0069Schema(changed, source)).toThrow();
    }
  });

  it('rejects extra DDL and a copy table that is not dropped', () => {
    expect(() =>
      validateInheritedShare0069Schema(
        rows,
        source + '\nCREATE TABLE rogue(id);',
      ),
    ).toThrow(/SOURCE_OBJECTS/);
    expect(() =>
      validateInheritedShare0069Schema(
        rows,
        source.replace('DROP TABLE kino_guest_invites_0069_copy;', ''),
      ),
    ).toThrow(/TEMPORARY_COPY/);
  });

  it('requires the complete altered scope table and its exact generation constraint', () => {
    expect(() =>
      validateInheritedShare0069Schema(
        rows.filter(({ name }) => name !== 'guest_invite_albums'),
        source,
      ),
    ).toThrow(/SCOPE_TABLE/);
    expect(() =>
      validateInheritedShare0069Schema(
        rows.map((row) =>
          row.name === 'guest_invite_albums'
            ? {
                ...row,
                sql: row.sql.replace(
                  'BETWEEN 1 AND 2147483647',
                  'BETWEEN 0 AND 2147483647',
                ),
              }
            : row,
        ),
        source,
      ),
    ).toThrow(/SCOPE_SQL/);
    expect(() =>
      validateInheritedShare0069Schema(
        rows,
        source.replace(
          'ADD COLUMN inherit_generation INTEGER CHECK',
          'ADD COLUMN inherit_generation TEXT CHECK',
        ),
      ),
    ).toThrow(/SOURCE_SCOPE_ALTER/);
  });

  it('does not normalize changed string literals in guarded SQL', () => {
    expect(() =>
      validateInheritedShare0069Schema(
        rows.map((row) =>
          row.name === 'guest_invite_albums'
            ? { ...row, sql: row.sql.replace("='integer'", "='INTEGER'") }
            : row,
        ),
        source,
      ),
    ).toThrow(/SCOPE_SQL/);
  });
});
