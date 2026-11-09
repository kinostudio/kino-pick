import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type CatalogRow = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string;
};

const {
  INHERITED_SHARE_CATALOG_QUERY,
  inheritedShareCatalogDigest,
  inheritedShare0069RestoreReceipt,
  validatePriorInheritedShareState,
  validatePriorInheritedShareProof,
} = createRequire(import.meta.url)(
  '../../tools/check-staging-collaboration-release.mjs',
) as {
  INHERITED_SHARE_CATALOG_QUERY: string;
  inheritedShareCatalogDigest: (rows: CatalogRow[]) => string;
  inheritedShare0069RestoreReceipt: (
    manifest: Record<string, unknown>,
    manifestSha256: string,
  ) => Record<string, unknown>;
  validatePriorInheritedShareState: (
    cloudflare: Record<string, unknown>,
    receipt: Record<string, unknown>,
    manifest: Record<string, unknown>,
    manifestSha256: string,
  ) => void;
  validatePriorInheritedShareProof: (proof: unknown) => void;
};

const migrationNames = [
  '0068_album_retention_policy_configuration.sql',
  '0069_inherited_share_expiry.sql',
];
const migrations = migrationNames.map((name, index) => ({
  name,
  sha256: String(index + 1).repeat(64),
  canonicalSha256: String(index + 3).repeat(64),
}));
const catalogRows = () =>
  Array.from({ length: 55 }, (_, index) => {
    const name = `fixture_table_${String(index).padStart(3, '0')}`;
    return {
      type: 'table',
      name,
      tbl_name: name,
      sql: `CREATE TABLE "${name}" (\nid INTEGER NOT NULL DEFAULT 'MixedCase'\n)`,
    };
  });
const sourceCatalog = catalogRows();
const sourceCatalogSha256 = inheritedShareCatalogDigest(sourceCatalog);
const restoreCommands = [
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
].map((label) => ({ label, exitCode: 0 }));

// Synthetic projection fixture only; it is never persisted or used as cloud evidence.
const restoreManifest = () => ({
  status: 'passed_independent_0069_restore_and_B_adoption',
  accountId: 'synthetic-account',
  sourceDatabaseId: 'synthetic-source-database',
  restoreDatabaseId: 'synthetic-independent-database',
  sourceSchemaVersion: 67,
  targetSchemaVersion: 69,
  sourceWritesDuringRestore: 0,
  migrationTransactionScope: 'per_migration',
  backupSha256: 'a'.repeat(64),
  restoredSha256: 'b'.repeat(64),
  upgradedSha256: 'c'.repeat(64),
  sourceAfterSha256: 'd'.repeat(64),
  sourceAfterSchemaSha256: sourceCatalogSha256,
  sourceAfterSchemaObjects: sourceCatalog.length,
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
      beforeMs: 1_000,
      policySeedMs: 1_500,
      shareBootstrapMs: 1_600,
      afterMs: 2_000,
    },
    source: {
      beforeMs: 3_000,
      policySeedMs: 3_500,
      shareBootstrapMs: 3_600,
      afterMs: 4_000,
    },
  },
  foreignKeyViolations: 0,
  commandsAllSucceeded: true,
  commands: restoreCommands,
  migrations,
  policyDefaultsVerified: true,
  existingAlbumCount: 2,
  legacyInviteCount: 1,
  legacyInviteAlbumCount: 1,
  legacyInviteColumnsPreserved: true,
  legacyScopeColumnsPreserved: true,
  legacyInviteModesVerified: true,
  legacyScopeGenerationsVerified: true,
  inheritedStateBootstrapVerified: true,
  // Deliberate extras must not enter the release receipt.
  exactIndependentDrillParity: true,
  ownerCookie: 'synthetic-not-a-credential',
});

