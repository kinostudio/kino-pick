import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STAGING_GUEST_SCOPE,
  stagingGuestAlbumScopeAllowed,
} from '../../apps/worker/src/staging-guest-scope';
import { importPhotographerOriginal } from '../../apps/worker/src/photographer-metadata-import';
import type { WorkerEnv } from '../../apps/worker/src/config';

const doubles = vi.hoisted(() => ({
  readPhoto: vi.fn(),
  importFromVerifiedSource: vi.fn(),
  extractMetadata: vi.fn(),
  head: vi.fn(),
}));

vi.mock('../../apps/worker/src/photographer-recommendations', () => ({
  D1PhotographerRecommendationsRepository: class {
    readPhoto() {
      return doubles.readPhoto();
    }

    importFromVerifiedSource() {
      return doubles.importFromVerifiedSource();
    }
  },
}));

vi.mock('../../packages/image-processing/src/photographer-container', () => ({
  extractPhotographerContainerMetadata: doubles.extractMetadata,
}));

vi.mock('../../apps/worker/src/private-storage', () => ({
  storageBucketForNode: () => ({ head: doubles.head, get: vi.fn() }),
}));

const actorId = '11111111-1111-4111-8111-111111111111';
const photoId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
const managedProjectId = '55555555-5555-4555-8555-555555555555';
const managedAlbumId = '66666666-6666-4666-8666-666666666666';
const sourceSha256 = '00'.repeat(32);

function makeEnv(
  sourceScope: { workspaceId: string; projectId: string; albumId: string },
  scopeResult: { allowed: 1 } | null,
) {
  let scopeQueries = 0;
  const source = {
    assetId,
    ...sourceScope,
    photoId,
    versionId,
    objectKey: 'private/original.jpg',
    storageNodeId: 'primary',
    size: 17,
    mime: 'image/jpeg',
    sourceSha256,
  };
  const DB = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes('FROM photos p')) return source;
              if (sql.includes('FROM albums a')) {
                scopeQueries += 1;
                return scopeResult;
              }
              throw new Error('Unexpected metadata import query');
            },
          };
        },
      };
    },
  };
  const env = {
    DB,
    APP_ENV: 'staging',
    APP_URL: STAGING_GUEST_SCOPE.origin,
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    R2_ACCOUNT_ID: STAGING_GUEST_SCOPE.accountId,
    R2_BUCKET_NAME: STAGING_GUEST_SCOPE.bucket,
    STAGING_GUEST_VALIDATION: 'true',
    STAGING_COLLABORATION_VALIDATION: 'true',
    PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
  } as unknown as WorkerEnv;
  return { env, scopeQueryCount: () => scopeQueries };
}

async function runImport(env: WorkerEnv) {
  return importPhotographerOriginal(env, actorId, 'session', photoId, {
    requestId: 'request',
    expectedRevision: 0,
    versionId,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  doubles.readPhoto.mockResolvedValue(undefined);
  doubles.importFromVerifiedSource.mockResolvedValue('imported');
  doubles.extractMetadata.mockResolvedValue({ photographer: 'test' });
  doubles.head.mockResolvedValue({
    size: 17,
    checksums: { sha256: new Uint8Array(32) },
    httpMetadata: { contentType: 'image/jpeg' },
    etag: 'etag',
  });
});

describe('managed album photographer metadata import scope', () => {
  it('imports a managed album when the shared scope query returns a row', async () => {
    const { env, scopeQueryCount } = makeEnv(
      {
        workspaceId: STAGING_GUEST_SCOPE.workspaceId,
        projectId: managedProjectId,
        albumId: managedAlbumId,
      },
      { allowed: 1 },
    );

    await expect(runImport(env)).resolves.toBe('imported');
    expect(scopeQueryCount()).toBe(1);
  });

  it('rejects when the shared scope query returns null before reading storage', async () => {
    const { env, scopeQueryCount } = makeEnv(
      {
        workspaceId: STAGING_GUEST_SCOPE.workspaceId,
        projectId: managedProjectId,
        albumId: managedAlbumId,
      },
      null,
    );

    await expect(runImport(env)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(scopeQueryCount()).toBe(1);
    expect(doubles.head).not.toHaveBeenCalled();
  });

  it('keeps new albums rejected in the original single album scope mode', async () => {
    const { env, scopeQueryCount } = makeEnv(
      {
        workspaceId: STAGING_GUEST_SCOPE.workspaceId,
        projectId: managedProjectId,
        albumId: managedAlbumId,
      },
      { allowed: 1 },
    );

    await expect(
      stagingGuestAlbumScopeAllowed(
        env.DB,
        actorId,
        managedProjectId,
        managedAlbumId,
        false,
        false,
      ),
    ).resolves.toBe(false);
    expect(scopeQueryCount()).toBe(0);
  });
});
