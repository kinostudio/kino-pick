import { describe, expect, it } from 'vitest';
import { configuration, type WorkerEnv } from '../../apps/worker/src/config';

function environment(
  appEnv: 'local' | 'staging' | 'production',
  enabled?: string,
) {
  return {
    APP_ENV: appEnv,
    APP_URL:
      appEnv === 'local' ? 'http://127.0.0.1:8787' : 'https://tags.example.com',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    ...(enabled === undefined ? {} : { GUEST_TAGS_ENABLED: enabled }),
  } as WorkerEnv;
}

describe('Guest tags feature boundary', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults off in %s',
    (appEnv) => {
      expect(configuration(environment(appEnv)).GUEST_TAGS_ENABLED).toBe(
        'false',
      );
    },
  );
  it('allows explicit local test activation', () => {
    expect(configuration(environment('local', 'true')).GUEST_TAGS_ENABLED).toBe(
      'true',
    );
  });
  it.each(['staging', 'production'] as const)(
    'rejects activation in %s',
    (appEnv) => {
      expect(() => configuration(environment(appEnv, 'true'))).toThrow(
        'GUEST_TAGS_LOCAL_ONLY',
      );
    },
  );
  it('rejects unknown flag values', () => {
    expect(() => configuration(environment('local', 'yes'))).toThrow();
  });
});
