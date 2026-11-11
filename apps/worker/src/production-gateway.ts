export const PRODUCTION_GATEWAY_HOST = 'pick.kinostudio.tw';
export const PRODUCTION_GATEWAY_UPSTREAM =
  'https://kino-pick-production.kino-pick-aaron2026.workers.dev';

const TIMESTAMP_HEADER = 'X-Kino-Gateway-Timestamp';
const IP_HEADER = 'X-Kino-Gateway-IP';
const SIGNATURE_HEADER = 'X-Kino-Gateway-Signature';
const SECRET_MIN_LENGTH = 32;
const MAX_AGE_SECONDS = 30;
const encoder = new TextEncoder();

export function requestHostIs<CfHostMetadata, Cf>(
  request: Request<CfHostMetadata, Cf>,
  host: string,
): boolean {
  const url = new URL(request.url);
  return (
    url.host === host &&
    (!request.headers.has('host') || request.headers.get('host') === host)
  );
}

export function stripProductionGatewayHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith('x-kino-gateway-')) headers.delete(name);
  }
}

function message<CfHostMetadata, Cf>(
  request: Request<CfHostMetadata, Cf>,
  timestamp: string,
  ip: string,
): Uint8Array<ArrayBuffer> {
  const url = new URL(request.url);
  return encoder.encode(
    `${timestamp}\n${ip}\n${request.method}\n${url.pathname}${url.search}`,
  );
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g)!, (byte) => parseInt(byte, 16));
}

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );
}

export async function createProductionGatewaySignature(
  request: Request,
  ip: string,
  secret: string,
): Promise<{ timestamp: string; ip: string; signature: string } | null> {
  if (secret.length < SECRET_MIN_LENGTH || !ip) return null;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, ['sign']),
    message(request, timestamp, ip),
  );
  return { timestamp, ip, signature: toHex(signature) };
}

export async function verifyProductionGatewayRequest<CfHostMetadata, Cf>(
  request: Request<CfHostMetadata, Cf>,
  secret: string | undefined,
): Promise<Request<CfHostMetadata, Cf> | null> {
  if (
    !secret ||
    secret.length < SECRET_MIN_LENGTH ||
    !requestHostIs(request, new URL(PRODUCTION_GATEWAY_UPSTREAM).host)
  )
    return null;

  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const ip = request.headers.get(IP_HEADER);
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!timestamp || !/^\d{1,13}$/.test(timestamp) || !ip || !signature)
    return null;

  const issuedAt = Number(timestamp);
  if (
    !Number.isSafeInteger(issuedAt) ||
    Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > MAX_AGE_SECONDS
  )
    return null;

  const signatureBytes = fromHex(signature);
  if (
    !signatureBytes ||
    !(await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, ['verify']),
      signatureBytes,
      message(request, timestamp, ip),
    ))
  )
    return null;

  const internalUrl = new URL(request.url);
  internalUrl.protocol = 'https:';
  internalUrl.host = PRODUCTION_GATEWAY_HOST;
  const internal = new Request(internalUrl, request as Request);
  internal.headers.delete('host');
  internal.headers.delete('CF-Worker');
  stripProductionGatewayHeaders(internal.headers);
  internal.headers.set('CF-Connecting-IP', ip);
  internal.headers.set('Host', PRODUCTION_GATEWAY_HOST);
  if ('cf' in request && request.cf !== undefined)
    Object.defineProperty(internal, 'cf', { value: request.cf });
  return internal as Request<CfHostMetadata, Cf>;
}
