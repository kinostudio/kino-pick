import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boundAssetStream,
  captureAssetStreamDeadline,
} from '../../apps/worker/src/bounded-asset-stream';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bounded asset streams', () => {
  it('returns the original stream when protection is off', () => {
    const source = new ReadableStream<Uint8Array>();

    expect(boundAssetStream(source, null)).toBe(source);
    expect(source.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves bytes, waits for demand, and releases the source at EOF', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const bounded = boundAssetStream(source, captureAssetStreamDeadline());

    const reader = bounded.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: new Uint8Array([1, 2, 3]),
    });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    expect(source.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a pending read at the ten minute deadline and cancels the source', async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    const bounded = boundAssetStream(source, captureAssetStreamDeadline());
    const reader = bounded.getReader();
    const pendingRead = reader.read();
    const pendingFailure = expect(pendingRead).rejects.toMatchObject({
      message: 'ASSET_STREAM_EXPIRED',
    });

    await vi.advanceTimersByTimeAsync(600_000);
    await pendingFailure;

    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait for a hanging source cancellation when the consumer cancels', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const pull = vi.fn();
    const source = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    const bounded = boundAssetStream(source, captureAssetStreamDeadline());
    expect(pull).not.toHaveBeenCalled();
    const reader = bounded.getReader();
    const pendingRead = reader.read();
    const pendingFailure = expect(pendingRead).resolves.toMatchObject({
      done: true,
    });
    await Promise.resolve();
    expect(pull).toHaveBeenCalledOnce();

    await expect(reader.cancel()).resolves.toBeUndefined();
    await pendingFailure;

    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['forward clock gap', 'clock rollback'])(
    'fails closed and interrupts a pending read on a %s',
    async (change) => {
      const deadline = captureAssetStreamDeadline();
      const cancel = vi.fn();
      const source = new ReadableStream<Uint8Array>({ cancel });
      const bounded = boundAssetStream(source, deadline);
      const pendingRead = bounded.getReader().read();
      const pendingFailure = expect(pendingRead).rejects.toMatchObject({
        message: 'ASSET_STREAM_CLOCK_INVALID',
      });

      vi.setSystemTime(
        deadline.startedAtWall +
          (change === 'forward clock gap' ? 2_001 : -2_001),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await pendingFailure;

      expect(cancel).toHaveBeenCalledOnce();
      expect(source.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not read an already expired source', async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    const deadline = captureAssetStreamDeadline();
    await vi.advanceTimersByTimeAsync(600_001);
    const bounded = boundAssetStream(source, deadline);

    await expect(bounded.getReader().read()).rejects.toMatchObject({
      message: 'ASSET_STREAM_EXPIRED',
    });

    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed for a non-finite deadline without reading the source', async () => {
    const pull = vi.fn();
    const source = new ReadableStream<Uint8Array>(
      { pull },
      { highWaterMark: 0 },
    );
    const bounded = boundAssetStream(source, {
      startedAtWall: Number.NaN,
      startedAtPerformance: performance.now(),
    });

    await expect(bounded.getReader().read()).rejects.toMatchObject({
      message: 'ASSET_STREAM_CLOCK_INVALID',
    });

    expect(pull).not.toHaveBeenCalled();
    expect(source.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides source errors and clears the deadline timer', async () => {
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('secret URL and object key'));
      },
    });
    const bounded = boundAssetStream(source, captureAssetStreamDeadline());

    await expect(bounded.getReader().read()).rejects.toMatchObject({
      message: 'ASSET_STREAM_FAILED',
    });

    expect(source.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
