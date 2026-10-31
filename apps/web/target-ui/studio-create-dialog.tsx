import { useEffect, useRef, useState } from 'react';
import { CreateContentForm } from '../app/dashboard/projects/[projectId]/content-forms';
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
        ＋ 建立{label}
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
            {kind === 'project' ? 'NEW PROJECT' : 'NEW ALBUM'}
          </span>
          <button
            type="button"
            aria-label={'關閉建立' + label}
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        <CreateContentForm
          kind={kind}
          parentId={parentId}
          onPendingChange={setPending}
          onCreated={() => setOpen(false)}
        />
      </dialog>
    </>
  );
}
