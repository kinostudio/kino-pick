import { describe, expect, it } from 'vitest';
import {
  decodeGuestPermissions,
  guestPermissionBit,
  guestPermissionNames,
  guestPermissionsSchema,
} from '../../packages/contracts/src/guest-access';
import {
  hashGuestSessionSecret,
  readGuestSessionSecret,
} from '../../apps/worker/src/guest-access';

describe('independent Guest ACL and session credential parsing', () => {
  it('round-trips all twelve bits without granting any other permission', () => {
    for (const permission of guestPermissionNames) {
      const decoded = decodeGuestPermissions(guestPermissionBit(permission));
      expect(decoded[permission]).toBe(true);
      expect(Object.values(decoded).filter(Boolean)).toHaveLength(1);
    }
    expect(Object.values(decodeGuestPermissions(0)).every((v) => !v)).toBe(
      true,
    );
    expect(Object.values(decodeGuestPermissions(4095)).every(Boolean)).toBe(
      true,
    );
  });
  it('rejects unknown rights, noninteger masks, overflow and client extra fields', () => {
    for (const mask of [-1, 4096, 1.5, '1', null])
      expect(() => decodeGuestPermissions(mask)).toThrow();
    expect(() =>
      guestPermissionsSchema.parse({
        ...decodeGuestPermissions(1),
        admin: true,
      }),
    ).toThrow();
  });
  it('rejects duplicate, encoded, oversized or noncanonical session cookies', () => {
    const secret = 'a'.repeat(64);
    expect(readGuestSessionSecret(`kino_guest=${secret}`, false)).toBe(secret);
    expect(readGuestSessionSecret(`__Host-kino_guest=${secret}`, true)).toBe(
      secret,
    );
    for (const header of [
      undefined,
      `kino_guest=${secret}; kino_guest=${secret}`,
      `kino_guest=${secret.toUpperCase()}`,
      `kino_guest=%61${secret.slice(1)}`,
      `kino_guest=${secret}=`,
      `kino_guest=${secret}; padding=${'x'.repeat(8192)}`,
      `other=${secret}`,
    ])
      expect(readGuestSessionSecret(header, false)).toBeNull();
    expect(readGuestSessionSecret(`kino_guest=${secret}`, true)).toBeNull();
    expect(
      readGuestSessionSecret(`__Host-kino_guest=${secret}`, false),
    ).toBeNull();
  });
  it('hashes only canonical high entropy credentials with purpose separation', async () => {
    const secret = 'b'.repeat(64);
    const hash = await hashGuestSessionSecret(secret);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(secret);
    expect(await hashGuestSessionSecret(secret)).toBe(hash);
    expect(await hashGuestSessionSecret('c'.repeat(64))).not.toBe(hash);
    await expect(hashGuestSessionSecret('too-short')).rejects.toThrow();
  });
});
