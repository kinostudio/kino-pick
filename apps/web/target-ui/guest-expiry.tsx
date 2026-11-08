import { useEffect, useState } from 'react';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '@kino-pic/contracts';

const responseSchema = z.object({ access: guestAlbumAccessSchema }).strict();

export function GuestExpiry({ albumId }: { albumId: string }) {
  const [value, setValue] = useState<{
    albumId: string;
    expiry: string | null;
    expiryMode: 'inherit_album' | undefined;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/guest/albums/' + encodeURIComponent(albumId) + '/access', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result = responseSchema.safeParse(await response.json());
        if (
          !controller.signal.aborted &&
          result.success &&
          result.data.access.albumId === albumId
        )
          setValue({
            albumId,
            expiry: result.data.access.inviteExpiresAt ?? null,
            expiryMode: result.data.access.expiryMode,
          });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [albumId]);
  if (!value || value.albumId !== albumId) return null;
  if (value.expiry === null)
    return value.expiryMode === 'inherit_album' ? (
      <p className="guest-share-expiry text-xs text-stone-600">
        依相簿設定，目前未設定到期日
      </p>
    ) : null;
  return (
    <p className="guest-share-expiry text-xs text-stone-600">
      分享有效至{' '}
      <time dateTime={value.expiry}>
        {new Intl.DateTimeFormat('zh-TW', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(value.expiry))}
      </time>
      （目前裝置時區）
    </p>
  );
}