const priorProof = () => ({
  status: 'passed_native_inherited_share_expiry',
  schemaVersion: 69,
  migrationCount: 69,
  latestMigration: '0069_inherited_share_expiry.sql',
  checkCount: 19,
  syntheticOwner: true,
  realOAuth: false,
  remoteCloudflare: false,
  hostedDeployment: false,
  foreignKeyViolations: 0,
  proofSha256: '1'.repeat(64),
  migrationsSha256: '2'.repeat(64),
  sourceSha256: '3'.repeat(64),
  bundleSha256: '4'.repeat(64),
});

const priorStateFixture = () => {
  const manifest = restoreManifest();
  const manifestSha256 = 'e'.repeat(64);
  return {
    manifest,
    manifestSha256,
    cloudflare: {
      inheritedShareIssuanceEnabled: true,
      inheritedShareSchema: true,
      inheritedShareSchemaObjects: 55,
      inheritedShareCatalogObjects: manifest.sourceAfterSchemaObjects,
      inheritedShareSchemaSha256: manifest.sourceAfterSchemaSha256,
    },
    receipt: {
      inheritedShareRestore: inheritedShare0069RestoreReceipt(
        manifest,
        manifestSha256,
      ),
      nativeProofs: { inheritedShare: priorProof() },
    },
  };
};

describe('0069 prior deployment release receipt', () => {
  it('projects only the approved 67-to-69 restore fields and manifest digest', () => {
    const manifest = restoreManifest();
    const manifestSha256 = 'e'.repeat(64);
    const receipt = inheritedShare0069RestoreReceipt(manifest, manifestSha256);

    expect(receipt).toStrictEqual({
      manifestSha256,
      status: manifest.status,
      accountId: manifest.accountId,
      sourceDatabaseId: manifest.sourceDatabaseId,
      restoreDatabaseId: manifest.restoreDatabaseId,
      sourceSchemaVersion: 67,
      targetSchemaVersion: 69,
      sourceWritesDuringRestore: 0,
      migrationTransactionScope: 'per_migration',
      backupSha256: manifest.backupSha256,
      restoredSha256: manifest.restoredSha256,
      upgradedSha256: manifest.upgradedSha256,
      sourceAfterSha256: manifest.sourceAfterSha256,
      sourceAfterSchemaSha256: manifest.sourceAfterSchemaSha256,
      sourceAfterSchemaObjects: manifest.sourceAfterSchemaObjects,
      oldTablesPreserved: true,
      exactSchemaAndRowsMatchSource: true,
      independentDrillParityVerified: true,
      bootstrapTimeComparison: manifest.bootstrapTimeComparison,
      foreignKeyViolations: 0,
      commandsAllSucceeded: true,
      commands: restoreCommands,
      migrations,
      policyDefaultsVerified: true,
      existingAlbumCount: 2,
      legacyInviteCount: 1,
      legacyInviteAlbumCount: 1,
      legacyInviteColumnsPreserved: true,
      legacyScopeColumnsPreserved: true,
      legacyInviteModesVerified: true,
      legacyScopeGenerationsVerified: true,
      inheritedStateBootstrapVerified: true,
    });
    expect(receipt).not.toHaveProperty('exactIndependentDrillParity');
    expect(receipt).not.toHaveProperty('ownerCookie');
  });

  it.each([
    ['missing manifest digest', undefined],
    ['malformed manifest digest', 'not-a-digest'],
    ['uppercase manifest digest', 'A'.repeat(64)],
  ])('rejects %s', (_name, digest) => {
    expect(() =>
      inheritedShare0069RestoreReceipt(restoreManifest(), digest as string),
    ).toThrow();
  });
});

