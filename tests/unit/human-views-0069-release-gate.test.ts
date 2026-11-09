import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const {
  expectedCollaborationFlags,
  validateHumanViewsReceiptProofs,
  validatePriorHumanViewsProfile,
} = createRequire(import.meta.url)(
  '../../tools/check-staging-collaboration-release.mjs',
) as {
  expectedCollaborationFlags: (
    migrationCount: number,
    humanViewsEnabled?: boolean,
  ) => string[];
  validateHumanViewsReceiptProofs: (
    proofs: unknown,
    schemaVersion?: number,
  ) => void;
  validatePriorHumanViewsProfile: (
    migrationCount: number,
    activeFlags: string[],
    humanViewsEnabled: boolean | undefined,
    nativeProofs: unknown,
  ) => void;
};

function receiptProof(schemaVersion: 68 | 69) {
  const nativeChecks = schemaVersion === 69 ? 5 : 4;
  const bProfileNativeChecks = schemaVersion === 69 ? 7 : 6;
  const latestMigration =
    schemaVersion === 69
      ? '0069_inherited_share_expiry.sql'
      : '0068_album_retention_policy_configuration.sql';
  return {
    humanViewsFocused: {
      status: 'passed_local_only',
      proofSha256: 'a'.repeat(64),
      sourceSha256: 'b'.repeat(64),
      migrationCount: schemaVersion,
      latestMigration,
      nativeChecks,
      browserChecks: 9,
      checkCount: nativeChecks + 9 + 1,
      ownerViewportWidth: 375,
      guestViewportWidth: 375,
      scope: 'fresh ephemeral Miniflare D1/R2 only',
      syntheticOwner: true,
      realOAuth: false,
      outboundRequestsBlocked: true,
    },
    humanViewsBProfile: {
      status: 'passed_local_only',
      proofSha256: 'c'.repeat(64),
      sourceSha256: 'd'.repeat(64),
      schemaVersion,
      nativeChecks: bProfileNativeChecks,
      browserChecks: 0,
      d1Checks: 1,
      checkCount: bProfileNativeChecks + 1,
      configuredFlag: true,
      primaryTestOverride: false,
      sidecarFlag: true,
      syntheticOwner: true,
      realOAuth: false,
      remoteCloudflare: false,
      hostedDeployment: false,
      browserOrPublicTLS: false,
    },
  };
}

describe('Human views release-gate schema compatibility', () => {
  it('keeps schema 67 without Human and schema 68 OFF/ON receipts valid', () => {
    expect(() =>
      validatePriorHumanViewsProfile(
        67,
        expectedCollaborationFlags(67),
        false,
        undefined,
      ),
    ).not.toThrow();

    expect(() =>
      validatePriorHumanViewsProfile(
        68,
        expectedCollaborationFlags(68, false),
        false,
        undefined,
      ),
    ).not.toThrow();
    expect(() =>
      validatePriorHumanViewsProfile(
        68,
        expectedCollaborationFlags(68, true),
        true,
        receiptProof(68),
      ),
    ).not.toThrow();
  });

  it('requires both Human and inherited-share flags for schema 69', () => {
    const flags = expectedCollaborationFlags(69);
    expect(flags).toContain('HUMAN_VIEW_TRACKING_ENABLED');
    expect(flags).toContain('INHERITED_SHARE_ISSUANCE_ENABLED');
    expect(() =>
      validatePriorHumanViewsProfile(69, flags, true, receiptProof(69)),
    ).not.toThrow();

    for (const requiredFlag of [
      'HUMAN_VIEW_TRACKING_ENABLED',
      'INHERITED_SHARE_ISSUANCE_ENABLED',
    ]) {
      expect(() =>
        validatePriorHumanViewsProfile(
          69,
          flags.filter((flag) => flag !== requiredFlag),
          true,
          receiptProof(69),
        ),
      ).toThrow();
    }
  });

  it('rejects schema 68 receipts reused as schema 69 evidence', () => {
    expect(() =>
      validateHumanViewsReceiptProofs(receiptProof(68), 69),
    ).toThrow();
    expect(() =>
      validatePriorHumanViewsProfile(
        69,
        expectedCollaborationFlags(69),
        true,
        receiptProof(68),
      ),
    ).toThrow();
  });

  it('rejects malformed proof digests and mismatched receipt counts', () => {
    const proof = receiptProof(69);
    expect(() =>
      validateHumanViewsReceiptProofs(
        {
          ...proof,
          humanViewsFocused: {
            ...proof.humanViewsFocused,
            proofSha256: 'not-a-digest',
          },
        },
        69,
      ),
    ).toThrow();
    expect(() =>
      validateHumanViewsReceiptProofs(
        {
          ...proof,
          humanViewsBProfile: {
            ...proof.humanViewsBProfile,
            checkCount: 7,
          },
        },
        69,
      ),
    ).toThrow();
  });

  it('rejects unsupported schema 70', () => {
    expect(() => expectedCollaborationFlags(70)).toThrow();
    expect(() =>
      validateHumanViewsReceiptProofs(receiptProof(69), 70),
    ).toThrow();
  });
});
