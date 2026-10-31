'use client';

import { Button } from '@kino-pic/ui';
import { albumSchema, type Album } from '@kino-pic/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';

const activationCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();
const activationResponseSchema = z.object({ album: albumSchema }).strict();

type CapabilityState =
  | { status: 'loading' }
  | { status: 'ready'; enabled: boolean; albumId: string; revision: number }
  | { status: 'error'; albumId: string; revision: number };

type ActivationIntent = {
  requestId: string;
  expectedRevision: number;
};

type ActivationState =
  | 'idle'
  | 'submitting'
  | 'unknown'
  | 'conflict'
  | 'locked'
  | 'error'
  | 'succeeded';

export function AlbumActivation({
  album,
  editable,
}: {
  album: Album;
  editable: boolean;
}) {
  const router = useRouter();
  const [capability, setCapability] = useState<CapabilityState>({
    status: 'loading',
  });
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [activationState, setActivationState] =
    useState<ActivationState>('idle');
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const requestInFlight = useRef(false);
  const intentRef = useRef<ActivationIntent | null>(null);
  const conflictRefreshRequested = useRef(false);
  const wasConfirmationOpen = useRef(false);
  const panelId = useId();
  const headingId = useId();
  const openerId = useId();
  const confirmButtonId = useId();
  const retryButtonId = useId();
  const statusId = useId();
  const capabilityMatchesAlbum =
    capability.status !== 'loading' &&
    capability.albumId.toLowerCase() === album.id.toLowerCase() &&
    capability.revision === album.revision;

  function clearIntent() {
    intentRef.current = null;
  }

  useEffect(() => {
    if (!editable || album.state !== 'draft') return;
    const controller = new AbortController();
    void fetch(
      '/api/v1/albums/' +
        encodeURIComponent(album.id) +
        '/activation-capabilities',
      {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('CAPABILITY_UNAVAILABLE');
        const parsed = activationCapabilitiesSchema.safeParse(body);
        if (!parsed.success) throw new Error('CAPABILITY_INVALID');
        setCapability({
          status: 'ready',
          enabled: parsed.data.enabled,
          albumId: album.id,
          revision: album.revision,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCapability({
          status: 'error',
          albumId: album.id,
          revision: album.revision,
        });
      });

    return () => controller.abort();
  }, [album.id, album.revision, album.state, editable]);

  useEffect(() => {
    if (confirmationOpen) {
      wasConfirmationOpen.current = true;
      if (activationState === 'idle') {
        document.getElementById(confirmButtonId)?.focus();
      } else if (activationState === 'unknown') {
        document.getElementById(retryButtonId)?.focus();
      } else if (activationState === 'conflict') {
        document.getElementById(statusId)?.focus();
      }
    } else if (wasConfirmationOpen.current) {
      wasConfirmationOpen.current = false;
      document.getElementById(openerId)?.focus();
    }
  }, [
    activationState,
    confirmButtonId,
    confirmationOpen,
    openerId,
    retryButtonId,
    statusId,
  ]);
  useEffect(() => {
    if (
      activationState === 'conflict' &&
      conflictRefreshRequested.current &&
      conflictRevision !== null &&
      album.revision !== conflictRevision
    ) {
      conflictRefreshRequested.current = false;
      setConflictRevision(null);
      clearIntent();
      setConfirmationOpen(false);
      setActivationState('idle');
      document.getElementById(openerId)?.focus();
    }
  }, [activationState, album.revision, conflictRevision, openerId]);

  async function sendActivationRequest(nextIntent: ActivationIntent) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setActivationState('submitting');

    try {
      const response = await fetch(
        '/api/v1/albums/' + encodeURIComponent(album.id) + '/activate',
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: nextIntent.requestId,
            expectedRevision: nextIntent.expectedRevision,
            confirmActivate: true,
          }),
        },
      );

      if (response.status === 409) {
        clearIntent();
        conflictRefreshRequested.current = false;
        setConflictRevision(nextIntent.expectedRevision);
        setActivationState('conflict');
        return;
      }

      if (response.status === 401 || response.status === 403) {
        clearIntent();
        setActivationState('locked');
        return;
      }

      if (!response.ok) {
        if (response.status >= 500) {
          setActivationState('unknown');
        } else {
          clearIntent();
          setActivationState('error');
        }
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const parsed = activationResponseSchema.safeParse(body);
      const activatedAlbum = parsed.success ? parsed.data.album : null;
      if (
        !activatedAlbum ||
        activatedAlbum.id.toLowerCase() !== album.id.toLowerCase() ||
        activatedAlbum.projectId.toLowerCase() !==
          album.projectId.toLowerCase() ||
        activatedAlbum.workspaceId.toLowerCase() !==
          album.workspaceId.toLowerCase() ||
        activatedAlbum.state !== 'active' ||
        activatedAlbum.revision !== nextIntent.expectedRevision + 1
      ) {
        setActivationState('unknown');
        return;
      }

      clearIntent();
      setActivationState('succeeded');
      router.refresh();
    } catch {
      setActivationState('unknown');
    } finally {
      requestInFlight.current = false;
    }
  }

  function confirmActivation() {
    if (
      !capabilityMatchesAlbum ||
      capability.status !== 'ready' ||
      !capability.enabled ||
      requestInFlight.current ||
      intentRef.current ||
      activationState !== 'idle'
    ) {
      return;
    }

    const nextIntent = {
      requestId: crypto.randomUUID(),
      expectedRevision: album.revision,
    };
    intentRef.current = nextIntent;
    void sendActivationRequest(nextIntent);
  }

  function retryUnknownIntent() {
    const originalIntent = intentRef.current;
    if (
      activationState !== 'unknown' ||
      !originalIntent ||
      requestInFlight.current
    ) {
      return;
    }
    void sendActivationRequest(originalIntent);
  }

  function cancelConfirmation() {
    if (requestInFlight.current || activationState === 'unknown') return;
    clearIntent();
    setConflictRevision(null);
    conflictRefreshRequested.current = false;
    setConfirmationOpen(false);
    setActivationState('idle');
    document.getElementById(openerId)?.focus();
  }

  if (!editable || album.state !== 'draft') return null;

  if (
    capability.status === 'error' &&
    capabilityMatchesAlbum &&
    !confirmationOpen
  ) {
    return (
      <p className="basis-full text-sm text-stone-600" role="status">
        目前無法確認這個相簿是否符合啟用條件。請重新整理相簿頁面後再試。
      </p>
    );
  }

  if (
    !confirmationOpen &&
    (!capabilityMatchesAlbum ||
      capability.status !== 'ready' ||
      !capability.enabled)
  ) {
    return null;
  }
  return (
    <div className="contents" data-testid={'album-activation-' + album.id}>
      {activationState !== 'succeeded' && (
        <Button
          id={openerId}
          type="button"
          variant="outline"
          aria-expanded={confirmationOpen}
          aria-controls={panelId}
          onClick={() => setConfirmationOpen(true)}
        >
          {'啟用相簿 ' + album.name}
        </Button>
      )}

      {confirmationOpen && (
        <section
          id={panelId}
          className="basis-full rounded-md border border-stone-200 bg-stone-50 p-4"
          role="group"
          aria-labelledby={headingId}
          aria-describedby={statusId}
        >
          <h4 id={headingId} className="text-base font-semibold">
            確認啟用相簿
          </h4>
          <p className="mt-2 text-sm text-stone-700">
            啟用後，此相簿將符合邀請協作的使用資格；這不會自動分享相簿，也不會建立邀請。
          </p>
          {activationState === 'idle' && !capabilityMatchesAlbum && (
            <p id={statusId} className="mt-3 text-sm" role="status">
              正在重新確認相簿啟用資格…
            </p>
          )}
          {activationState === 'idle' &&
            capabilityMatchesAlbum &&
            capability.status === 'error' && (
              <p
                id={statusId}
                className="mt-3 text-sm text-stone-600"
                role="status"
              >
                目前無法確認這個相簿是否符合啟用條件。請重新整理相簿頁面後再試。
              </p>
            )}
          {activationState === 'idle' &&
            capabilityMatchesAlbum &&
            capability.status === 'ready' &&
            !capability.enabled && (
              <p
                id={statusId}
                className="mt-3 text-sm text-stone-600"
                role="status"
              >
                目前無法啟用這個相簿。
              </p>
            )}

          {activationState === 'submitting' && (
            <p id={statusId} className="mt-3 text-sm" role="status">
              正在啟用相簿…
            </p>
          )}
          {activationState === 'unknown' && (
            <div className="mt-3" id={statusId}>
              <p className="text-sm text-amber-900" role="alert">
                上次啟用結果尚未確認。請留在此頁面，使用同一筆請求重試；
                重試會保留原始相簿版本與請求編號。
              </p>
              <p className="mt-1 text-sm text-stone-600">
                這筆恢復資訊只保存在目前頁面中，離開或重新載入後無法在此恢復。
              </p>
              <Button
                id={retryButtonId}
                type="button"
                className="mt-3"
                onClick={retryUnknownIntent}
              >
                使用同一筆請求重試
              </Button>
            </div>
          )}
          {activationState === 'conflict' && (
            <div className="mt-3">
              <p
                id={statusId}
                className="text-sm text-amber-900"
                role="alert"
                tabIndex={-1}
              >
                相簿狀態已變更，這次啟用要求與目前版本不符。請先重新整理相簿狀態，再確認下一步。
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  const currentPropsAlreadyChanged =
                    conflictRevision !== null &&
                    album.revision !== conflictRevision;
                  conflictRefreshRequested.current = true;
                  router.refresh();
                  if (currentPropsAlreadyChanged) {
                    conflictRefreshRequested.current = false;
                    setConflictRevision(null);
                    clearIntent();
                    setConfirmationOpen(false);
                    setActivationState('idle');
                  }
                }}
              >
                重新整理相簿狀態
              </Button>
            </div>
          )}
          {activationState === 'locked' && (
            <p
              id={statusId}
              className="mt-3 text-sm text-rose-800"
              role="alert"
            >
              目前無法執行啟用操作，請確認管理者登入狀態與相簿權限。
            </p>
          )}
          {activationState === 'error' && (
            <p
              id={statusId}
              className="mt-3 text-sm text-rose-800"
              role="alert"
            >
              相簿目前無法啟用。請先重新整理相簿狀態，再試一次。
            </p>
          )}
          {activationState === 'succeeded' && (
            <p
              id={statusId}
              className="mt-3 text-sm text-emerald-800"
              role="status"
            >
              相簿已啟用，正在更新相簿狀態。
            </p>
          )}
          {activationState === 'idle' &&
            capabilityMatchesAlbum &&
            capability.status === 'ready' &&
            capability.enabled && (
              <p id={statusId} className="sr-only">
                請確認相簿啟用說明。
              </p>
            )}

          <div className="mt-4 flex flex-wrap gap-3">
            {(activationState === 'idle' ||
              activationState === 'submitting') && (
              <Button
                id={confirmButtonId}
                type="button"
                disabled={
                  activationState === 'submitting' ||
                  !capabilityMatchesAlbum ||
                  capability.status !== 'ready' ||
                  !capability.enabled
                }
                onClick={confirmActivation}
              >
                {activationState === 'submitting' ? '啟用中…' : '確認啟用相簿'}
              </Button>
            )}

            {(activationState === 'idle' ||
              activationState === 'locked' ||
              activationState === 'error') && (
              <Button
                type="button"
                variant="outline"
                onClick={cancelConfirmation}
              >
                取消
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
