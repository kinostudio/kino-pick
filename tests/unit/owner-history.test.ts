import { describe, expect, it } from 'vitest';
import {
  ownerHistoryCapabilitiesSchema,
  ownerHistoryEventSchema,
  ownerHistoryExportRequestSchema,
  ownerHistoryFiltersSchema,
  ownerHistoryPageSchema,
  ownerHistoryQuerySchema,
} from '../../packages/contracts/src/owner-history';

const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const timestamp = '2026-10-28T10:00:00.000Z';

const event = {
  eventId: 'event-01',
  occurredAt: timestamp,
  actor: { type: 'user', id: id(2), label: '攝影師' },
  workspaceId: id(3),
  projectId: id(4),
  albumId: null,
  photoId: null,
  versionId: null,
  inviteId: null,
  relatedInviteIds: [],
  sessionId: 'session-01',
  guestSessionId: null,
  requestId: 'request-01',
  action: 'owner.project.updated',
  details: {
    status: 'available',
    before: { name: '舊名稱' },
    after: { name: '新名稱' },
  },
};

const eventWithDetails = (details: unknown) =>
  ownerHistoryEventSchema.safeParse({ ...event, details }).success;

const nestedObject = (depth: number): Record<string, unknown> => {
  let value: Record<string, unknown> = { leaf: true };
  for (let currentDepth = 1; currentDepth < depth; currentDepth++)
    value = { nested: value };
  return value;
};

const nestedArray = (depth: number): unknown => {
  let value: unknown = true;
  for (let currentDepth = 0; currentDepth < depth; currentDepth++)
    value = [value];
  return value;
};

const keyedRecord = (count: number): Record<string, number> => {
  const record: Record<string, number> = {};
  for (let index = 0; index < count; index++) record['key' + index] = index;
  return record;
};

