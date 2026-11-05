import { describe, expect, it } from 'vitest';
import {
  clientAlbumBrowserDigest,
  issueClientBrowserIdentity,
  readClientBrowserIdentity,
} from '../../apps/worker/src/client-browser-identity';

const secret = 'client-browser-identity-secret-for-tests';

function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0]!;
}

describe('client browser identity', () => {
  it('issues independent random identities and secure host cookies', async () => {
    const first = await issueClientBrowserIdentity(secret, true);
    const second = await issueClientBrowserIdentity(secret, true);
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    expect(second.token).not.toBe(first.token);
    expect(first.cookie).toMatch(
      /^__Host-kino_browser=[a-f0-9]{64}\.[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=31536000; Secure$/,
    );
    await expect(
      readClientBrowserIdentity(cookiePair(first.cookie), secret, true),
    ).resolves.toBe(first.token);
  });

  it('uses the local cookie name without Secure outside HTTPS', async () => {
    const identity = await issueClientBrowserIdentity(secret, false);
    expect(identity.cookie).toMatch(
      /^kino_browser=[a-f0-9]{64}\.[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=31536000$/,
    );
    await expect(
      readClientBrowserIdentity(cookiePair(identity.cookie), secret, false),
    ).resolves.toBe(identity.token);
    await expect(
      readClientBrowserIdentity(cookiePair(identity.cookie), secret, true),
    ).resolves.toBeNull();
  });

  it('rejects wrong secrets, bad signatures, duplicates and malformed cookies', async () => {
    const identity = await issueClientBrowserIdentity(secret, false);
    const pair = cookiePair(identity.cookie);
    const [name, value] = pair.split('=') as [string, string];
    const [nonce, signature] = value.split('.');
    const changedSignature =
      signature!.slice(0, -1) + (signature!.endsWith('0') ? '1' : '0');

    await expect(
      readClientBrowserIdentity(pair, secret + 'wrong', false),
    ).resolves.toBeNull();
    await expect(
      readClientBrowserIdentity(
        `${name}=${nonce}.${changedSignature}`,
        secret,
        false,
      ),
    ).resolves.toBeNull();
    await expect(
      readClientBrowserIdentity(`${pair}; ${pair}`, secret, false),
    ).resolves.toBeNull();
    await expect(
      readClientBrowserIdentity(`${name}=%${value}`, secret, false),
    ).resolves.toBeNull();
    await expect(
      readClientBrowserIdentity('kino_browser', secret, false),
    ).resolves.toBeNull();
    await expect(
      readClientBrowserIdentity('x='.padEnd(8_193, 'a'), secret, false),
    ).resolves.toBeNull();
  });

  it('derives a secret, album-scoped digest from only a random token', async () => {
    const identity = await issueClientBrowserIdentity(secret, false);
    const firstAlbum = crypto.randomUUID();
    const secondAlbum = crypto.randomUUID();
    const first = await clientAlbumBrowserDigest(
      identity.token,
      firstAlbum,
      secret,
    );
    await expect(
      clientAlbumBrowserDigest(identity.token, firstAlbum, secret),
    ).resolves.toBe(first);
    expect(first).not.toBe(
      await clientAlbumBrowserDigest(identity.token, secondAlbum, secret),
    );
    expect(first).not.toBe(
      await clientAlbumBrowserDigest(
        (await issueClientBrowserIdentity(secret, false)).token,
        firstAlbum,
        secret,
      ),
    );
    await expect(
      clientAlbumBrowserDigest(identity.token, 'not-a-uuid', secret),
    ).rejects.toThrow('INVALID_ALBUM_ID');
    await expect(
      clientAlbumBrowserDigest('not-a-token', firstAlbum, secret),
    ).rejects.toThrow('INVALID_CLIENT_BROWSER_IDENTITY');
  });
});
