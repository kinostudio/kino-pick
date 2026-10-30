'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ownerAlbumSelectionConfigurationReadSchema,
  ownerProjectSelectionConfigurationReadSchema,
  setAlbumSelectionConfigurationResultSchema,
  setProjectSelectionConfigurationResultSchema,
  type EffectiveSelectionPolicy,
} from '../../../packages/contracts/src/project-selection-policy';

type Kind = 'project' | 'album';
type Mode = 'inherit' | 'override';
type Source = 'system' | 'project' | 'album';
type Value = {
  projectId: string;
  minimum: number;
  maximum: number | null;
  inheritedMinimum: number;
  inheritedMaximum: number | null;
  projectRevision: number;
  albumRevision: number;
  source: Source;
  configuration: Mode | null;
  maxOpenSelectedCount: number;
};
type Read =
  | { status: 'ready'; key: string; sequence: number; value: Value }
  | { status: 'disabled'; key: string; sequence: number }
  | { status: 'error'; key: string; sequence: number; message: string };
type Draft = { key: string; minimum: string; maximum: string; mode: Mode };
type ProjectIntent = {
  kind: 'project';
  key: string;
  id: string;
  requestId: string;
  body: string;
  minimum: number;
  maximum: number | null;
  projectRevision: number;
};
type AlbumIntent = {
  kind: 'album';
  key: string;
  id: string;
  projectId: string;
  requestId: string;
  body: string;
  mode: Mode;
  minimum: number | null;
  maximum: number | null;
  projectRevision: number;
  albumRevision: number;
};
type Intent = ProjectIntent | AlbumIntent;
type Confirm =
  | {
      kind: 'project';
      key: string;
      sequence: number;
      minimum: number;
      maximum: number | null;
      projectRevision: number;
    }
  | {
      kind: 'album';
      key: string;
      sequence: number;
      mode: Mode;
      minimum: number;
      maximum: number | null;
      projectRevision: number;
      albumRevision: number;
    };

function apiPath(kind: Kind, id: string) {
  return (
    '/api/v1/' +
    (kind === 'project' ? 'projects' : 'albums') +
    '/' +
    encodeURIComponent(id) +
    '/selection-policy-configuration'
  );
}
function intValue(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100000
    ? value
    : null;
}
function maxValue(raw: string): number | null | 'invalid' {
  return raw.trim() === '' ? null : (intValue(raw) ?? 'invalid');
}
function getErrorCode(value: unknown) {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return '';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}
function sourceName(source: Source) {
  return source === 'album'
    ? '相簿覆寫'
    : source === 'project'
      ? '專案預設'
      : '系統預設';
}
function bounds(minimum: number, maximum: number | null) {
  return (
    '最少 ' +
    minimum +
    ' 張，最高 ' +
    (maximum === null ? '不限' : maximum + ' 張')
  );
}
function beforeUnload() {
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}
function normalize(kind: Kind, id: string, body: unknown): Value | null {
  if (kind === 'project') {
    const result = ownerProjectSelectionConfigurationReadSchema.safeParse(body);
    if (!result.success || result.data.projectId !== id) return null;
    return {
      projectId: result.data.projectId,
      minimum: result.data.minimum,
      maximum: result.data.maximum,
      inheritedMinimum: result.data.minimum,
      inheritedMaximum: result.data.maximum,
      projectRevision: result.data.revision,
      albumRevision: 0,
      source: result.data.revision === 0 ? 'system' : 'project',
      configuration: null,
      maxOpenSelectedCount: result.data.maxOpenSelectedCount,
    };
  }
  const result = ownerAlbumSelectionConfigurationReadSchema.safeParse(body);
  if (!result.success || result.data.albumId !== id) return null;
  const policy: EffectiveSelectionPolicy = result.data.policy;
  return {
    projectId: result.data.projectId,
    minimum: policy.minimum,
    maximum: policy.maximum,
    inheritedMinimum: policy.minimum,
    inheritedMaximum: policy.maximum,
    projectRevision: policy.projectRevision,
    albumRevision: policy.albumRevision,
    source: policy.source,
    configuration: result.data.configuration,
    maxOpenSelectedCount: result.data.maxOpenSelectedCount,
  };
}

