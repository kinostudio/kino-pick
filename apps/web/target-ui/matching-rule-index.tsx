'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import {
  getMatchingProfile,
  type MatchingProfileId,
} from '../../../packages/domain/src/matching-profiles';
import {
  advanceMatchingRuleIndexSchema,
  matchingRulesCapabilitiesSchema,
  matchingRuleIndexStatusSchema,
  type MatchingRuleIndexStatus,
} from '../../../packages/contracts/src/matching-rules';

type OwnerIdentity = Readonly<{ actorId: string; sessionId: string }>;
type AlbumScope = Readonly<{
  workspaceId: string;
  projectId: string;
  albumId: string;
}>;
type PanelState =
  | {
      scopeKey: string;
      phase: 'checking' | 'loading' | 'suspended' | 'disabled';
    }
  | {
      scopeKey: string;
      phase: 'submitting';
      owner: OwnerIdentity;
      status: MatchingRuleIndexStatus;
    }
  | {
      scopeKey: string;
      phase: 'ready';
      owner: OwnerIdentity;
      status: MatchingRuleIndexStatus;
    }
  | { scopeKey: string; phase: 'error'; message: string };

// Better Auth returns additional user/session metadata. Extract identity only;
// never reject its legitimate fields or retain them in recovery metadata.
const ownerSessionSchema = z.object({
  user: z.object({ id: z.uuid() }),
  session: z.object({ id: z.string().min(1).max(512) }),
});
const apiErrorSchema = z
  .object({ error: z.object({ code: z.string().min(1) }).strict() })
  .strict();

class MatchingRuleIndexApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Matching rule index request failed');
  }
}

class OwnerChangedError extends Error {
  constructor(readonly current: OwnerIdentity | null) {
    super('Owner identity changed during index request');
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

function apiCode(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.error.code : 'SERVICE_UNAVAILABLE';
}

function sameOwner(left: OwnerIdentity, right: OwnerIdentity) {
  return left.actorId === right.actorId && left.sessionId === right.sessionId;
}

async function readOwnerIdentity(signal?: AbortSignal): Promise<OwnerIdentity> {
  const response = await fetch('/api/auth/get-session', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const body = await readJson(response);
  if (!response.ok)
    throw new MatchingRuleIndexApiError(response.status, apiCode(body));
  const parsed = ownerSessionSchema.safeParse(body);
  if (!parsed.success)
    throw new MatchingRuleIndexApiError(401, 'OWNER_REQUIRED');
  return {
    actorId: parsed.data.user.id,
    sessionId: parsed.data.session.id,
  };
}

async function requestWithOwner(
  expectedOwner: OwnerIdentity,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const before = await readOwnerIdentity(init.signal ?? undefined);
  if (!sameOwner(before, expectedOwner)) throw new OwnerChangedError(before);

  let response: Response | null = null;
  let body: unknown = null;
  let requestError: unknown = null;
  try {
    response = await fetch(url, init);
    body = await readJson(response);
  } catch (error) {
    requestError = error;
  }

  let after: OwnerIdentity;
  try {
    after = await readOwnerIdentity(init.signal ?? undefined);
  } catch {
    throw new OwnerChangedError(null);
  }
  if (!sameOwner(before, after) || !sameOwner(expectedOwner, after))
    throw new OwnerChangedError(after);
  if (requestError) throw requestError;
  if (!response) throw new MatchingRuleIndexApiError(0, 'REQUEST_FAILED');
  return { response, body };
}

function statusPath(albumId: string) {
  return (
    '/api/v1/albums/' + encodeURIComponent(albumId) + '/matching-rule-index'
  );
}

function parseStatus(
  body: unknown,
  albumId: string,
  expectedScope: AlbumScope | null,
) {
  const parsed = matchingRuleIndexStatusSchema.safeParse(body);
  if (!parsed.success || parsed.data.albumId !== albumId)
    throw new MatchingRuleIndexApiError(503, 'INVALID_MATCHING_RULE_INDEX');
  if (
    expectedScope &&
    (parsed.data.workspaceId !== expectedScope.workspaceId ||
      parsed.data.projectId !== expectedScope.projectId ||
      parsed.data.albumId !== expectedScope.albumId)
  )
    throw new MatchingRuleIndexApiError(
      409,
      'MATCHING_RULE_INDEX_SCOPE_CHANGED',
    );
  return parsed.data;
}

async function readCapabilities(owner: OwnerIdentity, signal: AbortSignal) {
  const { response, body } = await requestWithOwner(
    owner,
    '/api/v1/matching-rules/capabilities',
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Kino-Expected-Actor': owner.actorId,
      },
      signal,
    },
  );
  if (!response.ok)
    throw new MatchingRuleIndexApiError(response.status, apiCode(body));
  const parsed = matchingRulesCapabilitiesSchema.safeParse(body);
  if (!parsed.success)
    throw new MatchingRuleIndexApiError(
      503,
      'INVALID_MATCHING_RULE_CAPABILITY',
    );
  return parsed.data;
}

async function readStatus(
  albumId: string,
  owner: OwnerIdentity,
  expectedScope: AlbumScope | null,
  signal: AbortSignal,
) {
  const { response, body } = await requestWithOwner(
    owner,
    statusPath(albumId),
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Kino-Expected-Actor': owner.actorId,
      },
      signal,
    },
  );
  if (!response.ok)
    throw new MatchingRuleIndexApiError(response.status, apiCode(body));
  return parseStatus(body, albumId, expectedScope);
}

