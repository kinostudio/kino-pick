'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import {
  deliveryZipSchema,
  MAX_ZIP_BYTES,
  MAX_ZIP_FILES,
} from '../../../packages/contracts/src/delivery-zips';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import type { GuestDeliveryRead } from '../../../packages/contracts/src/deliveries';
import { StudioIcon } from './studio-icons';

async function identity(albumId: string) {
  const response = await fetch(`/api/guest/albums/${albumId}/access`, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('identity');
  return z
    .object({ access: guestAlbumAccessSchema })
    .parse(await response.json()).access;
}
export function GuestDeliveryZip({
  albumId,
  guestId,
  deliveries,
}: {
  albumId: string;
  guestId: string;
  deliveries: GuestDeliveryRead[];
}) {
  const [enabled, setEnabled] = useState(false),
    [selected, setSelected] = useState<Set<string>>(
      () =>
        new Set(
          deliveries.slice(0, MAX_ZIP_FILES).map((row) => row.delivery.id),
        ),
    ),
    [busy, setBusy] = useState(false),
    [captured, setCaptured] = useState(false),
    [ticket, setTicket] = useState<z.infer<typeof deliveryZipSchema> | null>(
      null,
    ),
    [notice, setNotice] = useState(''),
    [downloadId, setDownloadId] = useState(() => crypto.randomUUID());
  const intent = useRef<{
      requestId: string;
      expectedGuestId: string;
      deliveryIds: string[];
    } | null>(null),
    generation = useRef(0);
  useEffect(() => {
    const turn = ++generation.current,
      controller = new AbortController();
    void fetch('/api/guest/delivery-zips/capabilities', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = z
          .object({ enabled: z.boolean() })
          .strict()
          .parse(await response.json());
        if (!response.ok) throw Error();
        if (generation.current === turn) setEnabled(value.enabled);
      })
      .catch(() => {
        if (generation.current === turn) setEnabled(false);
      });
    return () => {
      controller.abort();
      generation.current = turn + 1;
    };
  }, []);
  const chosen = deliveries.filter((row) => selected.has(row.delivery.id)),
    bytes = chosen.reduce(
      (total, row) =>
        total +
        row.delivery.items.reduce((sum, item) => sum + item.asset.byteSize, 0),
      0,
    );
  async function prepare() {
    const turn = generation.current;
    setBusy(true);
    setNotice('');
    try {
      const before = await identity(albumId);
      if (
        before.guestId !== guestId ||
        !before.permissions.can_download_original
      )
        throw Error('identity');
      // shortcut: mounted-panel retries retain metadata-only intent; abandoned tickets expire without reserving storage.
      intent.current ??= {
        requestId: crypto.randomUUID(),
        expectedGuestId: guestId,
        deliveryIds: [...selected].sort(),
      };
      setCaptured(true);
      const response = await fetch(
        `/api/guest/albums/${albumId}/delivery-zips`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(intent.current),
        },
      );
      if (!response.ok)
        throw Error(
          response.status === 413 || response.status === 422
            ? 'limit'
            : response.status === 401
              ? 'identity'
              : 'request',
        );
      const value = deliveryZipSchema.parse(await response.json()),
        after = await identity(albumId);
      if (
        after.guestId !== guestId ||
        after.inviteId !== before.inviteId ||
        after.albumId !== albumId ||
        !after.permissions.can_download_original
      )
        throw Error('identity');
      if (generation.current !== turn) return;
      if (
        value.albumId !== albumId ||
        value.fileCount !== intent.current.deliveryIds.length
      )
        throw Error('request');
      setTicket(value);
      intent.current = null;
      setCaptured(false);
      setDownloadId(crypto.randomUUID());
    } catch (error) {
      if (generation.current !== turn) return;
      setTicket(null);
      if (error instanceof Error && error.message === 'identity') {
        intent.current = null;
        setCaptured(false);
        setEnabled(false);
      } else {
        if (error instanceof Error && error.message === 'limit') {
          intent.current = null;
          setCaptured(false);
        }
        setNotice(
          error instanceof Error && error.message === 'limit'
            ? '這包檔案太大，請減少張數後再試。'
            : '尚未取得下載連結，請用原內容重試。',
        );
      }
    } finally {
      if (generation.current === turn) setBusy(false);
    }
  }
  if (!enabled || deliveries.length === 0) return null;
  return (
    <details
      className="mt-3 rounded-md border border-stone-200 p-3"
      data-testid="delivery-zip"
    >
      <summary className="flex min-h-10 cursor-pointer items-center gap-2 font-medium">
        <StudioIcon name="download" aria-hidden="true" />
        打包下載 ZIP
      </summary>
      <p className="mt-2 text-xs text-stone-600">
        每包最多24張、64 MB；只包含已交付的固定版本。
      </p>
      <ul className="mt-2 max-h-44 space-y-2 overflow-auto">
        {deliveries.map((row) => (
          <li key={row.delivery.id}>
            <label className="flex min-h-9 items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(row.delivery.id)}
                disabled={
                  busy ||
                  captured ||
                  (!selected.has(row.delivery.id) &&
                    selected.size >= MAX_ZIP_FILES)
                }
                onChange={(event) => {
                  setTicket(null);
                  setNotice('');
                  setSelected((old) => {
                    const next = new Set(old);
                    if (event.target.checked) next.add(row.delivery.id);
                    else next.delete(row.delivery.id);
                    return next;
                  });
                }}
              />
              <span className="min-w-0 break-all">
                {row.delivery.items
                  .map((item) => item.asset.filename)
                  .join('、')}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || selected.size === 0 || bytes > MAX_ZIP_BYTES}
          onClick={() => void prepare()}
        >
          {busy ? '準備中…' : captured ? '重試原打包內容' : '準備下載'}
        </Button>
        <span className="text-xs text-stone-600">已選 {selected.size} 張</span>
      </div>
      {bytes > MAX_ZIP_BYTES && (
        <p className="mt-2 text-sm" role="status">
          超過64 MB，請分批下載。
        </p>
      )}
      {notice && (
        <p role="alert" className="mt-2 text-sm">
          {notice}
        </p>
      )}
      {ticket && (
        <div className="mt-3">
          <a
            className="inline-flex min-h-10 items-center gap-2 rounded border border-stone-400 px-3 underline"
            href={`/api/guest/albums/${albumId}/delivery-zips/${ticket.id}/download?requestId=${downloadId}`}
            onClick={() => setDownloadId(crypto.randomUUID())}
          >
            <StudioIcon name="download" aria-hidden="true" />
            下載 ZIP（{ticket.fileCount}張）
          </a>
          <p className="mt-2 text-xs text-stone-600">
            連結有效至 {new Date(ticket.expiresAt).toLocaleString('zh-TW')}。
          </p>
        </div>
      )}
    </details>
  );
}