export function ProjectSelectionPolicyConfiguration({
  projectId,
}: {
  projectId: string;
}) {
  return <SelectionPolicyConfiguration kind="project" id={projectId} />;
}
export function AlbumSelectionPolicyConfiguration({
  albumId,
}: {
  albumId: string;
}) {
  return <SelectionPolicyConfiguration kind="album" id={albumId} />;
}

function SelectionPolicyConfiguration({
  kind,
  id,
}: {
  kind: Kind;
  id: string;
}) {
  const key = kind + ':' + id;
  const [sequence, setSequence] = useState(0);
  const [read, setRead] = useState<Read | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [intentError, setIntentError] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const intentRef = useRef<Intent | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const requestedKey = key;
    const requestedSequence = sequence;
    void fetch(apiPath(kind, id), {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!active || controller.signal.aborted) return;
        if (response.status === 503) {
          if (getErrorCode(body) === 'GUEST_SELECTION_DISABLED') {
            setRead({
              status: 'disabled',
              key: requestedKey,
              sequence: requestedSequence,
            });
          } else {
            setRead({
              status: 'error',
              key: requestedKey,
              sequence: requestedSequence,
              message: '暫時無法載入挑片設定，請重新載入再試。',
            });
          }
          return;
        }
        if (!response.ok) {
          setRead({
            status: 'error',
            key: requestedKey,
            sequence: requestedSequence,
            message:
              response.status === 401 ||
              response.status === 403 ||
              getErrorCode(body) === 'OWNER_REQUIRED'
                ? '登入已失效或目前帳號沒有管理權限，請重新登入後再載入。'
                : '目前無法載入挑片設定，請稍後重新整理。',
          });
          return;
        }
        const value = normalize(kind, id, body);
        if (!value) {
          setRead({
            status: 'error',
            key: requestedKey,
            sequence: requestedSequence,
            message: '伺服器回傳的挑片設定無法驗證，請重新載入。',
          });
          return;
        }
        if (kind === 'album') {
          const projectResponse = await fetch(
            apiPath('project', value.projectId),
            {
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { Accept: 'application/json' },
              signal: controller.signal,
            },
          );
          const projectBody: unknown = await projectResponse
            .json()
            .catch(() => null);
          if (!active || controller.signal.aborted) return;
          if (projectResponse.status === 503) {
            if (getErrorCode(projectBody) === 'GUEST_SELECTION_DISABLED') {
              setRead({
                status: 'disabled',
                key: requestedKey,
                sequence: requestedSequence,
              });
            } else {
              setRead({
                status: 'error',
                key: requestedKey,
                sequence: requestedSequence,
                message: '暫時無法載入專案挑片預設，請重新載入再試。',
              });
            }
            return;
          }
          if (!projectResponse.ok) {
            setRead({
              status: 'error',
              key: requestedKey,
              sequence: requestedSequence,
              message:
                projectResponse.status === 401 ||
                projectResponse.status === 403 ||
                getErrorCode(projectBody) === 'OWNER_REQUIRED'
                  ? '登入已失效或目前帳號沒有管理權限，請重新登入後再載入。'
                  : '目前無法載入專案挑片預設，請重新整理。',
            });
            return;
          }
          const project =
            ownerProjectSelectionConfigurationReadSchema.safeParse(projectBody);
          if (!project.success || project.data.projectId !== value.projectId) {
            setRead({
              status: 'error',
              key: requestedKey,
              sequence: requestedSequence,
              message: '專案挑片預設回應無法驗證，請重新載入相簿設定。',
            });
            return;
          }
          if (project.data.revision !== value.projectRevision) {
            setRead({
              status: 'error',
              key: requestedKey,
              sequence: requestedSequence,
              message:
                '專案挑片預設已更新，相簿讀到的版本已過期。請重新載入後再確認。',
            });
            return;
          }
          value.inheritedMinimum = project.data.minimum;
          value.inheritedMaximum = project.data.maximum;
        }
        setDraft((current) =>
          current?.key === requestedKey
            ? current
            : {
                key: requestedKey,
                minimum: String(value.minimum),
                maximum: value.maximum === null ? '' : String(value.maximum),
                mode: value.configuration ?? 'inherit',
              },
        );
        setRead({
          status: 'ready',
          key: requestedKey,
          sequence: requestedSequence,
          value,
        });
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setRead({
          status: 'error',
          key: requestedKey,
          sequence: requestedSequence,
          message: '目前無法載入挑片設定，請稍後重新整理。',
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [id, key, kind, sequence]);

  useEffect(() => {
    if (!intent) return;
    return beforeUnload();
  }, [intent]);

  useEffect(() => {
    if (!confirm) return;
    cancelRef.current?.focus();
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirm(null);
      } else if (event.key === 'Tab' && dialog) {
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled])',
          ),
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, [confirm]);

  const currentRead =
    read?.key === key && read.sequence === sequence ? read : null;
  const value = currentRead?.status === 'ready' ? currentRead.value : null;
  const currentDraft = draft?.key === key ? draft : null;
  const currentConflict = conflict?.key === key ? conflict : null;
  const hasIntent = intent !== null;
  const isSending = Boolean(intent && sending === intent.requestId);
  const disabled = !value || hasIntent || Boolean(currentConflict);

  function reload(message: string) {
    if (hasIntent) return;
    setConflict(null);
    setNotice(message);
    setSequence((previous) => previous + 1);
  }
  function change(field: 'minimum' | 'maximum', next: string) {
    if (disabled) return;
    setDraft((previous) =>
      previous?.key === key ? { ...previous, [field]: next } : previous,
    );
  }
  function changeMode(mode: Mode) {
    if (kind !== 'album' || disabled) return;
    setDraft((previous) =>
      previous?.key === key ? { ...previous, mode } : previous,
    );
  }
  function clearIntent(attempt: Intent) {
    if (intentRef.current?.requestId !== attempt.requestId) return;
    intentRef.current = null;
    setIntent(null);
    setIntentError('');
  }
  function matchesResult(attempt: Intent, body: unknown) {
    if (attempt.kind === 'project') {
      const result =
        setProjectSelectionConfigurationResultSchema.safeParse(body);
      return (
        result.success &&
        result.data.configuration.projectId === attempt.id &&
        result.data.configuration.minimum === attempt.minimum &&
        result.data.configuration.maximum === attempt.maximum &&
        result.data.configuration.revision >= attempt.projectRevision
      );
    }
    const result = setAlbumSelectionConfigurationResultSchema.safeParse(body);
    if (
      !result.success ||
      result.data.configuration.albumId !== attempt.id ||
      result.data.configuration.projectId !== attempt.projectId ||
      result.data.configuration.configuration !== attempt.mode ||
      result.data.configuration.policy.albumRevision < attempt.albumRevision ||
      result.data.configuration.policy.projectRevision !==
        attempt.projectRevision
    )
      return false;
    if (attempt.mode === 'override')
      return (
        result.data.configuration.policy.source === 'album' &&
        result.data.configuration.policy.minimum === attempt.minimum &&
        result.data.configuration.policy.maximum === attempt.maximum
      );
    return (
      attempt.minimum === null &&
      attempt.maximum === null &&
      result.data.configuration.policy.source !== 'album'
    );
  }
  async function send(attempt: Intent) {
    if (
      intentRef.current?.requestId !== attempt.requestId ||
      inFlightRef.current
    )
      return;
    inFlightRef.current = attempt.requestId;
    setSending(attempt.requestId);
    setIntentError('');
    try {
      const response = await fetch(apiPath(attempt.kind, attempt.id), {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: attempt.body,
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        clearIntent(attempt);
        const code = getErrorCode(body);
        setConflict({
          key: attempt.key,
          message:
            code.includes('BELOW_CURRENT') || code.includes('SELECTION_LIMIT')
              ? '目前私有草稿已選的張數超過這個上限。設定草稿已保留；請重新整理目前設定後再確認。'
              : '設定版本或目前資料已變更。設定草稿已保留；請重新整理目前設定後再確認。',
        });
        return;
      }
      if (!response.ok) {
        setIntentError(
          response.status === 401 ||
            response.status === 403 ||
            getErrorCode(body) === 'OWNER_REQUIRED'
            ? '登入或 Owner 權限可能已失效；原設定結果仍未確認。重新登入後請重試同一設定，操作編號與內容會保持不變。'
            : '設定結果仍未確認。請明確重試同一設定；原操作編號與內容會保持不變。',
        );
        return;
      }
      if (!matchesResult(attempt, body)) {
        setIntentError(
          '伺服器回應無法與原設定核對；結果仍未確認，請重試同一設定。',
        );
        return;
      }
      clearIntent(attempt);
      setDraft(null);
      setConflict(null);
      setNotice('設定結果已確認，正在重新取得目前設定。');
      // A replay may return a historical result, so always read current state.
      setSequence((previous) => previous + 1);
    } catch {
      setIntentError(
        '設定結果仍未確認。請明確重試同一設定；原操作編號與內容會保持不變。',
      );
    } finally {
      if (inFlightRef.current === attempt.requestId) {
        inFlightRef.current = null;
        setSending(null);
      }
    }
  }
  function retry() {
    const attempt = intentRef.current;
    if (attempt && !inFlightRef.current) void send(attempt);
  }

  const minimumText = currentDraft?.minimum ?? '';
  const maximumText = currentDraft?.maximum ?? '';
  const parsedMinimum = intValue(minimumText);
  const parsedMaximum = maxValue(maximumText);
  const mode = currentDraft?.mode ?? 'inherit';
  const usesBounds = kind === 'project' || mode === 'override';
  const minimumError = !usesBounds
    ? ''
    : minimumText === ''
      ? '請輸入最少張數。'
      : parsedMinimum === null
        ? '請輸入 1 到 100000 之間的整數。'
        : '';
  const maximumError = !usesBounds
    ? ''
    : parsedMaximum === 'invalid'
      ? '最高張數請留空或輸入 1 到 100000 之間的整數。'
      : parsedMaximum !== null &&
          parsedMinimum !== null &&
          parsedMaximum < parsedMinimum
        ? '最高張數不可少於最少張數。'
        : parsedMaximum !== null &&
            value &&
            parsedMaximum < value.maxOpenSelectedCount
          ? '最高張數不可低於目前仍開放的私有草稿數量。'
          : '';
  const noChange =
    kind === 'project'
      ? Boolean(
          value &&
          parsedMinimum === value.minimum &&
          parsedMaximum === value.maximum,
        )
      : Boolean(
          value &&
          mode === value.configuration &&
          (mode === 'inherit' ||
            (parsedMinimum === value.minimum &&
              parsedMaximum === value.maximum)),
        );
  const saveDisabled =
    disabled ||
    !currentDraft ||
    (usesBounds && Boolean(minimumError || maximumError)) ||
    noChange;
  const minimumId = 'selection-policy-configuration-' + kind + '-minimum';
  const maximumId = 'selection-policy-configuration-' + kind + '-maximum';
  const sectionId = 'selection-policy-configuration-' + kind + '-' + id;
  const unavailable = currentRead?.status === 'disabled';
  const loadError = currentRead?.status === 'error' ? currentRead.message : '';

  function openConfirm(event: MouseEvent<HTMLButtonElement>) {
    if (
      !value ||
      !currentDraft ||
      saveDisabled ||
      (usesBounds && (parsedMinimum === null || parsedMaximum === 'invalid'))
    )
      return;
    const proposedMinimum = usesBounds ? parsedMinimum : value.inheritedMinimum;
    const proposedMaximum = usesBounds ? parsedMaximum : value.inheritedMaximum;
    if (proposedMinimum === null || proposedMaximum === 'invalid') return;
    triggerRef.current = event.currentTarget;
    if (kind === 'project') {
      setConfirm({
        kind,
        key,
        sequence,
        minimum: proposedMinimum,
        maximum: proposedMaximum,
        projectRevision: value.projectRevision,
      });
    } else {
      setConfirm({
        kind,
        key,
        sequence,
        mode,
        minimum: proposedMinimum,
        maximum: proposedMaximum,
        projectRevision: value.projectRevision,
        albumRevision: value.albumRevision,
      });
    }
  }
  function confirmChange() {
    const snapshot = confirm;
    if (
      !snapshot ||
      snapshot.key !== key ||
      !value ||
      intentRef.current ||
      inFlightRef.current
    )
      return;
    const fresh =
      currentRead?.sequence === snapshot.sequence &&
      value.projectRevision === snapshot.projectRevision &&
      (snapshot.kind === 'project' ||
        value.albumRevision === snapshot.albumRevision);
    if (!fresh) {
      setConfirm(null);
      reload('目前設定已更新；草稿已保留，請檢查後再確認。');
      return;
    }
    const requestId = crypto.randomUUID();
    let attempt: Intent;
    if (snapshot.kind === 'project') {
      const request = {
        requestId,
        expectedRevision: snapshot.projectRevision,
        minimum: snapshot.minimum,
        maximum: snapshot.maximum,
        confirm: true as const,
      };
      attempt = {
        kind: 'project',
        key,
        id,
        requestId,
        body: JSON.stringify(request),
        minimum: snapshot.minimum,
        maximum: snapshot.maximum,
        projectRevision: snapshot.projectRevision,
      };
    } else {
      const request =
        snapshot.mode === 'inherit'
          ? {
              requestId,
              expectedAlbumRevision: snapshot.albumRevision,
              expectedProjectRevision: snapshot.projectRevision,
              confirm: true as const,
              configuration: 'inherit' as const,
            }
          : {
              requestId,
              expectedAlbumRevision: snapshot.albumRevision,
              expectedProjectRevision: snapshot.projectRevision,
              confirm: true as const,
              configuration: 'override' as const,
              minimum: snapshot.minimum,
              maximum: snapshot.maximum,
            };
      attempt = {
        kind: 'album',
        key,
        id,
        projectId: value.projectId,
        requestId,
        body: JSON.stringify(request),
        mode: snapshot.mode,
        minimum: snapshot.mode === 'inherit' ? null : snapshot.minimum,
        maximum: snapshot.mode === 'inherit' ? null : snapshot.maximum,
        projectRevision: snapshot.projectRevision,
        albumRevision: snapshot.albumRevision,
      };
    }
    intentRef.current = attempt;
    setIntent(attempt);
    setIntentError('');
    setConfirm(null);
    void send(attempt);
  }

  return (
    <section
      className="mt-4 min-w-0 max-w-full rounded-lg border border-stone-200 bg-white p-4 sm:p-5"
      aria-labelledby={sectionId + '-heading'}
      data-testid={sectionId}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="min-w-0 flex-1">
          <h3
            id={sectionId + '-heading'}
            className="break-words text-base font-semibold text-stone-900"
          >
            {kind === 'project' ? '專案私有挑片預設' : '相簿私有挑片政策'}
          </h3>
          <p className="mt-1 break-words text-sm leading-6 text-stone-600">
            {kind === 'project'
              ? '套用在沿用專案設定的私有相簿。明確覆寫的相簿與共用審查輪次維持原設定。'
              : '顯示目前政策來源與有效張數。相簿可沿用系統或專案預設，也可設為相簿覆寫；共用審查輪次使用各自固定張數。'}
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 max-w-full shrink-0 rounded border border-stone-300 px-3 py-2 text-sm disabled:opacity-50"
          disabled={hasIntent || unavailable}
          onClick={() =>
            reload('目前設定已重新取得；原草稿已保留，請檢查後再確認。')
          }
        >
          {currentRead === null ? '載入中…' : '重新整理設定'}
        </button>
      </header>

      {intent?.key === key && (
        <div
          role="alert"
          className="mt-4 min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="selection-policy-configuration-pending"
        >
          <p>這項設定的結果尚未確認。重試會沿用原操作編號與完全相同的內容。</p>
          {intentError && (
            <p
              className="mt-2"
              data-testid="selection-policy-configuration-error"
            >
              {intentError}
            </p>
          )}
          <button
            type="button"
            className="mt-3 min-h-11 max-w-full rounded border border-amber-500 px-3 py-2 font-medium disabled:opacity-50"
            disabled={isSending}
            onClick={retry}
            data-testid="selection-policy-configuration-retry"
          >
            {isSending ? '正在重試…' : '重試同一設定'}
          </button>
        </div>
      )}
      {intent && intent.key !== key && (
        <div
          role="alert"
          className="mt-4 min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p>
            另一項挑片設定的結果尚未確認。請先重試原操作，完成後再編輯這裡。
          </p>
          {intentError && <p className="mt-2">{intentError}</p>}
          <button
            type="button"
            className="mt-3 min-h-11 max-w-full rounded border border-amber-500 px-3 py-2 disabled:opacity-50"
            disabled={isSending}
            onClick={retry}
          >
            {isSending ? '正在重試…' : '重試同一設定'}
          </button>
        </div>
      )}

      {!value && (
        <div className="mt-4 min-w-0" role="status" aria-live="polite">
          {loadError ? (
            <div role="alert" className="break-words text-sm text-red-800">
              <p>{loadError}</p>
              <button
                type="button"
                className="mt-3 min-h-11 rounded border border-stone-300 px-3 py-2"
                disabled={hasIntent}
                onClick={() => reload('')}
              >
                重新載入
              </button>
            </div>
          ) : unavailable ? (
            <div
              role="status"
              className="break-words rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="selection-policy-configuration-unavailable"
            >
              私有挑片政策設定目前無法使用。功能未啟用時不會送出變更。
            </div>
          ) : (
            <p>載入挑片設定中…</p>
          )}
        </div>
      )}

      {value && currentDraft && (
        <div className="mt-4 min-w-0 space-y-4">
          {notice && (
            <p
              role="status"
              className="break-words text-sm text-stone-700"
              data-testid="selection-policy-configuration-notice"
            >
              {notice}
            </p>
          )}
          <div className="min-w-0 rounded-md bg-stone-50 p-3 text-sm text-stone-700">
            <p data-testid="selection-policy-configuration-source">
              目前有效來源：{sourceName(value.source)}
            </p>
            <p
              className="mt-1 break-words"
              data-testid="selection-policy-configuration-effective"
            >
              目前有效範圍：{bounds(value.minimum, value.maximum)}
            </p>
            <p
              className="mt-1 break-words"
              data-testid="selection-policy-configuration-revisions"
            >
              專案版本 {value.projectRevision}；相簿設定版本{' '}
              {value.albumRevision}
            </p>
            <p
              className="mt-1 break-words"
              data-testid="selection-policy-configuration-open-draft-count"
            >
              目前仍開放的私有草稿最高選片張數：{value.maxOpenSelectedCount}
            </p>
          </div>
          {currentConflict && (
            <p
              role="alert"
              className="break-words text-sm text-red-800"
              data-testid="selection-policy-configuration-conflict"
            >
              {currentConflict.message}
            </p>
          )}

          {kind === 'album' && (
            <fieldset className="min-w-0 space-y-2" disabled={disabled}>
              <legend className="mb-2 text-sm font-medium text-stone-800">
                相簿設定來源
              </legend>
              <label className="flex min-w-0 items-start gap-2 rounded border border-stone-200 p-3 text-sm leading-6">
                <input
                  className="mt-1 shrink-0"
                  type="radio"
                  name={'selection-policy-configuration-mode-' + id}
                  value="inherit"
                  checked={currentDraft.mode === 'inherit'}
                  onChange={() => changeMode('inherit')}
                  data-testid="selection-policy-configuration-inherit"
                />
                <span className="min-w-0 break-words">
                  沿用系統或專案預設（目前來源：{sourceName(value.source)}）
                </span>
              </label>
              <label className="flex min-w-0 items-start gap-2 rounded border border-stone-200 p-3 text-sm leading-6">
                <input
                  className="mt-1 shrink-0"
                  type="radio"
                  name={'selection-policy-configuration-mode-' + id}
                  value="override"
                  checked={currentDraft.mode === 'override'}
                  onChange={() => changeMode('override')}
                  data-testid="selection-policy-configuration-override"
                />
                <span className="min-w-0 break-words">
                  使用這個相簿的獨立張數
                </span>
              </label>
            </fieldset>
          )}

          {(kind === 'project' || currentDraft.mode === 'override') && (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label
                  htmlFor={minimumId}
                  className="block text-sm font-medium text-stone-800"
                >
                  最少選片張數
                </label>
                <input
                  id={minimumId}
                  data-testid={
                    'selection-policy-configuration-' + kind + '-minimum'
                  }
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100000}
                  step={1}
                  value={currentDraft.minimum}
                  disabled={disabled}
                  aria-invalid={Boolean(minimumError)}
                  aria-describedby={minimumId + '-help'}
                  onChange={(event) =>
                    change('minimum', event.currentTarget.value)
                  }
                  className="mt-1 min-h-11 w-full min-w-0 rounded border border-stone-300 px-3 py-2 text-base disabled:bg-stone-100"
                />
                <p
                  id={minimumId + '-help'}
                  className="mt-1 min-h-5 break-words text-sm text-red-700"
                  aria-live="polite"
                >
                  {minimumError}
                </p>
              </div>
              <div className="min-w-0">
                <label
                  htmlFor={maximumId}
                  className="block text-sm font-medium text-stone-800"
                >
                  最高選片張數
                </label>
                <input
                  id={maximumId}
                  data-testid={
                    'selection-policy-configuration-' + kind + '-maximum'
                  }
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100000}
                  step={1}
                  value={currentDraft.maximum}
                  disabled={disabled}
                  aria-invalid={Boolean(maximumError)}
                  aria-describedby={maximumId + '-help'}
                  onChange={(event) =>
                    change('maximum', event.currentTarget.value)
                  }
                  className="mt-1 min-h-11 w-full min-w-0 rounded border border-stone-300 px-3 py-2 text-base disabled:bg-stone-100"
                />
                <p
                  id={maximumId + '-help'}
                  className="mt-1 min-h-5 break-words text-sm text-red-700"
                  aria-live="polite"
                  data-testid="selection-policy-configuration-cap-error"
                >
                  {maximumError}
                </p>
                <p className="mt-1 break-words text-xs leading-5 text-stone-500">
                  留空代表不限；可輸入 1 到 100000 張。
                </p>
              </div>
            </div>
          )}
          {kind === 'project' && (
            <p className="break-words text-sm text-stone-600">
              專案設定只更新沿用專案設定的私有相簿。相簿覆寫不變，共用審查輪次仍使用建立時確認的範圍。
            </p>
          )}
          {kind === 'album' && currentDraft.mode === 'inherit' && (
            <p className="break-words text-sm text-stone-600">
              目前選擇沿用，套用範圍為：{bounds(value.minimum, value.maximum)}
              。儲存後會採用當時的專案預設；沒有專案設定時使用系統預設。
            </p>
          )}
          {currentConflict && (
            <button
              type="button"
              className="min-h-11 max-w-full rounded border border-stone-300 px-3 py-2 text-sm"
              disabled={hasIntent}
              onClick={() =>
                reload('目前設定已重新取得；草稿已保留，請檢查後再確認。')
              }
            >
              重新整理目前設定
            </button>
          )}
          <button
            type="button"
            className="min-h-11 max-w-full rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={saveDisabled}
            onClick={openConfirm}
            data-testid="selection-policy-configuration-save"
          >
            確認政策變更
          </button>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={sectionId + '-confirm-title'}
            className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-auto rounded-lg bg-white p-5 shadow-xl"
          >
            <h4
              id={sectionId + '-confirm-title'}
              className="break-words text-lg font-semibold text-stone-900"
            >
              {confirm.kind === 'project'
                ? '確認變更專案挑片預設？'
                : confirm.mode === 'inherit'
                  ? '確認改為沿用上層政策？'
                  : '確認變更相簿挑片政策？'}
            </h4>
            <p className="mt-3 break-words text-sm leading-6 text-stone-700">
              {confirm.kind === 'project'
                ? '專案預設會更新所有沿用專案設定的私有相簿，包含目前仍開放的私有草稿。已覆寫相簿不變，共用審查輪次維持建立時確認的張數。'
                : confirm.mode === 'inherit'
                  ? '這個相簿會改為沿用目前專案預設；若沒有專案設定，則使用系統預設。共用審查輪次維持建立時確認的張數。'
                  : '這個覆寫會套用在此相簿的私有草稿與後續輪次，不會改動其他相簿或共用審查輪次。'}
            </p>
            <p className="mt-3 break-words text-sm font-medium text-stone-800">
              套用後範圍：{bounds(confirm.minimum, confirm.maximum)}
            </p>
            <div className="mt-5 flex min-w-0 flex-wrap justify-end gap-3">
              <button
                ref={cancelRef}
                type="button"
                className="min-h-11 max-w-full rounded border border-stone-300 px-4 py-2 text-sm"
                onClick={() => setConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="min-h-11 max-w-full rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white"
                onClick={confirmChange}
                data-testid="selection-policy-configuration-confirm"
              >
                確認套用設定
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
