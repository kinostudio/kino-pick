import { useRef, useState } from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';
import {
  processingReviewPreviewSchema,
  type ProcessingReviewPreview,
  abandonedProcessingSchema,
} from '../../../packages/contracts/src/processing-review';

const processingRetryResultSchema = z
  .object({
    status: z.literal('checked'),
    processed: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

const labels = {
  missing: '尚無輸出',
  fenced: '已封鎖寫入',
  occupied: '已有檔案，需保留容量',
  unknown: '無法確認，需保留容量',
};
export function ProcessingReview({
  photoId,
  versionId,
  onResolved,
  retryOnly = false,
}: {
  photoId: string;
  versionId: string;
  onResolved: () => void;
  retryOnly?: boolean;
}) {
  const [preview, setPreview] = useState<ProcessingReviewPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const operation = useRef<{ requestId: string; epoch: number } | null>(null);
  const retryPending = useRef(false);
  async function retry() {
    if (retryPending.current) return;
    retryPending.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/photos/${encodeURIComponent(photoId)}/versions/${encodeURIComponent(versionId)}/processing-retry`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      if (!response.ok) throw new Error();
      processingRetryResultSchema.parse(await response.json());
      onResolved();
    } catch {
      setError('目前無法確認重試結果，原圖已保留。請稍後重新整理。');
    } finally {
      retryPending.current = false;
      setPending(false);
    }
  }
  async function abandon() {
    if (!preview || !confirmed || pending) return;
    const attempt = operation.current ?? {
      requestId: crypto.randomUUID(),
      epoch: preview.leaseEpoch,
    };
    operation.current = attempt;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/photos/${encodeURIComponent(photoId)}/versions/${encodeURIComponent(versionId)}/processing-review/abandon`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: attempt.requestId,
            expectedLeaseEpoch: attempt.epoch,
            confirmAbandon: true,
          }),
        },
      );
      if (!response.ok) {
        if (response.status === 409) {
          operation.current = null;
          setConfirmed(false);
          setError('狀態已變更或輸出位置已有檔案，請重新檢查處理結果。');
        } else setError('尚無法確認處理結果，請用相同操作重試。');
        return;
      }
      const result = abandonedProcessingSchema.parse(await response.json());
      if (result.jobId !== preview.jobId || result.leaseEpoch !== attempt.epoch)
        throw new Error('尚無法確認處理結果，請用相同操作重試。');
      onResolved();
    } catch {
      setError('尚無法確認處理結果，請用相同操作重試。');
    } finally {
      setPending(false);
    }
  }
  async function inspect() {
    setPending(true);
    setError('');
    if (!operation.current) setPreview(null);
    try {
      const response = await fetch(
        `/api/v1/photos/${encodeURIComponent(photoId)}/versions/${encodeURIComponent(versionId)}/processing-review`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!response.ok)
        throw new Error('目前無法取得審查資訊，請重新整理相簿後再試。');
      const result = processingReviewPreviewSchema.parse(await response.json());
      if (result.photoId !== photoId || result.versionId !== versionId)
        throw new Error('照片資訊已變更，請重新整理相簿。');
      setPreview(result);
    } catch (failure) {
      setError(
        failure instanceof Error && !(failure.name === 'ZodError')
          ? failure.message
          : '審查資訊無法驗證，請稍後重試。',
      );
    } finally {
      setPending(false);
    }
  }
  if (retryOnly)
    return (
      <div className="border-t border-stone-200 p-2 text-xs text-stone-700">
        <button
          type="button"
          disabled={pending}
          onClick={() => void retry()}
          className="inline-flex min-h-11 items-center gap-2 rounded border border-stone-300 px-2 py-1 disabled:opacity-50"
        >
          <StudioIcon name="refresh" className="h-4 w-4" />
          {pending ? '處理中…' : '重試縮圖'}
        </button>
        {error && (
          <p role="alert" className="mt-2">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="border-t border-stone-200 p-2 text-xs text-stone-700">
      <button
        type="button"
        disabled={pending}
        onClick={() => void inspect()}
        className="min-h-11 rounded border border-stone-300 px-2 py-1 disabled:opacity-50"
      >
        {pending ? '檢查中…' : '檢視處理問題'}
      </button>
      {error && (
        <p role="alert" className="mt-2">
          {error}
        </p>
      )}
      {preview && (
        <div role="status" className="mt-2 space-y-2">
          <p>原圖已保留。處理失敗的預留容量：16 MiB。</p>
          <ul>
            {preview.outputs.map((output) => (
              <li key={output.kind}>
                {output.kind === 'thumbnail' ? '縮圖' : '預覽圖'}：
                {labels[output.state]}
              </li>
            ))}
          </ul>
          <p>
            {preview.potentialReleaseBytes
              ? '兩個輸出位置目前可列入容量回收審查。'
              : '目前無法安全回收預留容量。'}
          </p>
          <p>
            這是 Dry
            Run，即時狀態仍可能改變。此檢查不會封鎖寫入、刪除檔案或釋放容量。
          </p>
          {preview.potentialReleaseBytes > 0 && (
            <div className="space-y-2 border-t border-stone-200 pt-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={pending}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我確認永久停止這次縮圖與預覽處理；保留原圖並封鎖兩個輸出位置後，釋放
                16 MiB 預留容量。
              </label>
              <button
                type="button"
                disabled={!confirmed || pending}
                onClick={() => void abandon()}
                className="min-h-11 rounded border border-stone-300 px-2 py-1 disabled:opacity-50"
              >
                {pending ? '確認中…' : '停止處理並釋放預留容量'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
