import { describe, expect, it } from 'vitest';
import { freehandAnnotationWriteCapabilitiesSchema } from '../../packages/contracts/src/freehand-annotation-capabilities';
import { guestAnnotationsCapabilitiesSchema } from '../../packages/contracts/src/guest-annotations';
import { ownerAnnotationAuthoringCapabilitiesSchema } from '../../packages/contracts/src/owner-annotation-authoring';
import { guestAnnotationRoutes } from '../../apps/worker/src/guest-annotation-routes';
import { ownerAnnotationAuthoringRoutes } from '../../apps/worker/src/owner-annotation-authoring-routes';

const base = 'http://127.0.0.1:8787';
const guestPath = '/api/guest/annotations/freehand-capabilities';
const ownerPath = '/api/v1/annotations/authoring/freehand-capabilities';
const baseEnv = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  GUEST_EXCHANGE_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'false',
};

async function getGuest(path: string, env = baseEnv) {
  return guestAnnotationRoutes.fetch(new Request(base + path), env as never);
}

async function getOwner(path: string, env = baseEnv) {
  return ownerAnnotationAuthoringRoutes.fetch(
    new Request(base + path),
    env as never,
  );
}

describe('freehand annotation write capability contract', () => {
  it('accepts only the strict enabled boolean object', () => {
    expect(
      freehandAnnotationWriteCapabilitiesSchema.parse({ enabled: false }),
    ).toEqual({ enabled: false });
    expect(
      freehandAnnotationWriteCapabilitiesSchema.parse({ enabled: true }),
    ).toEqual({ enabled: true });
    expect(
      freehandAnnotationWriteCapabilitiesSchema.safeParse({
        enabled: true,
        ownerId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
    expect(
      freehandAnnotationWriteCapabilitiesSchema.safeParse({ enabled: 'true' })
        .success,
    ).toBe(false);
  });

  it.each([
    ['Guest', getGuest, guestPath],
    ['Owner', getOwner, ownerPath],
  ] as const)(
    '%s endpoint remains OFF when D1 schema support is absent',
    async (_role, getRoute, path) => {
      const disabled = await getRoute(path);
      expect(disabled.status).toBe(200);
      const disabledJson: unknown = await disabled.json();
      expect(disabledJson).toEqual({ enabled: false });
      expect(
        freehandAnnotationWriteCapabilitiesSchema.parse(disabledJson),
      ).toEqual({ enabled: false });

      const configEnabledWithoutD1 = await getRoute(path, {
        ...baseEnv,
        FREEHAND_ANNOTATIONS_ENABLED: 'true',
      });
      expect(configEnabledWithoutD1.status).toBe(200);
      const configEnabledJson: unknown = await configEnabledWithoutD1.json();
      expect(configEnabledJson).toEqual({ enabled: false });
      expect(
        freehandAnnotationWriteCapabilitiesSchema.parse(configEnabledJson),
      ).toEqual({ enabled: false });
    },
  );

  it.each([
    ['Guest', getGuest, guestPath],
    ['Owner', getOwner, ownerPath],
  ] as const)(
    '%s capability endpoint rejects query parameters',
    async (_role, getRoute, path) => {
      const response = await getRoute(
        path + '?albumId=11111111-1111-4111-8111-111111111111',
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'INVALID_INPUT' },
      });
    },
  );

  it('leaves existing Guest and Owner capability JSON unchanged', async () => {
    const guest = await getGuest('/api/guest/annotations/capabilities', {
      ...baseEnv,
      FREEHAND_ANNOTATIONS_ENABLED: 'true',
    });
    expect(guest.status).toBe(200);
    const guestJson: unknown = await guest.json();
    expect(guestJson).toEqual({ enabled: true });
    expect(guestAnnotationsCapabilitiesSchema.parse(guestJson)).toEqual({
      enabled: true,
    });

    const owner = await getOwner('/api/v1/annotations/authoring/capabilities', {
      ...baseEnv,
      FREEHAND_ANNOTATIONS_ENABLED: 'true',
    });
    expect(owner.status).toBe(200);
    const ownerJson: unknown = await owner.json();
    expect(ownerJson).toEqual({ enabled: true });
    expect(ownerAnnotationAuthoringCapabilitiesSchema.parse(ownerJson)).toEqual(
      { enabled: true },
    );
  });
});
