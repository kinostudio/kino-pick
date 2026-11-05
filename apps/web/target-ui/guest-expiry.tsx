import { useEffect, useState } from 'react';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '@kino-pic/contracts';

const responseSchema = z.object({ access: guestAlbumAccessSchema }).strict();

export function GuestExpiry({ albumId }: { albumId: string }) {
  const [value, setValue] = useState<{
    albumId: string;
    expiry: string | null;
  } | null>(null);
  const expiry = value?.albumId === albumId ? value.expiry : null;
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
          });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [albumId]);
  if (!expiry) return null;
  return (
    <p className="guest-share-expiry text-xs text-stone-600">
      分享有效至{' '}
      <time dateTime={expiry}>
        {new Intl.DateTimeFormat('zh-TW', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(expiry))}
      </time>
      （目前裝置時區）
    </p>
  );
}
