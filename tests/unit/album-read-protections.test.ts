import { describe, expect, it } from 'vitest';
import { D1AlbumReadProtections } from '../../apps/worker/src/album-read-protections';

const scope = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  project_id: '22222222-2222-4222-8222-222222222222',
  album_id: '33333333-3333-4333-8333-333333333333',
};

function row(overrides: Record<string, unknown> = {}) {
  const now = 1_800_000_000_000;
  return {
    ...scope,
    renewed_at_ms: now,
    protected_until_ms: now + 900_000,
    revision: 0,
    db_now_ms: now,
    scope_valid: 1,
    ...overrides,
  };
}

function fakeDb(
  selected: unknown,
  options: {
    fail?: boolean;
    missing?: boolean;
    success?: boolean;
    resultCount?: number;
  } = {},
) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return { sql, values };
        },
      };
    },
    async batch() {
      if (options.fail) throw new Error('private database detail');
      return Array.from({ length: options.resultCount ?? 3 }, (_, index) => ({
        success: options.success ?? true,
        results: index === 2 && selected ? [selected] : [],
      }));
    },
  };
  return {
    db: (options.missing ? undefined : db) as unknown as D1Database,
    statements,
  };
}

describe('album read protections', () => {
  it('uses one atomic update, insert-if-missing, and scoped read batch', async () => {
    const { db, statements } = fakeDb(row());
    const result = await new D1AlbumReadProtections(db).acquire(scope);
    expect(result).toEqual({
      protectedUntilMs: 1_800_000_900_000,
      revision: 0,
    });
    expect(statements).toHaveLength(3);
    expect(statements.map(({ sql }) => sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('UPDATE album_read_protections'),
        expect.stringContaining('INSERT INTO album_read_protections'),
        expect.stringContaining(
          "CAST(unixepoch('subsec')*1000 AS INTEGER) AS db_now_ms",
        ),
      ]),
    );
    expect(
      statements.every(
        ({ sql }) => !/audit_events|human_photo_views/i.test(sql),
      ),
    ).toBe(true);
  });

  it('accepts a suppressed renewal within the one-second batch-clock margin', async () => {
    const now = 1_800_000_000_000;
    const { db } = fakeDb(
      row({
        renewed_at_ms: now - 30_000,
        protected_until_ms: now + 870_000,
        revision: 4,
        db_now_ms: now,
      }),
    );
    await expect(
      new D1AlbumReadProtections(db).acquire(scope),
    ).resolves.toEqual({
      protectedUntilMs: now + 870_000,
      revision: 4,
    });

    const shortLease = fakeDb(
      row({
        renewed_at_ms: now - 30_000,
        protected_until_ms: now + 839_999,
        revision: 4,
        db_now_ms: now,
      }),
    );
    await expect(
      new D1AlbumReadProtections(shortLease.db).acquire(scope),
    ).rejects.toMatchObject({
      code: 'ALBUM_READ_PROTECTION_UNAVAILABLE',
      status: 503,
    });

    const boundary = fakeDb(
      row({
        renewed_at_ms: now - 61_000,
        protected_until_ms: now + 839_000,
        revision: 4,
        db_now_ms: now,
      }),
    );
    await expect(
      new D1AlbumReadProtections(boundary.db).acquire(scope),
    ).resolves.toEqual({ protectedUntilMs: now + 839_000, revision: 4 });
  });

  it.each([
    [
      'scope mismatch',
      row({ project_id: '44444444-4444-4444-8444-444444444444' }),
    ],
    ['invalid scope witness', row({ scope_valid: 0 })],
    [
      'clock moved backward',
      row({
        renewed_at_ms: 1_800_000_000_001,
        protected_until_ms: 1_800_000_900_001,
      }),
    ],
    ['corrupt TTL', row({ protected_until_ms: 1_800_001_000_000 })],
    ['unsafe integer', row({ revision: Number.MAX_SAFE_INTEGER + 1 })],
    ['missing result', null],
  ])('fails closed on %s', async (_label, selected) => {
    const { db } = fakeDb(selected);
    await expect(
      new D1AlbumReadProtections(db).acquire(scope),
    ).rejects.toMatchObject({
      code: 'ALBUM_READ_PROTECTION_UNAVAILABLE',
      status: 503,
    });
  });

  it('maps missing bindings, invalid trusted scope, and database errors to 503 without leaking detail', async () => {
    const missing = fakeDb(row(), { missing: true });
    const repository = new D1AlbumReadProtections(missing.db);
    await expect(repository.acquire(scope)).rejects.toMatchObject({
      code: 'ALBUM_READ_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    await expect(
      new D1AlbumReadProtections(fakeDb(row()).db).acquire({
        ...scope,
        album_id: '',
      }),
    ).rejects.toMatchObject({ code: 'ALBUM_READ_PROTECTION_UNAVAILABLE' });
    const scopeWithActor = { ...scope, actor_id: 'must-not-be-bound' };
    await expect(
      new D1AlbumReadProtections(fakeDb(row()).db).acquire(scopeWithActor),
    ).rejects.toMatchObject({ code: 'ALBUM_READ_PROTECTION_UNAVAILABLE' });

    const failed = fakeDb(row(), { fail: true });
    await expect(
      new D1AlbumReadProtections(failed.db).acquire(scope),
    ).rejects.toMatchObject({
      code: 'ALBUM_READ_PROTECTION_UNAVAILABLE',
      status: 503,
      message: 'ALBUM_READ_PROTECTION_UNAVAILABLE',
    });

    for (const invalidBatch of [
      fakeDb(row(), { success: false }).db,
      fakeDb(row(), { resultCount: 2 }).db,
    ]) {
      await expect(
        new D1AlbumReadProtections(invalidBatch).acquire(scope),
      ).rejects.toMatchObject({ code: 'ALBUM_READ_PROTECTION_UNAVAILABLE' });
    }
  });
});
