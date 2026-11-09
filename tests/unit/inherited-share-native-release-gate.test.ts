import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { validateInheritedShareNativeProof } = createRequire(import.meta.url)(
  '../../tools/check-staging-collaboration-release.mjs',
) as {
  validateInheritedShareNativeProof: (
    proof: unknown,
    hashes: Record<string, string>,
    migrationsSha256: string,
  ) => void;
};

const nativeChecks = [
  '0069 DDL failure rolls back schema, AUTOINCREMENT sequences, and foreign keys',
  '0069 preserves legacy table columns and every preexisting row',
  'legacy custom invite, album scope, and Guest session remain valid',
  'every existing active album receives the initial inherited-expiry state',
  'album created-at edits and ID replacement are rejected',
  'direct inherited-state edits and forged transition causes are rejected',
  'foreign_key_check is empty after the migration and API checks',
];
const apiChecks = [
  'existing historical album defaults OFF at 90 days',
  'fixture scopes and enabled inherited-issuance capability are verified',
  'create and recovery expose metadata only with null OFF deadline',
  'OFF inherited exchange and album access have no deadline',
  'closed historical baseline rejects old inherited access while valid custom access remains independent',
  'OFF transition does not revive an old invite or session',
  'new generation invite works while historical policy is OFF',
  'issuance flag OFF rejects new inherited issue but preserves metadata recovery',
  'multi-album access returns exact deadlines and session uses latest scope capped at 24 hours',
  'multi-scope exchange survives closed A through B while A access stays denied',
  'missing, unknown, out-of-scope, and cross-project guest sessions are denied',
  'Owner policy lookup cannot cross workspace/project ownership',
];
const sourcePaths = [
  '.build/index.js',
  'tests/inherited-share-expiry-focused.mjs',
  'tests/inherited-share-api-checks.mjs',
  'tests/apply-migration.mjs',
  'src/guest-expiry-sql.ts',
  'src/guest-access.ts',
  'src/guest-exchange.ts',
  'src/invite-issuance.ts',
  'src/invites.ts',
  'src/config.ts',
  'src/index.ts',
  '../../packages/contracts/src/guest-access.ts',
  '../../packages/contracts/src/invites.ts',
  '../../packages/domain/src/share-expiry.ts',
  '../../apps/web/target-ui/invite-create.tsx',
  '../../apps/web/target-ui/project-invites.tsx',
  '../../apps/web/target-ui/guest-expiry.tsx',
];
const migrationsSha256 = 'c'.repeat(64);
const sourceHashes = Object.fromEntries(
  sourcePaths.map((path) => [path, 'a'.repeat(64)]),
);
const sourceSha256 = (hashes: Record<string, string>) => {
  const digest = createHash('sha256');
  for (const [file, hash] of Object.entries(hashes).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    digest.update(file + '\0' + hash + '\n');
  return digest.digest('hex');
};
const fixture = () => ({
  status: 'passed_native_inherited_share_expiry',
  schemaVersion: 69,
  migrationCount: 69,
  latestMigration: '0069_inherited_share_expiry.sql',
  runtime: 'Miniflare native Worker with ephemeral D1 and R2',
  syntheticOwner: true,
  realOAuth: false,
  remoteCloudflare: false,
  hostedDeployment: false,
  foreignKeyViolations: 0,
  migrationsSha256,
  migrationDigestAlgorithm: 'SHA-256',
  migrationDigestFormat:
    'ascending migration filename + NUL + canonical LF SQL bytes',
  nativeChecks,
  apiChecks,
  checks: [...nativeChecks, ...apiChecks],
  checkCount: 19,
  sourceFiles: { ...sourceHashes },
  sourceSha256: sourceSha256(sourceHashes),
  bundleSha256: sourceHashes['.build/index.js'],
  notChecked: [
    'hosted Cloudflare D1 or Worker behavior',
    'real OAuth provider authentication',
    'real Human photo-view ingestion',
    'production deployment',
  ],
});

describe('inherited share native release proof admission', () => {
  it('accepts a complete schema69 proof with the exact 19 named checks', () => {
    expect(() =>
      validateInheritedShareNativeProof(
        fixture(),
        sourceHashes,
        migrationsSha256,
      ),
    ).not.toThrow();
  });

  it.each([
    ['wrong schema version', { schemaVersion: 68 }],
    ['wrong migration count', { migrationCount: 68 }],
    [
      'wrong latest migration',
      { latestMigration: '0068_album_retention_policy_configuration.sql' },
    ],
    ['claimed real OAuth', { realOAuth: true }],
    ['claimed remote Cloudflare run', { remoteCloudflare: true }],
    ['claimed hosted deployment', { hostedDeployment: true }],
    ['foreign key violation', { foreignKeyViolations: 1 }],
    ['stale migration digest', { migrationsSha256: 'd'.repeat(64) }],
    ['stale source digest', { sourceSha256: 'e'.repeat(64) }],
    ['stale built bundle hash', { bundleSha256: 'f'.repeat(64) }],
  ])('rejects %s', (_name, change) => {
    expect(() =>
      validateInheritedShareNativeProof(
        { ...fixture(), ...change },
        sourceHashes,
        migrationsSha256,
      ),
    ).toThrow();
  });

  it('rejects a missing expiry-mode API check', () => {
    const proof = fixture();
    const reducedApiChecks = apiChecks.filter(
      (check) =>
        check !== 'OFF inherited exchange and album access have no deadline',
    );
    proof.apiChecks = reducedApiChecks;
    proof.checks = [...nativeChecks, ...reducedApiChecks];
    proof.checkCount = proof.checks.length;
    expect(() =>
      validateInheritedShareNativeProof(proof, sourceHashes, migrationsSha256),
    ).toThrow();
  });

  it('rejects stale per-file hashes, including the bundle and product sources', () => {
    for (const file of ['.build/index.js', 'src/guest-exchange.ts']) {
      const proof = fixture();
      proof.sourceFiles[file] = 'b'.repeat(64);
      expect(() =>
        validateInheritedShareNativeProof(
          proof,
          sourceHashes,
          migrationsSha256,
        ),
      ).toThrow();
    }
  });

  it('rejects missing or extra source keys in the proof and expected map', () => {
    const proofMissing = fixture();
    delete proofMissing.sourceFiles['src/invites.ts'];
    const proofExtra = {
      ...fixture(),
      sourceFiles: { ...sourceHashes, 'src/unreviewed.ts': 'a'.repeat(64) },
    };
    const expectedMissing = { ...sourceHashes };
    delete expectedMissing['src/invites.ts'];
    const expectedExtra = {
      ...sourceHashes,
      'src/unreviewed.ts': 'a'.repeat(64),
    };

    for (const [proof, hashes] of [
      [proofMissing, sourceHashes],
      [proofExtra, sourceHashes],
      [fixture(), expectedMissing],
      [fixture(), expectedExtra],
    ] as const)
      expect(() =>
        validateInheritedShareNativeProof(proof, hashes, migrationsSha256),
      ).toThrow();
  });

  it('rejects a caller-supplied migration digest that does not match the proof', () => {
    expect(() =>
      validateInheritedShareNativeProof(
        fixture(),
        sourceHashes,
        'b'.repeat(64),
      ),
    ).toThrow();
  });
});
