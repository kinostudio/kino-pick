import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  matchingFilenameIndexCapabilitiesSchema,
  matchingFilenameIndexStatusSchema,
  type MatchingFilenameIndexStatus,
} from '../../../packages/contracts/src/matching-filename-index';

const ownerResponseSchema = z.object({
  actor: z.object({ id: z.uuid() }),
  role: z.literal('owner'),
});
const apiErrorResponseSchema = z.object({
  error: z.object({ code: z.string().min(1) }),
});

type PanelState =
  | {
      scopeKey: string;
      phase: 'checking' | 'loading' | 'suspended' | 'disabled';
    }
  | {
      scopeKey: string;
      phase: 'submitting';
      status: MatchingFilenameIndexStatus;
    }
  | {
      scopeKey: string;
      phase: 'ready';
      ownerId: string;
      status: MatchingFilenameIndexStatus;
    }
  | { scopeKey: string; phase: 'error'; message: string };

class MatchingIndexApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiError(statusCode: number, body: unknown) {
  const parsed = apiErrorResponseSchema.safeParse(body);
  return new MatchingIndexApiError(
    statusCode,
    parsed.success ? parsed.data.error.code : 'SERVICE_UNAVAILABLE',
  );
}

async function verifyCurrentOwner(
  expectedOwnerId: string | null,
  signal: AbortSignal,
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (expectedOwnerId !== null)
    headers['X-Kino-Expected-Actor'] = expectedOwnerId;
  const response = await fetch('/api/v1/me', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw apiError(response.status, body);
  const owner = ownerResponseSchema.safeParse(body);
  if (!owner.success)
    throw new MatchingIndexApiError(503, 'INVALID_OWNER_RESPONSE');
  if (expectedOwnerId !== null && owner.data.actor.id !== expectedOwnerId) {
    throw new MatchingIndexApiError(409, 'OWNER_CHANGED');
  }
  return owner.data.actor.id;
}

async function readCapabilities(ownerId: string, signal: AbortSignal) {
  const response = await fetch('/api/v1/matching-filename-index/capabilities', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-Kino-Expected-Actor': ownerId,
    },
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw apiError(response.status, body);
  const capabilities = matchingFilenameIndexCapabilitiesSchema.safeParse(body);
  if (!capabilities.success)
    throw new MatchingIndexApiError(503, 'INVALID_MATCHING_INDEX_CAPABILITY');
  return capabilities.data;
}

function parseStatus(body: unknown, scope: Scope) {
  const parsed = matchingFilenameIndexStatusSchema.safeParse(body);
  if (!parsed.success)
    throw new MatchingIndexApiError(503, 'INVALID_MATCHING_INDEX_STATUS');
  if (
    parsed.data.workspaceId !== scope.workspaceId ||
    parsed.data.projectId !== scope.projectId ||
    parsed.data.albumId !== scope.albumId
  ) {
    throw new MatchingIndexApiError(409, 'MATCHING_INDEX_SCOPE_CHANGED');
  }
  return parsed.data;
}

type Scope = {
  workspaceId: string;
  projectId: string;
  albumId: string;
};

async function readStatus(scope: Scope, ownerId: string, signal: AbortSignal) {
  const response = await fetch(
    '/api/v1/albums/' +
      encodeURIComponent(scope.albumId) +
      '/matching-filename-index',
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Kino-Expected-Actor': ownerId,
      },
      signal,
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw apiError(response.status, body);
  return parseStatus(body, scope);
}

async function buildNextBatch(
  scope: Scope,
  ownerId: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    '/api/v1/albums/' +
      encodeURIComponent(scope.albumId) +
      '/matching-filename-index',
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Kino-Expected-Actor': ownerId,
      },
      body: JSON.stringify({}),
      signal,
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw apiError(response.status, body);
  return parseStatus(body, scope);
}

function isIdentityError(error: unknown) {
  return (
    error instanceof MatchingIndexApiError &&
    (error.statusCode === 401 ||
      error.statusCode === 403 ||
      /AUTH_REQUIRED|OWNER_REQUIRED|OWNER_CHANGED|EXPECTED_ACTOR/u.test(
        error.code,
      ))
  );
}

