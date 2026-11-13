'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';
import './workspace-settings.css';

const MIN_IDLE_DAYS = 7;
const MAX_IDLE_DAYS = 3650;
const DEFAULT_IDLE_DAYS = 90;

const previewSchema = z.object({
  dryRun: z.literal(true),
  autoCleanup: z.literal('off'),
  policy: z.object({
    inactiveDays: z.number().int(),
    minAlbumAgeDays: z.number().int(),
  }),
  metrics: z.object({
    confirmedBytes: z.number(),
    reservedBytes: z.number(),
    quotaBytes: z.number(),
  }),
  plan: z.object({
    candidateAlbumIds: z.array(z.string()),
    estimatedBytes: z.number(),
    blockedReasons: z.array(z.string()),
    inventoryComplete: z.boolean(),
    excluded: z.array(
      z.object({ albumId: z.string(), reasons: z.array(z.string()) }),
    ),
  }),
  albums: z.array(
    z.object({
      albumId: z.string(),
      name: z.string(),
      bytes: z.number(),
      lastValidViewedAt: z.string().nullable(),
    }),
  ),
});
type Preview = z.infer<typeof previewSchema>;

const reasonLabels: Record<string, string> = {
  pinned: '已釘選或受刪除保護',
  legal_hold: '法律保留',
  workflow_busy: '仍有進行中的審稿或處理',
  blocking_references: '有其他相簿引用',
  minimum_album_age_not_met: '相簿建立未滿最短保留期',
  recent_activity: '近期仍有人瀏覽',
  recent_state_change: '近期狀態有變更',
  inactive_period_not_met: '閒置天數未達門檻',
  no_reclaimable_bytes: '沒有可回收的空間',
  album_deleting: '刪除中',
  album_deleted: '已刪除',
  inventory_incomplete: '相簿數量過多，清單不完整',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return value.toFixed(value >= 10 ? 0 : 1) + ' ' + units[unit];
}

function formatDate(iso: string | null) {
  if (!iso) return '從未有人瀏覽';
  return new Date(iso).toLocaleDateString('zh-TW');
}

function describeStatus(status: number) {
  if (status === 401 || status === 403) return '登入已失效，請重新登入後再試。';
  if (status === 404) return '找不到此工作區，或目前帳號無權存取。';
  if (status === 400)
    return '閒置天數需為 ' + MIN_IDLE_DAYS + '～' + MAX_IDLE_DAYS + ' 的整數。';
  return '保留期限試算暫時無法使用，請稍後重試。';
}

export function RetentionPreview({ workspaceId }: { workspaceId: string }) {
  const titleId = useId();
  const inputId = useId();
  const [draftDays, setDraftDays] = useState(String(DEFAULT_IDLE_DAYS));
  const [idleDays, setIdleDays] = useState(DEFAULT_IDLE_DAYS);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(
    async (days: number, signal?: AbortSignal) => {
      setLoading(true);
      setMessage('');
      try {
        const response = await fetch(
          '/api/v1/workspaces/' +
            encodeURIComponent(workspaceId) +
            '/retention-preview?idleDays=' +
            days,
          {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            ...(signal ? { signal } : {}),
          },
        );
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setPreview(null);
          setMessage(describeStatus(response.status));
          return;
        }
        const parsed = previewSchema.safeParse(body);
        if (!parsed.success) {
          setPreview(null);
          setMessage(describeStatus(503));
          return;
        }
        setPreview(parsed.data);
      } catch {
        if (signal?.aborted) return;
        setPreview(null);
        setMessage('連線中斷，請稍後重試。');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(idleDays, controller.signal);
    return () => controller.abort();
  }, [load, idleDays]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(draftDays);
    if (
      !Number.isInteger(value) ||
      value < MIN_IDLE_DAYS ||
      value > MAX_IDLE_DAYS
    ) {
      setMessage(describeStatus(400));
      return;
    }
    if (value === idleDays) void load(value);
    else setIdleDays(value);
  }

  const names = new Map(
    (preview?.albums ?? []).map((album) => [album.albumId, album]),
  );
  const candidates = preview?.plan.candidateAlbumIds ?? [];
  const excluded = preview?.plan.excluded ?? [];

  return (
    <section className="studio-settings" aria-labelledby={titleId}>
      <header className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef3f0] text-[#426f69]">
          <StudioIcon name="history" width={22} height={22} />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 text-[17px]">
            保留期限試算
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            只做試算，不會刪除任何照片。自動清理：關閉。
          </p>
        </div>
      </header>

      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={submit}>
        <label htmlFor={inputId} className="grid gap-1 text-sm">
          閒置超過幾天列為候選
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={MIN_IDLE_DAYS}
            max={MAX_IDLE_DAYS}
            step={1}
            value={draftDays}
            onChange={(event) => setDraftDays(event.target.value)}
            className="w-28 rounded-lg border border-stone-300 px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[#426f69] px-3 py-1.5 text-sm text-white disabled:opacity-60"
          disabled={loading}
        >
          {loading ? '試算中…' : '重新試算'}
        </button>
      </form>

      {message && (
        <p className="workspace-setting__message" role="status">
          {message}
        </p>
      )}

      {preview && (
        <div className="mt-4 grid gap-3 text-sm">
          <p className="m-0" role="status">
            已用 {formatBytes(preview.metrics.confirmedBytes)}
            {preview.metrics.reservedBytes > 0 &&
              '（另有 ' +
                formatBytes(preview.metrics.reservedBytes) +
                ' 上傳預留）'}
            ／配額 {formatBytes(preview.metrics.quotaBytes)}。 閒置{' '}
            {preview.policy.inactiveDays} 天以上的候選相簿 {candidates.length}{' '}
            本，約可釋放 {formatBytes(preview.plan.estimatedBytes)}。
          </p>
          {!preview.plan.inventoryComplete && (
            <p className="m-0 text-amber-700">
              相簿數量較多，此試算只涵蓋前 500 本。
            </p>
          )}
          {candidates.length > 0 && (
            <div>
              <h3 className="m-0 mb-1 text-[15px]">候選相簿</h3>
              <ul className="m-0 grid gap-1 pl-4">
                {candidates.map((id) => {
                  const album = names.get(id);
                  return (
                    <li key={id}>
                      {album?.name ?? id}・{formatBytes(album?.bytes ?? 0)}
                      ・最後瀏覽 {formatDate(album?.lastValidViewedAt ?? null)}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {excluded.length > 0 && (
            <details>
              <summary>不列入候選的相簿（{excluded.length}）</summary>
              <ul className="m-0 mt-1 grid gap-1 pl-4">
                {excluded.map((item) => (
                  <li key={item.albumId}>
                    {names.get(item.albumId)?.name ?? item.albumId}：
                    {item.reasons
                      .map((reason) => reasonLabels[reason] ?? reason)
                      .join('、')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