describe('0069 full SQLite schema catalog digest', () => {
  it('ignores input order and canonicalizes CRLF while retaining exact SQL text', () => {
    const rows = catalogRows();
    const digest = inheritedShareCatalogDigest(rows);
    const crlfRows = rows.map((row) => ({
      ...row,
      sql: row.sql.replaceAll('\n', '\r\n'),
    }));

    expect(inheritedShareCatalogDigest([...rows].reverse())).toBe(digest);
    expect(inheritedShareCatalogDigest(crlfRows)).toBe(digest);
    expect(
      inheritedShareCatalogDigest([
        ...rows,
        {
          type: 'index',
          name: 'fixture_extra_index',
          tbl_name: 'fixture_table_000',
          sql: 'CREATE INDEX fixture_extra_index ON fixture_table_000(id)',
        },
      ]),
    ).not.toBe(digest);

    const changedLiteral = rows.map((row, index) =>
      index === 0
        ? { ...row, sql: row.sql.replace('MixedCase', 'mixedcase') }
        : row,
    );
    expect(inheritedShareCatalogDigest(changedLiteral)).not.toBe(digest);

    const changedWhitespace = rows.map((row, index) =>
      index === 0
        ? { ...row, sql: row.sql.replace('id INTEGER', 'id  INTEGER') }
        : row,
    );
    expect(inheritedShareCatalogDigest(changedWhitespace)).not.toBe(digest);
  });

  it('rejects too few rows, duplicate identities, and malformed catalog rows', () => {
    const rows = catalogRows();
    expect(() => inheritedShareCatalogDigest(rows.slice(0, 54))).toThrow();
    const firstRow = rows.at(0)!;
    expect(() =>
      inheritedShareCatalogDigest([...rows, { ...firstRow }]),
    ).toThrow();

    const badType = rows.map((row, index) =>
      index === 0 ? { ...row, type: 'sequence' } : row,
    );
    expect(() => inheritedShareCatalogDigest(badType)).toThrow();

    const badSql = rows.map((row, index) =>
      index === 0 ? { ...row, sql: undefined as unknown as string } : row,
    );
    expect(() => inheritedShareCatalogDigest(badSql)).toThrow();
  });

  it('executes the shared catalog query with the intended SQLite namespaces', () => {
    const db = new DatabaseSync(':memory:');
    try {
      for (const row of catalogRows())
        db.exec(`CREATE TABLE "${row.name}" (id INTEGER NOT NULL)`);
      db.exec(
        'CREATE TABLE fixture_autoincrement(id INTEGER PRIMARY KEY AUTOINCREMENT)',
      );
      const before = db
        .prepare(INHERITED_SHARE_CATALOG_QUERY)
        .all() as unknown as CatalogRow[];
      const beforeDigest = inheritedShareCatalogDigest(before);
      expect(before).toHaveLength(56);
      expect(before.some(({ name }) => name === 'sqlite_sequence')).toBe(false);

      db.exec('CREATE TABLE sqliteX_untracked(id INTEGER NOT NULL)');
      db.exec('CREATE TABLE _cf_metadata(id INTEGER NOT NULL)');
      const rows = db
        .prepare(INHERITED_SHARE_CATALOG_QUERY)
        .all() as unknown as CatalogRow[];
      const names = rows.map(({ name }) => name);

      expect(rows).toHaveLength(57);
      expect(names).toContain('sqliteX_untracked');
      expect(names).not.toContain('_cf_metadata');
      expect(names).not.toContain('sqlite_sequence');
      expect(names).not.toContain('sqlite_schema');
      expect(names.some((name) => name.startsWith('sqlite_'))).toBe(false);
      expect(inheritedShareCatalogDigest(rows)).not.toBe(beforeDigest);
    } finally {
      db.close();
    }
  });
});