describe('Owner history filters and query', () => {
  it('accepts independently scoped filters without requiring parent IDs', () => {
    expect(ownerHistoryFiltersSchema.parse({})).toEqual({});
    expect(
      ownerHistoryFiltersSchema.safeParse({ projectId: id(1) }).success,
    ).toBe(true);
    expect(
      ownerHistoryFiltersSchema.safeParse({ albumId: id(2) }).success,
    ).toBe(true);
    expect(
      ownerHistoryFiltersSchema.safeParse({ photoId: id(3) }).success,
    ).toBe(true);
    expect(
      ownerHistoryFiltersSchema.safeParse({ versionId: id(4) }).success,
    ).toBe(true);
    expect(
      ownerHistoryFiltersSchema.safeParse({ inviteId: id(5) }).success,
    ).toBe(true);

    const uppercaseId = id(6).toUpperCase();
    expect(
      ownerHistoryFiltersSchema.parse({
        projectId: uppercaseId,
        actorType: 'guest',
        actorId: id(7),
        action: 'guest.selection.added',
      }),
    ).toEqual({
      projectId: uppercaseId,
      actorType: 'guest',
      actorId: id(7),
      action: 'guest.selection.added',
    });
    expect(
      ownerHistoryFiltersSchema.parse({
        actorTypes: ['guest', 'system', 'user'],
      }),
    ).toEqual({ actorTypes: ['system', 'user', 'guest'] });
    expect(ownerHistoryFiltersSchema.parse({ actorTypes: [] })).toEqual({
      actorTypes: [],
    });
    expect(
      ownerHistoryFiltersSchema.parse({
        actorType: 'guest',
        actorTypes: ['guest'],
      }),
    ).toEqual({ actorType: 'guest', actorTypes: ['guest'] });
  });

  it('rejects malformed UUIDs, actor types, action names, and unknown fields', () => {
    for (const invalid of [
      { projectId: 'not-a-uuid' },
      { actorId: 'not-a-uuid' },
      { actorType: 'owner' },
      { actorType: 'user', actorTypes: ['guest'] },
      { actorTypes: ['user', 'user'] },
      { actorTypes: ['guest', 'user', 'system', 'guest'] },
      { actorTypes: ['owner'] },
      { action: 'Owner.updated' },
      { action: '_owner.updated' },
      { action: ' owner.updated' },
      { action: 'owner.updated\n' },
      { action: 'a'.repeat(129) },
      { ownerId: id(1) },
      { guestId: id(2) },
    ])
      expect(ownerHistoryFiltersSchema.safeParse(invalid).success).toBe(false);

    expect(
      ownerHistoryFiltersSchema.safeParse({ action: 'a'.repeat(128) }).success,
    ).toBe(true);
    expect(
      ownerHistoryFiltersSchema.safeParse({ actorType: 'system' }).success,
    ).toBe(true);
  });

  it('requires UTC timestamps and a strictly increasing from/to range', () => {
    expect(
      ownerHistoryFiltersSchema.safeParse({
        from: '2026-10-28T10:00:00Z',
        to: '2026-10-28T10:00:01Z',
      }).success,
    ).toBe(true);
    expect(
      ownerHistoryFiltersSchema.safeParse({
        from: '2026-10-28T10:00:00.123Z',
        to: '2026-10-28T10:00:00.124Z',
      }).success,
    ).toBe(true);

    for (const invalid of [
      {
        from: '2026-10-28T10:00:00Z',
        to: '2026-10-28T10:00:00Z',
      },
      {
        from: '2026-10-28T10:00:00.100Z',
        to: '2026-10-28T10:00:00.1Z',
      },
      {
        from: '2026-10-28T10:00:02Z',
        to: '2026-10-28T10:00:01Z',
      },
      { from: '2026-10-28T10:00:00+00:00' },
      { to: '2026-10-28T10:00:00' },
      { from: '2026-10-28T10:00:00.1234Z' },
      { from: 'not-a-time' },
    ])
      expect(ownerHistoryFiltersSchema.safeParse(invalid).success).toBe(false);

    expect(
      ownerHistoryFiltersSchema.safeParse({ from: timestamp }).success,
    ).toBe(true);
    expect(ownerHistoryFiltersSchema.safeParse({ to: timestamp }).success).toBe(
      true,
    );
  });

  it('bounds an optional cursor and rejects extra query identity or page controls', () => {
    expect(ownerHistoryQuerySchema.parse({ cursor: 'opaque' })).toEqual({
      cursor: 'opaque',
    });
    expect(
      ownerHistoryQuerySchema.safeParse({ cursor: 'c'.repeat(8192) }).success,
    ).toBe(true);
    expect(
      ownerHistoryQuerySchema.parse({ actorTypes: ['guest', 'system'] }),
    ).toEqual({ actorTypes: ['system', 'guest'] });

    for (const invalid of [
      { cursor: '' },
      { cursor: 'c'.repeat(8193) },
      { limit: 24 },
      { ownerId: id(1) },
      { requestId: id(2) },
      { actorType: 'user', actorTypes: [] },
    ])
      expect(ownerHistoryQuerySchema.safeParse(invalid).success).toBe(false);
  });
});