async function advanceIndex(
  albumId: string,
  owner: OwnerIdentity,
  status: MatchingRuleIndexStatus,
  signal: AbortSignal,
) {
  const body = advanceMatchingRuleIndexSchema.parse({
    expectedProjectRevision: status.projectRevision,
    expectedRuleRevision: status.ruleRevision,
    profile: status.profile,
  });
  const expectedScope: AlbumScope = {
    workspaceId: status.workspaceId,
    projectId: status.projectId,
    albumId: status.albumId,
  };
  const { response, body: responseBody } = await requestWithOwner(
    owner,
    statusPath(albumId),
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Kino-Expected-Actor': owner.actorId,
      },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!response.ok)
    throw new MatchingRuleIndexApiError(response.status, apiCode(responseBody));
  return parseStatus(responseBody, albumId, expectedScope);
}

function isIdentityError(error: unknown) {
  return (
    error instanceof OwnerChangedError ||
    (error instanceof MatchingRuleIndexApiError &&
      (error.status === 401 ||
        error.status === 403 ||
        /OWNER|AUTH|EXPECTED_ACTOR/u.test(error.code)))
  );
}

function isDisabled(error: unknown) {
  return (
    error instanceof MatchingRuleIndexApiError &&
    (error.code === 'DISABLED' || /MATCHING_RULE.*DISABLED/u.test(error.code))
  );
}

function errorMessage(error: unknown) {
  if (error instanceof MatchingRuleIndexApiError && error.status === 409)
    return '索引狀態或專案規則已更新。舊狀態已清除，請明確重新整理後再繼續。';
  if (isIdentityError(error))
    return '登入身分或相簿權限已變更。索引狀態已清除，請重新確認後載入。';
  if (error instanceof MatchingRuleIndexApiError && error.status === 404)
    return '目前無法查看這個相簿的索引狀態。';
  if (error instanceof MatchingRuleIndexApiError && error.status === 503)
    return '目前無法確認這組規則的索引狀態，請重新整理。';
  return '索引狀態尚未確認。請重新整理狀態後再決定是否建立下一批。';
}

function ruleSummary(profileId: MatchingProfileId) {
  const profile = getMatchingProfile(profileId);
  if (!profile) return '目前設定無法驗證';
  return [
    profile.rules.caseSensitive ? '區分大小寫' : '忽略大小寫',
    profile.rules.allowJpgJpegEquivalence
      ? 'JPG 與 JPEG 視為相同'
      : 'JPG 與 JPEG 分開比對',
    profile.rules.stripRecognizedSuffixes
      ? '忽略一個已知檔名後綴'
      : '保留檔名後綴',
  ].join('、');
}

