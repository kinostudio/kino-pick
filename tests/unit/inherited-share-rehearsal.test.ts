import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('inherited share 0069 rehearsal self-test', () => {
  it('runs the local synthetic 67-to-69 rehearsal without remote operations', () => {
    const workerDirectory = resolve('apps/worker');
    const result = spawnSync(
      process.execPath,
      [
        'tools/rehearse-approved-deliveries.mjs',
        '--local-self-test',
        '--schema=69',
      ],
      {
        cwd: workerDirectory,
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const proof = JSON.parse(result.stdout.trim()) as {
      status?: string;
      checks?: unknown[];
    };
    expect(proof.status).toBe('passed_local_inherited_share_rehearsal');
    expect(Array.isArray(proof.checks) && proof.checks.length).toBeGreaterThan(
      0,
    );
  }, 125_000);
});
