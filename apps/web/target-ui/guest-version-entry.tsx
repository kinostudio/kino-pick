'use client';
import { useEffect, useState, type Ref } from 'react';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import { guestVersionComparisonCapabilitiesSchema } from '../../../packages/contracts/src/guest-versions';

/** Visibility hint only; history and every image repeat current server ACL. */
export function GuestVersionComparisonButton({
  albumId,
  photoId,
  opened,
  onOpen,
  onClose,
  buttonRef,
}: {
  albumId: string;
  photoId: string;
  opened: boolean;
  onOpen: () => void;
  onClose: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  const key = albumId + ':' + photoId;
  const [allowed, setAllowed] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    void (async () => {
      try {
        const cap = await fetch('/api/guest/version-comparison/capabilities', {
          credentials: 'same-origin',
          signal: abort.signal,
        });
        if (
          !cap.ok ||
          !guestVersionComparisonCapabilitiesSchema.parse(await cap.json())
            .enabled
        )
          return;
        const response = await fetch(
          '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
          { credentials: 'same-origin', signal: abort.signal },
        );
        if (!response.ok) return;
        const { access } = z
          .object({ access: guestAlbumAccessSchema })
          .strict()
          .parse(await response.json());
        if (
          active &&
          access.albumId === albumId &&
          access.permissions.can_view &&
          access.permissions.can_compare_versions
        )
          setAllowed(key);
      } catch {
        /* Denied or unavailable features have no action button. */
      }
    })();
    return () => {
      active = false;
      abort.abort();
    };
  }, [albumId, key]);
  if (allowed !== key) return null;
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="guest-compare-open"
      aria-expanded={opened}
      onClick={opened ? onClose : onOpen}
      className="rounded border border-white/30 px-3 py-2 text-sm text-white hover:bg-white/10"
    >
      {opened ? '返回單張預覽' : '比較版本'}
    </button>
  );
}
