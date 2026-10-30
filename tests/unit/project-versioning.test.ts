import { describe, expect, it } from 'vitest';
import {
  projectVersioningReadSchema,
  setProjectVersioningSchema,
  setProjectVersioningResultSchema,
} from '../../packages/contracts/src/project-versioning';
import {
  configuration,
  projectVersioningCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const modes = ['off', 'manual', 'auto_filename', 'assisted'] as const;
const body = {
  requestId: eventId,
  expectedRevision: 1,
  mode: 'manual',
  confirm: true,
};
function environment(
  appEnv: 'local' | 'staging' | 'production',
  enabled?: string,
) {
  return {
    APP_ENV: appEnv,
    APP_URL:
      appEnv === 'local'
        ? 'http://127.0.0.1:8787'
        : 'https://versions.example.com',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    ...(enabled === undefined
      ? {}
      : { PROJECT_VERSIONING_CONFIGURATION_ENABLED: enabled }),
  } as WorkerEnv;
}
describe('Project versioning contracts', () => {
  it('requires confirmation and a bounded project revision', () => {
    expect(setProjectVersioningSchema.parse(body)).toEqual(body);
    for (const input of [
      { ...body, confirm: false },
      { ...body, confirm: undefined },
      { ...body, expectedRevision: 0 },
      { ...body, expectedRevision: 2147483648 },
      { ...body, expectedRevision: 1.5 },
      { ...body, projectId },
      { ...body, requestId: 'bad' },
    ]) {
      expect(setProjectVersioningSchema.safeParse(input).success).toBe(false);
    }
  });
  it('accepts all four modes at the contract boundary', () => {
    for (const mode of modes) {
      expect(
        setProjectVersioningSchema.safeParse({ ...body, mode }).success,
      ).toBe(true);
      expect(
        projectVersioningReadSchema.safeParse({
          projectId,
          workspaceId,
          mode,
          revision: 1,
          availableModes: ['off', 'manual'],
        }).success,
      ).toBe(true);
    }
  });
  it('requires a valid audit identity for changed results and none for no-op', () => {
    const result = {
      projectId,
      workspaceId,
      mode: 'off',
      revision: 2,
      changed: true,
      eventId,
    };
    expect(setProjectVersioningResultSchema.safeParse(result).success).toBe(
      true,
    );
    expect(
      setProjectVersioningResultSchema.safeParse({
        ...result,
        mode: 'assisted',
      }).success,
    ).toBe(true);
    expect(
      setProjectVersioningResultSchema.safeParse({
        ...result,
        changed: false,
        eventId: null,
      }).success,
    ).toBe(true);
    for (const input of [
      { ...result, eventId: null },
      { ...result, changed: false },
      { ...result, eventId: 'bad' },
      { ...result, sessionId: eventId },
    ]) {
      expect(setProjectVersioningResultSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });
  it('requires available modes to be nonempty, unique, and strict', () => {
    const result = {
      projectId,
      workspaceId,
      mode: 'manual',
      revision: 1,
      availableModes: modes,
    };
    expect(projectVersioningReadSchema.safeParse(result).success).toBe(true);
    for (const availableModes of [
      [],
      ['off', 'manual', 'manual'],
      ['off', 'unsupported'],
    ]) {
      expect(
        projectVersioningReadSchema.safeParse({
          ...result,
          availableModes,
        }).success,
      ).toBe(false);
    }
    expect(
      projectVersioningReadSchema.safeParse({
        ...result,
        sessionId: eventId,
      }).success,
    ).toBe(false);
  });
});
describe('Project versioning capability', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults off in %s',
    (appEnv) => {
      expect(
        configuration(environment(appEnv))
          .PROJECT_VERSIONING_CONFIGURATION_ENABLED,
      ).toBe('false');
      expect(projectVersioningCapability(environment(appEnv))).toBe(false);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects enablement in %s',
    (appEnv) => {
      expect(() => configuration(environment(appEnv, 'true'))).toThrow(
        'PROJECT_VERSIONING_CONFIGURATION_LOCAL_ONLY',
      );
    },
  );
  it.each([0, 1, 2, 3])(
    'requires both local configuration and version gates (%i)',
    (mask) => {
      expect(
        projectVersioningCapability({
          ...environment('local', mask & 1 ? 'true' : 'false'),
          PHOTO_VERSIONS_ENABLED: mask & 2 ? 'true' : 'false',
        } as WorkerEnv),
      ).toBe(mask === 3);
    },
  );
  it('rejects an unknown flag value', () =>
    expect(() => configuration(environment('local', 'yes'))).toThrow());
});
