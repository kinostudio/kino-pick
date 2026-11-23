import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StudioIcon } from './studio-icons';
import './upload-window.css';

export type UploadProgress = {
  active: boolean;
  done: number | null;
  total: number;
  label: string;
  elapsedSeconds?: number | undefined;
  bytesPerSecond?: number | undefined;
  remainingSeconds?: number | undefined;
};

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? hours + ' 小時 ' : ''}${minutes ? minutes + ' 分 ' : ''}${seconds % 60} 秒`;
}

export function UploadWindow({
  albumName,
  expanded,
  progress,
  onToggle,
  onClose,
  children,
}: {
  albumName: string;
  expanded: boolean;
  progress: UploadProgress | null;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const bodyId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  return createPortal(
    <section className="kino-upload-window" aria-labelledby={titleId}>
      <header className="kino-upload-window__header">
        <div className="min-w-0">
          <h2 id={titleId}>上傳照片</h2>
          <p className="truncate" title={albumName}>
            {albumName}
          </p>
        </div>
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={(expanded ? '收起上傳 ' : '展開上傳 ') + albumName}
          title={expanded ? '收起視窗' : '展開視窗'}
          onClick={onToggle}
        >
          <StudioIcon
            name="chevronDown"
            className={expanded ? undefined : 'rotate-180'}
          />
        </button>
        {!progress?.active && (
          <button
            type="button"
            aria-label="關閉上傳視窗"
            title="關閉上傳視窗"
            onClick={onClose}
          >
            <StudioIcon name="close" />
          </button>
        )}
      </header>
      {progress && (
        <div className="kino-upload-window__progress">
          <p role="status">
            {progress.label}
            {progress.done !== null &&
              progress.total > 0 &&
              ` · ${progress.done} / ${progress.total} 張完成`}
          </p>
          {progress.elapsedSeconds !== undefined && (
            <p>
              已耗時 {duration(progress.elapsedSeconds)}
              {progress.active && (
                <>
                  {' · 最近速度 '}
                  {progress.bytesPerSecond === undefined
                    ? '量測中'
                    : progress.bytesPerSecond >= 1_000_000
                      ? `${(progress.bytesPerSecond / 1_000_000).toFixed(1)} MB/s`
                      : `${Math.round(progress.bytesPerSecond / 1000)} KB/s`}
                  {' · 預估剩餘傳輸 '}
                  {progress.remainingSeconds === undefined
                    ? '計算中'
                    : duration(progress.remainingSeconds)}
                </>
              )}
            </p>
          )}
          {(progress.active || progress.total > 0) && (
            <progress
              aria-label="照片上傳進度"
              max={Math.max(progress.total, 1)}
              value={progress.done ?? undefined}
            />
          )}
        </div>
      )}
      <div
        id={bodyId}
        className="kino-upload-window__body"
        hidden={!expanded}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          onToggle();
          toggleRef.current?.focus();
        }}
      >
        {children}
      </div>
    </section>,
    document.body,
  );
}
