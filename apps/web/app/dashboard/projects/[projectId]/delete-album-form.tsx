'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import { StudioIcon } from '../../../../target-ui/studio-icons';
import { getUploadIdentity } from '../../../../target-ui/upload-client';

const count = z.number().int().nonnegative().safe();
const deletionStateSchema = z.object({
  album: z.object({ id: z.uuid(), name: z.string(), revision: count }),
  preview: z.object({
    assetCount: count,
    totalBytes: count,
    versionCount: count,
    photoCount: count,
    blockers: z.array(z.string()),
  }),
  job: z
    .object({
      id: z.uuid(),
      status: z.enum(['deleting', 'completed']),
      inventoryCount: count,
      bytesBefore: count,
      bytesReclaimed: count,
      pending: count,
      failed: count,
    })
    .nullable(),
});
type DeletionState = z.infer<typeof deletionStateSchema>;
type DeleteIntent = {
  requestId: string;
  expectedRevision: number;
  confirmationName: string;
  inventoryCount: number;
  bytesBefore: number;
  confirmPermanent: true;
};

const messages: Record<string, string> = {
  AUTH_REQUIRED: '登入已失效，請重新登入後檢查刪除進度。',
  OWNER_REQUIRED: '只有工作空間擁有者可以刪除相簿。',
  NOT_FOUND: '目前無法存取此相簿，請返回工作台確認。',
  CONCURRENT_MODIFICATION: '相簿已更新，請重新檢查進度並確認最新內容。',
  DELETION_INVENTORY_CHANGED:
    '照片或版本清單已更新，請重新檢查進度並確認最新內容。',
  DELETION_BLOCKED: '相簿仍有使用中或受保護的內容，請處理後重新檢查進度。',
  DELETION_CONFIRMATION_REQUIRED: '請輸入完整相簿名稱並確認永久刪除。',
  DELETE_CONFIRMATION_REQUIRED: '請輸入完整相簿名稱並確認永久刪除。',
  CONTENT_NOT_EMPTY_OR_IDLE: '相簿仍有使用中或受保護的內容，請先處理後再預覽。',
  REQUEST_ID_CONFLICT: '刪除要求與先前紀錄不同，請重新檢查刪除進度。',
};
const blockerMessages: Record<string, string> = {
  DELETE_PROTECTED: '相簿受保護，或仍有置頂照片；請先明確解除保護。',
  DELETE_CONTENT_BUSY: '專案流程、上傳授權或照片處理仍在進行；完成後才能清理。',
  DELETE_ACTIVE_REVIEW: '相簿最近有人讀取，或客戶仍在使用；請稍後再試。',
  DELETE_SHARED_REFERENCE: '照片版本仍被其他相簿或核准流程引用，暫時不能清理。',
};
const bytes = (value: number) => `${value.toLocaleString('zh-TW')} bytes`;

