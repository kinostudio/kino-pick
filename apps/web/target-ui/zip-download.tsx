'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { StudioIcon } from './studio-icons';

/**
 * Album / ticked-photo ZIP downloads, assembled in the browser.
 *
 * Each file is fetched through its existing authorized endpoint for that
 * photo and version, then packed as an uncompressed ZIP. Guest downloads keep
 * their current per-asset activity audit. The Worker only streams files and
 * spends no CPU on archiving; large Blobs stay in browser storage.
 */
export type ZipSource = { url: string; filename: string };
export type ZipQuality = 'preview' | 'original';
export type ZipSelectionMode = {
  active: boolean;
  onStart: () => void;
  onCancel: () => void;
};

const MAX_ZIP_FILES = 2000;
const MAX_ZIP_BYTES = 3.5 * 1024 * 1024 * 1024; // ZIP32 offsets stay < 4 GiB

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, crc = 0) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let value = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i += 1)
    value = crcTable[(value ^ bytes[i]!) & 0xff]! ^ (value >>> 8);
  return ~value >>> 0;
}

function header(size: number, fields: [number, number, 2 | 4][]) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (const [offset, value, width] of fields)
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value >>> 0, true);
  return bytes;
}

function safeName(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .trim() || 'photo'
  );
}

function uniqueNames(names: string[]) {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = safeName(raw);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1)
      candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function buildZip(
  sources: ZipSource[],
  onProgress: (done: number) => void,
  signal: AbortSignal,
) {
  if (sources.length === 0) throw new Error('EMPTY');
  if (sources.length > MAX_ZIP_FILES) throw new Error('TOO_MANY');
  const encoder = new TextEncoder();
  const names = uniqueNames(sources.map((source) => source.filename));
  const parts: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [index, source] of sources.entries()) {
    const response = await fetch(source.url, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (!response.ok) throw new Error('HTTP_' + response.status);
    const blob = await response.blob();
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;
    if (offset + size > MAX_ZIP_BYTES) throw new Error('TOO_LARGE');
    const name = encoder.encode(names[index]!);
    // Local header: version 20, UTF-8 names (bit 11), STORE.
    const local = header(30, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [6, 0x0800, 2],
      [8, 0, 2],
      [14, crc, 4],
      [18, size, 4],
      [22, size, 4],
      [26, name.length, 2],
    ]);
    directory.push(
      header(46, [
        [0, 0x02014b50, 4],
        [4, 20, 2],
        [6, 20, 2],
        [8, 0x0800, 2],
        [10, 0, 2],
        [16, crc, 4],
        [20, size, 4],
        [24, size, 4],
        [28, name.length, 2],
        [42, offset, 4],
      ]),
      name,
    );
    parts.push(local, name, blob);
    offset += local.length + name.length + size;
    onProgress(index + 1);
  }
  const centralStart = offset;
  const centralSize = directory.reduce((sum, part) => sum + part.length, 0);
  parts.push(
    ...directory,
    header(22, [
      [0, 0x06054b50, 4],
      [8, sources.length, 2],
      [10, sources.length, 2],
      [12, centralSize, 4],
      [16, centralStart, 4],
    ]),
  );
  return new Blob(parts, { type: 'application/zip' });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const failureText: Record<string, string> = {
  EMPTY: '沒有可下載的照片。',
  TOO_MANY: `一次最多打包 ${MAX_ZIP_FILES} 張，請分批勾選下載。`,
  TOO_LARGE: '檔案總量超過 3.5 GB，請分批勾選下載。',
  ACCESS_CHANGED: '相簿下載權限已更新，請重新整理後再試。',
};

/**
 * `loadAll` resolves the album's full list lazily, only when clicked. Callers
 * with a separate selection set use one menu for all or selected downloads.
 */
