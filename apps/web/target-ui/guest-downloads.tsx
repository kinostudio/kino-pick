'use client';

import { fetchGuestMetadataRead } from './guest-metadata-read';

import { StudioIcon } from './studio-icons';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import {
  guestDownloadsPageSchema,
  type GuestDownloadFile,
  type GuestDownloadKind,
  type GuestDownloadsPage,
} from '../../../packages/contracts/src/guest-downloads';

type GuestAlbumAccess = GuestDownloadsPage['access'];

const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });

export class GuestDownloadsRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'GuestDownloadsRequestError';
  }
}

function requestError(response: Response, body: unknown) {
  const parsed = apiErrorSchema.safeParse(body);
  return new GuestDownloadsRequestError(
    response.status,
    parsed.success ? parsed.data.error.code : 'SERVICE_UNAVAILABLE',
  );
}

export async function getGuestDownloadsPage(
  albumId: string,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<GuestDownloadsPage> {
  const validAlbumId = z.uuid().parse(albumId);
  const validCursor = cursor ? z.uuid().parse(cursor) : null;
  const query = validCursor ? '?cursor=' + encodeURIComponent(validCursor) : '';
  const response = await fetchGuestMetadataRead(
    '/api/guest/albums/' +
      encodeURIComponent(validAlbumId) +
      '/downloads' +
      query,
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      ...(signal ? { signal } : {}),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw requestError(response, body);
  const page = guestDownloadsPageSchema.parse(body);
  if (page.access.albumId !== validAlbumId)
    throw new Error('GUEST_DOWNLOADS_SCOPE_MISMATCH');
  return page;
}

async function getViewAccess(albumId: string, signal: AbortSignal) {
  const response = await fetchGuestMetadataRead(
    '/api/guest/albums/' +
      encodeURIComponent(z.uuid().parse(albumId)) +
      '/access',
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw requestError(response, body);
  const parsed = z
    .object({ access: guestAlbumAccessSchema })
    .strict()
    .parse(body);
  if (parsed.access.albumId !== albumId)
    throw new Error('GUEST_DOWNLOADS_SCOPE_MISMATCH');
  return {
    guestId: parsed.access.guestId,
    inviteId: parsed.access.inviteId,
    workspaceId: parsed.access.workspaceId,
    projectId: parsed.access.projectId,
    albumId: parsed.access.albumId,
    expiresAt: parsed.access.expiresAt,
    permissions: {
      can_view: parsed.access.permissions.can_view,
      can_download_preview: parsed.access.permissions.can_download_preview,
      can_download_original: parsed.access.permissions.can_download_original,
    },
  };
}

function hasDownloadPermission(access: GuestAlbumAccess) {
  return (
    access.permissions.can_download_preview ||
    access.permissions.can_download_original
  );
}

function sameAccessIdentity(left: GuestAlbumAccess, right: GuestAlbumAccess) {
  return (
    left.albumId === right.albumId &&
    left.guestId === right.guestId &&
    left.inviteId === right.inviteId &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.permissions.can_view === right.permissions.can_view &&
    left.permissions.can_download_preview ===
      right.permissions.can_download_preview &&
    left.permissions.can_download_original ===
      right.permissions.can_download_original &&
    left.expiresAt === right.expiresAt
  );
}

function accessIdentityKey(access: GuestAlbumAccess) {
  return JSON.stringify({
    guestId: access.guestId,
    inviteId: access.inviteId,
    workspaceId: access.workspaceId,
    projectId: access.projectId,
    albumId: access.albumId,
    expiresAt: access.expiresAt,
    permissions: access.permissions,
  });
}

function downloadHref(
  photoId: string,
  versionId: string,
  kind: GuestDownloadKind,
) {
  return (
    '/api/guest/photos/' +
    encodeURIComponent(z.uuid().parse(photoId)) +
    '/versions/' +
    encodeURIComponent(z.uuid().parse(versionId)) +
    '/downloads/' +
    kind
  );
}

function DownloadLink({
  photoId,
  versionId,
  kind,
  file,
}: {
  photoId: string;
  versionId: string;
  kind: GuestDownloadKind;
  file: GuestDownloadFile | null;
}) {
  if (!file) return null;
  return (
    <a
      href={downloadHref(photoId, versionId, kind)}
      download={file.filename}
      data-testid={'guest-download-' + kind}
      className="guest-download-link inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
    >
      <span className="min-w-0 break-all text-left">
        下載{kind === 'preview' ? '預覽' : '原圖'}（{file.filename}，
        {file.byteSize.toLocaleString()} 位元組）
      </span>
    </a>
  );
}

type PageState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: GuestDownloadsPage; pageNumber: number };

export function GuestDownloadsPanel({
  albumId,
  viewable = true,
  compact = false,
  onViewAccessLost,
}: {
  albumId: string;
  compact?: boolean;
  /** When false, the gallery endpoint already denied view access; downloads authorize independently. */
  viewable?: boolean;
  onViewAccessLost?: () => void;
}) {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const headingId = useId();
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const guestIdRef = useRef<string | null>(null);
  const accessIdentityRef = useRef<string | null>(null);
  const cursorStackRef = useRef<Array<string | null>>([null]);
  const pageIndexRef = useRef(0);
  const retryRequestRef = useRef<{
    cursor: string | null;
    navigation: 'initial' | 'next' | 'previous' | 'retry';
  } | null>(null);
  const onViewAccessLostRef = useRef(onViewAccessLost);

  useEffect(() => {
    onViewAccessLostRef.current = onViewAccessLost;
  }, [onViewAccessLost]);

  const clearPrivatePage = useCallback(() => {
    guestIdRef.current = null;
    accessIdentityRef.current = null;
    cursorStackRef.current = [null];
    pageIndexRef.current = 0;
    retryRequestRef.current = null;
    setCursorStack([null]);
    setPageIndex(0);
    setState({ status: 'hidden' });
  }, []);

  const requestPage = useCallback(
    async (
      cursor: string | null,
      navigation: 'initial' | 'next' | 'previous' | 'retry',
    ) => {
      const generation = ++generationRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      retryRequestRef.current = { cursor, navigation };
      setState({ status: 'loading' });

      function isCurrent() {
        return (
          generationRef.current === generation &&
          controllerRef.current === controller &&
          !controller.signal.aborted
        );
      }

      function viewAccessLost() {
        clearPrivatePage();
        onViewAccessLostRef.current?.();
      }

      try {
        let accessBefore: GuestAlbumAccess | null = null;
        if (viewable) {
          try {
            accessBefore = await getViewAccess(albumId, controller.signal);
          } catch (error) {
            if (!isCurrent()) return;
            if (
              error instanceof GuestDownloadsRequestError &&
              (error.statusCode === 401 || error.statusCode === 403)
            ) {
              viewAccessLost();
              return;
            }
            throw error;
          }
          if (!isCurrent()) return;
          if (!accessBefore.permissions.can_view) {
            viewAccessLost();
            return;
          }
          if (Date.parse(accessBefore.expiresAt) <= Date.now()) {
            clearPrivatePage();
            return;
          }
          if (!hasDownloadPermission(accessBefore)) {
            clearPrivatePage();
            return;
          }
          if (
            guestIdRef.current !== null &&
            guestIdRef.current !== accessBefore.guestId
          ) {
            viewAccessLost();
            return;
          }
        }

        const page = await getGuestDownloadsPage(
          albumId,
          cursor,
          controller.signal,
        );
        if (!isCurrent()) return;
        if (!hasDownloadPermission(page.access)) {
          clearPrivatePage();
          return;
        }
        const currentAccessIdentity = accessIdentityKey(page.access);
        if (
          accessIdentityRef.current !== null &&
          accessIdentityRef.current !== currentAccessIdentity
        ) {
          if (viewable) viewAccessLost();
          else clearPrivatePage();
          return;
        }
        const expectedGuestId = accessBefore?.guestId ?? guestIdRef.current;
        if (
          expectedGuestId !== null &&
          expectedGuestId !== page.access.guestId
        ) {
          if (viewable) viewAccessLost();
          else clearPrivatePage();
          return;
        }
        if (accessBefore && !sameAccessIdentity(accessBefore, page.access)) {
          viewAccessLost();
          return;
        }
        if (
          !Number.isFinite(Date.parse(page.access.expiresAt)) ||
          Date.parse(page.access.expiresAt) <= Date.now()
        ) {
          clearPrivatePage();
          return;
        }

        if (viewable && accessBefore) {
          let accessAfter: GuestAlbumAccess;
          try {
            accessAfter = await getViewAccess(albumId, controller.signal);
          } catch (error) {
            if (!isCurrent()) return;
            if (
              error instanceof GuestDownloadsRequestError &&
              (error.statusCode === 401 || error.statusCode === 403)
            ) {
              viewAccessLost();
              return;
            }
            throw error;
          }
          if (!isCurrent()) return;
          if (
            !sameAccessIdentity(accessBefore, accessAfter) ||
            page.access.guestId !== accessAfter.guestId ||
            !accessAfter.permissions.can_view ||
            !hasDownloadPermission(accessAfter) ||
            Date.parse(accessAfter.expiresAt) <= Date.now()
          ) {
            viewAccessLost();
            return;
          }
        }

        let nextCursors = cursorStackRef.current;
        let nextIndex = pageIndexRef.current;
        if (navigation === 'initial') {
          nextCursors = [null];
          nextIndex = 0;
        } else if (navigation === 'next') {
          const existingCursor = nextCursors[nextIndex + 1];
          if (existingCursor === cursor) {
            nextIndex += 1;
          } else {
            nextCursors = [...nextCursors.slice(0, nextIndex + 1), cursor];
            nextIndex += 1;
          }
        } else if (navigation === 'previous') {
          nextIndex = Math.max(0, nextIndex - 1);
        }
        if (
          navigation === 'next' &&
          page.nextCursor !== null &&
          (page.nextCursor === cursor ||
            cursorStackRef.current.includes(page.nextCursor))
        ) {
          clearPrivatePage();
          return;
        }
        cursorStackRef.current = nextCursors;
        pageIndexRef.current = nextIndex;
        guestIdRef.current = page.access.guestId;
        accessIdentityRef.current = currentAccessIdentity;
        retryRequestRef.current = null;
        setCursorStack(nextCursors);
        setPageIndex(nextIndex);
        setState({ status: 'ready', value: page, pageNumber: nextIndex + 1 });
      } catch (error) {
        if (!isCurrent()) return;
        if (
          error instanceof GuestDownloadsRequestError &&
          (error.statusCode === 401 ||
            error.statusCode === 403 ||
            error.code === 'GUEST_DOWNLOADS_DISABLED')
        ) {
          clearPrivatePage();
          return;
        }
        setState({
          status: 'error',
          message: '目前無法載入下載清單，請稍後重試。',
        });
      }
    },
    [albumId, clearPrivatePage, viewable],
  );

  useEffect(() => {
    cursorStackRef.current = [null];
    pageIndexRef.current = 0;
    guestIdRef.current = null;
    accessIdentityRef.current = null;
    retryRequestRef.current = null;
    const initialRequest = window.setTimeout(() => {
      void requestPage(null, 'initial');
    }, 0);
    return () => {
      window.clearTimeout(initialRequest);
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      guestIdRef.current = null;
      accessIdentityRef.current = null;
    };
  }, [albumId, requestPage]);

  const retry = () => {
    const previousRequest = retryRequestRef.current;
    if (previousRequest) {
      void requestPage(previousRequest.cursor, previousRequest.navigation);
      return;
    }
    const cursor = cursorStackRef.current[pageIndexRef.current] ?? null;
    void requestPage(cursor, 'retry');
  };

  const previous = () => {
    if (state.status !== 'ready' || pageIndexRef.current <= 0) return;
    const cursor = cursorStackRef.current[pageIndexRef.current - 1];
    if (cursor === undefined) return;
    void requestPage(cursor, 'previous');
  };

  const next = () => {
    if (state.status !== 'ready') return;
    const stackedCursor = cursorStackRef.current[pageIndexRef.current + 1];
    const cursor = stackedCursor ?? state.value.nextCursor;
    if (!cursor) return;
    void requestPage(cursor, 'next');
  };

  const expiresAt =
    state.status === 'ready' ? state.value.access.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const expiration = Date.parse(expiresAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearAtExpiry = () => {
      const remaining = expiration - Date.now();
      if (!Number.isFinite(expiration) || remaining <= 0) {
        clearPrivatePage();
        return;
      }
      timer = setTimeout(clearAtExpiry, Math.min(remaining, 2_147_000_000));
    };
    const initialDelay = Number.isFinite(expiration)
      ? Math.max(0, Math.min(expiration - Date.now(), 2_147_000_000))
      : 0;
    timer = setTimeout(clearAtExpiry, initialDelay);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [clearPrivatePage, expiresAt]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const refreshOnReturn = () => {
      if (document.visibilityState !== 'visible') return;
      const cursor = cursorStackRef.current[pageIndexRef.current] ?? null;
      void requestPage(
        cursor,
        pageIndexRef.current === 0 ? 'initial' : 'retry',
      );
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [requestPage, state.status]);

  if (state.status === 'hidden' || state.status === 'loading') return null;
  const content = (
    <section
      aria-labelledby={headingId}
      data-testid="guest-downloads-panel"
      className="guest-download-panel mt-5 min-w-0 rounded-lg border border-stone-200 bg-white p-4 sm:p-5"
    >
      <header className="guest-download-heading">
        <div>
          <p className="guest-studio-eyebrow">DELIVERY / CURRENT VERSION</p>
          <h2
            id={headingId}
            className="guest-download-title text-lg font-semibold text-stone-950"
          >
            目前版本下載
          </h2>
        </div>
      </header>
      {state.status === 'error' && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p
            role="alert"
            className="min-w-0 break-words text-sm text-amber-900"
          >
            {state.message}
          </p>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            重試
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <p className="guest-download-intro mt-1 text-sm text-stone-600">
            只提供目前版本中受邀可下載的檔案。若下載失敗，請重新開啟攝影師提供的原邀請連結後再試。
          </p>
          {state.value.photos.length === 0 ? (
            <p className="guest-download-empty mt-4 rounded-md bg-stone-50 p-3 text-sm text-stone-600">
              目前沒有可下載的照片版本。
            </p>
          ) : (
            <ul className="guest-download-list mt-4 grid min-w-0 gap-3">
              {state.value.photos.map((photo) => {
                const mayDownloadPreview =
                  state.value.access.permissions.can_download_preview;
                const mayDownloadOriginal =
                  state.value.access.permissions.can_download_original;
                const hasVisibleFile =
                  (mayDownloadPreview && photo.preview !== null) ||
                  (mayDownloadOriginal && photo.original !== null);
                if (!hasVisibleFile) return null;
                return (
                  <li
                    key={photo.photoId}
                    data-testid="guest-download-photo"
                    className="guest-download-photo min-w-0 rounded-md border border-stone-200 p-3"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-stone-900">
                        {photo.filename}
                      </p>
                      <p className="mt-1 text-xs text-stone-600">
                        目前版本 V{photo.versionNo}
                      </p>
                    </div>
                    <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                      {mayDownloadPreview && (
                        <DownloadLink
                          photoId={photo.photoId}
                          versionId={photo.versionId}
                          kind="preview"
                          file={photo.preview}
                        />
                      )}
                      {mayDownloadOriginal && (
                        <DownloadLink
                          photoId={photo.photoId}
                          versionId={photo.versionId}
                          kind="original"
                          file={photo.original}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="guest-download-pagination mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-stone-600" aria-live="polite">
              第 {state.pageNumber} 頁，每頁最多 24 張
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pageIndex === 0}
                onClick={previous}
                data-testid="guest-downloads-previous"
                className="guest-download-page-button min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                上一頁
              </button>
              <button
                type="button"
                disabled={
                  !cursorStack[pageIndex + 1] && !state.value.nextCursor
                }
                onClick={next}
                data-testid="guest-downloads-next"
                className="guest-download-page-button min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一頁
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
  return compact && state.status === 'ready' ? (
    <details className="guest-download-disclosure">
      <summary>
        <StudioIcon
          name="upload"
          width={16}
          height={16}
          style={{ transform: 'rotate(180deg)' }}
        />
        下載照片
      </summary>
      {content}
    </details>
  ) : (
    content
  );
}
