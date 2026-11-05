import { useEffect, useId, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';

const policySchema = z.object({
  requestedEnabled: z.boolean(),
  effectiveEnabled: z.boolean(),
  ready: z.boolean(),
  reason: z.string(),
  quotaGb: z.number(),
  freeFloorGb: z.number(),
  revision: z.number().int().nonnegative(),
});
type Policy = z.infer<typeof policySchema>;
type Intent = {
  requestId: string;
  expectedRevision: number;
  enabled: boolean;
  quotaGb: number;
};

export function OracleStorageSettings() {
  const id = useId();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [quota, setQuota] = useState('30');
  const [pending, setPending] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/storage/oracle-policy', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const value = policySchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setPolicy(value);
        setEnabled(value.requestedEnabled);
        setQuota(String(value.quotaGb));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!policy) return null;
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (pending || !policy) return;
    const gb = Number(quota);
    if (!Number.isInteger(gb) || gb < 1 || gb > 100) {
      setNotice('請輸入 1–100 GB 的整數。');
      return;
    }
    const body = intent ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: policy.revision,
      enabled,
      quotaGb: gb,
    };
    setIntent(body);
    setPending(true);
    setNotice('儲存中…');
    try {
      const response = await fetch('/api/v1/storage/oracle-policy', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (response.status === 409) {
        setNotice('設定已變更，或新容量低於已用空間。請重新載入頁面確認。');
        setIntent(null);
        return;
      }
      if (!response.ok) throw new Error('UNCONFIRMED');
      const value = policySchema.parse(await response.json());
      setPolicy(value);
      setEnabled(value.requestedEnabled);
      setQuota(String(value.quotaGb));
      setIntent(null);
      setNotice(
        value.effectiveEnabled
          ? '設定已儲存，Oracle 容量擴充已生效。'
          : value.requestedEnabled
            ? '設定已儲存，等待磁碟容量同步。約一分鐘後可重新整理狀態。'
            : '設定已儲存；新照片仍優先存入 R2。',
      );
    } catch {
      setNotice('尚無法確認儲存結果，請重試相同設定。');
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="studio-pages__module mt-4 rounded-lg border border-stone-200 bg-white p-4"
      aria-labelledby={id + '-title'}
    >
      <h2 id={id + '-title'} className="flex items-center gap-2 font-semibold">
        <StudioIcon name="settings" width={20} height={20} />
        照片儲存空間
      </h2>
      <p>照片優先存入 R2；容量不足時，使用 Oracle VM 空間。</p>
      <p role="status">
        {policy.effectiveEnabled
          ? 'Oracle 容量擴充已啟用'
          : policy.requestedEnabled
            ? '已設定啟用，尚未生效'
            : '目前使用 R2'}
        {policy.reason ? ' · ' + policy.reason : ''}
      </p>
      <button
        type="button"
        disabled={pending || intent !== null}
        onClick={() => window.location.reload()}
        className="mt-2 rounded border px-3 py-2"
      >
        <StudioIcon name="refresh" width={18} height={18} />
        重新整理狀態
      </button>
      <form onSubmit={(event) => void save(event)}>
        <fieldset
          disabled={pending || intent !== null}
          className="mt-4 grid gap-3"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
            />
            R2 滿額時使用 Oracle
          </label>
          <label htmlFor={id + '-quota'}>Oracle 容量上限（GB，可調整）</label>
          <input
            id={id + '-quota'}
            type="number"
            min="1"
            max="100"
            step="1"
            value={quota}
            onChange={(event) => setQuota(event.currentTarget.value)}
            className="max-w-48 rounded border p-2"
          />
          <p>
            另保留至少 {policy.freeFloorGb} GB
            磁碟空間。降低上限不能少於已用與上傳中的容量；提高時需要確認實際磁碟可容納。
          </p>
          <button type="submit" className="w-fit rounded border px-4 py-2">
            <StudioIcon name="check" width={18} height={18} />
            儲存設定
          </button>
        </fieldset>
      </form>
      {notice && (
        <p role="status" className="mt-3">
          {notice}
        </p>
      )}
      {intent && !pending && (
        <button
          type="button"
          onClick={() => void save()}
          className="mt-2 rounded border px-4 py-2"
        >
          重試相同設定
        </button>
      )}
    </section>
  );
}
