'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@kino-pic/ui';
import { useContentMutation } from './content-forms';
export function ArchiveContentForm({
  kind,
  id,
  name,
  archived,
  revision,
}: {
  kind: 'project' | 'album';
  id: string;
  name: string;
  archived: boolean;
  revision: number;
}) {
  const router = useRouter();
  const mutation = useContentMutation(kind);
  const [editing, setEditing] = useState(false);
  const [desired, setDesired] = useState(!archived);
  const [confirm, setConfirm] = useState(false);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [reloadFrom, setReloadFrom] = useState<number | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const conflict = mutation.error?.code === 'CONCURRENT_MODIFICATION';
  const refreshed = reloadFrom !== null && revision !== reloadFrom;
  const mustReload = conflict && !refreshed;
  const label = kind === 'project' ? '專案' : '相簿';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirm || mustReload || refreshing) return;
    const expectedRevision = refreshed ? revision : baseRevision;
    setBaseRevision(expectedRevision);
    setReloadFrom(null);
    if (
      await mutation.mutate(`/api/v1/${kind}s/${id}/archive`, 'PATCH', {
        archived: desired,
        expectedRevision,
      })
    ) {
      setEditing(false);
      router.refresh();
    }
  }
  if (!editing)
    return (
      <Button
        type="button"
        variant="outline"
        aria-label={`${archived ? '還原' : '封存'}${label} ${name}`}
        onClick={() => {
          setDesired(!archived);
          setConfirm(false);
          setBaseRevision(revision);
          setReloadFrom(null);
          mutation.clearError();
          setEditing(true);
        }}
      >
        {archived ? '還原' : '封存'}
        {label}
      </Button>
    );
  return (
    <form
      onSubmit={submit}
      aria-label={`${desired ? '封存' : '還原'}${label} ${name}`}
      className="mt-4 space-y-3"
    >
      <p className="text-sm text-stone-600">
        {desired
          ? '封存將暫停內容編輯，不會刪檔或解除保護。目前僅支援沒有照片的草稿相簿、草稿或已交付專案。'
          : '還原將回到封存前狀態，不會重設瀏覽時間或解除保護。'}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirm}
          disabled={mutation.pending || refreshing}
          onChange={(e) => setConfirm(e.target.checked)}
        />
        我確認{desired ? '封存' : '還原'}此{label}
      </label>
      {mutation.error && (
        <p role="alert" className="text-sm text-red-800">
          {conflict
            ? refreshed
              ? '已載入最新資料，請確認目前狀態再送出。'
              : '資料已更新，請先載入最新狀態。'
            : mutation.error.message}
        </p>
      )}
      {conflict && (
        <p className="text-sm">目前狀態：{archived ? '已封存' : '未封存'}</p>
      )}
      <div className="flex flex-wrap gap-3">
        {mustReload && (
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() => {
              setReloadFrom(baseRevision);
              setConfirm(false);
              startRefresh(() => router.refresh());
            }}
          >
            載入最新封存狀態
          </Button>
        )}
        <Button
          type="submit"
          disabled={!confirm || mutation.pending || refreshing || mustReload}
        >
          {mutation.pending
            ? '處理中…'
            : `確認${desired ? '封存' : '還原'}${label}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={mutation.pending || refreshing}
          onClick={() => setEditing(false)}
        >
          取消封存操作
        </Button>
      </div>
    </form>
  );
}
