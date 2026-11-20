import { expect, test, vi } from 'vitest';
import type { WorkerEnv } from '../../apps/worker/src/config';
import { consumeImageProcessingQueue } from '../../apps/worker/src/cloudflare-processing';
import { expireRecentReservations } from '../../apps/worker/src/uploads';

test('interactive expiry scans only the recent range or the exact upload', async () => {
  const run = vi.fn();
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  const db = { prepare } as unknown as D1Database;
  const now = 7_200_000;

  await expireRecentReservations(db, now);
  expect(prepare).toHaveBeenCalledWith(
    expect.stringContaining('expires_at_ms>?'),
  );
  expect(bind).toHaveBeenLastCalledWith(now, now, 3_600_000);

  await expireRecentReservations(db, now, 'specific-upload');
  expect(prepare).toHaveBeenLastCalledWith(expect.stringContaining('AND id=?'));
  expect(bind).toHaveBeenLastCalledWith(now, now, 'specific-upload');
  expect(run).toHaveBeenCalledTimes(2);
});

test.each([
  { workspaceId: crypto.randomUUID(), jobId: crypto.randomUUID() },
  { kind: 'original', actorId: 'owner', uploadSessionId: crypto.randomUUID() },
])(
  'the queue retries D1 overload for both job and completion messages',
  async (body) => {
    const retry = vi.fn();
    const ack = vi.fn();
    const batch = {
      messages: [
        {
          body,
          retry,
          ack,
        },
      ],
    } as unknown as MessageBatch<unknown>;
    const first = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window.',
        ),
      );
    const env = {
      DB: { prepare: () => ({ bind: () => ({ first }) }) },
    } as unknown as WorkerEnv;

    await consumeImageProcessingQueue(batch, env);

    expect(first).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 12 });
    expect(ack).not.toHaveBeenCalled();
  },
);
