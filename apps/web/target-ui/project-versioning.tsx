'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import {
  configurableProjectVersioningModeSchema,
  projectVersioningCapabilitiesSchema,
  projectVersioningReadSchema,
  setProjectVersioningResultSchema,
  setProjectVersioningSchema,
  type ProjectVersioningRead,
} from '../../../packages/contracts/src/project-versioning';

type ConfigurableMode = z.infer<typeof configurableProjectVersioningModeSchema>;
type ProjectMode = ProjectVersioningRead['mode'];
type OwnerIdentity = { actorId: string; sessionId: string };
type CapabilityState =
  | {
      key: string;
      sequence: number;
      status: 'loading' | 'ready' | 'disabled';
    }
  | { key: string; sequence: number; status: 'error'; message: string };
type ReadState =
  | { key: string; sequence: number; status: 'loading' }
  | {
      key: string;
      sequence: number;
      status: 'ready';
      value: ProjectVersioningRead;
    }
  | { key: string; sequence: number; status: 'error'; message: string };
type MutationIntent = {
  projectId: string;
  workspaceId: string;
  actorId: string;
  requestId: string;
  expectedRevision: number;
  mode: ConfigurableMode;
  body: string;
};
type ModeSelection = { key: string; mode: ConfigurableMode | '' };
type Confirmation = { key: string; mode: ConfigurableMode };

const ownerSessionSchema = z.object({
  user: z.object({ id: z.uuid() }),
  session: z.object({ id: z.string().min(1) }),
});

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Project versioning request failed');
  }
}

function errorCode(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return '';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}

function projectPath(projectId: string) {
  return '/api/v1/projects/' + encodeURIComponent(projectId) + '/versioning';
}

