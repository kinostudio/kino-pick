import { expect, it, vi } from 'vitest';
import { withOwnerKdfPermit } from '../../apps/worker/src/kdf-permits';

const context = { actor: 'owner', session: 'session', requestId: 'request' };
function fixture(
  acquire: 'unknown' | 'confirmed',
  release: 'unknown' | 'confirmed',
) {
  const calls: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(id: string) {
          return {
            async all() {
              const acquiring = sql.includes('INSERT INTO kdf_permits(');
              calls.push(acquiring ? 'acquire' : 'release');
              const confirmed = (acquiring ? acquire : release) === 'confirmed';
              return {
                success: true,
                meta: { changes: confirmed ? 1 : 0 },
                results: confirmed
                  ? [acquiring ? { id } : { permit_id: id }]
                  : [],
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}
it('ambiguous acquisition never runs work or attempts release', async () => {
  const { db, calls } = fixture('unknown', 'confirmed');
  const work = vi.fn(async () => 'secret');
  await expect(withOwnerKdfPermit(db, context, work)).rejects.toThrow(
    'KDF_CAPACITY_UNAVAILABLE',
  );
  expect(work).not.toHaveBeenCalled();
  expect(calls).toEqual(['acquire']);
});
it('unconfirmed release never returns the successful KDF result', async () => {
  const { db, calls } = fixture('confirmed', 'unknown');
  await expect(
    withOwnerKdfPermit(db, context, async () => 'secret'),
  ).rejects.toThrow('KDF_RELEASE_UNAVAILABLE');
  expect(calls).toEqual(['acquire', 'release']);
});
it('release waits for the original work to settle and still runs after failure', async () => {
  const { db, calls } = fixture('confirmed', 'confirmed');
  let settle!: () => void;
  const waiting = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const work = vi.fn(async () => {
    await waiting;
    throw new Error('WORK_FAILED');
  });
  const result = withOwnerKdfPermit(db, context, work);
  await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());
  expect(calls).toEqual(['acquire']);
  const assertion = expect(result).rejects.toThrow('WORK_FAILED');
  settle();
  await assertion;
  expect(calls).toEqual(['acquire', 'release']);
});
