import { describe, expect, it } from 'vitest';
import { clientActivityIp } from '../../apps/worker/src/client-ip';

describe('client activity IP trust boundary', () => {
  it('rejects local, non-edge and Worker-supplied headers', () => {
    const request = new Request('https://pick.invalid', {
      headers: {
        'CF-Connecting-IP': '203.0.113.5',
        'X-Forwarded-For': '198.51.100.4',
      },
    });
    expect(clientActivityIp(request, false)).toBeNull();
    Object.defineProperty(request, 'cf', { value: { colo: 'TPE' } });
    expect(clientActivityIp(request, true)).toBeNull();
    expect(clientActivityIp(request, false)).toBe('203.0.113.5');
    request.headers.set('CF-Worker', 'untrusted.example');
    expect(clientActivityIp(request, false)).toBeNull();
  });
  it('accepts edge IPv6 and never falls back to client forwarding headers', () => {
    const request = new Request('https://pick.invalid', {
      headers: {
        'X-Forwarded-For': '203.0.113.5',
        'CF-Connecting-IPv6': '2001:db8::9',
      },
    });
    Object.defineProperty(request, 'cf', { value: { colo: 'TPE' } });
    expect(clientActivityIp(request, false)).toBeNull();
    request.headers.set('CF-Connecting-IP', 'garbage');
    expect(clientActivityIp(request, false)).toBeNull();
    request.headers.set('CF-Connecting-IP', '2001:db8::1');
    expect(clientActivityIp(request, false)).toBe('2001:db8::1');
  });
});
