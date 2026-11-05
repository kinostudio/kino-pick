import { useEffect, useRef, useState } from 'react';
import { Button } from '@kino-pic/ui';
import { CreateContentForm } from '../app/dashboard/projects/[projectId]/content-forms';
import { StudioIcon } from './studio-icons';
export function StudioCreateDialog({
  kind,
  parentId,
}: {
  kind: 'project' | 'album';
  parentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const label = kind === 'project' ? '專案' : '相簿';
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        className="studio-primary-link"
        type="button"
        onClick={() => setOpen(true)}
      >
        <StudioIcon
          name={kind === 'project' ? 'projects' : 'image'}
          width={16}
          height={16}
        />{' '}
        建立{label}
      </button>
      <dialog
        ref={dialog}
        className="studio-create-dialog"
        aria-label={'建立' + label}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => setOpen(false)}
      >
        <header>
          <span className="studio-eyebrow">
            {kind === 'project' ? '建立專案' : '建立相簿'}
          </span>
          <button
            type="button"
            aria-label={'關閉建立' + label}
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            <StudioIcon name="close" width={18} height={18} />
          </button>
        </header>
        <CreateContentForm
          kind={kind}
          parentId={parentId}
          onPendingChange={setPending}
          onCreated={() => setOpen(false)}
        />
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
            className="gap-2"
          >
            <StudioIcon name="close" width={16} height={16} />
            取消
          </Button>
        </div>
      </dialog>
    </>
  );
}
