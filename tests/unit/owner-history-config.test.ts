import { describe, expect, it } from 'vitest';
import {
  configuration,
  ownerHistoryCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
function env(mode: 'local' | 'staging' | 'production'): WorkerEnv {
  return {
    APP_ENV: mode,
    APP_URL:
      mode === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  } as WorkerEnv;
}
describe('Owner workspace history gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).OWNER_HISTORY_ENABLED).toBe('false');
      expect(ownerHistoryCapability(env(mode))).toBe(false);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({ ...env(mode), OWNER_HISTORY_ENABLED: 'true' }),
      ).toThrow('OWNER_HISTORY_LOCAL_ONLY');
    },
  );
  it('does not require Guest or photo/collaboration rights to read owned history', () => {
    expect(
      ownerHistoryCapability({
        ...env('local'),
        OWNER_HISTORY_ENABLED: 'true',
        PHOTO_VERSIONS_ENABLED: 'false',
        OWNER_ANNOTATIONS_ENABLED: 'false',
        OWNER_COMMENTS_ENABLED: 'false',
        GUEST_EXCHANGE_ENABLED: 'false',
      }),
    ).toBe(true);
  });
  it('rejects malformed activation instead of treating it as enabled', () => {
    expect(() =>
      configuration({ ...env('local'), OWNER_HISTORY_ENABLED: 'TRUE' }),
    ).toThrow();
  });
});
