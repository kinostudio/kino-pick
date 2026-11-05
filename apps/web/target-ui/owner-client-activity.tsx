import { useEffect, useState } from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';

const itemSchema = z
  .object({
    eventId: z.uuid(),
    viewedAtMs: z.number().int().safe().nonnegative(),
    guestId: z.uuid(),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    rawIp: z.string().nullable(),
  })
  .strict();
const pageSchema = z
  .object({
    summary: z
      .object({
        uniqueBrowserCount: z.number().int().nonnegative(),
        visitCount: z.number().int().nonnegative(),
        requestedDownloadCount: z.number().int().nonnegative(),
        generatedDownloadCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(itemSchema).max(24),
    nextCursor: z
      .object({
        viewedAtMs: z.number().int().safe().nonnegative(),
        eventId: z.uuid(),
      })
      .strict()
      .nullable(),
  })
  .strict();
type Page = z.infer<typeof pageSchema>;

export function OwnerClientActivity({ albumId }: { albumId: string }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/client-activity/capabilities', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok && !controller.signal.aborted)
          setEnabled(
            z.object({ enabled: z.boolean() }).parse(await response.json())
              .enabled,
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!enabled) return null;
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="studio-project-settings mt-4"
    >
      <summary>
        <StudioIcon name="history" /> 瀏覽與下載紀錄
      </summary>
      {open && <ActivityPage key={albumId} albumId={albumId} />}
    </details>
  );
}
function ActivityPage({ albumId }: { albumId: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState<Page['nextCursor']>(null);
  const [status, setStatus] = useState('載入紀錄中…');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const cap = await fetch('/api/client-activity/capabilities', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (
        !cap.ok ||
        ((await cap.json()) as { enabled?: unknown }).enabled !== true
      ) {
        if (!controller.signal.aborted) setStatus('瀏覽統計尚未開放。');
        return;
      }
      const query = cursor
        ? '?beforeTime=' +
          cursor.viewedAtMs +
          '&beforeId=' +
          encodeURIComponent(cursor.eventId)
        : '';
      const response = await fetch(
        '/api/v1/albums/' + encodeURIComponent(albumId) + '/activity' + query,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error();
      const value = pageSchema.parse(await response.json());
      if (!controller.signal.aborted) {
        setPage(value);
        setStatus('');
      }
    })().catch(() => {
      if (!controller.signal.aborted) {
        setPage(null);
        setStatus('目前無法載入紀錄，請重新開啟重試。');
      }
    });
    return () => controller.abort();
  }, [albumId, cursor]);
  if (!page)
    return (
      <p role="status" className="text-sm">
        {status}
      </p>
    );
  return (
    <section aria-label="客戶瀏覽統計" className="mt-3">
      <p>
        不重複瀏覽器 {page.summary.uniqueBrowserCount} · 照片瀏覽{' '}
        {page.summary.visitCount} · 下載請求{' '}
        {page.summary.requestedDownloadCount} · 已備妥檔案{' '}
        {page.summary.generatedDownloadCount}
      </p>
      <p className="mt-2 text-xs text-stone-600">
        同一瀏覽器在此相簿只算一位訪客。清除瀏覽資料可能重新計數；已備妥檔案不代表已儲存到裝置。
      </p>
      {page.items.length === 0 ? (
        <p className="mt-3">尚無客戶瀏覽紀錄。</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {page.items.map((item) => (
            <li key={item.eventId} className="rounded border p-3 text-sm">
              <time dateTime={new Date(item.viewedAtMs).toISOString()}>
                {new Date(item.viewedAtMs).toLocaleString('zh-TW')}
              </time>
              <p>IP：{item.rawIp ?? '未取得'}</p>
              <details>
                <summary>查看照片與客戶識別</summary>
                <p className="break-all">
                  邀請：{item.inviteId}
                  <br />
                  客戶：{item.guestId}
                  <br />
                  照片：{item.photoId}
                  <br />
                  版本：{item.versionId}
                </p>
              </details>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={!cursor}
          onClick={() => setCursor(null)}
        >
          第一頁
        </button>
        <button
          type="button"
          disabled={!page.nextCursor}
          onClick={() => setCursor(page.nextCursor)}
        >
          較早紀錄
        </button>
      </div>
      <DownloadActivity albumId={albumId} />
    </section>
  );
}

const downloadsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            eventId: z.uuid(),
            requestId: z.uuid(),
            requestedAtMs: z.number().int().safe().nonnegative(),
            guestId: z.uuid(),
            inviteId: z.uuid(),
            photoId: z.uuid(),
            versionId: z.uuid(),
            rawIp: z.string().nullable(),
            generated: z.boolean(),
          })
          .strict(),
      )
      .max(24),
    nextCursor: z
      .object({
        requestedAtMs: z.number().int().safe().nonnegative(),
        eventId: z.uuid(),
      })
      .strict()
      .nullable(),
  })
  .strict();
function DownloadActivity({ albumId }: { albumId: string }) {
  const [page, setPage] = useState<z.infer<typeof downloadsSchema> | null>(
    null,
  );
  const [cursor, setCursor] =
    useState<z.infer<typeof downloadsSchema>['nextCursor']>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const query = cursor
      ? '?beforeTime=' +
        cursor.requestedAtMs +
        '&beforeId=' +
        encodeURIComponent(cursor.eventId)
      : '';
    void fetch(
      '/api/v1/albums/' +
        encodeURIComponent(albumId) +
        '/download-activity' +
        query,
      {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = downloadsSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setPage(result);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPage(null);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [albumId, cursor]);
  return (
    <section className="mt-5" aria-label="客戶下載紀錄">
      <h4>下載紀錄</h4>
      {error ? (
        <p role="alert">下載紀錄暫時無法載入。</p>
      ) : !page ? (
        <p>載入中…</p>
      ) : (
        <>
          <ol className="mt-2 space-y-2">
            {page.items.map((item) => (
              <li key={item.eventId} className="rounded border p-3 text-sm">
                <time dateTime={new Date(item.requestedAtMs).toISOString()}>
                  {new Date(item.requestedAtMs).toLocaleString('zh-TW')}
                </time>
                <p>
                  {item.generated ? '已備妥檔案' : '已請求下載'} · IP：
                  {item.rawIp ?? '未取得'}
                </p>
                <details>
                  <summary>查看識別資料</summary>
                  <p className="break-all">
                    邀請：{item.inviteId}
                    <br />
                    照片：{item.photoId}
                    <br />
                    請求：{item.requestId}
                  </p>
                </details>
              </li>
            ))}
          </ol>
          {page.items.length === 0 && <p>尚無下載紀錄。</p>}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={!cursor}
              onClick={() => setCursor(null)}
            >
              第一頁
            </button>
            <button
              type="button"
              disabled={!page.nextCursor}
              onClick={() => setCursor(page.nextCursor)}
            >
              較早下載
            </button>
          </div>
        </>
      )}
    </section>
  );
}
