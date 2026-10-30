import { describe, expect, it } from 'vitest';
import {
  configuration,
  ownerCommentsCapability,
  ownerCommentProcessingCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
const env = (mode: 'local' | 'staging' | 'production') =>
  ({
    APP_ENV: mode,
    APP_URL:
      mode === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  }) as WorkerEnv;
describe('Owner comment feature boundaries', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).OWNER_COMMENTS_ENABLED).toBe('false');
      expect(ownerCommentsCapability(env(mode))).toBe(false);
    },
  );
  it.each([0, 1, 2, 3])(
    'requires its own gate and photo versions only, combination %i',
    (mask) => {
      expect(
        ownerCommentsCapability({
          ...env('local'),
          PHOTO_VERSIONS_ENABLED: mask & 1 ? 'true' : 'false',
          OWNER_COMMENTS_ENABLED: mask & 2 ? 'true' : 'false',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_COMMENTS_ENABLED: 'false',
          GUEST_SELECTION_ENABLED: 'false',
        } as WorkerEnv),
      ).toBe(mask === 3);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted enablement in %s',
    (mode) => {
      expect(() =>
        configuration({ ...env(mode), OWNER_COMMENTS_ENABLED: 'true' }),
      ).toThrow('OWNER_COMMENTS_LOCAL_ONLY');
    },
  );
});

describe('Owner processing feature boundaries', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).OWNER_COMMENT_PROCESSING_ENABLED).toBe(
        'false',
      );
      expect(ownerCommentProcessingCapability(env(mode))).toBe(false);
    },
  );
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'requires all Owner/version gates, combination %i',
    (mask) => {
      expect(
        ownerCommentProcessingCapability({
          ...env('local'),
          PHOTO_VERSIONS_ENABLED: mask & 1 ? 'true' : 'false',
          OWNER_COMMENTS_ENABLED: mask & 2 ? 'true' : 'false',
          OWNER_COMMENT_PROCESSING_ENABLED: mask & 4 ? 'true' : 'false',
          GUEST_COMMENTS_ENABLED: 'false',
          GUEST_EXCHANGE_ENABLED: 'false',
        } as WorkerEnv),
      ).toBe(mask === 7);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted enablement in %s',
    (mode) => {
      expect(() =>
        configuration({
          ...env(mode),
          OWNER_COMMENT_PROCESSING_ENABLED: 'true',
        }),
      ).toThrow('OWNER_COMMENT_PROCESSING_LOCAL_ONLY');
    },
  );
});