describe('Owner history capabilities and events', () => {
  it('exposes only the enabled capability', () => {
    expect(ownerHistoryCapabilitiesSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(
      ownerHistoryCapabilitiesSchema.safeParse({
        enabled: true,
        ownerId: id(1),
      }).success,
    ).toBe(false);
  });

  it('accepts complete strict event snapshots with nullable provenance fields', () => {
    expect(ownerHistoryEventSchema.safeParse(event).success).toBe(true);
    expect(
      ownerHistoryEventSchema.safeParse({
        ...event,
        eventId: 'e'.repeat(512),
      }).success,
    ).toBe(true);
    expect(
      ownerHistoryEventSchema.safeParse({
        ...event,
        actor: { type: 'system', id: null, label: null },
        projectId: null,
        albumId: id(8),
        photoId: id(9),
        versionId: id(10),
        inviteId: id(11),
        relatedInviteIds: [id(11)],
        sessionId: null,
        guestSessionId: id(12),
        requestId: null,
        details: {
          status: 'available',
          before: null,
          after: { state: 'ready' },
        },
      }).success,
    ).toBe(true);
  });

  it('accepts opaque Owner session IDs through the auth-supported 512-character limit', () => {
    expect(
      ownerHistoryEventSchema.safeParse({
        ...event,
        sessionId: 's'.repeat(512),
        requestId: 'r'.repeat(256),
        guestSessionId: id(12),
      }).success,
    ).toBe(true);
    expect(
      ownerHistoryEventSchema.safeParse({
        ...event,
        sessionId: 's'.repeat(513),
      }).success,
    ).toBe(false);
  });

  it('rejects unknown event fields, malformed actors, timestamps, and action names', () => {
    const invalidEvents = [
      { ...event, ownerId: id(20) },
      { ...event, relatedInviteIds: [id(22), id(22)] },
      {
        ...event,
        relatedInviteIds: Array.from({ length: 25 }, (_, index) =>
          id(index + 30),
        ),
      },
      { ...event, inviteId: id(23) },
      { ...event, actor: { ...event.actor, guestId: id(21) } },
      { ...event, actor: { type: 'service', id: id(2), label: 'System' } },
      { ...event, actor: { type: 'user', id: 'bad', label: 'Owner' } },
      { ...event, actor: { type: 'guest', id: id(2), label: '' } },
      { ...event, workspaceId: 'bad' },
      { ...event, albumId: 'bad' },
      { ...event, sessionId: '' },
      { ...event, guestSessionId: 'bad' },
      { ...event, requestId: 'r'.repeat(257) },
      { ...event, eventId: '' },
      { ...event, eventId: 'e'.repeat(513) },
      { ...event, occurredAt: '2026-10-28T10:00:00+00:00' },
      { ...event, action: 'Owner.Updated' },
      { ...event, action: 'owner.updated\n' },
      { ...event, details: { ...event.details, detail: { private: true } } },
    ];

    for (const invalid of invalidEvents)
      expect(ownerHistoryEventSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('Owner history safe JSON details', () => {
  it('requires before and after to be JSON records and omitted or invalid details to be empty', () => {
    expect(
      eventWithDetails({
        status: 'available',
        before: { nested: [{ value: true }, null] },
        after: { count: 1.25 },
      }),
    ).toBe(true);

    for (const invalid of [
      { status: 'available', before: ['not', 'a', 'record'], after: {} },
      { status: 'available', before: 'not a record', after: {} },
      { status: 'available', before: {}, after: Number.NaN },
      { status: 'omitted', before: {}, after: null },
      { status: 'omitted', before: null, after: {} },
      { status: 'invalid', before: null, after: { leak: true } },
      { status: 'unknown', before: null, after: null },
      { status: 'available', before: null, after: null, raw: {} },
    ])
      expect(eventWithDetails(invalid)).toBe(false);

    expect(
      eventWithDetails({ status: 'omitted', before: null, after: null }),
    ).toBe(true);
    expect(
      eventWithDetails({ status: 'invalid', before: null, after: null }),
    ).toBe(true);
  });

  it('bounds depth, object keys, array length, strings, and numeric values', () => {
    expect(
      eventWithDetails({
        status: 'available',
        before: nestedObject(5),
        after: keyedRecord(40),
      }),
    ).toBe(true);
    expect(
      eventWithDetails({
        status: 'available',
        before: nestedObject(6),
        after: {},
      }),
    ).toBe(false);
    expect(
      eventWithDetails({
        status: 'available',
        before: { values: nestedArray(4) },
        after: {},
      }),
    ).toBe(true);
    expect(
      eventWithDetails({
        status: 'available',
        before: { values: nestedArray(5) },
        after: {},
      }),
    ).toBe(false);
    expect(
      eventWithDetails({
        status: 'available',
        before: keyedRecord(41),
        after: {},
      }),
    ).toBe(false);
    expect(
      eventWithDetails({
        status: 'available',
        before: { values: Array.from({ length: 128 }, (_, index) => index) },
        after: {},
      }),
    ).toBe(true);
    expect(
      eventWithDetails({
        status: 'available',
        before: { values: Array.from({ length: 129 }, (_, index) => index) },
        after: {},
      }),
    ).toBe(false);
    expect(
      eventWithDetails({
        status: 'available',
        before: { text: 'x'.repeat(8192) },
        after: {},
      }),
    ).toBe(true);
    expect(
      eventWithDetails({
        status: 'available',
        before: { text: 'x'.repeat(8193) },
        after: {},
      }),
    ).toBe(false);
    expect(
      eventWithDetails({
        status: 'available',
        before: { value: Number.POSITIVE_INFINITY },
        after: {},
      }),
    ).toBe(false);
    expect(
      eventWithDetails({
        status: 'available',
        before: { value: Number.NEGATIVE_INFINITY },
        after: {},
      }),
    ).toBe(false);
  });
});

describe('Owner history pages and export requests', () => {
  it('caps pages at 24 items and bounds cursor and snapshot tokens', () => {
    const page = {
      ownerId: id(1),
      workspaceId: id(2),
      snapshotToken: 'snapshot-01',
      items: [event],
      nextCursor: null,
    };

    expect(ownerHistoryPageSchema.safeParse(page).success).toBe(true);
    expect(
      ownerHistoryPageSchema.safeParse({
        ...page,
        snapshotToken: 's'.repeat(8192),
        nextCursor: 'c'.repeat(8192),
        items: Array.from({ length: 24 }, (_, index) => ({
          ...event,
          eventId: 'event-' + index,
        })),
      }).success,
    ).toBe(true);

    const tooManyItems = Array.from({ length: 25 }, (_, index) => ({
      ...event,
      eventId: 'event-' + index,
    }));
    for (const invalid of [
      { ...page, ownerId: 'bad' },
      { ...page, workspaceId: 'bad' },
      { ...page, snapshotToken: '' },
      { ...page, snapshotToken: 's'.repeat(8193) },
      { ...page, nextCursor: '' },
      { ...page, nextCursor: 'c'.repeat(8193) },
      { ...page, items: tooManyItems },
      { ...page, extra: true },
    ])
      expect(ownerHistoryPageSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts CSV and JSON export requests without replay IDs or secret fields', () => {
    expect(
      ownerHistoryExportRequestSchema.parse({
        expectedOwnerId: id(1),
        snapshotToken: 'snapshot-01',
        format: 'csv',
      }),
    ).toEqual({
      expectedOwnerId: id(1),
      snapshotToken: 'snapshot-01',
      format: 'csv',
    });
    expect(
      ownerHistoryExportRequestSchema.safeParse({
        expectedOwnerId: id(1),
        snapshotToken: 'snapshot-01',
        format: 'json',
      }).success,
    ).toBe(true);

    for (const invalid of [
      {
        expectedOwnerId: id(1),
        snapshotToken: '',
        format: 'csv',
      },
      {
        expectedOwnerId: 'bad',
        snapshotToken: 'snapshot-01',
        format: 'csv',
      },
      {
        expectedOwnerId: id(1),
        snapshotToken: 's'.repeat(8193),
        format: 'csv',
      },
      {
        expectedOwnerId: id(1),
        snapshotToken: 'snapshot-01',
        format: 'xml',
      },
      {
        expectedOwnerId: id(1),
        snapshotToken: 'snapshot-01',
        format: 'csv',
        requestId: id(2),
      },
      {
        expectedOwnerId: id(1),
        snapshotToken: 'snapshot-01',
        format: 'csv',
        ownerSecret: 'must not pass',
      },
      {
        expectedOwnerId: id(1),
        snapshotToken: 'snapshot-01',
        format: 'csv',
        actorId: id(3),
      },
    ])
      expect(ownerHistoryExportRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
  });
});
