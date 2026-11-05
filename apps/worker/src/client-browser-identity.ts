const encoder = new TextEncoder();
const maxCookieHeaderLength = 8_192;
const cookieNames = ['__Host-kino_browser', 'kino_browser'] as const;
const randomTokenPattern = /^[a-f0-9]{64}$/;
const signedTokenPattern = /^([a-f0-9]{64})\.([a-f0-9]{64})$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const cookieValuePattern = /^[\x21-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

async function hmacKey(secret: string) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('CLIENT_BROWSER_IDENTITY_UNAVAILABLE');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function cookieValue(cookieHeader: string, secure: boolean): string | null {
  if (
    typeof cookieHeader !== 'string' ||
    cookieHeader.length === 0 ||
    cookieHeader.length > maxCookieHeaderLength ||
    /[^\x20-\x7e\t]/.test(cookieHeader)
  )
    return null;

  const expectedName = secure ? cookieNames[0] : cookieNames[1];
  let found: string | null = null;
  for (const part of cookieHeader.split(';')) {
    const pair = part.replace(/^[ \t]+|[ \t]+$/g, '');
    const equals = pair.indexOf('=');
    if (equals < 1) return null;
    const name = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (!cookieNamePattern.test(name) || !cookieValuePattern.test(value))
      return null;
    if (name === cookieNames[0] || name === cookieNames[1]) {
      if (name !== expectedName || found !== null) return null;
      found = value;
    }
  }
  return found;
}

export async function issueClientBrowserIdentity(
  secret: string,
  secure: boolean,
): Promise<{ token: string; cookie: string }> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const key = await hmacKey(secret);
  const signature = toHex(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`kino-pic:client-browser:v1:cookie:${token}`),
      ),
    ),
  );
  const name = secure ? cookieNames[0] : cookieNames[1];
  const cookie =
    `${name}=${token}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` +
    (secure ? '; Secure' : '');
  return { token, cookie };
}

export async function readClientBrowserIdentity(
  cookieHeader: string,
  secret: string,
  secure: boolean,
): Promise<string | null> {
  const value = cookieValue(cookieHeader, secure);
  if (value === null) return null;
  const match = signedTokenPattern.exec(value);
  if (!match) return null;
  const [, token, signature] = match;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    new Uint8Array(fromHex(signature!)),
    encoder.encode(`kino-pic:client-browser:v1:cookie:${token}`),
  );
  return valid ? token! : null;
}

export async function clientAlbumBrowserDigest(
  token: string,
  albumId: string,
  secret: string,
): Promise<string> {
  if (typeof token !== 'string' || !randomTokenPattern.test(token))
    throw new Error('INVALID_CLIENT_BROWSER_IDENTITY');
  if (typeof albumId !== 'string' || !uuidPattern.test(albumId))
    throw new Error('INVALID_ALBUM_ID');
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(
      `kino-pic:client-browser:v1:album:${albumId.toLowerCase()}:${token}`,
    ),
  );
  return toHex(new Uint8Array(signature));
}
