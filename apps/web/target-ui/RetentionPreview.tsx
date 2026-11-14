'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';
import './workspace-settings.css';

const MIN_IDLE_DAYS = 7;
const MAX_IDLE_DAYS = 3650;

const previewSchema = z.object({
  dryRun: z.literal(true),
  autoCleanup: z.literal('off'),
  policy: z.object({
    source: z.enum(['album_settings', 'override']),
    inactiveDays: z.number().int().nullable(),
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
      state: z.string(),
      bytes: z.number(),
      lastValidViewedAt: z.string().nullable(),
      inactiveDays: z.number().int(),
      settingsSource: z.enum(['default', 'album']),
      settingsRevision: z.number().int(),
      cleanupEnabled: z.boolean(),
      customLinkActive: z.boolean(),
    }),
  ),
});
type Preview = z.infer<typeof previewSchema>;
type Album = Preview['albums'][number];

const reasonLabels: Record<string, string> = {
  pinned: '已釘選或受刪除保護',
  legal_hold: '法律保留',
  workflow_busy: '仍有進行中的審稿、處理或分享瀏覽',
  blocking_references: '有版本確認或跨相簿版本引用',
  preservation_requested: '有未到期的自訂期限分享連結',
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
  if (!iso) return '尚無有效瀏覽紀錄';
  return new Date(iso).toLocaleDateString('zh-TW');
}

function validDays(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) &&
    value >= MIN_IDLE_DAYS &&
    value <= MAX_IDLE_DAYS
    ? value
    : null;
}

function describeStatus(status: number) {
  if (status === 401 || status === 403) return '登入已失效，請重新登入後再試。';
  if (status === 404) return '找不到此工作區，或目前帳號無權存取。';
  if (status === 400)
    return '閒置天數需為 ' + MIN_IDLE_DAYS + '～' + MAX_IDLE_DAYS + ' 的整數。';
  if (status === 409) return '設定已被其他操作更新，已重新載入最新內容。';
  return '保留期限試算暫時無法使用，請稍後重試。';
}

async function fetchPreview(
  workspaceId: string,
  override: number | null,
  signal: AbortSignal,
): Promise<{ preview: Preview | null; message: string }> {
  try {
    const response = await fetch(
      '/api/v1/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/retention-preview' +
        (override === null ? '' : '?idleDays=' + override),
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal,
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok)
      return { preview: null, message: describeStatus(response.status) };
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) return { preview: null, message: describeStatus(503) };
    return { preview: parsed.data, message: '' };
  } catch {
    return { preview: null, message: '連線中斷，請稍後重試。' };
  }
}

