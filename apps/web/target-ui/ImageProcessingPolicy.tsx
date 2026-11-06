'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';
import './workspace-settings.css';

const policyRecipeSchema = z.enum([
  'local-sharp-0.35.5-v1',
  'cloudflare-images-jpeg-82-v1',
]);
type PolicyRecipe = z.infer<typeof policyRecipeSchema>;
type OwnerIdentity = { actorId: string; sessionId: string };
type PolicyState = {
  workspaceId: string;
  recipe: PolicyRecipe;
  revision: number;
  processingEnabled?: boolean | undefined;
};
type PolicyIntent = {
  workspaceId: string;
  actorId: string;
  requestId: string;
  expectedRevision: number;
  recipe: PolicyRecipe;
  body: string;
};

const ownerSessionSchema = z.object({
  user: z.object({ id: z.uuid() }),
  session: z.object({ id: z.string().min(1) }),
});
const policyStateSchema = z
  .object({
    workspaceId: z.uuid(),
    recipe: policyRecipeSchema,
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    processingEnabled: z.boolean().optional(),
  })
  .strict();
const receiptSchema = z
  .object({
    workspaceId: z.uuid(),
    requestId: z.uuid(),
    recipe: policyRecipeSchema,
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    createdAtMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Image processing policy request failed');
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

function policyPath(workspaceId: string) {
  return (
    '/api/v1/workspaces/' +
    encodeURIComponent(workspaceId) +
    '/image-processing-policy'
  );
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

async function readPolicy(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ identity: OwnerIdentity; policy: PolicyState }> {
  const identity = await readOwnerIdentity(signal);
  const response = await fetch(policyPath(workspaceId), {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiFailure(response.status, errorCode(body));
  const parsed = policyStateSchema.safeParse(body);
  if (!parsed.success || parsed.data.workspaceId !== workspaceId)
    throw new ApiFailure(503, 'IMAGE_PROCESSING_POLICY_UNAVAILABLE');
  return { identity, policy: parsed.data };
}

function describeFailure(error: unknown) {
  if (!(error instanceof ApiFailure))
    return '連線中斷，結果尚未確認；再次儲存會沿用同一操作識別碼。';

  if (error.status === 401 || error.status === 403)
    return '登入已失效或帳號權限已變更，請重新登入後再試。';
  if (error.status === 404) return '找不到此工作區，或目前帳號無權存取。';
  if (error.status === 400) return '設定內容無效，請重新載入後再試。';
  if (error.status === 503) return '處理配方設定服務暫時無法使用，請稍後重試。';
  if (error.status === 409) {
    if (
      error.code.includes('UPLOADS_IN_PROGRESS') ||
      error.code.includes('RESERVED_UPLOADS')
    )
      return '工作區尚有已預留的上傳；完成或處理後才能切換新工作的配方。';
    if (error.code.includes('REVISION_CONFLICT')) return '';
    if (error.code.includes('REQUEST_ID_CONFLICT'))
      return '操作識別碼已用於其他設定，請重新載入後再試。';
    return '目前狀態不允許切換處理配方。';
  }
  return '處理配方設定服務暫時無法使用，請稍後重試。';
}

export function ImageProcessingPolicy({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const titleId = useId();
  const savedLabelId = useId();
  const [state, setState] = useState<PolicyState | null>(null);
  const [draft, setDraft] = useState<{
    workspaceId: string;
    recipe: PolicyRecipe;
  } | null>(null);
  const [loadedKey, setLoadedKey] = useState<{
    workspaceId: string;
    sequence: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadSequence, setReloadSequence] = useState(0);
  const identityRef = useRef<OwnerIdentity | null>(null);
  const intentRef = useRef<PolicyIntent | null>(null);
  const savingRef = useRef(false);
  const currentWorkspaceRef = useRef(workspaceId);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    currentWorkspaceRef.current = workspaceId;
    identityRef.current = null;

    async function load() {
      const result = await readPolicy(workspaceId, controller.signal);
      if (!active || controller.signal.aborted) return;
      identityRef.current = result.identity;
      setState(result.policy);
      setDraft({ workspaceId, recipe: result.policy.recipe });
      setError('');
    }

    void load()
      .catch((failure: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState(null);
        setDraft(null);
        setError(describeFailure(failure));
      })
      .finally(() => {
        if (active && !controller.signal.aborted)
          setLoadedKey({ workspaceId, sequence: reloadSequence });
      });

    return () => {
      active = false;
      controller.abort();
      if (identityRef.current?.actorId) identityRef.current = null;
    };
  }, [workspaceId, reloadSequence]);

  const loading =
    !loadedKey ||
    loadedKey.workspaceId !== workspaceId ||
    loadedKey.sequence !== reloadSequence;
  const current = state?.workspaceId === workspaceId ? state : null;
  const selected =
    draft?.workspaceId === workspaceId
      ? draft.recipe
      : (current?.recipe ?? null);
  const hasChanges = current !== null && selected !== current.recipe;

  function chooseRecipe(recipe: PolicyRecipe) {
    setDraft({ workspaceId, recipe });
    setError('');
    setNotice('');
    if (intentRef.current?.recipe !== recipe) intentRef.current = null;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !selected || !hasChanges || savingRef.current) return;
    const identity = identityRef.current;
    if (!identity) {
      setError('登入資訊已變更，請重新載入設定。');
      return;
    }

    const previous = intentRef.current;
    const requestId = crypto.randomUUID();
    const intent =
      previous &&
      previous.workspaceId === workspaceId &&
      previous.actorId === identity.actorId &&
      previous.expectedRevision === current.revision &&
      previous.recipe === selected
        ? previous
        : {
            workspaceId,
            actorId: identity.actorId,
            requestId,
            expectedRevision: current.revision,
            recipe: selected,
            body: JSON.stringify({
              requestId,
              expectedRevision: current.revision,
              recipe: selected,
            }),
          };

    intentRef.current = intent;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch(policyPath(workspaceId), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Kino-Expected-Actor': identity.actorId,
        },
        body: intent.body,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ApiFailure(response.status, errorCode(body));

      const receipt = receiptSchema.safeParse(body);
      if (
        !receipt.success ||
        receipt.data.workspaceId !== workspaceId ||
        receipt.data.requestId !== intent.requestId ||
        receipt.data.recipe !== intent.recipe ||
        receipt.data.revision !== intent.expectedRevision + 1
      )
        throw new ApiFailure(503, 'IMAGE_PROCESSING_POLICY_UNAVAILABLE');

      setNotice(
        '設定指令已記錄（修訂 ' +
          receipt.data.revision +
          '），正在同步目前設定。',
      );
      const latest = await readPolicy(workspaceId);
      if (latest.identity.actorId !== intent.actorId)
        throw new ApiFailure(403, 'OWNER_CHANGED');
      if (currentWorkspaceRef.current !== workspaceId) return;
      identityRef.current = latest.identity;
      setState(latest.policy);
      setDraft({ workspaceId, recipe: latest.policy.recipe });
      setNotice(
        latest.policy.revision > receipt.data.revision
          ? '設定指令已完成；目前設定已由後續操作更新，已載入最新版本。'
          : '處理配方已儲存，僅套用到新建立的處理工作。',
      );
      intentRef.current = null;
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) {
        if (failure.code.includes('REVISION_CONFLICT')) {
          intentRef.current = null;
          setNotice('設定版本已變更，正在載入最新設定。');
          setReloadSequence((sequence) => sequence + 1);
        } else {
          setError(describeFailure(failure));
          if (failure.code.includes('REQUEST_ID_CONFLICT'))
            intentRef.current = null;
        }
      } else {
        setError(describeFailure(failure));
        if (failure instanceof ApiFailure && failure.status < 500)
          intentRef.current = null;
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="studio-settings" aria-labelledby={titleId}>
      <header className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef3f0] text-[#426f69]">
          <StudioIcon name="image" width={22} height={22} />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 text-[17px]">
            縮圖處理方式
          </h2>
          <p
            id={savedLabelId}
            className="mt-1 text-xs leading-relaxed text-stone-600"
          >
            只影響新上傳的照片；上傳中暫時不能更改。
          </p>
        </div>
      </header>

      {loading && (
        <p className="workspace-setting__message" role="status">
          載入工作區處理配方中…
        </p>
      )}

      {current && (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => void save(event)}
        >
          <fieldset
            disabled={loading || saving}
            aria-describedby={savedLabelId}
            className="workspace-setting__options"
          >
            <legend>新工作使用</legend>

            <label
              className={
                'workspace-setting__choice' +
                (selected === 'cloudflare-images-jpeg-82-v1'
                  ? ' is-selected'
                  : '')
              }
            >
              <input
                className="workspace-setting__radio"
                type="radio"
                name={'image-processing-recipe-' + workspaceId}
                value="cloudflare-images-jpeg-82-v1"
                checked={selected === 'cloudflare-images-jpeg-82-v1'}
                onChange={() => chooseRecipe('cloudflare-images-jpeg-82-v1')}
              />
              <span className="workspace-setting__choice-copy">
                <span className="workspace-setting__choice-title">
                  Cloudflare 優先
                </span>
                <span className="workspace-setting__choice-note">
                  本站縮圖處理，每張最多 16 MiB。
                </span>
              </span>
              {selected === 'cloudflare-images-jpeg-82-v1' && (
                <StudioIcon
                  name="check"
                  width={18}
                  height={18}
                  className="workspace-setting__choice-check"
                />
              )}
            </label>

            <label
              className={
                'workspace-setting__choice' +
                (selected === 'local-sharp-0.35.5-v1' ? ' is-selected' : '')
              }
            >
              <input
                className="workspace-setting__radio"
                type="radio"
                name={'image-processing-recipe-' + workspaceId}
                value="local-sharp-0.35.5-v1"
                checked={selected === 'local-sharp-0.35.5-v1'}
                onChange={() => chooseRecipe('local-sharp-0.35.5-v1')}
              />
              <span className="workspace-setting__choice-copy">
                <span className="workspace-setting__choice-title">
                  本機處理／Oracle VM 候選
                </span>
                <span className="workspace-setting__choice-note">
                  每張最多 64 MiB；Oracle VM 處理尚未接線。
                </span>
              </span>
              {selected === 'local-sharp-0.35.5-v1' && (
                <StudioIcon
                  name="check"
                  width={18}
                  height={18}
                  className="workspace-setting__choice-check"
                />
              )}
            </label>
          </fieldset>

          {current.processingEnabled === false && (
            <p className="workspace-setting__notice" role="status">
              雲端縮圖服務未啟用；儲存配方不會啟用服務。
            </p>
          )}

          <p className="workspace-setting__current">
            目前使用：
            {current.recipe === 'cloudflare-images-jpeg-82-v1'
              ? 'Cloudflare 優先'
              : '本機處理／Oracle VM 候選'}
          </p>
          <details className="workspace-setting__details">
            <summary>版本資訊</summary>
            <p>
              修訂 {current.revision}
              {current.revision === 0 ? '，沿用舊 Sharp 預設。' : '。'}
            </p>
          </details>

          <button
            type="submit"
            className="studio-pages__button workspace-setting__button"
            disabled={!hasChanges || saving || loading}
          >
            {saving ? '儲存中…' : '儲存處理方式'}
          </button>
        </form>
      )}

      {error && (
        <p className="workspace-setting__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="workspace-setting__message" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
