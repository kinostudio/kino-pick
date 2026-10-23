'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { type Album } from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
import { useContentMutation } from './content-forms';
export function AlbumProtectionForm({ album }: { album: Album }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pinned, setPinned] = useState(album.isPinned);
  const [hold, setHold] = useState(album.legalHold);
  const [confirm, setConfirm] = useState(false);
  const [baseRevision, setBaseRevision] = useState(album.revision);
  const [reloadFrom, setReloadFrom] = useState<number | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const mutation = useContentMutation('album');
  const conflict = mutation.error?.code === 'CONCURRENT_MODIFICATION';
  const refreshed = reloadFrom !== null && album.revision !== reloadFrom;
  const mustReload = conflict && !refreshed;
  const removing = (album.isPinned && !pinned) || (album.legalHold && !hold);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mustReload || refreshing || (removing && !confirm)) return;
    const expectedRevision = refreshed ? album.revision : baseRevision;
    setBaseRevision(expectedRevision);
    setReloadFrom(null);
    const ok = await mutation.mutate(
      `/api/v1/albums/${album.id}/protection`,
      'PATCH',
      {
        isPinned: pinned,
        legalHold: hold,
        expectedRevision,
        confirmUnprotect: confirm,
      },
    );
    if (ok) {
      setEditing(false);
      router.refresh();
    }
  }
  if (!editing)
    return (
      <Button
        type="button"
        variant="outline"
        aria-label={`保護設定 ${album.name}`}
        onClick={() => {
          setPinned(album.isPinned);
          setHold(album.legalHold);
          setConfirm(false);
          setBaseRevision(album.revision);
          setReloadFrom(null);
          mutation.clearError();
          setEditing(true);
        }}
      >
        保護設定
      </Button>
    );
  return (
    <form
      aria-label={`保護設定 ${album.name}`}
      onSubmit={submit}
      className="mt-4 space-y-3"
    >
      <p className="text-sm text-stone-600">
        釘選或保留保護的相簿，應排除於自動清理。目前自動刪除尚未啟用。
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={pinned}
          disabled={mutation.pending || refreshing}
          onChange={(e) => {
            setPinned(e.target.checked);
            setConfirm(false);
          }}
        />
        釘選相簿
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hold}
          disabled={mutation.pending || refreshing}
          onChange={(e) => {
            setHold(e.target.checked);
            setConfirm(false);
          }}
        />
        保留保護
      </label>
      {removing && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirm}
            disabled={mutation.pending || refreshing}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          我確認解除保護；未來啟用清理政策後可能成為清理候選
        </label>
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-red-800">
          {conflict
            ? refreshed
              ? '已載入最新設定，請比較後再儲存；你的選項已保留。'
              : '資料已更新，請先載入最新設定；你的選項會保留。'
            : mutation.error.message}
        </p>
      )}
      {conflict && (
        <p className="text-sm">
          目前設定：釘選{album.isPinned ? '開啟' : '關閉'}，保留保護
          {album.legalHold ? '開啟' : '關閉'}
        </p>
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
            載入最新保護設定
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            mutation.pending ||
            refreshing ||
            mustReload ||
            (removing && !confirm)
          }
        >
          {mutation.pending ? '儲存中…' : '儲存保護設定'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={mutation.pending || refreshing}
          onClick={() => setEditing(false)}
        >
          取消保護修改
        </Button>
      </div>
    </form>
  );
}
