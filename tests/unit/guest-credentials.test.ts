import { describe, expect, it } from 'vitest';
import { scryptSync, createHash } from 'node:crypto';
import {
  createGuestPasswordVerifier,
  verifyGuestPassword,
  guestPasswordSchema,
  generateGuestBearer,
  hashGuestInviteToken,
  GUEST_SCRYPT_PREFIX,
} from '../../apps/worker/src/guest-credentials';
import { hashGuestSessionSecret } from '../../apps/worker/src/guest-access';

describe('bounded versioned Guest credentials', () => {
  it('uses random salts, fixed native scrypt parameters and verifies exact password bytes', async () => {
    const password = ' 前後空白與📷密碼字串不裁切 ';
    const first = await createGuestPasswordVerifier(password);
    const second = await createGuestPasswordVerifier(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyGuestPassword(password, first)).toBe(true);
    expect(await verifyGuestPassword(password.trim(), first)).toBe(false);
    const [salt, key] = first.slice(GUEST_SCRYPT_PREFIX.length).split('$');
    expect(key).toBe(
      scryptSync(password, Buffer.from(salt ?? '', 'hex'), 32, {
        N: 32768,
        r: 8,
        p: 3,
        maxmem: 64 * 1024 * 1024,
      }).toString('hex'),
    );
  });
  it('rejects verifier cost/format/algorithm changes and malformed credentials', async () => {
    const salt = 'a'.repeat(32),
      key = 'b'.repeat(64);
    for (const value of [
      null,
      1,
      'plain text password',
      `${GUEST_SCRYPT_PREFIX}${salt}$${key}$extra`,
      `${GUEST_SCRYPT_PREFIX}${salt}$${key}\n`,
      `${GUEST_SCRYPT_PREFIX}${salt}$${key}\0junk`,
      `${GUEST_SCRYPT_PREFIX}${salt.toUpperCase()}$${key}`,
      `${GUEST_SCRYPT_PREFIX.replace('32768', '16')}${salt}$${key}`,
      `$argon2id$${salt}$${key}`,
    ])
      expect(await verifyGuestPassword('long-enough-password', value)).toBe(
        false,
      );
  });
  it('bounds inputs before KDF and rejects lone-surrogate aliases without normalization', async () => {
    for (const value of [
      '',
      123,
      'x'.repeat(257),
      'abcdefghijk\ud800',
      'abcdefghijk\udc00',
    ]) {
      expect(guestPasswordSchema.safeParse(value).success).toBe(false);
      await expect(createGuestPasswordVerifier(value)).rejects.toThrow();
    }
    expect(guestPasswordSchema.safeParse('📷'.repeat(128)).success).toBe(true);
    const composed = 'café-password-long';
    const encoded = await createGuestPasswordVerifier(composed);
    expect(await verifyGuestPassword(composed.normalize('NFD'), encoded)).toBe(
      false,
    );
  });
  it('generates independent256-bit bearers and domain-separated lookup hashes', async () => {
    const first = generateGuestBearer(),
      second = generateGuestBearer();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    const invite = await hashGuestInviteToken(first);
    expect(invite).toBe(
      createHash('sha256')
        .update(`kino-pic:guest-invite-token:v1:${first}`)
        .digest('hex'),
    );
    expect(invite).not.toBe(await hashGuestSessionSecret(first));
    expect(invite).not.toBe(first);
    await expect(hashGuestInviteToken('too-short')).rejects.toThrow();
    await expect(hashGuestInviteToken(first + '\n')).rejects.toThrow();
    await expect(hashGuestSessionSecret(first + '\n')).rejects.toThrow();
  });
});
