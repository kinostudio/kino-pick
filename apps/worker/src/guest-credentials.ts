import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { guestPasswordSchema } from '../../../packages/contracts/src/guest-access';
export { guestPasswordSchema } from '../../../packages/contracts/src/guest-access';

// Fixed v1 work factor; untrusted verifier fields must never select KDF costs.
export const GUEST_SCRYPT_PREFIX = '$kino-scrypt$v=1$N=32768,r=8,p=3$';
const verifierSchema = z
  .string()
  .length(GUEST_SCRYPT_PREFIX.length + 97)
  .regex(/^\$kino-scrypt\$v=1\$N=32768,r=8,p=3\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
const bearerSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);

function derive(password: string, salt: Buffer): Promise<Buffer> {
  const input = Buffer.from(password, 'utf8');
  return new Promise((resolve, reject) => {
    try {
      scrypt(
        input,
        salt,
        32,
        { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
        (error, key) => {
          input.fill(0);
          if (error) reject(new Error('GUEST_PASSWORD_KDF_UNAVAILABLE'));
          else resolve(key);
        },
      );
    } catch {
      input.fill(0);
      reject(new Error('GUEST_PASSWORD_KDF_UNAVAILABLE'));
    }
  });
}
export async function createGuestPasswordVerifier(
  input: unknown,
): Promise<string> {
  const password = guestPasswordSchema.parse(input);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  try {
    return `${GUEST_SCRYPT_PREFIX}${salt.toString('hex')}$${key.toString('hex')}`;
  } finally {
    key.fill(0);
  }
}
export async function verifyGuestPassword(
  input: unknown,
  encoded: unknown,
): Promise<boolean> {
  const password = guestPasswordSchema.safeParse(input);
  const verifier = verifierSchema.safeParse(encoded);
  if (!password.success || !verifier.success) return false;
  const parts = verifier.data.slice(GUEST_SCRYPT_PREFIX.length).split('$');
  const salt = Buffer.from(parts[0] ?? '', 'hex');
  const expected = Buffer.from(parts[1] ?? '', 'hex');
  const key = await derive(password.data, salt);
  try {
    return timingSafeEqual(key, expected);
  } finally {
    key.fill(0);
    expected.fill(0);
  }
}
export function generateGuestBearer(): string {
  return randomBytes(32).toString('hex');
}
export async function hashGuestInviteToken(input: unknown): Promise<string> {
  const token = bearerSchema.parse(input);
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`kino-pic:guest-invite-token:v1:${token}`),
  );
  return Buffer.from(hash).toString('hex');
}
