import { describe, expect, it, vi } from 'vitest';
import {
  envFingerprint,
  memoizeByEnv,
  type WorkerEnv,
} from '../../apps/worker/src/config';

const env = (extra: Record<string, unknown> = {}) =>
  ({ APP_ENV: 'local', DB: {}, ...extra }) as unknown as WorkerEnv;

describe('per-isolate env memoization', () => {
  it('reuses the built value for the same unchanged env', () => {
    const build = vi.fn(() => ({ built: true }));
    const memo = memoizeByEnv(build);
    const value = env();
    expect(memo(value)).toBe(memo(value));
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when a string setting changes on the same env object', () => {
    const build = vi.fn((e: WorkerEnv) => (e as unknown as { F: string }).F);
    const memo = memoizeByEnv(build);
    const value = env({ F: 'false' }) as unknown as Record<string, unknown>;
    expect(memo(value as unknown as WorkerEnv)).toBe('false');
    value.F = 'true';
    expect(memo(value as unknown as WorkerEnv)).toBe('true');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when a binding is replaced and for distinct env objects', () => {
    const build = vi.fn(() => ({}));
    const memo = memoizeByEnv(build);
    const value = env() as unknown as Record<string, unknown>;
    const first = memo(value as unknown as WorkerEnv);
    value.DB = {};
    expect(memo(value as unknown as WorkerEnv)).not.toBe(first);
    memo(env());
    expect(build).toHaveBeenCalledTimes(3);
  });

  it('never caches failures', () => {
    let fail = true;
    const memo = memoizeByEnv(() => {
      if (fail) throw new Error('INVALID');
      return 'ok';
    });
    const value = env();
    expect(() => memo(value)).toThrow('INVALID');
    expect(() => memo(value)).toThrow('INVALID');
    fail = false;
    expect(memo(value)).toBe('ok');
  });

  it('fingerprints binding identity without reading binding contents', () => {
    const db = {};
    expect(envFingerprint({ A: 'x', DB: db })).toBe(
      envFingerprint({ DB: db, A: 'x' }),
    );
    expect(envFingerprint({ A: 'x', DB: db })).not.toBe(
      envFingerprint({ A: 'x', DB: {} }),
    );
  });
});
