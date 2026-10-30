import { describe, expect, it } from 'vitest';
import { canonicalTrustedClientAddress } from '../../apps/worker/src/guest-admission';

describe('trusted Guest admission address normalization', () => {
  it('canonicalizes IPv4/IPv6 and folds IPv4-mapped IPv6 aliases', () => {
    expect(canonicalTrustedClientAddress('198.51.100.7')).toBe('198.51.100.7');
    expect(canonicalTrustedClientAddress('2001:0db8:0:0:0:0:0:1')).toBe(
      '2001:db8::1',
    );
    expect(canonicalTrustedClientAddress('::ffff:c000:207')).toBe('192.0.2.7');
    expect(canonicalTrustedClientAddress('::FFFF:192.0.2.7')).toBe('192.0.2.7');
  });
  it('rejects missing, malformed, ambiguous or scoped network addresses', () => {
    for (const value of [
      undefined,
      null,
      '',
      '198.51.100.999',
      '198.051.100.7',
      '2001:::1',
      'fe80::1%eth0',
      '[::1]',
      '127.0.0.1:80',
    ]) {
      expect(canonicalTrustedClientAddress(value)).toBeNull();
    }
  });
});