async function readOwnerIdentity(signal?: AbortSignal): Promise<OwnerIdentity> {
  const response = await fetch('/api/auth/get-session', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiFailure(response.status, errorCode(body));
  const parsed = ownerSessionSchema.safeParse(body);
  if (!parsed.success) throw new ApiFailure(401, 'OWNER_REQUIRED');
  return {
    actorId: parsed.data.user.id,
    sessionId: parsed.data.session.id,
  };
}

function modeLabel(mode: ProjectMode | ConfigurableMode) {
  switch (mode) {
    case 'off':
      return '關閉';
    case 'manual':
      return '手動';
    case 'auto_filename':
      return '依檔名比對';
    case 'assisted':
      return '輔助比對';
  }
}

function errorMessage(error: unknown) {
  if (error instanceof ApiFailure) {
    if (error.status === 401 || error.status === 403)
      return '管理者登入已失效或目前帳號無權查看這個專案。請重新登入後再試。';
    if (error.status === 503)
      return '專案版本模式目前暫時無法連線，請稍後重試。';
  }
  return '目前無法取得專案版本模式，請稍後重試。';
}

function beforeUnload() {
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}

export function ProjectVersioningConfiguration({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged?: () => void;
}) {
  const key = projectId;
  const titleId = useId();
  const modeId = useId();
  const [capability, setCapability] = useState<CapabilityState | null>(null);
  const [read, setRead] = useState<ReadState | null>(null);
  const [selection, setSelection] = useState<ModeSelection | null>(null);
  const [confirmMode, setConfirmMode] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState('');
  const [reloadSequence, setReloadSequence] = useState(0);
  const [intent, setIntent] = useState<MutationIntent | null>(null);
  const [intentMessage, setIntentMessage] = useState('');
  const [sending, setSending] = useState(false);
  const identityRef = useRef<OwnerIdentity | null>(null);
  const intentRef = useRef<MutationIntent | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const identityCheckRef = useRef(false);
  const mountedRef = useRef(false);
  const notifyChangedAfterReadRef = useRef(false);
  const onChangedRef = useRef(onChanged);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function rememberIntent(next: MutationIntent | null) {
    intentRef.current = next;
    setIntent(next);
    if (!next) setIntentMessage('');
  }

  function isCurrentIntent(attempt: MutationIntent) {
    return (
      mountedRef.current &&
      intentRef.current?.requestId === attempt.requestId &&
      attempt.projectId === projectId
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const requestedKey = key;
    const requestedSequence = reloadSequence;
    identityRef.current = null;

    async function load() {
      const capabilityResponse = await fetch(
        '/api/v1/versioning/capabilities',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      );
      const capabilityBody: unknown = await capabilityResponse
        .json()
        .catch(() => null);
      if (!active || controller.signal.aborted) return;
      if (!capabilityResponse.ok) {
        setCapability({
          key: requestedKey,
          sequence: requestedSequence,
          status: 'error',
          message: errorMessage(
            new ApiFailure(
              capabilityResponse.status,
              errorCode(capabilityBody),
            ),
          ),
        });
        setRead(null);
        return;
      }
      const capabilityResult =
        projectVersioningCapabilitiesSchema.safeParse(capabilityBody);
      if (!capabilityResult.success) {
        setCapability({
          key: requestedKey,
          sequence: requestedSequence,
          status: 'error',
          message: '專案版本模式功能狀態無法驗證，請重新載入。',
        });
        setRead(null);
        return;
      }
      if (!capabilityResult.data.enabled) {
        setCapability({
          key: requestedKey,
          sequence: requestedSequence,
          status: 'disabled',
        });
        setRead(null);
        return;
      }
      setCapability({
        key: requestedKey,
        sequence: requestedSequence,
        status: 'ready',
      });

      const identity = await readOwnerIdentity(controller.signal);
      if (!active || controller.signal.aborted) return;
      identityRef.current = identity;

      const response = await fetch(projectPath(projectId), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!active || controller.signal.aborted) return;
      if (!response.ok) throw new ApiFailure(response.status, errorCode(body));
      const parsed = projectVersioningReadSchema.safeParse(body);
      if (!parsed.success || parsed.data.projectId !== projectId) {
        throw new ApiFailure(200, 'INVALID_PROJECT_VERSIONING_RESPONSE');
      }
      const confirmedIdentity = await readOwnerIdentity(controller.signal);
      if (!active || controller.signal.aborted) return;
      if (
        confirmedIdentity.actorId !== identity.actorId ||
        confirmedIdentity.sessionId !== identity.sessionId
      ) {
        identityRef.current = confirmedIdentity;
        if (confirmedIdentity.actorId !== identity.actorId)
          rememberIntent(null);
        setRead(null);
        setSelection(null);
        setNotice('登入狀態已變更，專案設定已隱藏；正在重新確認目前帳號。');
        setReloadSequence((value) => value + 1);
        return;
      }
      identityRef.current = confirmedIdentity;
      setRead({
        key: requestedKey,
        sequence: requestedSequence,
        status: 'ready',
        value: parsed.data,
      });
      const currentMode = parsed.data.availableModes.includes(parsed.data.mode)
        ? parsed.data.mode
        : '';
      setSelection({ key: requestedKey, mode: currentMode });
      if (notifyChangedAfterReadRef.current) {
        notifyChangedAfterReadRef.current = false;
        setNotice('目前專案版本模式已重新確認。');
        onChangedRef.current?.();
      }
    }

    void load().catch((error: unknown) => {
      if (!active || controller.signal.aborted) return;
      if (
        error instanceof ApiFailure &&
        (error.status === 401 || error.status === 403)
      )
        identityRef.current = null;
      setRead({
        key: requestedKey,
        sequence: requestedSequence,
        status: 'error',
        message: errorMessage(error),
      });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [key, projectId, reloadSequence]);

  useEffect(() => {
    if (!intent) return;
    return beforeUnload();
  }, [intent]);

  useEffect(() => {
    const recheckIdentity = () => {
      if (document.visibilityState === 'hidden' || identityCheckRef.current)
        return;
      const previous = identityRef.current;
      if (!previous) return;
      identityCheckRef.current = true;
      void readOwnerIdentity()
        .then((current) => {
          if (!mountedRef.current) return;
          if (
            current.actorId === previous.actorId &&
            current.sessionId === previous.sessionId
          )
            return;
          identityRef.current = current;
          setRead(null);
          setSelection(null);
          setConfirmMode(null);
          if (current.actorId !== previous.actorId) {
            rememberIntent(null);
            setNotice(
              '登入帳號已變更，舊帳號的專案設定已清除。正在重新確認目前帳號。',
            );
          } else {
            setNotice(
              '登入工作階段已更新，正在重新確認專案設定；未確認操作仍沿用原內容。',
            );
          }
          setReloadSequence((value) => value + 1);
        })
        .catch(() => {
          if (!mountedRef.current) return;
          identityRef.current = null;
          setRead({
            key,
            sequence: reloadSequence,
            status: 'error',
            message: '登入狀態無法確認，專案設定已隱藏。',
          });
          setSelection(null);
          setConfirmMode(null);
          setNotice('登入狀態無法確認，專案設定已隱藏。');
        })
        .finally(() => {
          identityCheckRef.current = false;
        });
    };
    window.addEventListener('focus', recheckIdentity);
    document.addEventListener('visibilitychange', recheckIdentity);
    return () => {
      window.removeEventListener('focus', recheckIdentity);
      document.removeEventListener('visibilitychange', recheckIdentity);
    };
  }, [key, reloadSequence]);

  const currentCapability =
    capability?.key === key && capability.sequence === reloadSequence
      ? capability
      : { key, sequence: reloadSequence, status: 'loading' as const };
  const currentRead =
    read?.key === key && read.sequence === reloadSequence ? read : null;
  const value = currentRead?.status === 'ready' ? currentRead.value : null;
  const currentSelection = selection?.key === key ? selection.mode : '';
  const currentIntent = intent?.projectId === projectId ? intent : null;
  const hasIntent = currentIntent !== null;
  const isSending = sending;
  const selectedChanged = Boolean(
    value && currentSelection !== '' && currentSelection !== value.mode,
  );
  const controlsDisabled = !value || hasIntent || sending;

  function reload() {
    if (intentRef.current) return;
    setConfirmMode(null);
    setNotice('正在重新取得專案版本模式。');
    setReloadSequence((value) => value + 1);
  }

  function chooseMode(mode: ConfigurableMode | '') {
    if (controlsDisabled) return;
    setSelection({ key, mode });
    setConfirmMode(null);
    setNotice('');
  }

  async function sendIntent(attempt: MutationIntent) {
    if (!isCurrentIntent(attempt) || inFlightRef.current !== null) return;
    inFlightRef.current = attempt.requestId;
    setSending(true);
    setIntentMessage('');
    try {
      const identity = await readOwnerIdentity();
      if (!isCurrentIntent(attempt)) return;
      if (identity.actorId !== attempt.actorId) {
        identityRef.current = identity;
        rememberIntent(null);
        setRead(null);
        setSelection(null);
        setNotice(
          '登入帳號已變更，原操作未送出。舊帳號的專案設定已清除，正在重新確認目前帳號。',
        );
        setReloadSequence((value) => value + 1);
        return;
      }
      identityRef.current = identity;
      const response = await fetch(projectPath(attempt.projectId), {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Kino-Expected-Actor': z.uuid().parse(attempt.actorId),
        },
        body: attempt.body,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!isCurrentIntent(attempt)) return;
      const code = errorCode(body);
      if (
        response.status === 409 &&
        code === 'PROJECT_VERSIONING_REVISION_CONFLICT'
      ) {
        rememberIntent(null);
        setConfirmMode(null);
        setNotice('專案版本模式已由其他管理者更新；正在重新取得目前設定。');
        setReloadSequence((value) => value + 1);
        return;
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setRead(null);
        setIntentMessage(
          response.status === 401 || response.status === 403
            ? '登入或管理權限需要重新確認。操作結果仍未確認；重新登入後請重試同一操作。'
            : '操作結果仍未確認。請重試同一操作；原操作編號與內容會保持不變。',
        );
        return;
      }
      const parsed = setProjectVersioningResultSchema.safeParse(body);
      const expectedRevision =
        attempt.expectedRevision +
        (parsed.success && parsed.data.changed ? 1 : 0);
      if (
        !parsed.success ||
        parsed.data.projectId !== attempt.projectId ||
        parsed.data.workspaceId !== attempt.workspaceId ||
        parsed.data.mode !== attempt.mode ||
        parsed.data.revision !== expectedRevision
      ) {
        setIntentMessage(
          '伺服器回應無法與原操作核對；結果仍未確認，請重試同一操作。',
        );
        return;
      }

      rememberIntent(null);
      setConfirmMode(null);
      setRead(null);
      setNotice('模式變更已確認，正在重新取得專案目前設定。');
      notifyChangedAfterReadRef.current = true;
      setReloadSequence((value) => value + 1);
    } catch (error) {
      if (!isCurrentIntent(attempt)) return;
      if (
        error instanceof ApiFailure &&
        (error.status === 401 || error.status === 403)
      )
        setRead(null);
      setIntentMessage(
        error instanceof ApiFailure &&
          (error.status === 401 || error.status === 403)
          ? '登入或管理權限需要重新確認。操作結果仍未確認；重新登入後請重試同一操作。'
          : '操作結果仍未確認。請重試同一操作；原操作編號與內容會保持不變。',
      );
    } finally {
      if (inFlightRef.current === attempt.requestId) {
        inFlightRef.current = null;
        if (mountedRef.current) setSending(false);
      }
    }
  }

  function startChangeConfirmation() {
    if (!value || !selectedChanged || controlsDisabled) return;
    setConfirmMode({ key, mode: currentSelection as ConfigurableMode });
  }

  function confirmChange() {
    const current = currentRead;
    const target = confirmMode?.key === key ? confirmMode.mode : null;
    const identity = identityRef.current;
    if (
      current?.status !== 'ready' ||
      !target ||
      !identity ||
      target === current.value.mode ||
      intentRef.current ||
      inFlightRef.current
    )
      return;
    const body = setProjectVersioningSchema.parse({
      requestId: crypto.randomUUID(),
      expectedRevision: current.value.revision,
      mode: target,
      confirm: true,
    });
    const attempt: MutationIntent = {
      projectId,
      workspaceId: current.value.workspaceId,
      actorId: identity.actorId,
      requestId: body.requestId,
      expectedRevision: body.expectedRevision,
      mode: body.mode,
      body: JSON.stringify(body),
    };
    rememberIntent(attempt);
    setConfirmMode(null);
    void sendIntent(attempt);
  }

  function retryIntent() {
    const attempt = intentRef.current;
    if (attempt && inFlightRef.current === null) void sendIntent(attempt);
  }

  if (currentCapability.status === 'disabled') {
    return (
      <section
        className="min-w-0 max-w-full rounded-lg border border-stone-200 bg-white p-3 text-stone-700"
        data-project-versioning-configuration
      >
        <p role="status">專案版本模式設定目前尚未開放。</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 max-w-full rounded-lg border border-stone-300 bg-white p-3 text-stone-900 sm:p-4"
      data-project-versioning-configuration
    >
      <h2 id={titleId} className="text-base font-semibold">
        專案版本模式
      </h2>

      {currentCapability.status === 'loading' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在確認專案版本模式功能…
        </p>
      )}
      {currentCapability.status === 'error' && (
        <div
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="status"
        >
          <p>{currentCapability.message}</p>
          <button
            type="button"
            className="mt-3 min-h-11 rounded border border-stone-400 px-3 py-2"
            onClick={reload}
          >
            重新確認
          </button>
        </div>
      )}

      {currentCapability.status === 'ready' &&
        currentRead?.status === 'loading' && (
          <p className="mt-3 text-sm text-stone-600" role="status">
            正在載入專案版本模式…
          </p>
        )}

      {currentCapability.status === 'ready' &&
        currentRead?.status === 'error' && (
          <div
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="alert"
          >
            <p>{currentRead.message}</p>
            <button
              type="button"
              className="mt-3 min-h-11 rounded border border-stone-400 px-3 py-2 disabled:opacity-50"
              disabled={hasIntent}
              onClick={reload}
            >
              重新載入
            </button>
          </div>
        )}

      {currentCapability.status === 'ready' && currentIntent && (
        <div
          className="mt-4 min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
          data-testid="project-versioning-configuration-pending"
        >
          <p>
            這項模式變更的結果尚未確認。重試會沿用完全相同的操作編號與內容。
          </p>
          {intentMessage && <p className="mt-2">{intentMessage}</p>}
          <button
            type="button"
            className="mt-3 min-h-11 max-w-full rounded border border-amber-500 px-3 py-2 font-medium disabled:opacity-50"
            disabled={isSending}
            onClick={retryIntent}
            data-testid="project-versioning-configuration-retry"
          >
            {isSending ? '正在重試…' : '重試同一操作'}
          </button>
        </div>
      )}
      {currentCapability.status === 'ready' && value && (
        <div className="mt-4 min-w-0 space-y-4">
          {notice && (
            <p className="break-words text-sm text-stone-700" role="status">
              {notice}
            </p>
          )}
          <div className="min-w-0 rounded-md bg-stone-50 p-3 text-sm text-stone-700">
            <p>
              目前模式：<strong>{modeLabel(value.mode)}</strong>
            </p>
            <p className="mt-1 break-words">設定版本：{value.revision}</p>
            <p className="mt-2 break-words">
              {value.availableModes.includes('auto_filename')
                ? '依檔名比對會建議同一照片的新版本；輔助比對由你確認建立新照片、版本或略過。上傳不會自動切換目前版本。'
                : '目前只開放「關閉」與「手動」。比對模式尚未開放；可保留現況或確認改為可用模式。'}
            </p>
          </div>

          <div className="grid min-w-0 gap-3">
            <div>
              <label
                htmlFor={modeId}
                className="block text-sm font-medium text-stone-900"
              >
                版本控制模式
              </label>
              <select
                id={modeId}
                value={currentSelection}
                disabled={controlsDisabled}
                onChange={(event) =>
                  chooseMode(event.currentTarget.value as ConfigurableMode | '')
                }
                className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-base disabled:bg-stone-100"
              >
                <option value="">請選擇可用模式</option>
                {value.availableModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {modeLabel(mode)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="min-h-11 max-w-full justify-self-start rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!selectedChanged || controlsDisabled}
              onClick={startChangeConfirmation}
            >
              確認變更模式
            </button>
          </div>

          {confirmMode?.key === key && (
            <div
              className="min-w-0 rounded-md border border-stone-300 bg-stone-50 p-3"
              role="group"
              aria-label="確認專案版本模式變更"
              data-testid="project-versioning-configuration-confirm"
            >
              <p className="break-words text-sm leading-6">
                將專案版本模式由「{modeLabel(value.mode)}」變更為「
                {modeLabel(confirmMode.mode)}」。此動作不會切換照片的目前版本。
              </p>
              <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 max-w-full rounded-md border border-stone-400 px-4 py-2 text-sm"
                  disabled={sending}
                  onClick={() => setConfirmMode(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="min-h-11 max-w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={sending || hasIntent}
                  onClick={confirmChange}
                >
                  確認並套用
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentCapability.status === 'ready' && !value && !currentIntent && (
        <div className="mt-3">
          {currentRead?.status === 'error' ? null : (
            <p className="text-sm text-stone-600" role="status">
              載入專案版本模式中…
            </p>
          )}
        </div>
      )}
    </section>
  );
}