function statusLabel(state: MatchingRuleIndexStatus['state']) {
  if (state === 'ready') return '已就緒';
  if (state === 'blocked') return '受阻';
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

export function MatchingRuleIndexPanel({
  albumId,
  disabled = false,
}: {
  albumId: string;
  disabled?: boolean;
}) {
  const titleId = useId();
  const scopeKey = albumId;
  const initiallySuspended =
    disabled ||
    (typeof document !== 'undefined' &&
      (document.hidden ||
        document.visibilityState === 'hidden' ||
        !document.hasFocus()));
  const [panel, setPanel] = useState<PanelState>(() => ({
    scopeKey,
    phase: initiallySuspended ? 'suspended' : 'checking',
  }));
  const panelRef = useRef(panel);
  const scopeKeyRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const suspendedRef = useRef(initiallySuspended);
  const controllerRef = useRef<AbortController | null>(null);
  const ownerRef = useRef<OwnerIdentity | null>(null);
  const expectedScopeRef = useRef<AlbumScope | null>(null);
  const mountedRef = useRef(false);
  const identityCheckRef = useRef(false);
  const batchButtonRef = useRef<HTMLButtonElement | null>(null);
  const refreshButtonRef = useRef<HTMLButtonElement | null>(null);
  const batchWasFocusedRef = useRef(false);

  const write = useCallback((next: PanelState) => {
    panelRef.current = next;
    setPanel(next);
  }, []);

  const abortCurrent = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const isCurrent = useCallback(
    (generation: number, requestedScope: string, signal: AbortSignal) =>
      generationRef.current === generation &&
      scopeKeyRef.current === requestedScope &&
      !suspendedRef.current &&
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
            status: MatchingRuleIndexStatus;
            owner: OwnerIdentity;
          },
    ) => {
      abortCurrent();
      const generation = ++generationRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;
      ownerRef.current =
        operation.phase === 'submitting' ? operation.owner : null;
      if (operation.phase === 'submitting') {
        write({
          scopeKey: operation.scopeKey,
          phase: operation.phase,
          status: operation.status,
          owner: operation.owner,
        });
      } else {
        write({ scopeKey: operation.scopeKey, phase: operation.phase });
      }
      return { generation, controller };
    },
    [abortCurrent, write],
  );

  const hidePrivateState = useCallback(
    (message: string) => {
      generationRef.current += 1;
      abortCurrent();
      ownerRef.current = null;
      expectedScopeRef.current = null;
      batchWasFocusedRef.current = false;
      write({ scopeKey, phase: 'error', message });
    },
    [abortCurrent, scopeKey, write],
  );

  const load = useCallback(() => {
    if (disabled || suspendedRef.current) return;
    const requestedScope = scopeKey;
    const { generation, controller } = begin({
      phase: 'checking',
      scopeKey: requestedScope,
    });
    const isActive = () =>
      isCurrent(generation, requestedScope, controller.signal);

    void (async () => {
      try {
        if (!z.uuid().safeParse(albumId).success)
          throw new MatchingRuleIndexApiError(503, 'INVALID_ALBUM_SCOPE');
        const owner = await readOwnerIdentity(controller.signal);
        if (!isActive()) return;
        ownerRef.current = owner;

        const capabilities = await readCapabilities(owner, controller.signal);
        if (!isActive()) return;
        if (!capabilities.enabled) {
          ownerRef.current = null;
          write({ scopeKey: requestedScope, phase: 'disabled' });
          return;
        }

        write({ scopeKey: requestedScope, phase: 'loading' });
        const status = await readStatus(
          albumId,
          owner,
          expectedScopeRef.current,
          controller.signal,
        );
        if (!isActive()) return;
        expectedScopeRef.current = {
          workspaceId: status.workspaceId,
          projectId: status.projectId,
          albumId: status.albumId,
        };
        if (status.profile === 'default-v1') {
          ownerRef.current = null;
          write({ scopeKey: requestedScope, phase: 'disabled' });
          return;
        }
        write({ scopeKey: requestedScope, phase: 'ready', owner, status });
      } catch (error) {
        if (!isActive() || isAbort(error)) return;
        if (isDisabled(error)) {
          ownerRef.current = null;
          expectedScopeRef.current = null;
          write({ scopeKey: requestedScope, phase: 'disabled' });
          return;
        }
        if (isIdentityError(error)) {
          ownerRef.current = null;
          expectedScopeRef.current = null;
        } else if (
          error instanceof MatchingRuleIndexApiError &&
          error.status === 409
        ) {
          expectedScopeRef.current = null;
        }
        write({
          scopeKey: requestedScope,
          phase: 'error',
          message: errorMessage(error),
        });
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    })();
  }, [albumId, begin, disabled, isCurrent, scopeKey, write]);

  const advance = useCallback(() => {
    const current = panelRef.current;
    if (
      disabled ||
      suspendedRef.current ||
      current.scopeKey !== scopeKey ||
      current.phase !== 'ready' ||
      current.status.state !== 'building' ||
      current.status.missingSessions === 0
    )
      return;

    batchWasFocusedRef.current =
      document.activeElement === batchButtonRef.current;
    const requestedScope = scopeKey;
    const { generation, controller } = begin({
      phase: 'submitting',
      scopeKey: requestedScope,
      status: current.status,
      owner: current.owner,
    });
    const isActive = () =>
      isCurrent(generation, requestedScope, controller.signal);

    void (async () => {
      try {
        const status = await advanceIndex(
          albumId,
          current.owner,
          current.status,
          controller.signal,
        );
        if (!isActive()) return;
        expectedScopeRef.current = {
          workspaceId: status.workspaceId,
          projectId: status.projectId,
          albumId: status.albumId,
        };
        write({
          scopeKey: requestedScope,
          phase: 'ready',
          owner: current.owner,
          status,
        });
        if (batchWasFocusedRef.current && status.state !== 'building') {
          window.requestAnimationFrame(() => refreshButtonRef.current?.focus());
        }
        batchWasFocusedRef.current = false;
      } catch (error) {
        if (!isActive() || isAbort(error)) return;
        ownerRef.current = null;
        expectedScopeRef.current = null;
        write({
          scopeKey: requestedScope,
          phase: 'error',
          message: errorMessage(error),
        });
        if (batchWasFocusedRef.current) {
          window.requestAnimationFrame(() => refreshButtonRef.current?.focus());
        }
        batchWasFocusedRef.current = false;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    })();
  }, [albumId, begin, disabled, isCurrent, scopeKey, write]);

  const hide = useCallback(() => {
    if (suspendedRef.current) return;
    suspendedRef.current = true;
    generationRef.current += 1;
    abortCurrent();
    ownerRef.current = null;
    expectedScopeRef.current = null;
    batchWasFocusedRef.current = false;
    write({ scopeKey, phase: 'suspended' });
  }, [abortCurrent, scopeKey, write]);

  const show = useCallback(() => {
    if (
      disabled ||
      !suspendedRef.current ||
      document.hidden ||
      document.visibilityState === 'hidden'
    )
      return;
    suspendedRef.current = false;
    load();
  }, [disabled, load]);

  useEffect(() => {
    mountedRef.current = true;
    scopeKeyRef.current = scopeKey;
    if (
      disabled ||
      document.hidden ||
      document.visibilityState === 'hidden' ||
      !document.hasFocus()
    ) {
      suspendedRef.current = true;
      generationRef.current += 1;
      abortCurrent();
      ownerRef.current = null;
      expectedScopeRef.current = null;
      /* eslint-disable react-hooks/set-state-in-effect */
      write({ scopeKey, phase: 'suspended' });
      /* eslint-enable react-hooks/set-state-in-effect */
    } else {
      suspendedRef.current = false;
      load();
    }
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortCurrent();
      ownerRef.current = null;
      expectedScopeRef.current = null;
    };
  }, [abortCurrent, disabled, load, scopeKey, write]);

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

  useEffect(() => {
    const current = panelRef.current;
    if (current.scopeKey !== scopeKey || current.phase !== 'ready' || disabled)
      return;
    let active = true;
    const owner = current.owner;
    const check = () => {
      if (document.hidden || identityCheckRef.current) return;
      identityCheckRef.current = true;
      void readOwnerIdentity()
        .then((latest) => {
          if (!active || !mountedRef.current || sameOwner(owner, latest))
            return;
          hidePrivateState(
            '登入身分已變更。索引資料已清除，請重新整理以載入目前帳號可查看的狀態。',
          );
        })
        .catch(() => {
          if (!active || !mountedRef.current) return;
          hidePrivateState('登入狀態無法確認。索引資料已清除，請重新載入。');
        })
        .finally(() => {
          identityCheckRef.current = false;
        });
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      active = false;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [disabled, hidePrivateState, panel, scopeKey]);

  const visiblePanel =
    !disabled && panel.scopeKey === scopeKey
      ? panel
      : ({ scopeKey, phase: 'suspended' } satisfies PanelState);
  if (visiblePanel.phase === 'disabled') return null;

  const busy =
    visiblePanel.phase === 'checking' ||
    visiblePanel.phase === 'loading' ||
    visiblePanel.phase === 'submitting';
  const status = visiblePanel.phase === 'ready' ? visiblePanel.status : null;
  if (status?.profile === 'default-v1') return null;
  const blockers = status
    ? [
        ...(status.invalidSessions > 0
          ? ['相關無效工作階段：' + status.invalidSessions + ' 筆']
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
      data-testid="matching-rule-index"
      aria-labelledby={titleId}
      aria-busy={busy}
      className="mt-4 min-w-0 rounded-md border border-stone-200 bg-white p-4"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3
            id={titleId}
            className="break-words text-sm font-semibold text-stone-900"
          >
            {status ? '整理目前規則的索引資料' : '規則索引狀態'}
          </h3>
          {status && (
            <p className="mt-1 break-words text-xs text-stone-600">
              目前規則：{ruleSummary(status.profile)}
            </p>
          )}
        </div>
        {status && (
          <span
            className="w-fit shrink-0 rounded border border-stone-300 px-2 py-1 text-xs text-stone-700"
            aria-label={'目前索引狀態：' + statusLabel(status.state)}
          >
            {statusLabel(status.state)}
          </span>
        )}
      </div>

      <p className="mt-2 break-words text-sm text-stone-600">
        這項整理只建立目前規則所需的衍生索引資料，不會批准或決定任何上傳目標。
      </p>

      {(visiblePanel.phase === 'checking' ||
        visiblePanel.phase === 'loading') && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在載入目前規則的索引狀態…
        </p>
      )}
      {visiblePanel.phase === 'submitting' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在建立下一批索引資料…
        </p>
      )}
      {visiblePanel.phase === 'suspended' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          視窗重新取得焦點後，會重新載入索引狀態。
        </p>
      )}
      {visiblePanel.phase === 'error' && (
        <p
          className="mt-3 break-words text-sm text-amber-900"
          role="alert"
          data-testid="matching-rule-index-error"
        >
          {visiblePanel.message}
        </p>
      )}

      {status && (
        <>
          <p
            className="mt-3 text-sm text-stone-700"
            role="status"
            aria-live="polite"
            data-testid="matching-rule-index-status"
          >
            目前規則的索引狀態：{statusLabel(status.state)}
          </p>
          <dl className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5">
            <Count label="已建立工作階段" value={status.indexedSessions} />
            <Count label="待建立工作階段" value={status.missingSessions} />
            <Count label="相關無效工作階段" value={status.invalidSessions} />
            <Count label="未連結版本" value={status.unlinkedVersions} />
            <Count label="尚未就緒照片" value={status.unreadyPhotos} />
          </dl>

          {status.state === 'ready' && (
            <p className="mt-3 break-words rounded-md bg-stone-50 p-3 text-sm text-stone-700">
              目前規則的索引資料已整理完成。實際上傳比對仍會另行驗證照片與目標。
            </p>
          )}
          {status.state === 'building' && (
            <p
              className="mt-3 break-words text-sm text-stone-700"
              role="status"
            >
              索引資料尚未完成；每次手動操作最多建立一批，完成後請重新確認狀態。
            </p>
          )}
          {status.state === 'blocked' && (
            <div className="mt-3 min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="break-words text-sm font-medium text-stone-800">
                目前規則的索引整理受阻：
              </p>
              {blockers.length > 0 ? (
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-700">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 break-words text-sm text-stone-700">
                  目前無法繼續建立索引，請稍後重新整理狀態。
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
        {status?.state === 'building' && status.missingSessions > 0 && (
          <button
            ref={batchButtonRef}
            type="button"
            className="min-h-11 w-full min-w-0 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            disabled={busy || disabled}
            onClick={advance}
            data-testid="matching-rule-index-advance"
          >
            建立下一批索引
          </button>
        )}
        {visiblePanel.phase !== 'suspended' && (
          <button
            ref={refreshButtonRef}
            type="button"
            className="min-h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            disabled={busy || disabled}
            onClick={load}
            data-testid="matching-rule-index-refresh"
          >
            {busy ? '正在確認…' : '重新整理索引狀態'}
          </button>
        )}
      </div>
    </section>
  );
}