export function ZipDownloadBar({
  albumName,
  loadAll,
  selected,
  qualities,
  selectionMode,
  className,
}: {
  albumName: string;
  loadAll: (quality: ZipQuality, signal: AbortSignal) => Promise<ZipSource[]>;
  selected: {
    count: number;
    load: (quality: ZipQuality, signal: AbortSignal) => Promise<ZipSource[]>;
  };
  qualities: readonly ZipQuality[];
  selectionMode: ZipSelectionMode;
  className?: string;
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy'; done: number; total: number | null }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [dialogFor, setDialogFor] = useState<'all' | 'selected' | null>(null);
  const controller = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const qualityTitleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogFor !== null && !dialog.open) dialog.showModal();
    else if (dialogFor === null && dialog.open) dialog.close();
  }, [dialogFor]);

  async function run(which: 'all' | 'selected', quality: ZipQuality) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState({ kind: 'busy', done: 0, total: null });
    try {
      const sources =
        which === 'all'
          ? await loadAll(quality, abort.signal)
          : await selected.load(quality, abort.signal);
      setState({ kind: 'busy', done: 0, total: sources.length });
      const blob = await buildZip(
        sources,
        (done) => setState({ kind: 'busy', done, total: sources.length }),
        abort.signal,
      );
      const base = safeName(albumName).slice(0, 80) || 'album';
      saveBlob(
        blob,
        which === 'all'
          ? `${base}.zip`
          : `${base}-已勾選${sources.length}張.zip`,
      );
      setState({ kind: 'idle' });
    } catch (error) {
      if (abort.signal.aborted) {
        setState({ kind: 'idle' });
        return;
      }
      const code = error instanceof Error ? error.message : '';
      setState({
        kind: 'error',
        message: failureText[code] ?? '打包下載失敗，請稍後重試。',
      });
    }
  }

  const busy = state.kind === 'busy';
  const selectedCount = selected.count;
  return (
    <div className={'kino-zip-bar ' + (className ?? '')}>
      {selectionMode.active ? (
        <button
          type="button"
          className="kino-zip-bar__button"
          disabled={busy || selectedCount === 0 || qualities.length === 0}
          onClick={() => setDialogFor('selected')}
        >
          <StudioIcon name="download" width={18} height={18} />
          下載已勾選（{selectedCount}）
        </button>
      ) : (
        <details ref={menuRef} className="relative">
          <summary className="kino-zip-bar__button list-none" aria-label="下載">
            <StudioIcon name="download" width={18} height={18} />
            下載
          </summary>
          <div
            className="absolute left-0 top-full z-30 mt-2 flex min-w-40 flex-col gap-1 rounded-xl border border-stone-200 bg-white p-2 shadow-xl"
            role="group"
            aria-label="下載方式"
          >
            <button
              type="button"
              className="kino-zip-bar__button justify-start"
              disabled={busy || qualities.length === 0}
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
                setDialogFor('all');
              }}
            >
              全部
            </button>
            <button
              type="button"
              className="kino-zip-bar__button justify-start"
              disabled={busy}
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
                selectionMode.onStart();
              }}
            >
              多選
            </button>
          </div>
        </details>
      )}
      {selectionMode.active && (
        <>
          <span className="kino-zip-bar__status" role="status">
            多選下載 · 已勾選 {selectedCount} 張
          </span>
          <button
            type="button"
            className="kino-zip-bar__cancel"
            disabled={busy}
            onClick={selectionMode.onCancel}
          >
            取消模式
          </button>
        </>
      )}
      {busy && (
        <span className="kino-zip-bar__status" role="status">
          {state.total === null
            ? '整理清單中…'
            : `打包中 ${state.done} / ${state.total}`}
          <button
            type="button"
            className="kino-zip-bar__cancel"
            onClick={() => controller.current?.abort()}
          >
            取消
          </button>
        </span>
      )}
      {state.kind === 'error' && (
        <span className="kino-zip-bar__status is-error" role="alert">
          {state.message}
        </span>
      )}
      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto max-h-[90vh] w-[min(92vw,24rem)] max-w-none overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 text-stone-900 shadow-2xl backdrop:bg-black/50 sm:p-6"
        aria-labelledby={qualityTitleId}
        onCancel={(event) => {
          event.preventDefault();
          setDialogFor(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setDialogFor(null);
        }}
      >
        {dialogFor && (
          <>
            <h2
              id={qualityTitleId}
              className="text-lg font-semibold text-stone-950"
            >
              選擇下載畫質
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {dialogFor === 'all'
                ? '選擇下載整本相簿的畫質。'
                : `選擇下載已勾選 ${selectedCount} 張照片的畫質。`}
            </p>
            <div className="mt-5 grid gap-2">
              {qualities.map((quality, index) => (
                <button
                  key={quality}
                  type="button"
                  className="kino-zip-bar__button min-h-11 justify-center"
                  autoFocus={index === 0}
                  onClick={() => {
                    const which = dialogFor;
                    setDialogFor(null);
                    void run(which, quality);
                  }}
                >
                  {quality === 'preview' ? '縮圖' : '原始畫質'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-4 min-h-10 w-full rounded-md px-3 py-2 text-sm font-medium text-stone-600 underline underline-offset-2 hover:text-stone-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              onClick={() => setDialogFor(null)}
            >
              取消
            </button>
          </>
        )}
      </dialog>
    </div>
  );
}
