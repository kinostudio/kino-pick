import { describe, it, expect } from 'vitest';
import {
  createWorkspaceSchema,
  workspaceSchema,
} from '../../packages/contracts/src/identity';
const id = '11111111-1111-4111-8111-111111111111';
const response = {
  id,
  ownerUserId: id,
  role: 'workspace_owner',
  createdAt: '2026-10-23T12:00:00.000000Z',
  quotaBytes: 8000000000,
};
describe('workspace Unicode name contracts', () => {
  it('accepts 120 astral characters in both API input and response and rejects 121', () => {
    const valid = '😀'.repeat(120);
    expect(
      createWorkspaceSchema.parse({ name: valid, requestId: id }).name,
    ).toBe(valid);
    expect(workspaceSchema.parse({ ...response, name: valid }).name).toBe(
      valid,
    );
    const invalid = '😀'.repeat(121);
    expect(
      createWorkspaceSchema.safeParse({ name: invalid, requestId: id }).success,
    ).toBe(false);
    expect(
      workspaceSchema.safeParse({ ...response, name: invalid }).success,
    ).toBe(false);
  });
  it('trims the same Unicode whitespace for input and response', () => {
    const name = '\u00a0\t\ufeff Studio \u3000\u2029';
    expect(createWorkspaceSchema.parse({ name, requestId: id }).name).toBe(
      'Studio',
    );
    expect(workspaceSchema.parse({ ...response, name }).name).toBe('Studio');
  });
  it('rejects invisible whitespace-only workspace names', () => {
    const name =
      '\t\n\r\v\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
    expect(
      createWorkspaceSchema.safeParse({ name, requestId: id }).success,
    ).toBe(false);
    expect(workspaceSchema.safeParse({ ...response, name }).success).toBe(
      false,
    );
  });
});
