import { describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../../apps/worker/src/config';

const state = vi.hoisted(() => ({
  remote: null as null | { quotaBytes: number; revision: number },
  conflicts: 0,
  writes: 0,
}));
vi.mock('../../apps/worker/src/private-storage', () => ({
  oracleStorageCredentials: () => ({}),
  storageBucketForNode: () => ({
    get: async () =>
      state.remote
        ? {
            size: 60,
            etag: 'existing',
            json: async () => ({ ...state.remote }),
          }
        : null,
    put: async (_key: string, body: string, options: { onlyIf: unknown }) => {
      expect(options.onlyIf).toBeTruthy();
      if (state.conflicts-- > 0) return null;
      state.remote = JSON.parse(body);
      state.writes++;
      return { etag: 'saved' };
    },
  }),
}));
vi.mock('../../apps/worker/src/storage-admission', () => ({
  refreshStorageHealth: async () => {},
}));
import { saveOraclePolicy } from '../../apps/worker/src/oracle-storage-policy';

const actor = 'a2200000-0000-4000-8000-000000000001';
function env() {
  const row = {
    requested_enabled: 1,
    quota_bytes: 30e9,
    free_floor_bytes: 20e9,
    revision: 4,
  };
  return {
    ORACLE_STORAGE_ADMIN_USER_ID: actor,
    ORACLE_STORAGE_ENABLED: 'true',
    APP_ENV: 'local',
    APP_URL: 'http://localhost:4196',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    DB: {
      prepare: (sql: string) => ({
        first: async () =>
          sql.includes('sqlite_schema')
            ? { n: 1 }
            : sql.includes('FROM oracle_storage_policy WHERE')
              ? row
              : null,
        bind: () => ({ run: async () => ({ success: true }) }),
      }),
    },
  } as unknown as WorkerEnv;
}
describe('VM policy sync', () => {
  it('publishes the current committed quota, retries conditional conflicts and keeps newer revisions', async () => {
    const value = {
      requestId: 'a2200000-0000-4000-8000-000000000002',
      expectedRevision: 3,
      enabled: true,
      quotaGb: 30,
    };
    state.remote = null;
    state.conflicts = 1;
    state.writes = 0;
    await saveOraclePolicy(env(), actor, 'session', value);
    expect(state.remote).toEqual({ quotaBytes: 30e9, revision: 4 });
    expect(state.writes).toBe(1);
    await saveOraclePolicy(env(), actor, 'session', value);
    expect(state.writes).toBe(1);
    state.remote = { quotaBytes: 35e9, revision: 5 };
    await saveOraclePolicy(env(), actor, 'session', value);
    expect(state.remote).toEqual({ quotaBytes: 35e9, revision: 5 });
    expect(state.writes).toBe(1);
  });
});
