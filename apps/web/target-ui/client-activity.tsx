import { useEffect } from 'react';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '@kino-pic/contracts';

/** Separate visit receipts never replace retention's five-minute heartbeat. */
export function ClientActivityTracker({ albumId }: { albumId: string }) {
  useEffect(() => {
    const controller = new AbortController();
    const timers = new Map<HTMLImageElement, ReturnType<typeof setTimeout>>();
    const visible = new Set<HTMLImageElement>();
    const done = new Set<string>();
    let active = false;
    let expectedActorId: string | null = null;
    const observe = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const image = entry.target as HTMLImageElement;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5)
            visible.add(image);
          else visible.delete(image);
        }
        schedule();
      },
      { threshold: [0.5] },
    );
    function stopTimers() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }
    function schedule() {
      stopTimers();
      if (
        !active ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus()
      )
        return;
      for (const image of visible) {
        const photoId = image.dataset.kinoPhotoId;
        const versionId = image.dataset.kinoVersionId;
        const key = photoId + ':' + versionId;
        if (
          !image.complete ||
          !image.naturalWidth ||
          !z.uuid().safeParse(photoId).success ||
          !z.uuid().safeParse(versionId).success ||
          done.has(key)
        )
          continue;
        timers.set(
          image,
          setTimeout(() => {
            timers.delete(image);
            if (
              done.has(key) ||
              !visible.has(image) ||
              document.visibilityState !== 'visible' ||
              !document.hasFocus()
            )
              return;
            done.add(key);
            const body = JSON.stringify({
              viewId: crypto.randomUUID(),
              photoId,
              versionId,
              expectedActorId,
              visibleForMs: 1000,
            });
            // Serialize first-cookie handshakes across tabs; unsupported browsers remain usable.
            if (!navigator.locks) return;
            void navigator.locks
              .request('kino-client-browser-identity', async () => {
                for (let attempt = 0; attempt < 2; attempt++) {
                  if (controller.signal.aborted) return;
                  const response = await fetch(
                    '/api/guest/albums/' +
                      encodeURIComponent(albumId) +
                      '/activity',
                    {
                      method: 'POST',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body,
                      signal: controller.signal,
                      cache: 'no-store',
                    },
                  );
                  if (response.status !== 202) return;
                }
              })
              .catch(() => {});
          }, 1000),
        );
      }
    }
    const images = new WeakSet<HTMLImageElement>();
    function scan() {
      for (const image of document.querySelectorAll<HTMLImageElement>(
        'img[data-kino-photo-id][data-kino-version-id]',
      )) {
        if (images.has(image)) continue;
        images.add(image);
        observe.observe(image);
      }
    }
    const mutations = new MutationObserver(scan);
    void (async () => {
      const capability = await fetch('/api/client-activity/capabilities', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (
        !capability.ok ||
        ((await capability.json()) as { enabled?: unknown }).enabled !== true
      )
        return;
      const response = await fetch(
        '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      if (!response.ok) return;
      const parsed = z
        .object({ access: guestAlbumAccessSchema })
        .safeParse(await response.json());
      if (
        !parsed.success ||
        parsed.data.access.albumId !== albumId ||
        controller.signal.aborted
      )
        return;
      expectedActorId = parsed.data.access.guestId;
      active = true;
      scan();
      mutations.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('load', schedule, true);
      document.addEventListener('visibilitychange', schedule);
      window.addEventListener('focus', schedule);
      window.addEventListener('blur', schedule);
    })().catch(() => {});
    return () => {
      active = false;
      controller.abort();
      stopTimers();
      observe.disconnect();
      mutations.disconnect();
      document.removeEventListener('load', schedule, true);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('blur', schedule);
    };
  }, [albumId]);
  return null;
}
