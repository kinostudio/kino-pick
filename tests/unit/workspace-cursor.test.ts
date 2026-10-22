import { it, expect } from 'vitest';
import {
  encodeWorkspaceCursor,
  decodeWorkspaceCursor,
} from '../../packages/db/src/workspace-cursor';
it('round-trips opaque cursors without losing PostgreSQL timestamp microseconds', () => {
  const value = {
    createdAt: '2026-10-23T12:00:00.123456Z',
    id: '11111111-1111-4111-8111-111111111111',
  };
  expect(decodeWorkspaceCursor(encodeWorkspaceCursor(value))).toEqual(value);
  expect(decodeWorkspaceCursor()).toBeNull();
});
it('rejects malformed cursors and filter injection', () => {
  for (const value of [
    '',
    '?invalid',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        createdAt: 'x),id.neq.any',
        id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toString('base64url'),
  ])
    expect(() => decodeWorkspaceCursor(value)).toThrow();
});
