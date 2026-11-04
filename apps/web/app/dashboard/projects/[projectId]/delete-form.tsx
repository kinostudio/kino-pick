'use client';
import { useState, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@kino-pic/ui';
import { useContentMutation } from './content-forms';

export function DeleteContentForm({
  kind,
  id,
  name,
  revision,
  returnTo,
}: {
  kind: 'project' | 'album';
  id: string;
  name: string;
  revision: number;
  returnTo?: string;
}) {
  const router = useRouter();
  const field = useId();
  const mutation = useContentMutation(kind);
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const label = kind === 'project' ? '專案' : '相簿';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== name || mutation.pending) return;
    if (
      await mutation.mutate(`/api/v1/${kind}s/${id}`, 'DELETE', {
        confirmationName: confirmation,
        expectedRevision: revision,
      })
    ) {
      setEditing(false);
      if (returnTo) router.replace(returnTo);
      else router.refresh();
    }
  }
  if (!editing)
    return (
      <Button
        type="button"
        variant="outline"
        aria-label={`刪除${label} ${name}`}
        onClick={() => {
          setConfirmation('');
          mutation.clearError();
          setEditing(true);
        }}
      >
        刪除{label}
      </Button>
    );
  return (
    <form
      onSubmit={submit}
      aria-label={`確認刪除${label} ${name}`}
      className="mt-4 space-y-3"
    >
      <p className="text-sm text-stone-600">
        請先清理此專案的所有相簿。確認刪除後，專案將從工作台移除且無法還原；版本與審計紀錄仍會保留。
      </p>
      <label htmlFor={field}>輸入「{name}」確認刪除</label>
      <input
        id={field}
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        disabled={mutation.pending}
        autoComplete="off"
        className="block w-full rounded border border-stone-300 p-2"
      />
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={confirmation !== name || mutation.pending}
        >
          {mutation.pending ? '刪除中…' : `確認刪除${label}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={mutation.pending}
          onClick={() => setEditing(false)}
        >
          取消
        </Button>
      </div>
    </form>
  );
}
