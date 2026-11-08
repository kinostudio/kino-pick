import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import {
  albumRetentionPolicyCapabilitiesSchema,
  albumRetentionPolicySchema,
  updateAlbumRetentionPolicySchema,
  type AlbumRetentionPolicy,
  type UpdateAlbumRetentionPolicy,
} from '../../../packages/contracts/src/album-retention-policy';
import { StudioIcon } from './studio-icons';

const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const errorCode = (value: unknown) => {
  const parsed = errorSchema.safeParse(value);
  return parsed.success ? parsed.data.error.code : '';
};
type Notice = { error: boolean; text: string };

export function AlbumRetentionPolicySettings({
  albumId,
  expectedOwnerId,
}: {
  albumId: string;
  expectedOwnerId: string;
}) {
  const id = useId();
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'disabled' | 'error'
  >('loading');
  const [policy, setPolicy] = useState<AlbumRetentionPolicy | null>(null);
  const [cleanupAllowed, setCleanupAllowed] = useState(false);
  const [inactiveDays, setInactiveDays] = useState('90');
  const [intent, setIntent] = useState<UpdateAlbumRetentionPolicy | null>(null);
  const [pending, setPending] = useState(false);
  const [writeDisabled, setWriteDisabled] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [readSequence, setReadSequence] = useState(0);
  const intentRef = useRef<UpdateAlbumRetentionPolicy | null>(null);
  const busyRef = useRef(false);
  const preserveDraftRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const preserveDraft = preserveDraftRef.current;
    preserveDraftRef.current = false;
    const current = () => active && !controller.signal.aborted;

    async function load() {
      setLoadState('loading');
      if (!preserveDraft) setNotice(null);
      try {
        const capability = await fetch(
          '/api/v1/album-retention-policy/capabilities',
          {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          },
        );
        const capabilityBody: unknown = await capability
          .json()
          .catch(() => null);
        if (!current()) return;
        const capabilityResult =
          albumRetentionPolicyCapabilitiesSchema.safeParse(capabilityBody);
        if (!capability.ok || !capabilityResult.success)
          throw new Error('CAPABILITY_UNAVAILABLE');
        if (!capabilityResult.data.enabled) {
          setLoadState('disabled');
          return;
        }

        const response = await fetch(
          '/api/v1/albums/' + encodeURIComponent(albumId) + '/retention-policy',
          {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          },
        );
        const value: unknown = await response.json().catch(() => null);
        if (!current()) return;
        if (
          errorCode(value) === 'ALBUM_RETENTION_POLICY_DISABLED' &&
          !response.ok
        ) {
          setLoadState('disabled');
          return;
        }
        const result = albumRetentionPolicySchema.safeParse(value);
        if (!response.ok || !result.success || result.data.albumId !== albumId)
          throw new Error('POLICY_UNAVAILABLE');

        setPolicy(result.data);
        if (!preserveDraft) {
          setCleanupAllowed(result.data.cleanupAllowed);
          setInactiveDays(String(result.data.inactiveDays));
        } else {
          setNotice({
            error: false,
            text: '已載入最新設定；你的修改仍保留，請確認後再儲存。',
          });
        }
        setLoadState('ready');
      } catch {
        if (!current()) return;
        setLoadState('error');
        setNotice({
          error: true,
          text: '目前無法載入閒置清理設定，請重新載入。',
        });
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [albumId, readSequence]);

  async function send(body: UpdateAlbumRetentionPolicy) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setNotice({ error: false, text: '儲存中…' });
    try {
      const response = await fetch(
        '/api/v1/albums/' + encodeURIComponent(albumId) + '/retention-policy',
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          cache: 'no-store',
        },
      );
      const value: unknown = await response.json().catch(() => null);
      const code = errorCode(value);
      if (!response.ok) {
        if (code === 'ALBUM_RETENTION_POLICY_DISABLED') {
          intentRef.current = null;
          setIntent(null);
          setLoadState('disabled');
          return;
        }
        if (
          code === 'ALBUM_RETENTION_POLICY_REVISION_CONFLICT' ||
          code === 'REQUEST_ID_CONFLICT'
        ) {
          intentRef.current = null;
          setIntent(null);
          preserveDraftRef.current = true;
          setNotice({
            error: false,
            text: '設定已更新；正在載入最新版本並保留你的修改。',
          });
          setReadSequence((sequence) => sequence + 1);
          return;
        }
        if (code === 'ALBUM_RETENTION_POLICY_REVISION_EXHAUSTED') {
          intentRef.current = null;
          setIntent(null);
          setWriteDisabled(true);
          setNotice({ error: true, text: '設定版本已達上限，無法再修改。' });
          return;
        }
        if (code === 'NOT_FOUND' || code === 'RESOURCE_NOT_EDITABLE') {
          intentRef.current = null;
          setIntent(null);
          setWriteDisabled(true);
          setNotice({
            error: true,
            text:
              code === 'NOT_FOUND'
                ? '無法存取此相簿的閒置清理設定。'
                : '相簿已進入刪除流程，閒置清理設定為唯讀。',
          });
          return;
        }
        if (code === 'INVALID_INPUT') {
          intentRef.current = null;
          setIntent(null);
          setNotice({ error: true, text: '請確認天數介於 1–36500 天。' });
          return;
        }
        setNotice({
          error: true,
          text:
            code === 'OWNER_REQUIRED'
              ? '登入或管理權限已失效；重新登入後可重試相同設定。'
              : '尚無法確認儲存結果，請重試相同設定。',
        });
        return;
      }

      const result = albumRetentionPolicySchema.safeParse(value);
      if (
        !result.success ||
        result.data.albumId !== albumId ||
        result.data.cleanupAllowed !== body.cleanupAllowed ||
        result.data.inactiveDays !== body.inactiveDays ||
        result.data.automaticDeletionEnabled !== false ||
        result.data.dryRun !== true
      ) {
        setNotice({
          error: true,
          text: '尚無法確認儲存結果，請重試相同設定。',
        });
        return;
      }
      setPolicy(result.data);
      setCleanupAllowed(result.data.cleanupAllowed);
      setInactiveDays(String(result.data.inactiveDays));
      intentRef.current = null;
      setIntent(null);
      setNotice({ error: false, text: '設定已儲存；自動刪除仍維持關閉。' });
    } catch {
      setNotice({ error: true, text: '尚無法確認儲存結果，請重試相同設定。' });
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || intentRef.current || !policy || writeDisabled)
      return;
    const days = /^\d+$/.test(inactiveDays) ? Number(inactiveDays) : NaN;
    if (!Number.isSafeInteger(days) || days < 1 || days > 36500) {
      setNotice({ error: true, text: '請輸入 1–36500 天的整數。' });
      return;
    }
    const result = updateAlbumRetentionPolicySchema.safeParse({
      requestId: crypto.randomUUID(),
      expectedOwnerId,
      expectedRevision: policy.revision,
      cleanupAllowed,
      inactiveDays: days,
    });
    if (!result.success) {
      setNotice({ error: true, text: '無法驗證設定，請重新載入後再試。' });
      return;
    }
    intentRef.current = result.data;
    setIntent(result.data);
    void send(result.data);
  }

  if (loadState === 'disabled') return null;
  const unchanged =
    policy !== null &&
    cleanupAllowed === policy.cleanupAllowed &&
    inactiveDays === String(policy.inactiveDays);
  const revisionExhausted = policy?.revision === 2147483647;

  return (
    <section
      className="studio-settings"
      aria-labelledby={id + '-title'}
      data-testid="album-retention-policy"
    >
      <header className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef3f0] text-[#426f69]">
          <StudioIcon name="settings" width={22} height={22} />
        </span>
        <div className="min-w-0">
          <h3 id={id + '-title'} className="m-0 text-[15px]">
            閒置清理設定
          </h3>
        </div>
      </header>
      {loadState === 'loading' && !policy && (
        <p role="status" className="workspace-setting__message">
          正在載入閒置清理設定…
        </p>
      )}
      {loadState === 'error' && !policy && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setReadSequence((sequence) => sequence + 1)}
        >
          <StudioIcon name="refresh" width={18} height={18} />
          重新載入清理設定
        </Button>
      )}
      {policy && (
        <form className="mt-4" onSubmit={save}>
          <fieldset
            disabled={
              loadState !== 'ready' ||
              pending ||
              intent !== null ||
              writeDisabled ||
              revisionExhausted
            }
            className="workspace-setting__storage-fields"
          >
            <label
              className={
                'workspace-setting__switch-card' +
                (cleanupAllowed ? ' is-enabled' : '')
              }
            >
              <span>允許閒置清理</span>
              <input
                className="workspace-setting__switch"
                type="checkbox"
                role="switch"
                checked={cleanupAllowed}
                onChange={(event) =>
                  setCleanupAllowed(event.currentTarget.checked)
                }
              />
            </label>
            <div className="workspace-setting__capacity">
              <label htmlFor={id + '-inactive-days'}>
                無人瀏覽幾天後列入清理
              </label>
              <div className="workspace-setting__capacity-input">
                <input
                  id={id + '-inactive-days'}
                  type="number"
                  min="1"
                  max="36500"
                  step="1"
                  value={inactiveDays}
                  onInvalid={(event) => {
                    event.preventDefault();
                    setNotice({
                      error: true,
                      text: '請輸入 1–36500 天的整數。',
                    });
                  }}
                  onChange={(event) =>
                    setInactiveDays(event.currentTarget.value)
                  }
                />
                <span>天</span>
              </div>
            </div>
            <p className="workspace-setting__field-note">
              儲存不會刪除照片；自動刪除目前仍關閉。
            </p>
            <Button
              type="submit"
              disabled={
                loadState !== 'ready' ||
                pending ||
                intent !== null ||
                writeDisabled ||
                revisionExhausted ||
                unchanged
              }
            >
              <StudioIcon name="check" width={18} height={18} />
              {pending ? '儲存中…' : '儲存清理設定'}
            </Button>
          </fieldset>
        </form>
      )}
      {notice && (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={
            notice.error
              ? 'workspace-setting__error'
              : 'workspace-setting__message'
          }
        >
          {notice.text}
        </p>
      )}
      {intent && !pending && !writeDisabled && (
        <Button
          type="button"
          variant="outline"
          className="workspace-setting__retry"
          onClick={() => void send(intentRef.current ?? intent)}
        >
          <StudioIcon name="refresh" width={18} height={18} />
          重試相同設定
        </Button>
      )}
      {loadState === 'error' && policy && (
        <Button
          type="button"
          variant="outline"
          className="workspace-setting__retry"
          onClick={() => {
            preserveDraftRef.current = true;
            setReadSequence((sequence) => sequence + 1);
          }}
        >
          <StudioIcon name="refresh" width={18} height={18} />
          重新載入最新設定
        </Button>
      )}
    </section>
  );
}
