import { expect, test, vi } from 'vitest';
import { consumeImageProcessingQueue } from '../../apps/worker/src/cloudflare-processing';
import type { WorkerEnv } from '../../apps/worker/src/config';

const input = {
  workspaceId: 'c6e7896a-5bfb-44b9-8f11-c83d00642135',
  jobId: 'f3b4bb8c-a41c-4dfb-a839-6430c84163e9',
};

test('queued delivery defers to an active browser lease and a completed duplicate stops', async () => {
  const first = vi
    .fn()
    .mockResolvedValueOnce({
      status: 'running',
      lease_until_ms: Date.now() + 15_000,
    })
    .mockResolvedValueOnce({ status: 'succeeded', lease_until_ms: null });
  const bind = vi.fn(() => ({ first }));
  const env = { DB: { prepare: () => ({ bind }) } } as unknown as WorkerEnv;
  const message = { body: input, attempts: 1, ack: vi.fn(), retry: vi.fn() };
  const batch = { messages: [message] } as unknown as MessageBatch<unknown>;
  await consumeImageProcessingQueue(batch, env);
  expect(bind).toHaveBeenCalledWith(input.jobId, input.workspaceId);
  expect(message.retry).toHaveBeenCalledWith({
    delaySeconds: expect.any(Number),
  });
  const delay = message.retry.mock.calls[0]?.[0].delaySeconds;
  expect(delay).toBeGreaterThanOrEqual(15);
  expect(delay).toBeLessThanOrEqual(16);
  expect(message.ack).not.toHaveBeenCalled();
  await consumeImageProcessingQueue(batch, env);
  expect(message.retry).toHaveBeenCalledTimes(1);
  expect(message.ack).toHaveBeenCalledTimes(1);
});