export function DeleteAlbumForm({
  albumId,
  onDeleted,
  previewOnly = false,
  expectedOwnerId,
}: {
  albumId: string;
  onDeleted?: () => void;
  previewOnly?: boolean;
  expectedOwnerId?: string;
}) {
  const router = useRouter();
  const field = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeletionState | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const mounted = useRef(true);
  const intent = useRef<DeleteIntent | null>(null);
  const rejected = useRef(false);
  const completed = useRef(false);
  const base = `/api/v1/albums/${albumId}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function request(url: string, method = 'GET', body?: unknown) {
    if (method === 'DELETE') rejected.current = false;
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const parsed = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(result);
      if (
        method === 'DELETE' &&
        response.status === 409 &&
        parsed.success &&
        [
          'DELETION_INVENTORY_CHANGED',
          'CONCURRENT_MODIFICATION',
          'DELETION_BLOCKED',
          'DELETION_CONFIRMATION_REQUIRED',
        ].includes(parsed.data.error.code)
      )
        rejected.current = true;
      throw new Error(
        parsed.success
          ? (messages[parsed.data.error.code] ??
              (previewOnly
                ? '目前無法檢查清理條件，請稍後重試。'
                : '刪除尚未完成，請檢查進度後重試。'))
          : previewOnly
            ? '目前無法檢查清理條件，請稍後重試。'
            : '無法確認刪除結果，請重試原要求。',
      );
    }
    const next = deletionStateSchema.parse(result);
    if (next.album.id !== albumId)
      throw new Error('相簿資料不一致，已停止操作。');
    return next;
  }

  function accept(next: DeletionState) {
    if (!mounted.current) return;
    setState(next);
    if (
      !previewOnly &&
      next.job?.status === 'completed' &&
      !completed.current
    ) {
      completed.current = true;
      intent.current = null;
      setCaptured(false);
      onDeleted?.();
      router.refresh();
    }
  }

  async function perform(work: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : '無法確認刪除結果，請重試原要求。',
        );
    } finally {
      active.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function continueJob(first: DeletionState) {
    let current = first;
    accept(current);
    while (
      mounted.current &&
      current.job?.status === 'deleting' &&
      current.job.failed === 0
    ) {
      const previous = current.job;
      current = await request(base + '/deletion/retry', 'POST', {
        jobId: previous.id,
      });
      accept(current);
      if (
        current.job?.status === 'deleting' &&
        current.job.pending === previous.pending &&
        current.job.bytesReclaimed === previous.bytesReclaimed
      )
        break;
    }
  }

  async function preview() {
    setOpen(true);
    if (previewOnly) setState(null);
    await perform(async () => {
      const before = previewOnly ? await getUploadIdentity() : null;
      if (previewOnly && before?.actorId !== expectedOwnerId)
        throw new Error('登入身分已變更，請重新載入後再檢查。');
      const next = await request(base + '/deletion');
      if (before) {
        const after = await getUploadIdentity();
        if (
          before.actorId !== after.actorId ||
          before.sessionId !== after.sessionId
        )
          throw new Error('登入身分已變更，請重新載入後再檢查。');
      }
      if (mounted.current && !next.job && rejected.current) {
        intent.current = null;
        rejected.current = false;
        setCaptured(false);
        setConfirmation('');
        setConfirmed(false);
      }
      accept(next);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (previewOnly) return;
    if (!state || state.job || state.preview.blockers.length) return;
    if (!intent.current) {
      if (confirmation !== state.album.name || !confirmed) return;
      intent.current = {
        requestId: crypto.randomUUID(),
        expectedRevision: state.album.revision,
        confirmationName: confirmation,
        inventoryCount: state.preview.assetCount,
        bytesBefore: state.preview.totalBytes,
        confirmPermanent: true,
      };
      setCaptured(true);
    }
    await perform(async () => {
      await continueJob(await request(base, 'DELETE', intent.current));
    });
  }

  if (!open)
    return (
      <Button type="button" variant="outline" onClick={() => void preview()}>
        {previewOnly && <StudioIcon name="eye" width={18} height={18} />}
        {previewOnly ? '檢查清理條件' : '刪除相簿與照片'}
      </Button>
    );
  if (previewOnly)
    return (
      <section
        aria-label="清理條件預覽"
        aria-busy={pending}
        className="mt-4 space-y-3 rounded-lg border border-stone-300 p-4"
      >
        <h4 className="font-semibold">清理條件預覽</h4>
        <p className="text-sm text-stone-600">
          僅檢查，不會刪除照片。自動刪除維持關閉。
        </p>
        {state && (
          <>
            <p className="text-sm">
              {state.preview.photoCount} 張照片 · {state.preview.versionCount}{' '}
              個版本 · {state.preview.assetCount} 個檔案
            </p>
            <p className="text-sm">
              登記檔案容量 {bytes(state.preview.totalBytes)}
            </p>
            {state.job ? (
              <p role="status">
                {state.job.status === 'completed'
                  ? '已有完成的清理紀錄'
                  : '已有清理工作進行中'}
                ，已確認釋放 {bytes(state.job.bytesReclaimed)}。
              </p>
            ) : state.preview.blockers.length ? (
              <ul
                aria-label="清理保護原因"
                className="list-inside list-disc text-sm"
              >
                {state.preview.blockers.map((reason) => (
                  <li key={reason}>
                    {blockerMessages[reason] ?? '尚有未滿足的刪除安全條件。'}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">本次手動清理檢查未發現阻擋項目。</p>
            )}
            <p className="text-sm text-stone-600">
              這不是可自動清理的判定；仍待完整活動與儲存對帳檢查。實際刪除前會重新檢查。
            </p>
          </>
        )}
        {pending && <p role="status">正在檢查…</p>}
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void preview()}
          >
            <StudioIcon name="refresh" width={18} height={18} />
            重新檢查
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            收起預覽
          </Button>
        </div>
      </section>
    );
  return (
    <section
      aria-label="相簿儲存清理"
      className="mt-4 space-y-3 rounded-lg border border-stone-300 p-4"
      aria-busy={pending}
    >
      <h3 className="font-semibold">永久刪除相簿與照片</h3>
      {state && (
        <>
          <p className="break-words">{state.album.name}</p>
          <p className="text-sm text-stone-600">
            {state.preview.photoCount} 張照片、{state.preview.versionCount}{' '}
            個版本、{state.preview.assetCount}{' '}
            個檔案。包含原圖、歷史版本與縮圖／預覽。
          </p>
          <p className="text-sm">
            預計清理 {bytes(state.job?.bytesBefore ?? state.preview.totalBytes)}
            ；審計與刪除紀錄保留。
          </p>
          {state.job ? (
            <div role="status" className="space-y-2 text-sm">
              <p>
                {state.job.status === 'completed' ? '清理完成' : '清理尚未完成'}
                ，已確認釋放 {bytes(state.job.bytesReclaimed)}。
              </p>
              {state.job.status === 'deleting' && (
                <>
                  <p>
                    剩餘 {state.job.pending} 個檔案，失敗 {state.job.failed}{' '}
                    個；完成前不會再提供此相簿的照片。
                  </p>
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        const next = await request(
                          base + '/deletion/retry',
                          'POST',
                          { jobId: state.job!.id },
                        );
                        await continueJob(next);
                      })
                    }
                  >
                    {pending
                      ? '清理中…'
                      : state.job.failed
                        ? '重試清理'
                        : '繼續清理'}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              {state.preview.blockers.length > 0 && (
                <div role="alert">
                  <p>目前無法清理：</p>
                  <ul className="list-inside list-disc">
                    {state.preview.blockers.map((reason) => (
                      <li key={reason}>
                        {blockerMessages[reason] ??
                          '尚有未滿足的刪除安全條件，請先處理後再試。'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm text-stone-600">
                此操作不可還原。確認後立即停止新存取與上傳，再清理儲存空間；失敗可繼續原工作。
              </p>
              <label htmlFor={field}>輸入「{state.album.name}」確認</label>
              <input
                id={field}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={pending || captured}
                autoComplete="off"
                className="block w-full rounded border border-stone-300 p-2"
              />
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={pending || captured}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我確認永久刪除此相簿的所有版本與衍生檔案。
              </label>
              <Button
                type="submit"
                disabled={
                  pending ||
                  !!state.preview.blockers.length ||
                  (!captured &&
                    (confirmation !== state.album.name || !confirmed))
                }
              >
                {pending
                  ? '清理中…'
                  : captured
                    ? '重試已確認的刪除要求'
                    : '確認永久刪除'}
              </Button>
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void preview()}
        >
          {state ? '重新檢查進度' : '重試載入預覽'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          {state?.job || captured ? '收起進度' : '取消'}
        </Button>
      </div>
    </section>
  );
}
