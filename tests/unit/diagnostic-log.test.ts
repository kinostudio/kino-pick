import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diagnosticError,
  diagnosticRoute,
  logUnhandledRouteError,
} from '../../apps/worker/src/diagnostic-log';

describe('unhandled route error diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('masks identifiers and drops query strings from the route', () => {
    expect(
      diagnosticRoute(
        'get',
        'https://pick.invalid/api/guest/photos/0E807C65-8A8F-4AD3-9B1A-22EE060981ED/versions/344324de-caf9-4832-9dd5-b6fd06ea1fc0/assets/thumbnail?token=abc#password=1',
      ),
    ).toBe('GET /api/guest/photos/:id/versions/:id/assets/thumbnail');
    expect(diagnosticRoute('GET', 'not a url')).toBe('unknown');
  });

  it('keeps only a bounded, redacted first line of the error', () => {
    const error = new Error(
      'D1_ERROR: overloaded for a5f6bbfd07da26a9949e2838ecd596647d57de8c owner@example.com 203.0.113.5\nSELECT secret_hash',
    );
    expect(diagnosticError(error)).toEqual({
      errorName: 'Error',
      errorMessage: 'D1_ERROR: overloaded for :hex :email :ip',
    });
    expect(
      diagnosticError(new Error('x'.repeat(500))).errorMessage,
    ).toHaveLength(160);
    expect(diagnosticError('raw string')).toEqual({
      errorName: 'string',
      errorMessage: '',
    });
  });

  it('never writes request headers or cookies', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new Request(
      'https://pick.invalid/api/guest/albums/x/access',
      {
        headers: {
          Cookie: 'kino_guest=supersecretvalue',
          'CF-Connecting-IP': '198.51.100.7',
        },
      },
    );
    logUnhandledRouteError('app', new TypeError('boom'), request);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line.startsWith('KINO_UNHANDLED_ROUTE_ERROR ')).toBe(true);
    expect(
      JSON.parse(line.slice('KINO_UNHANDLED_ROUTE_ERROR '.length)),
    ).toEqual({
      scope: 'app',
      route: 'GET /api/guest/albums/x/access',
      errorName: 'TypeError',
      errorMessage: 'boom',
    });
    expect(line).not.toContain('supersecretvalue');
    expect(line).not.toContain('198.51.100.7');
  });
});
