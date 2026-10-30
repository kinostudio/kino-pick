'use client';

import { useId } from 'react';
import type { ResolvedUploadCandidate } from '../../../packages/contracts/src/resolved-uploads';

type AssistedCandidatePickerProps = {
  uploadedFilename: string;
  status: 'loading' | 'ready' | 'error' | 'stale';
  items: readonly ResolvedUploadCandidate[];
  nextCursor: string | null;
  pageNumber: number;
  hasPrevious: boolean;
  canReturnFirst: boolean;
  message: string;
  selectedKind: 'new_photo' | 'new_version' | null;
  selectedCandidate: ResolvedUploadCandidate | null;
  disabled?: boolean;
  onKindChange: (kind: 'new_photo' | 'new_version') => void;
  onSelect: (candidate: ResolvedUploadCandidate) => void;
  onFirst: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRefresh: () => void;
};

function canCreateVersion(candidate: ResolvedUploadCandidate) {
  return candidate.currentVersionId !== null && candidate.revision !== null;
}

export function AssistedCandidatePicker({
  uploadedFilename,
  status,
  items,
  nextCursor,
  pageNumber,
  hasPrevious,
  canReturnFirst,
  message,
  selectedKind,
  selectedCandidate,
  disabled = false,
  onKindChange,
  onSelect,
  onFirst,
  onPrevious,
  onNext,
  onRefresh,
}: AssistedCandidatePickerProps) {
  const choiceName = useId();
  const candidateName = useId();
  const loading = status === 'loading';
  const locked = disabled || status !== 'ready';

  return (
    <section
      data-testid="assisted-catalog"
      aria-label="相簿照片目標"
      className="mt-3 min-w-0 rounded-md border border-stone-200 p-3"
    >
      <p className="break-words text-sm text-stone-700">
        為「{uploadedFilename}」選擇照片目標。每頁最多顯示 24 個目前目標。
      </p>

      <fieldset className="mt-3 min-w-0 space-y-3" disabled={locked}>
        <legend className="text-sm font-medium text-stone-900">
          請明確選擇這次上傳目標
        </legend>
        <label className="flex min-w-0 items-start gap-2 rounded-md border border-stone-200 p-3 text-sm">
          <input
            type="radio"
            name={choiceName}
            value="new_photo"
            checked={selectedKind === 'new_photo'}
            onChange={() => onKindChange('new_photo')}
            className="mt-1 size-4 shrink-0 accent-stone-800"
          />
          <span>建立一張新照片</span>
        </label>

        <div className="min-w-0 rounded-md border border-stone-200 p-3">
          <label className="flex min-w-0 items-start gap-2 text-sm">
            <input
              type="radio"
              name={choiceName}
              value="new_version"
              checked={selectedKind === 'new_version'}
              onChange={() => onKindChange('new_version')}
              className="mt-1 size-4 shrink-0 accent-stone-800"
            />
            <span className="font-medium">建立現有照片的新版本</span>
          </label>

          {selectedCandidate && (
            <p
              data-testid="assisted-catalog-selected"
              role="status"
              aria-live="polite"
              className="mt-3 break-words rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
            >
              {selectedKind === 'new_photo' ? '保留的版本目標：' : '已選目標：'}
              {selectedCandidate.filename} · 目前版本
            </p>
          )}

          {status === 'loading' && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-sm text-stone-600"
            >
              正在載入目前照片目標…
            </p>
          )}
          {status === 'error' && (
            <p
              data-testid="assisted-catalog-error"
              role="alert"
              className="mt-3 break-words rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
            >
              {message || '目前無法載入照片目標。'}
            </p>
          )}
          {status === 'stale' && (
            <p
              data-testid="assisted-catalog-error"
              role="alert"
              className="mt-3 break-words rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            >
              {message || '相簿目標已變更，請重新檢查目前照片。'}
            </p>
          )}
          {status === 'ready' && items.length === 0 && (
            <p role="status" className="mt-3 text-sm text-stone-600">
              這一頁沒有可選的照片目標。
            </p>
          )}

          {items.length > 0 && (
            <div className="mt-3 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
                <span>
                  第 {pageNumber} 頁 · {items.length} 個目標
                </span>
                <span>清單只載入目前頁面</span>
              </div>
              <ul className="mt-2 max-h-72 min-w-0 space-y-2 overflow-y-auto pr-1">
                {items.map((candidate, index) => {
                  const available = canCreateVersion(candidate);
                  const selected =
                    selectedKind === 'new_version' &&
                    selectedCandidate?.photoId === candidate.photoId;
                  return (
                    <li key={candidate.photoId} className="min-w-0">
                      <label
                        data-testid="assisted-catalog-item"
                        data-candidate-id={candidate.photoId}
                        className="flex min-w-0 items-start gap-3 rounded-md border border-stone-200 p-3 text-sm hover:bg-stone-50 has-[:checked]:border-stone-700 has-[:checked]:bg-stone-50"
                      >
                        <input
                          type="radio"
                          name={candidateName}
                          value={candidate.photoId}
                          checked={selected}
                          disabled={!available || locked}
                          aria-label={`第 ${index + 1} 個目標，${candidate.filename}`}
                          onChange={() => {
                            onKindChange('new_version');
                            onSelect(candidate);
                          }}
                          className="mt-1 size-4 shrink-0 accent-stone-800"
                        />
                        <span className="min-w-0 flex-1 break-words">
                          <span className="block text-xs text-stone-600">
                            目標 {index + 1}
                          </span>
                          <span className="mt-1 block break-words">
                            {candidate.filename}
                          </span>
                          <span className="mt-1 block text-xs text-stone-600">
                            {available ? '目前版本可用' : '沒有可用的目前版本'}
                            {selected ? ' · 已選目標' : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              data-testid="assisted-catalog-first"
              disabled={
                disabled || loading || !canReturnFirst || status !== 'ready'
              }
              onClick={onFirst}
              className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              第一頁
            </button>
            <button
              type="button"
              data-testid="assisted-catalog-previous"
              disabled={
                disabled || loading || !hasPrevious || status !== 'ready'
              }
              onClick={onPrevious}
              className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一頁
            </button>
            <button
              type="button"
              data-testid="assisted-catalog-next"
              disabled={
                disabled || loading || !nextCursor || status !== 'ready'
              }
              onClick={onNext}
              className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一頁
            </button>
            <button
              type="button"
              data-testid="assisted-catalog-refresh"
              disabled={disabled || loading}
              onClick={onRefresh}
              className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? '正在載入…'
                : status === 'stale'
                  ? '重新檢查目標'
                  : status === 'error'
                    ? '重試載入目標'
                    : '重新載入此頁'}
            </button>
          </div>
        </div>
      </fieldset>
    </section>
  );
}
