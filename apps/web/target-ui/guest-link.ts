import { guestLoginPasswordSchema } from '../../../packages/contracts/src/guest-access';

export type GuestEntryCredential = {
  token: string | null;
  invalid: boolean;
  password?: string;
};

export function parseGuestEntryFragment(
  fragment: string,
): GuestEntryCredential {
  if (!fragment) return { token: null, invalid: false };
  const match = /^#token=([a-f0-9]{64})(?:&password=([^&]+))?$/.exec(fragment);
  if (!match?.[1]) return { token: null, invalid: true };
  if (match[2] === undefined) return { token: match[1], invalid: false };
  try {
    const password = decodeURIComponent(match[2]);
    if (!guestLoginPasswordSchema.safeParse(password).success)
      return { token: null, invalid: true };
    return { token: match[1], invalid: false, password };
  } catch {
    return { token: null, invalid: true };
  }
}

export function appendGuestLinkPassword(url: string, password: string): string {
  const parsed = new URL(url);
  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    !/^\/guest\/albums\/[^/]+\/enter$/.test(parsed.pathname) ||
    !/^#token=[a-f0-9]{64}$/.test(parsed.hash)
  )
    throw new Error('INVALID_SHARE_LINK');
  guestLoginPasswordSchema.parse(password);
  parsed.hash += '&password=' + encodeURIComponent(password);
  return parsed.href;
}
