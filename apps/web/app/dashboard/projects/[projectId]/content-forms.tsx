'use client';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { albumSchema, projectSchema } from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
type Kind = 'project' | 'album';
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const messages: Record<string, string> = {
  AUTH_REQUIRED: '登入已失效，請重新登入後再操作。',
  GOOGLE_IDENTITY_REQUIRED: '請使用 Google 攝影師帳號登入。',
  FORBIDDEN_SCOPE: '目前沒有修改權限，請聯絡工作空間擁有者。',
  NOT_FOUND: '無法存取這筆資料，請返回工作台確認。',
  INVALID_STATE_TRANSITION: '目前狀態不允許這項操作，請取消後確認最新狀態。',
  CONTENT_NOT_EMPTY_OR_IDLE:
    '目前僅支援沒有照片且沒有進行中流程的內容，無法封存。',
  RESOURCE_NOT_EDITABLE: '內容已封存或進入刪除流程，請先確認目前狀態。',
  PROTECTION_CONFIRMATION_REQUIRED: '解除保護前，請勾選確認。',
  INVALID_INPUT: '請輸入 1 至 160 字的名稱。',
  REQUEST_ID_CONFLICT: '這次操作的內容已變更，請修改名稱後重新送出。',
  CONCURRENT_MODIFICATION:
    '名稱已被其他人修改。請重新載入最新資料；你的輸入會保留。',
};
export function useContentMutation(kind: Kind) {
  const busy = useRef(false);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  async function mutate(
    url: string,
    method: 'POST' | 'PATCH',
    payload:
      | { archived: boolean; expectedRevision: number }
      | { name: string; workspaceId?: string; expectedRevision?: number }
      | {
          isPinned: boolean;
          legalHold: boolean;
          expectedRevision: number;
          confirmUnprotect: boolean;
        },
  ) {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify({ url, method, ...payload });
    if (attempt.current?.key !== key)
      attempt.current = { key, requestId: crypto.randomUUID() };
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          requestId: attempt.current.requestId,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body);
        const code = parsed.success
          ? parsed.data.error.code
          : 'SERVICE_UNAVAILABLE';
        setError({
          code,
          message:
            messages[code] ??
            '操作尚未確認，請重試；相同內容重試不會重複建立或修改。',
        });
        return false;
      }
      if (kind === 'project') z.object({ project: projectSchema }).parse(body);
      else z.object({ album: albumSchema }).parse(body);
      attempt.current = null;
      return true;
    } catch {
      setError({
        code: 'SERVICE_UNAVAILABLE',
        message: '操作尚未確認，請重試；相同內容重試不會重複建立或修改。',
      });
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { mutate, pending, error, clearError: () => setError(null) };
}
export function CreateContentForm({
  kind,
  parentId,
  returnTo,
}: {
  kind: Kind;
  parentId: string;
  returnTo?: string | undefined;
}) {
  const router = useRouter();
  const inputId = useId();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const mutation = useContentMutation(kind);
  const title = kind === 'project' ? '專案' : '相簿';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    const value = name.trim();
    if (!value) return;
    const ok = await mutation.mutate(
      kind === 'project'
        ? '/api/v1/projects'
        : `/api/v1/projects/${parentId}/albums`,
      'POST',
      kind === 'project'
        ? { name: value, workspaceId: parentId }
        : { name: value },
    );
    if (!ok) return;
    setName('');
    setNotice(`${title}已建立`);
    if (returnTo) router.replace(returnTo);
    else router.refresh();
  }
  return (
    <section
      className="mt-10 rounded-lg border border-stone-200 bg-white p-6"
      aria-labelledby={`${inputId}-title`}
    >
      <h2 id={`${inputId}-title`} className="text-lg font-semibold">
        建立{title}
      </h2>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <label htmlFor={inputId} className="block text-sm">
          {title}名稱
        </label>
        <input
          id={inputId}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={160}
          disabled={mutation.pending}
          className="w-full rounded-md border border-stone-300 p-3"
        />
        {mutation.error && (
          <p role="alert" className="text-sm text-red-800">
            {mutation.error.message}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-stone-600">
            {notice}
          </p>
        )}
        <Button type="submit" disabled={mutation.pending || !name.trim()}>
          {mutation.pending ? '建立中…' : `建立${title}`}
        </Button>
      </form>
    </section>
  );
}
export function RenameContentForm({
  kind,
  id,
  name,
  revision,
}: {
  kind: Kind;
  id: string;
  name: string;
  revision: number;
}) {
  const router = useRouter();
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [reloadFrom, setReloadFrom] = useState<number | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const mutation = useContentMutation(kind);
  const conflict = mutation.error?.code === 'CONCURRENT_MODIFICATION';
  const refreshed = reloadFrom !== null && revision !== reloadFrom;
  const mustReload = conflict && !refreshed;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mustReload || refreshing || !draft.trim()) return;
    const expectedRevision = refreshed ? revision : baseRevision;
    // Capture exactly the revision the user reviewed. Network retries reuse this payload.
    setBaseRevision(expectedRevision);
    setReloadFrom(null);
    const ok = await mutation.mutate(
      `/api/v1/${kind === 'project' ? 'projects' : 'albums'}/${id}`,
      'PATCH',
      { name: draft.trim(), expectedRevision },
    );
    if (ok) {
      setEditing(false);
      router.refresh();
    }
  }
  if (!editing)
    return (
      <Button
        variant="outline"
        type="button"
        aria-label={`編輯 ${name}`}
        onClick={() => {
          setDraft(name);
          setBaseRevision(revision);
          setReloadFrom(null);
          mutation.clearError();
          setEditing(true);
        }}
      >
        修改名稱
      </Button>
    );
  return (
    <form
      onSubmit={submit}
      className="mt-4 space-y-3"
      aria-label={`修改 ${name}`}
    >
      <label htmlFor={inputId} className="block text-sm">
        修改名稱
      </label>
      <input
        id={inputId}
        name="name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        required
        maxLength={160}
        disabled={mutation.pending || refreshing}
        className="w-full rounded-md border border-stone-300 p-3"
      />
      {mutation.error && (
        <p role="alert" className="text-sm text-red-800">
          {refreshed && conflict
            ? '已載入最新資料，請確認目前名稱後再儲存。'
            : mutation.error.message}
        </p>
      )}
      {conflict && (
        <p className="break-words text-sm text-stone-600">目前名稱：{name}</p>
      )}
      <div className="flex flex-wrap gap-3">
        {mustReload && (
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() => {
              setReloadFrom(baseRevision);
              startRefresh(() => router.refresh());
            }}
          >
            {refreshing ? '載入中…' : '重新載入最新資料'}
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            mutation.pending || refreshing || mustReload || !draft.trim()
          }
        >
          {mutation.pending ? '儲存中…' : '儲存名稱'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={mutation.pending || refreshing}
          onClick={() => setEditing(false)}
        >
          取消修改
        </Button>
      </div>
    </form>
  );
}