describe('0069 prior native proof validation', () => {
  it('accepts a complete local synthetic proof summary', () => {
    expect(() => validatePriorInheritedShareProof(priorProof())).not.toThrow();
  });

  it.each([
    ['schema 68', { schemaVersion: 68 }],
    ['schema count 68', { migrationCount: 68 }],
    [
      'wrong latest migration',
      { latestMigration: '0068_album_retention_policy_configuration.sql' },
    ],
    ['only 18 checks', { checkCount: 18 }],
    ['claimed remote Cloudflare', { remoteCloudflare: true }],
    ['claimed hosted deployment', { hostedDeployment: true }],
    ['claimed real OAuth', { realOAuth: true }],
    ['foreign key violation', { foreignKeyViolations: 1 }],
    ['invalid proof digest', { proofSha256: 'bad' }],
    ['missing bundle digest', { bundleSha256: undefined }],
    ['invalid migration digest', { migrationsSha256: '0'.repeat(63) }],
    ['missing source digest', { sourceSha256: undefined }],
  ])('rejects %s', (_name, change) => {
    expect(() =>
      validatePriorInheritedShareProof({ ...priorProof(), ...change }),
    ).toThrow();
  });
});

describe('0069 prior state validation', () => {
  it('accepts exact B schema, full source catalog, restore receipt, and native proof', () => {
    const state = priorStateFixture();
    expect(() =>
      validatePriorInheritedShareState(
        state.cloudflare,
        state.receipt,
        state.manifest,
        state.manifestSha256,
      ),
    ).not.toThrow();
  });

  const mutations: Array<
    [string, (state: ReturnType<typeof priorStateFixture>) => void]
  > = [
    [
      'catalog object count mismatch',
      (state) => {
        state.cloudflare.inheritedShareCatalogObjects =
          Number(state.cloudflare.inheritedShareCatalogObjects) + 1;
      },
    ],
    [
      'full catalog digest mismatch',
      (state) => {
        state.cloudflare.inheritedShareSchemaSha256 = 'f'.repeat(64);
      },
    ],
    [
      'issuance flag OFF',
      (state) => {
        state.cloudflare.inheritedShareIssuanceEnabled = false;
      },
    ],
    [
      'schema disabled',
      (state) => {
        state.cloudflare.inheritedShareSchema = false;
      },
    ],
    [
      'fake standalone 68 restore receipt',
      (state) => {
        (state.receipt as Record<string, unknown>).albumRetentionPolicyRestore =
          {
            status: 'passed_independent_0068_restore_and_B_adoption',
          };
      },
    ],
    [
      '68 target in inherited restore receipt',
      (state) => {
        state.receipt.inheritedShareRestore.targetSchemaVersion = 68;
      },
    ],
    [
      'altered receipt clock window',
      (state) => {
        const restore = state.receipt.inheritedShareRestore;
        const clock = restore.bootstrapTimeComparison as {
          independent: { policySeedMs: number };
        };
        restore.bootstrapTimeComparison = {
          ...clock,
          independent: {
            ...clock.independent,
            policySeedMs: clock.independent.policySeedMs + 1,
          },
        };
      },
    ],
    [
      'altered receipt migration hash',
      (state) => {
        const restore = state.receipt.inheritedShareRestore;
        const migrations = restore.migrations as Array<{
          name: string;
          sha256: string;
          canonicalSha256: string;
        }>;
        restore.migrations = migrations.map((migration, index) =>
          index === 0 ? { ...migration, sha256: 'f'.repeat(64) } : migration,
        );
      },
    ],
    [
      'native proof failed status',
      (state) => {
        state.receipt.nativeProofs.inheritedShare.status = 'failed';
      },
    ],
    [
      'native proof schema 68',
      (state) => {
        state.receipt.nativeProofs.inheritedShare.schemaVersion = 68;
      },
    ],
  ];

  it.each(mutations)('rejects %s', (_name, mutate) => {
    const state = priorStateFixture();
    mutate(state);
    expect(() =>
      validatePriorInheritedShareState(
        state.cloudflare,
        state.receipt,
        state.manifest,
        state.manifestSha256,
      ),
    ).toThrow();
  });

  it('rejects a missing restore manifest', () => {
    const state = priorStateFixture();
    expect(() =>
      validatePriorInheritedShareState(
        state.cloudflare,
        state.receipt,
        undefined as unknown as Record<string, unknown>,
        state.manifestSha256,
      ),
    ).toThrow();
  });
});
