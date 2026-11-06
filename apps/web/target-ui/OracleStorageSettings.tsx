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
    <section className="studio-settings" aria-labelledby={id + '-title'}>
      <header className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef3f0] text-[#426f69]">
          <StudioIcon name="settings" width={22} height={22} />
        </span>
        <div className="min-w-0">
          <h2 id={id + '-title'} className="m-0 text-[17px]">
            照片儲存空間
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            新照片先存入 R2；空間不足時才使用 Oracle。
          </p>
        </div>
      </header>
      <p
        className={
          'workspace-setting__status' +
          (policy.effectiveEnabled
            ? ' is-active'
            : policy.requestedEnabled
              ? ' is-pending'
              : '')
        }
        role="status"
      >
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
        className="workspace-setting__secondary"
      >
        <StudioIcon name="refresh" width={18} height={18} />
        重新整理狀態
      </button>
      <form className="mt-4" onSubmit={(event) => void save(event)}>
        <fieldset
          disabled={pending || intent !== null}
          className="workspace-setting__storage-fields"
        >
          <label
            className={
              'workspace-setting__switch-card' + (enabled ? ' is-enabled' : '')
            }
          >
            <span>R2 滿額時使用 Oracle</span>
            <input
              className="workspace-setting__switch"
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
            />
          </label>
          <p className="workspace-setting__field-note">
            先用 R2；只有達到容量上限時才改用 Oracle。
          </p>
          <div className="workspace-setting__capacity">
            <label htmlFor={id + '-quota'}>Oracle 容量上限（GB，可調整）</label>
            <div className="workspace-setting__capacity-input">
              <input
                id={id + '-quota'}
                type="number"
                min="1"
                max="100"
                step="1"
                value={quota}
                onChange={(event) => setQuota(event.currentTarget.value)}
              />
              <span>GB</span>
            </div>
            <p className="workspace-setting__field-note">
              保留至少 {policy.freeFloorGb}{' '}
              GB；不可低於已用與上傳中的容量，調高前需確認磁碟空間。
            </p>
          </div>
          <button
            type="submit"
            className="studio-pages__button workspace-setting__button"
          >
            <StudioIcon name="check" width={18} height={18} />
            儲存設定
          </button>
        </fieldset>
      </form>
      {notice && (
        <p role="status" className="workspace-setting__message">
          {notice}
        </p>
      )}
      {intent && !pending && (
        <button
          type="button"
          onClick={() => void save()}
          className="workspace-setting__secondary workspace-setting__retry"
        >
          重試相同設定
        </button>
      )}
    </section>
  );
}
