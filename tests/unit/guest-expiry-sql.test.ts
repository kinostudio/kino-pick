import { describe, expect, it } from 'vitest';
import { guestInviteAlbumExpiryCondition } from '../../apps/worker/src/guest-expiry-sql';

describe('guestInviteAlbumExpiryCondition', () => {
  it('matches the invite, tenant, album, and validated effective-expiry row', () => {
    const sql = guestInviteAlbumExpiryCondition(
      'invite',
      'invite_album.album_id',
    );

    expect(sql).toContain('__guest_expiry.invite_id=invite.id');
    expect(sql).toContain('__guest_expiry.workspace_id=invite.workspace_id');
    expect(sql).toContain('__guest_expiry.project_id=invite.project_id');
    expect(sql).toContain('__guest_expiry.album_id=invite_album.album_id');
    expect(sql).toContain('__guest_expiry.expiry_valid=1');
  });

  it('rejects SQL fragments in either identifier input', () => {
    expect(() =>
      guestInviteAlbumExpiryCondition(
        'i; DROP TABLE guest_invites',
        'ia.album_id',
      ),
    ).toThrow(TypeError);
    expect(() =>
      guestInviteAlbumExpiryCondition('i', 'ia.album_id OR 1=1'),
    ).toThrow(TypeError);
  });
});
