'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import {
  workspaceSchema,
  type Workspace,
} from '../../../packages/contracts/src/identity';
import { StudioIcon } from './studio-icons';

const identitySchema = z.object({
  actor: z.object({ id: z.uuid() }),
  sessionId: z.string().min(1),
});
const messages: Record<string, string> = {
  WORKSPACE_NOT_EMPTY: '這個工作空間還有專案，請先清空後再刪除。',
  WORKSPACE_NAME_CONFLICT: '名稱已被更新，請重新整理後再操作。',
  REQUEST_ID_CONFLICT: '這次操作資料已變更，請關閉後重新操作。',
  NOT_FOUND: '找不到這個工作空間，請重新整理。',
  OWNER_REQUIRED: '登入已到期，請重新登入。',
  AUTH_REQUIRED: '登入已到期，請重新登入。',
  OWNER_IDENTITY_CHANGED: '登入狀態已變更，請重新整理後再操作。',
  CONCURRENT_MODIFICATION: '工作空間已被更新，請重新整理後再操作。',
  WORKSPACE_DELETED: '這個工作空間已移除，請重新整理。',
};
export function WorkspaceActions({ workspace }: { workspace: Workspace }) {
  const [mode, setMode] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(workspace.name);
  const [confirmation, setConfirmation] = useState('');
  const [requestId, setRequestId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (mode && !dialog.current?.open) {
      dialog.current?.showModal();
      dialog.current?.querySelector('input')?.focus();
    }
    if (!mode && dialog.current?.open) dialog.current.close();
  }, [mode]);
  function open(action: 'rename' | 'delete') {
    setName(workspace.name);
    setConfirmation('');
    setError('');
    setRequestId(crypto.randomUUID());
    setMode(action);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      pending ||
      !mode ||
      (mode === 'delete' && confirmation !== workspace.name)
    )
      return;
    setPending(true);
    setError('');
    try {
      const current = await fetch('/api/v1/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!current.ok) throw new Error('AUTH_REQUIRED');
      const identity = identitySchema.parse(await current.json());
      if (identity.actor.id !== workspace.ownerUserId)
        throw new Error('OWNER_IDENTITY_CHANGED');
      const response = await fetch('/api/v1/workspaces/' + workspace.id, {
        method: mode === 'rename' ? 'PATCH' : 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/json',
          'X-Kino-Expected-Actor': identity.actor.id,
          'X-Kino-Expected-Session': identity.sessionId,
        },
        body: JSON.stringify({
          expectedName: workspace.name,
          requestId,
          ...(mode === 'rename' ? { name: name.trim() } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          typeof body?.error?.code === 'string'
            ? body.error.code
            : 'UNAVAILABLE',
        );
      }
      const result: unknown = await response.json();
      const saved =
        mode === 'rename'
          ? workspaceSchema.parse(result)
          : z
              .object({
                id: z.uuid(),
                name: z.string(),
                deletedAtMs: z.number().int().positive().safe(),
              })
              .parse(result);
      if (
        saved.id !== workspace.id ||
        saved.name !== (mode === 'rename' ? name.trim() : workspace.name)
      )
        throw new Error('UNCONFIRMED_RESULT');
      window.location.reload();
    } catch (failure) {
      setError(
        messages[failure instanceof Error ? failure.message : ''] ??
          '尚未確認操作結果，請重試；不會重複執行。',
      );
      setPending(false);
    }
  }
  return (
    <>
      <div className="workspace-card-tools">
        <button
          type="button"
          className="kino-icon-button"
          title="更名"
          aria-label={'更名工作空間：' + workspace.name}
          onClick={() => open('rename')}
        >
          <StudioIcon name="edit" />
        </button>
        <button
          type="button"
          className="kino-icon-button kino-icon-button--danger"
          title="刪除"
          aria-label={'刪除工作空間：' + workspace.name}
          onClick={() => open('delete')}
        >
          <StudioIcon name="trash" />
        </button>
      </div>
      <dialog
        ref={dialog}
        className="studio-create-dialog"
        aria-label={mode === 'rename' ? '更名工作空間' : '刪除工作空間'}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => setMode(null)}
      >
        <header>
          <h2>{mode === 'rename' ? '更名工作空間' : '刪除工作空間'}</h2>
          <button
            type="button"
            aria-label="關閉工作空間設定"
            disabled={pending}
            onClick={() => setMode(null)}
          >
            <StudioIcon name="close" width={18} height={18} />
          </button>
        </header>
        <form onSubmit={submit} className="mt-4 space-y-4">
          {mode === 'rename' ? (
            <label className="block text-sm">
              工作空間名稱
              <input
                className="mt-2 w-full rounded-md border border-stone-300 p-3"
                value={name}
                maxLength={120}
                required
                disabled={pending}
                onChange={(event) => {
                  setName(event.target.value);
                  setRequestId(crypto.randomUUID());
                }}
              />
            </label>
          ) : (
            <>
              <p>只會移除已清空的工作空間，歷史紀錄會保留。</p>
              <label className="block text-sm">
                輸入「{workspace.name}」確認刪除
                <input
                  className="mt-2 w-full rounded-md border border-stone-300 p-3"
                  value={confirmation}
                  autoComplete="off"
                  disabled={pending}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setMode(null)}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                (mode === 'rename'
                  ? !name.trim() || name.trim() === workspace.name
                  : confirmation !== workspace.name)
              }
            >
              {pending
                ? '處理中…'
                : mode === 'rename'
                  ? '儲存名稱'
                  : '刪除工作空間'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