function isFeatureDisabled(error: unknown) {
  return (
    error instanceof MatchingIndexApiError &&
    /MATCHING.*INDEX.*DISABLED|CAPABILITY.*DISABLED/u.test(error.code)
  );
}

function errorMessage(error: unknown, uncertainWrite: boolean) {
  if (isIdentityError(error))
    return '管理者登入身分已變更或失效。索引資料已清除，請重新登入後再載入。';
  if (uncertainWrite)
    return '此批次結果尚未確認。請先重新整理索引狀態；系統不會自動重送。';
  return '目前無法確認檔名索引狀態，請重新整理索引狀態後再試。';
}

function statusLabel(status: MatchingFilenameIndexStatus['state']) {
  if (status === 'ready') return '已就緒';
  if (status === 'blocked') return '受阻';
  return '建立中';
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded border border-stone-200 bg-stone-50 p-3">
      <dt className="break-words text-xs text-stone-600">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold text-stone-900">
        {value}
      </dd>
    </div>
  );
}

export function MatchingFilenameIndexPanel({
  workspaceId,
  projectId,
  albumId,
}: Scope) {
  const scopeKey = [workspaceId, projectId, albumId].join(':');
  const titleId = 'matching-filename-index-title-' + albumId;
  const scope = useMemo(
    () => ({ workspaceId, projectId, albumId }),
    [albumId, projectId, workspaceId],
  );
  const validScope =
    z.uuid().safeParse(workspaceId).success &&
    z.uuid().safeParse(projectId).success &&
    z.uuid().safeParse(albumId).success;
  const initiallySuspended =
    typeof document !== 'undefined' &&
    (document.hidden || !document.hasFocus());
  const [panel, setPanel] = useState<PanelState>(() => ({
    scopeKey,
    phase: initiallySuspended ? 'suspended' : 'checking',
  }));
  const panelRef = useRef(panel);
  const scopeKeyRef = useRef(scopeKey);
  const generation = useRef(0);
  const suspended = useRef(initiallySuspended);
  const controller = useRef<AbortController | null>(null);
  const batchButton = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const batchWasFocused = useRef(false);

  const write = useCallback((next: PanelState) => {
    panelRef.current = next;
    setPanel(next);
  }, []);

  const abortCurrent = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const isCurrent = useCallback(
    (
      expectedGeneration: number,
      expectedScopeKey: string,
      signal: AbortSignal,
    ) =>
      generation.current === expectedGeneration &&
      scopeKeyRef.current === expectedScopeKey &&
      !suspended.current &&
      !signal.aborted,
    [],
  );

  const begin = useCallback(
    (
      operation:
        | { phase: 'checking'; scopeKey: string }
        | {
            phase: 'submitting';
            scopeKey: string;
            status: MatchingFilenameIndexStatus;
          },
    ) => {
      abortCurrent();
      const expectedGeneration = ++generation.current;
      const nextController = new AbortController();
      controller.current = nextController;
      if (operation.phase === 'submitting') {
        write({
          scopeKey: operation.scopeKey,
          phase: 'submitting',
          status: operation.status,
        });
      } else {
        write({ scopeKey: operation.scopeKey, phase: operation.phase });
      }
      return { expectedGeneration, controller: nextController };
    },
    [abortCurrent, write],
  );

  const load = useCallback(() => {
    if (suspended.current) return;
    const expectedScopeKey = scopeKey;
    const { expectedGeneration, controller: request } = begin({
      phase: 'checking',
      scopeKey: expectedScopeKey,
    });

    void (async () => {
      try {
        if (!validScope)
          throw new MatchingIndexApiError(503, 'INVALID_MATCHING_INDEX_SCOPE');
        const ownerId = await verifyCurrentOwner(null, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;

        const capabilities = await readCapabilities(ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        await verifyCurrentOwner(ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        if (!capabilities.enabled) {
          write({ scopeKey: expectedScopeKey, phase: 'disabled' });
          return;
        }

        write({ scopeKey: expectedScopeKey, phase: 'loading' });
        const status = await readStatus(scope, ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        await verifyCurrentOwner(ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        write({ scopeKey: expectedScopeKey, phase: 'ready', ownerId, status });
      } catch (error) {
        if (
          !isCurrent(expectedGeneration, expectedScopeKey, request.signal) ||
          isAbort(error)
        )
          return;
        if (isFeatureDisabled(error)) {
          write({ scopeKey: expectedScopeKey, phase: 'disabled' });
          return;
        }
        write({
          scopeKey: expectedScopeKey,
          phase: 'error',
          message: errorMessage(error, false),
        });
      } finally {
        if (controller.current === request) controller.current = null;
      }
    })();
  }, [begin, isCurrent, scope, scopeKey, validScope, write]);

  const submitNextBatch = useCallback(() => {
    const currentPanel = panelRef.current;
    if (
      suspended.current ||
      currentPanel.scopeKey !== scopeKey ||
      currentPanel.phase !== 'ready' ||
      currentPanel.status.missingSessions <= 0
    ) {
      return;
    }

    batchWasFocused.current = document.activeElement === batchButton.current;
    const expectedScopeKey = scopeKey;
    const { expectedGeneration, controller: request } = begin({
      phase: 'submitting',
      scopeKey: expectedScopeKey,
      status: currentPanel.status,
    });
    void (async () => {
      try {
        if (!validScope)
          throw new MatchingIndexApiError(503, 'INVALID_MATCHING_INDEX_SCOPE');
        const ownerId = currentPanel.ownerId;
        await verifyCurrentOwner(ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        const capabilities = await readCapabilities(ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        await verifyCurrentOwner(ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        if (!capabilities.enabled) {
          write({ scopeKey: expectedScopeKey, phase: 'disabled' });
          return;
        }

        const status = await buildNextBatch(scope, ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        await verifyCurrentOwner(ownerId, request.signal);
        if (!isCurrent(expectedGeneration, expectedScopeKey, request.signal))
          return;
        write({ scopeKey: expectedScopeKey, phase: 'ready', ownerId, status });
        if (batchWasFocused.current && status.missingSessions === 0) {
          window.requestAnimationFrame(() => refreshButton.current?.focus());
        }
        batchWasFocused.current = false;
      } catch (error) {
        if (
          !isCurrent(expectedGeneration, expectedScopeKey, request.signal) ||
          isAbort(error)
        )
          return;
        if (isFeatureDisabled(error)) {
          write({ scopeKey: expectedScopeKey, phase: 'disabled' });
          return;
        }
        write({
          scopeKey: expectedScopeKey,
          phase: 'error',
          message: errorMessage(error, true),
        });
        if (batchWasFocused.current) {
          window.requestAnimationFrame(() => refreshButton.current?.focus());
        }
        batchWasFocused.current = false;
      } finally {
        if (controller.current === request) controller.current = null;
      }
    })();
  }, [begin, isCurrent, scope, scopeKey, validScope, write]);

  useEffect(() => {
    scopeKeyRef.current = scopeKey;
    if (suspended.current) {
      write({ scopeKey, phase: 'suspended' });
    } else {
      load();
    }
    return () => {
      generation.current += 1;
      abortCurrent();
    };
  }, [abortCurrent, load, scopeKey, write]);

  const hide = useCallback(() => {
    if (suspended.current || panelRef.current.phase === 'disabled') return;
    suspended.current = true;
    generation.current += 1;
    abortCurrent();
    batchWasFocused.current = false;
    write({ scopeKey, phase: 'suspended' });
  }, [abortCurrent, scopeKey, write]);

  const show = useCallback(() => {
    if (
      !suspended.current ||
      document.hidden ||
      document.visibilityState === 'hidden'
    ) {
      return;
    }
    suspended.current = false;
    load();
  }, [load]);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden || document.visibilityState === 'hidden') hide();
      else show();
    };
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    if (document.hidden || document.visibilityState === 'hidden') hide();
    return () => {
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [hide, show]);

  const visiblePanel =
    panel.scopeKey === scopeKey
      ? panel
      : ({ scopeKey, phase: 'checking' } satisfies PanelState);
  if (visiblePanel.phase === 'disabled') return null;

  const busy =
    visiblePanel.phase === 'checking' ||
    visiblePanel.phase === 'loading' ||
    visiblePanel.phase === 'submitting';
  const status = visiblePanel.phase === 'ready' ? visiblePanel.status : null;
  const batchAvailable =
    status !== null
      ? status.missingSessions > 0
      : visiblePanel.phase === 'submitting' &&
        visiblePanel.status.missingSessions > 0;
  const statusIsBlocked = status?.state === 'blocked';
  const blockers = status
    ? [
        ...(status.invalidSessions > 0
          ? ['無效工作階段：' + status.invalidSessions + ' 筆']
          : []),
        ...(status.unlinkedVersions > 0
          ? ['未連結版本：' + status.unlinkedVersions + ' 個']
          : []),
        ...(status.unreadyPhotos > 0
          ? ['尚未就緒照片：' + status.unreadyPhotos + ' 張']
          : []),
      ]
    : [];

  return (
    <section
      data-testid="matching-filename-index-panel"
      aria-labelledby={titleId}
      aria-busy={busy}
      className="mt-4 min-w-0 rounded-md border border-stone-200 bg-white p-4"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h4
            id={titleId}
            className="break-words text-sm font-semibold text-stone-900"
          >
            整理檔名比對資料
          </h4>
        </div>
        {status && (
          <span
            className="w-fit shrink-0 rounded border border-stone-300 px-2 py-1 text-xs text-stone-700"
            aria-label={'索引狀態：' + statusLabel(status.state)}
          >
            {statusLabel(status.state)}
          </span>
        )}
      </div>
      {status && (
        <p
          className="mt-1 text-xs text-stone-600"
          role="status"
          aria-live="polite"
        >
          索引狀態：{statusLabel(status.state)}
        </p>
      )}
      <p className="mt-2 text-sm text-stone-600">
        目前僅供本機使用；自動比對須另行開啟專案設定。整理結果不會更改照片或自動合併版本。
      </p>

      {visiblePanel.phase === 'checking' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在載入索引狀態…
        </p>
      )}
      {visiblePanel.phase === 'loading' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在載入索引狀態…
        </p>
      )}
      {visiblePanel.phase === 'submitting' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在建立下一批索引…
        </p>
      )}
      {visiblePanel.phase === 'suspended' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          視窗重新取得焦點後，會重新載入索引狀態。
        </p>
      )}
      {visiblePanel.phase === 'error' && (
        <p className="mt-3 text-sm text-amber-900" role="alert">
          {visiblePanel.message}
        </p>
      )}

      {status && (
        <>
          <dl className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5">
            <Count label="已索引工作階段" value={status.indexedSessions} />
            <Count label="待建立工作階段" value={status.missingSessions} />
            <Count label="無效工作階段" value={status.invalidSessions} />
            <Count label="未連結版本" value={status.unlinkedVersions} />
            <Count label="尚未就緒照片" value={status.unreadyPhotos} />
          </dl>

          {status.state === 'ready' && (
            <p className="mt-3 rounded-md bg-stone-50 p-3 text-sm text-stone-700">
              索引已就緒；實際比對仍會檢查完整歷史與上傳狀態。整理結果不會更改照片或自動合併版本。
            </p>
          )}
          {status.state === 'building' && (
            <p className="mt-3 text-sm text-stone-700" role="status">
              索引資料整理中。
            </p>
          )}
          {statusIsBlocked && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-stone-800">
                索引目前受阻，請先處理下列項目：
              </p>
              {blockers.length > 0 ? (
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-700">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-stone-700">
                  服務回報目前無法繼續建立索引，請稍後重新整理狀態。
                </p>
              )}
            </div>
          )}

          {status.missingSessions > 0 && (
            <p className="mt-3 text-sm text-stone-700">
              尚有 {status.missingSessions} 個工作階段待建立索引。
            </p>
          )}
        </>
      )}

      <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
        {batchAvailable && (
          <button
            ref={batchButton}
            type="button"
            className="min-h-11 w-full min-w-0 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            disabled={busy || visiblePanel.phase === 'suspended'}
            onClick={submitNextBatch}
          >
            {visiblePanel.phase === 'submitting' ? '建立中…' : '建立下一批索引'}
          </button>
        )}
        {visiblePanel.phase !== 'suspended' && (
          <button
            ref={refreshButton}
            type="button"
            className="min-h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            disabled={busy}
            onClick={load}
          >
            {busy ? '重新整理中…' : '重新整理索引狀態'}
          </button>
        )}
      </div>
    </section>
  );
}
