import { describe, expect, it, vi } from 'vitest';
import { D1DeliveryZips } from '../../apps/worker/src/delivery-zips';
import { GuestAccessDenied } from '../../apps/worker/src/guest-access';
import type { ZipItem } from '../../packages/contracts/src/delivery-zips';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item: ZipItem = {
  deliveryId: id(1),
  photoId: id(2),
  versionId: id(3),
  versionNo: 1,
  assetId: id(4),
  filename: 'photo.jpg',
  byteSize: 12,
  mime: 'image/jpeg',
  sha256: 'a'.repeat(64),
  entryName: '001-v1-photo.jpg',
};
function fixture() {
  const first = vi.fn().mockResolvedValue({
    storage_node_id: id(5),
    object_key: 'private/original',
    byte_size: 12,
    checksum_sha256: item.sha256,
  });
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn<(sql: string) => { bind: typeof bind }>(() => ({
    bind,
  }));
  const repo = new D1DeliveryZips({ prepare } as unknown as D1Database);
  const ticket = {
    ticket_id: id(6),
    album_id: id(7),
    workspace_id: id(8),
    project_id: id(9),
    guest_id: id(10),
    guest_session_id: id(11),
    manifest: '{}',
    occurred_at_utc: '',
    contents: {
      deliveryIds: [item.deliveryId],
      items: [item],
      expiresAtMs: Date.now() + 1000,
    },
  };
  const authorize = vi.spyOn(repo, 'ticket').mockResolvedValue(ticket);
  return { repo, ticket, prepare, bind, authorize };
}
describe('ZIP immutable source lookup after live authorization', () => {
  it('authorizes the full ticket before resolving the exact scoped immutable asset', async () => {
    const f = fixture();
    await expect(
      f.repo.source('session', f.ticket, item),
    ).resolves.toMatchObject(item);
    expect(f.authorize).toHaveBeenCalledWith(
      'session',
      f.ticket.album_id,
      f.ticket.ticket_id,
    );
    expect(f.prepare.mock.calls[0]?.[0]).toContain(
      'FROM photo_assets WHERE id=? AND workspace_id=?',
    );
    expect(f.bind).toHaveBeenCalledWith(
      item.assetId,
      f.ticket.workspace_id,
      item.photoId,
      item.versionId,
      item.mime,
    );
  });
  it('never reads an asset after ticket revocation or authorization failure', async () => {
    const f = fixture();
    f.authorize.mockRejectedValue(new GuestAccessDenied());
    await expect(
      f.repo.source('session', f.ticket, item),
    ).rejects.toBeInstanceOf(GuestAccessDenied);
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it('rejects a substituted asset even in the same workspace', async () => {
    const f = fixture();
    await expect(
      f.repo.source('session', f.ticket, { ...item, assetId: id(12) }),
    ).rejects.toBeInstanceOf(GuestAccessDenied);
    expect(f.prepare).not.toHaveBeenCalled();
  });
});