function AlbumSettingsEditor({
  album,
  onSaved,
}: {
  album: Album;
  onSaved: (message: string) => void;
}) {
  const daysId = useId();
  const [days, setDays] = useState(String(album.inactiveDays));
  const [cleanup, setCleanup] = useState(album.cleanupEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = validDays(days);
    if (value === null) {
      setError(describeStatus(400));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        '/api/v1/albums/' +
          encodeURIComponent(album.albumId) +
          '/retention-settings',
        {
          method: 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            expectedRevision: album.settingsRevision,
            inactiveDays: value,
            cleanupEnabled: cleanup,
          }),
        },
      );
      if (response.ok) onSaved('已儲存「' + album.name + '」的保留設定。');
      else if (response.status === 409) onSaved(describeStatus(409));
      else setError(describeStatus(response.status));
    } catch {
      setError('連線中斷，結果尚未確認；請重新整理後確認設定。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="mt-2 grid gap-2 rounded-lg border border-stone-200 p-3"
      onSubmit={(event) => void save(event)}
    >
      <label htmlFor={daysId} className="grid gap-1 text-sm">
        閒置超過幾天列為候選
        <input
          id={daysId}
          type="number"
          inputMode="numeric"
          min={MIN_IDLE_DAYS}
          max={MAX_IDLE_DAYS}
          step={1}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          className="w-28 rounded-lg border border-stone-300 px-2 py-1"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={cleanup}
          onChange={(event) => setCleanup(event.target.checked)}
        />
        <span>
          允許此相簿日後參與清理
          <span className="block text-xs text-stone-600">
            只記錄意向；全站自動清理目前關閉，不會刪除任何照片。
          </span>
        </span>
      </label>
      {error && (
        <p className="m-0 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="w-fit rounded-lg bg-[#426f69] px-3 py-1.5 text-sm text-white disabled:opacity-60"
      >
        {saving ? '儲存中…' : '儲存相簿設定'}
      </button>
    </form>
  );
}

export function RetentionPreview({ workspaceId }: { workspaceId: string }) {
  const titleId = useId();
  const inputId = useId();
  const [draftDays, setDraftDays] = useState('');
  const [override, setOverride] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      const result = await fetchPreview(
        workspaceId,
        override,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPreview(result.preview);
      setMessage(result.message);
      setLoading(false);
    }
    void run();
    return () => controller.abort();
  }, [workspaceId, override, reload]);

  function refresh() {
    setLoading(true);
    setReload((count) => count + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = validDays(draftDays);
    if (value === null) {
      setMessage(describeStatus(400));
      return;
    }
    setLoading(true);
    setMessage('');
    if (value === override) refresh();
    else setOverride(value);
  }

  function resetToAlbumSettings() {
    setDraftDays('');
    setLoading(true);
    setOverride(null);
  }

  const albums = new Map(
    (preview?.albums ?? []).map((album) => [album.albumId, album]),
  );
  const candidates = preview?.plan.candidateAlbumIds ?? [];
  const excluded = preview?.plan.excluded ?? [];
  const editable = (preview?.albums ?? []).filter(
    (album) => album.state !== 'deleted',
  );

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
            只做試算，不會刪除任何照片。全站自動清理：關閉。
          </p>
        </div>
      </header>

      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={submit}>
        <label htmlFor={inputId} className="grid gap-1 text-sm">
          暫時以統一天數試算（選填）
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={MIN_IDLE_DAYS}
            max={MAX_IDLE_DAYS}
            step={1}
            placeholder="各相簿設定"
            value={draftDays}
            onChange={(event) => setDraftDays(event.target.value)}
            className="w-32 rounded-lg border border-stone-300 px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[#426f69] px-3 py-1.5 text-sm text-white disabled:opacity-60"
          disabled={loading}
        >
          {loading ? '試算中…' : '試算'}
        </button>
        {override !== null && (
          <button
            type="button"
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
            onClick={resetToAlbumSettings}
          >
            改回各相簿設定
          </button>
        )}
      </form>

      {(message || notice) && (
        <p className="workspace-setting__message" role="status">
          {message || notice}
        </p>
      )}

      {preview && (
        <div className="mt-4 grid gap-3 text-sm">
          <p className="m-0">
            已用 {formatBytes(preview.metrics.confirmedBytes)}
            {preview.metrics.reservedBytes > 0 &&
              '（另有 ' +
                formatBytes(preview.metrics.reservedBytes) +
                ' 上傳預留）'}
            ／配額 {formatBytes(preview.metrics.quotaBytes)}。
            {preview.policy.source === 'override'
              ? '以統一 ' + preview.policy.inactiveDays + ' 天試算，'
              : '依各相簿設定試算，'}
            候選相簿 {candidates.length} 本，約可釋放{' '}
            {formatBytes(preview.plan.estimatedBytes)}。
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
                  const album = albums.get(id);
                  return (
                    <li key={id}>
                      {album?.name ?? id}・{formatBytes(album?.bytes ?? 0)}
                      ・最後有效瀏覽{' '}
                      {formatDate(album?.lastValidViewedAt ?? null)}
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
                    {albums.get(item.albumId)?.name ?? item.albumId}：
                    {item.reasons
                      .map((reason) => reasonLabels[reason] ?? reason)
                      .join('、')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>各相簿保留設定（{editable.length}）</summary>
            <ul className="m-0 mt-2 grid gap-2 pl-0">
              {editable.map((album) => (
                <li key={album.albumId} className="list-none">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{album.name}</span>
                    <span className="text-xs text-stone-600">
                      閒置 {album.inactiveDays} 天
                      {album.settingsSource === 'default' ? '（預設）' : ''}・
                      {album.cleanupEnabled ? '允許清理' : '清理關閉'}
                      {album.customLinkActive ? '・有自訂期限分享中' : ''}・
                      最後有效瀏覽 {formatDate(album.lastValidViewedAt)}
                    </span>
                    <button
                      type="button"
                      className="rounded border border-stone-300 px-2 py-0.5 text-xs"
                      aria-expanded={editing === album.albumId}
                      onClick={() =>
                        setEditing(
                          editing === album.albumId ? null : album.albumId,
                        )
                      }
                    >
                      {editing === album.albumId ? '收起' : '編輯'}
                    </button>
                  </div>
                  {editing === album.albumId && (
                    <AlbumSettingsEditor
                      key={album.albumId + ':' + album.settingsRevision}
                      album={album}
                      onSaved={(text) => {
                        setNotice(text);
                        setEditing(null);
                        refresh();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
