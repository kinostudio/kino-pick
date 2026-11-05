import { describe, expect, it } from 'vitest';
import {
  appendGuestLinkPassword,
  parseGuestEntryFragment,
} from '../../apps/web/target-ui/guest-link';

describe('password-inclusive share fragments', () => {
  const token = 'a'.repeat(64);
  const base =
    'https://pick.example/guest/albums/00000000-0000-4000-8000-000000000001/enter#token=' +
    token;
  it('keeps token-only links compatible and round-trips five digits including zeroes', () => {
    expect(parseGuestEntryFragment('#token=' + token)).toEqual({
      token,
      invalid: false,
    });
    const link = appendGuestLinkPassword(base, '00007');
    expect(new URL(link).search).toBe('');
    expect(parseGuestEntryFragment(new URL(link).hash)).toEqual({
      token,
      invalid: false,
      password: '00007',
    });
  });
  it('encodes custom password delimiters without creating additional fields', () => {
    const password = '原樣空白 & # + 📷 密碼';
    const link = appendGuestLinkPassword(base, password);
    expect(parseGuestEntryFragment(new URL(link).hash)).toEqual({
      token,
      invalid: false,
      password,
    });
  });
  it('rejects ambiguous, unknown, malformed or invalid password fragments', () => {
    for (const hash of [
      '#token=' + token + '&token=' + token,
      '#token=' + token + '&password=00007&password=12345',
      '#token=' + token + '&x=1',
      '#token=' + token + '&password=%E0%A4%A',
      '#token=' + token + '&password=1234',
      '#token=' + token + '&password=',
      '#password=00007&token=' + token,
    ])
      expect(parseGuestEntryFragment(hash)).toEqual({
        token: null,
        invalid: true,
      });
    expect(() => appendGuestLinkPassword(base + '&other=1', '12345')).toThrow();
    expect(() =>
      appendGuestLinkPassword(
        base.replace('/enter#', '/enter?password=00007#'),
        '12345',
      ),
    ).toThrow();
  });
});
