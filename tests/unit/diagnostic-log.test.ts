import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diagnosticClass,
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
      errorMessage: 'D1_ERROR/OVERLOADED',
    });
    expect(
      diagnosticError(new Error('password=12345 token=unredacted-secret'))
        .errorMessage,
    ).toBe('UNCLASSIFIED');
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
      errorMessage: 'UNCLASSIFIED',
      errorClass: 'TypeError',
    });
    expect(line).not.toContain('supersecretvalue');
    expect(line).not.toContain('198.51.100.7');
  });
});

it.each([
  ['Too many resources consumed within a 10 second window', 'RESOURCE_LIMIT'],
  ['overloaded', 'OVERLOADED'],
  ['network connection lost', 'NETWORK_LOST'],
  ['timeout', 'TIMEOUT'],
  ['timed out', 'TIMEOUT'],
  ['password=12345 token=secret', 'OTHER'],
])(
  'classifies D1 failures without copying their message: %s',
  (message, category) => {
    expect(
      diagnosticError(new Error('D1_ERROR: ' + message)).errorMessage,
    ).toBe('D1_ERROR/' + category);
  },
);

describe('wrapped error diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('classifies a D1 failure wrapped by a library without copying text', () => {
    class DrizzleQueryError extends Error {}
    const wrapped = new DrizzleQueryError(
      'Failed query: select * from owner_sessions where token = ? params: secret-token',
      {
        cause: new Error(
          'D1_ERROR: Too many resources consumed within a 10 second window',
        ),
      },
    );
    expect(diagnosticError(wrapped)).toEqual({
      errorName: 'Error',
      errorMessage: 'CAUSE_D1_ERROR/RESOURCE_LIMIT',
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logUnhandledRouteError('app', wrapped);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(
      JSON.parse(line.slice('KINO_UNHANDLED_ROUTE_ERROR '.length)),
    ).toEqual({
      scope: 'app',
      route: null,
      errorName: 'Error',
      errorMessage: 'CAUSE_D1_ERROR/RESOURCE_LIMIT',
      errorClass: 'DrizzleQueryError',
      causeClass: 'Error',
    });
    expect(line).not.toContain('secret-token');
    expect(line).not.toContain('owner_sessions');
  });

  it('keeps unknown causes unclassified and masks unsafe class names', () => {
    const error = new Error('boom', { cause: new Error('still boom') });
    expect(diagnosticError(error).errorMessage).toBe('UNCLASSIFIED');
    const odd = new Error('x');
    Object.defineProperty(odd, 'constructor', {
      value: { name: 'name with spaces <script>' },
    });
    expect(diagnosticClass(odd)).toBe('Unknown');
    expect(diagnosticClass('text')).toBe('string');
  });
});
