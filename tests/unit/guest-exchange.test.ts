import { describe, expect, it } from 'vitest';
import { guestExchangeRequestSchema } from '../../packages/contracts/src/guest-access';
import {
  guestSelectionRequestSchema,
  guestSelectionSubmissionRequestSchema,
} from '../../packages/contracts/src/guest-actions';
import { configuration, type WorkerEnv } from '../../apps/worker/src/config';

const vars = (overrides: Record<string, unknown> = {}) =>
  ({
    APP_ENV: 'local',
    APP_URL: 'http://127.0.0.1:8787',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    ...overrides,
  }) as unknown as WorkerEnv;

describe('Guest exchange request and deployment gate', () => {
  it('accepts only canonical body fields and trims a bounded display name', () => {
    const parsed = guestExchangeRequestSchema.parse({
      requestId: '22222222-2222-4222-8222-222222222222',
      token: 'a'.repeat(64),
      displayName: '  林 小安  ',
      password: 'exact password bytes',
    });
    expect(parsed.displayName).toBe('林 小安');
    expect(parsed.password).toBe('exact password bytes');
  });

  it('rejects extra fields, noncanonical tokens and unsafe/unbounded names', () => {
    const base = {
      requestId: '22222222-2222-4222-8222-222222222222',
      token: 'a'.repeat(64),
      displayName: 'Visitor',
    };
    for (const value of [
      { ...base, extra: 'ignored fields must not pass' },
      { ...base, token: 'A'.repeat(64) },
      { ...base, displayName: 'x'.repeat(81) },
      { ...base, displayName: `Guest\u202e${'x'.repeat(3)}` },
      { ...base, displayName: '   ' },
      { ...base, password: 'x'.repeat(257) },
    ])
      expect(() => guestExchangeRequestSchema.parse(value)).toThrow();
  });

  it('validates strict Guest selection commands with exact version scope', () => {
    const request = {
      requestId: '22222222-2222-4222-8222-222222222222',
      selected: true,
      versionId: '33333333-3333-4333-8333-333333333333',
    };
    expect(guestSelectionRequestSchema.parse(request)).toEqual(request);
    for (const value of [
      { ...request, extra: 'denied' },
      { ...request, requestId: 'bad' },
      { ...request, versionId: undefined },
      { ...request, selected: 'true' },
    ])
      expect(() => guestSelectionRequestSchema.parse(value)).toThrow();
  });

  it('validates selection submit round/revision guards as an all-or-nothing pair', () => {
    const requestId = '22222222-2222-4222-8222-222222222222';
    expect(guestSelectionSubmissionRequestSchema.parse({ requestId })).toEqual({
      requestId,
    });
    expect(
      guestSelectionSubmissionRequestSchema.parse({
        requestId,
        expectedRoundNo: 2,
        expectedRevision: 7,
      }),
    ).toMatchObject({ expectedRoundNo: 2, expectedRevision: 7 });
    for (const value of [
      { requestId, expectedRoundNo: 1 },
      { requestId, expectedRevision: 0 },
      { requestId, expectedRoundNo: 0, expectedRevision: 0 },
      { requestId, extra: 'denied' },
    ])
      expect(() =>
        guestSelectionSubmissionRequestSchema.parse(value),
      ).toThrow();
  });

  it('defaults exchange off, permits explicit local testing, and rejects hosted enablement', () => {
    expect(configuration(vars()).GUEST_EXCHANGE_ENABLED).toBe('false');
    expect(configuration(vars()).GUEST_SELECTION_ENABLED).toBe('false');
    expect(configuration(vars()).GUEST_FEEDBACK_ENABLED).toBe('false');
    expect(configuration(vars()).GUEST_SHARED_SELECTION_ENABLED).toBe('false');
    expect(
      configuration(vars({ GUEST_SHARED_SELECTION_ENABLED: 'true' }))
        .GUEST_SHARED_SELECTION_ENABLED,
    ).toBe('true');
    for (const APP_ENV of ['staging', 'production'])
      expect(() =>
        configuration(
          vars({
            APP_ENV,
            APP_URL: 'https://kino.example',
            GUEST_SHARED_SELECTION_ENABLED: 'true',
          }),
        ),
      ).toThrow('GUEST_SHARED_SELECTION_LOCAL_ONLY');
    expect(
      configuration(vars({ GUEST_FEEDBACK_ENABLED: 'true' }))
        .GUEST_FEEDBACK_ENABLED,
    ).toBe('true');
    for (const APP_ENV of ['staging', 'production'])
      expect(() =>
        configuration(
          vars({
            APP_ENV,
            APP_URL: 'https://kino.example',
            GUEST_FEEDBACK_ENABLED: 'true',
          }),
        ),
      ).toThrow('GUEST_FEEDBACK_LOCAL_ONLY');

    expect(
      configuration(vars({ GUEST_SELECTION_ENABLED: 'true' }))
        .GUEST_SELECTION_ENABLED,
    ).toBe('true');
    for (const APP_ENV of ['staging', 'production'])
      expect(() =>
        configuration(
          vars({
            APP_ENV,
            APP_URL: 'https://kino.example',
            GUEST_SELECTION_ENABLED: 'true',
          }),
        ),
      ).toThrow('GUEST_SELECTION_LOCAL_ONLY');
    expect(
      configuration(vars({ GUEST_EXCHANGE_ENABLED: 'true' }))
        .GUEST_EXCHANGE_ENABLED,
    ).toBe('true');
    for (const APP_ENV of ['staging', 'production'])
      expect(() =>
        configuration(
          vars({
            APP_ENV,
            APP_URL: 'https://kino.example',
            GUEST_EXCHANGE_ENABLED: 'true',
          }),
        ),
      ).toThrow('GUEST_EXCHANGE_LOCAL_ONLY');
  });
});
