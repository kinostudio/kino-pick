import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  photographerRecommendationsPageSchema,
  photographerPhotoRecommendationSchema,
  photographerRecommendationPolicyResultSchema,
  setPhotographerPhotoMetadataResultSchema,
  type PhotographerLabelColor,
} from '../../../packages/contracts/src/photographer-recommendations';
import './photographer-recommendations.css';

const colors: { value: PhotographerLabelColor; label: string }[] = [
  { value: 'red', label: '紅色' },
  { value: 'yellow', label: '黃色' },
  { value: 'green', label: '綠色' },
  { value: 'blue', label: '藍色' },
  { value: 'purple', label: '紫色' },
];
const identitySchema = z.object({
  actor: z.object({ id: z.uuid() }),
  sessionId: z.string().min(1),
  role: z.literal('owner'),
});
class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function readJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(json);
    throw new RequestFailure(
      response.status,
      error.success ? error.data.error.code : 'SERVICE_UNAVAILABLE',
    );
  }
  return json;
}
type Intent = {
  method: 'PUT' | 'POST';
  url: string;
  body: string;
  actor: string;
  session: string;
};

function usePhotographerResource<T>(
  url: string,
  schema: z.ZodType<T>,
  onPendingChange?: (pending: boolean) => void,
) {
  const [state, setState] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  const identity = useRef<z.infer<typeof identitySchema> | null>(null);
  const intent = useRef<Intent | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const reload = () => {
      if (!intent.current) setRevision((value) => value + 1);
    };
    window.addEventListener('kino-pick:photographer-changed', reload);
    return () =>
      window.removeEventListener('kino-pick:photographer-changed', reload);
  }, []);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const changePending = useCallback(
    (pending: boolean) => onPendingChange?.(pending),
    [onPendingChange],
  );
  useEffect(() => {
    const stop = (event: BeforeUnloadEvent) => {
      if (intent.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      try {
        const capability = z
          .object({ enabled: z.boolean() })
          .strict()
          .parse(
            await readJson(
              '/api/v1/photographer-recommendations/capabilities',
              { signal },
            ),
          );
        if (signal.aborted) return;
        setEnabled(capability.enabled);
        if (!capability.enabled) return;
        const [who, value] = await Promise.all([
          readJson('/api/v1/me', { signal }),
          readJson(url, { signal }),
        ]);
        if (signal.aborted) return;
        identity.current = identitySchema.parse(who);
        setState(schema.parse(value));
        setError('');
      } catch (e) {
        if (signal.aborted) return;
        if (
          e instanceof RequestFailure &&
          (e.status === 401 || e.status === 403)
        ) {
          setState(null);
          identity.current = null;
        }
        setError(
          e instanceof RequestFailure
            ? `無法讀取攝影師推薦（${e.code}）`
            : '無法讀取攝影師推薦，請重新整理。',
        );
      }
    })();
    return () => controller.abort();
  }, [url, schema, revision]);
  const send = async (current: Intent, parse: (json: unknown) => T) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    changePending(true);
    try {
      const json = await readJson(current.url, {
        method: current.method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Kino-Expected-Actor': current.actor,
          'X-Kino-Expected-Session': current.session,
        },
        body: current.body,
      });
      const parsed = parse(json);
      if (!mounted.current) return;
      intent.current = null;
      setUncertain(false);
      setState(parsed);
      changePending(false);
      window.dispatchEvent(new Event('kino-pick:photographer-changed'));
    } catch (e) {
      if (!mounted.current) return;
      if (
        e instanceof RequestFailure &&
        (e.status === 401 || e.status === 403)
      ) {
        setState(null);
        identity.current = null;
      }
      if (
        !uncertain &&
        e instanceof RequestFailure &&
        [400, 404, 409, 422].includes(e.status)
      ) {
        intent.current = null;
        setUncertain(false);
        changePending(false);
        setError(
          e.status === 409
            ? '資料已變更，請重新整理後再操作。'
            : `未套用此變更（${e.code}）`,
        );
      } else {
        setUncertain(true);
        setError('儲存結果尚未確認；請重試同一操作，暫停其他變更以避免重複。');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const mutate = (
    target: string,
    body: Record<string, unknown>,
    parse: (json: unknown) => T,
    method: 'PUT' | 'POST' = 'PUT',
  ) => {
    if (intent.current || !identity.current || busy) return;
    const current: Intent = {
      url: target,
      method,
      body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
      actor: identity.current.actor.id,
      session: identity.current.sessionId,
    };
    intent.current = current;
    void send(current, parse);
  };
  const retry = (parse: (json: unknown) => T) => {
    if (intent.current) void send(intent.current, parse);
  };
  return {
    state,
    error,
    enabled,
    busy,
    uncertain,
    mutate,
    retry,
    refresh: () => {
      if (!intent.current) setRevision((x) => x + 1);
    },
  };
}

export function PhotographerRecommendationPolicy({
  albumId,
}: {
  albumId: string;
}) {
  const endpoint = `/api/v1/albums/${encodeURIComponent(albumId)}/photographer-recommendations`;
  const resource = usePhotographerResource(
    endpoint,
    photographerRecommendationsPageSchema,
  );
  const policy = resource.state?.policy;
  const parse = (json: unknown) => {
    const result = photographerRecommendationPolicyResultSchema.parse(json);
    if (result.policy.albumId !== albumId || !resource.state)
      throw new Error('POLICY_SCOPE_CHANGED');
    return { ...resource.state, policy: result.policy };
  };
  const update = (patch: Record<string, unknown>) => {
    if (!policy) return;
    resource.mutate(
      endpoint,
      {
        expectedRevision: policy.revision,
        visible: policy.visible,
        minRating: policy.minRating,
        allowedLabels: policy.allowedLabels,
        ...patch,
      },
      parse,
    );
  };
  if (resource.enabled === false) return null;
  return (
    <details
      className="studio-settings photographer-settings"
      data-testid="photographer-policy"
    >
      <summary>攝影師推薦設定</summary>
      {!policy && !resource.error && <p role="status">正在載入設定…</p>}
      {policy && (
        <fieldset disabled={resource.busy || resource.uncertain}>
          <label>
            <input
              type="checkbox"
              checked={policy.visible}
              onChange={(e) => update({ visible: e.target.checked })}
            />{' '}
            顯示攝影師推薦
          </label>
          <label>
            推薦星等門檻
            <select
              aria-label="推薦星等門檻"
              value={policy.minRating ?? ''}
              onChange={(e) =>
                update({
                  minRating:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              <option value="">不使用星等條件</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} 星以上
                </option>
              ))}
            </select>
          </label>
          <p>推薦色彩標籤</p>
          <div className="photographer-colors">
            {colors.map((color) => (
              <button
                type="button"
                key={color.value}
                aria-pressed={policy.allowedLabels.includes(color.value)}
                onClick={() =>
                  update({
                    allowedLabels: policy.allowedLabels.includes(color.value)
                      ? policy.allowedLabels.filter(
                          (value) => value !== color.value,
                        )
                      : [...policy.allowedLabels, color.value],
                  })
                }
              >
                <span className={'photographer-dot ' + color.value} />
                {color.label}
              </button>
            ))}
          </div>
          <p className="photographer-help">
            符合任一條件即可推薦。設定即時儲存，與客戶挑片、評分及收藏分開。
          </p>
        </fieldset>
      )}
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.busy && <p role="status">正在儲存…</p>}
      {resource.uncertain ? (
        <button
          type="button"
          disabled={resource.busy}
          onClick={() => resource.retry(parse)}
        >
          重試同一推薦設定
        </button>
      ) : (
        <button
          type="button"
          disabled={resource.busy}
          onClick={resource.refresh}
        >
          重新整理推薦設定
        </button>
      )}
    </details>
  );
}

export function PhotographerPhotoEditor({
  photoId,
  versionId,
  onPendingChange,
}: {
  photoId: string;
  versionId: string;
  onPendingChange: (pending: boolean) => void;
}) {
  const endpoint = `/api/v1/photos/${encodeURIComponent(photoId)}/photographer-metadata`;
  const resource = usePhotographerResource(
    `${endpoint}?versionId=${encodeURIComponent(versionId)}`,
    photographerPhotoRecommendationSchema,
    onPendingChange,
  );
  const photo = resource.state;
  const parse = (json: unknown) => {
    const result = setPhotographerPhotoMetadataResultSchema.parse(json);
    if (
      result.photo.photoId !== photoId ||
      result.photo.versionId !== versionId
    )
      throw new Error('PHOTO_SCOPE_CHANGED');
    return result.photo;
  };
  const update = (patch: Record<string, unknown>) => {
    if (!photo) return;
    const rating =
      photo.rating.manual.state === 'set'
        ? { state: 'set', value: photo.rating.manual.value }
        : { state: photo.rating.manual.state };
    const label =
      photo.label.manual.state === 'set'
        ? { state: 'set', value: photo.label.manual.value }
        : { state: photo.label.manual.state };
    resource.mutate(
      endpoint,
      {
        versionId,
        expectedRevision: photo.revision,
        expectedHeadRevision: photo.headRevision,
        rating,
        label,
        decision: photo.decision.manual,
        ...patch,
      },
      parse,
    );
  };
  if (resource.enabled === false) return null;
  if (photo && (photo.photoId !== photoId || photo.versionId !== versionId))
    return <p role="alert">攝影師標記的照片版本不符，請重新開啟照片。</p>;
  return (
    <section
      className="photographer-editor"
      aria-label="攝影師推薦與評等"
      data-testid="photographer-editor"
    >
      <p className="kino-photo-detail-eyebrow">PHOTOGRAPHER</p>
      <h3>攝影師推薦</h3>
      {!photo && !resource.error && <p role="status">正在載入攝影師標記…</p>}
      {photo && (
        <fieldset
          disabled={resource.busy || resource.uncertain || !photo.isCurrentHead}
        >
          <p role="status">
            {photo.decision.recommended ? '★ 攝影師推薦' : '未列入推薦'}
          </p>
          <div className="photographer-stars" aria-label="攝影師評等">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                type="button"
                key={value}
                aria-label={`攝影師 ${value} 星`}
                aria-pressed={photo.rating.effective === value}
                onClick={() => update({ rating: { state: 'set', value } })}
              >
                {value <= (photo.rating.effective ?? 0) ? '★' : '☆'}
              </button>
            ))}
          </div>
          <div className="photographer-colors">
            {colors.map((color) => (
              <button
                type="button"
                key={color.value}
                aria-pressed={photo.label.effective === color.value}
                onClick={() =>
                  update({ label: { state: 'set', value: color.value } })
                }
              >
                <span className={'photographer-dot ' + color.value} />
                {color.label}
              </button>
            ))}
          </div>
          <div className="photographer-actions">
            <button
              type="button"
              onClick={() =>
                update({
                  rating: { state: 'clear' },
                  label: { state: 'clear' },
                  decision: 'inherit',
                })
              }
            >
              清除攝影師標記
            </button>
            <button
              type="button"
              onClick={() =>
                update({
                  rating: { state: 'inherit' },
                  label: { state: 'inherit' },
                  decision: 'inherit',
                })
              }
            >
              還原檔案資訊
            </button>
          </div>
          <label>
            個別推薦
            <select
              aria-label="個別推薦"
              value={photo.decision.manual}
              onChange={(e) => update({ decision: e.target.value })}
            >
              <option value="inherit">依相簿門檻</option>
              <option value="recommend">手動推薦</option>
              <option value="exclude">不推薦</option>
            </select>
          </label>
          <p className="photographer-help">
            評等、色標與推薦即時儲存；與客戶選片分開，僅編輯目前版本。
          </p>
          <p className="photographer-help">
            檔案資訊：
            {photo.rating.imported.state === 'not_imported'
              ? '尚未讀取'
              : '已讀取固定版本原圖'}
            。手動清除保留原始資訊，還原後重新採用。
          </p>
          <p className="photographer-help">
            原圖評等：
            {photo.rating.imported.state === 'imported' &&
            photo.rating.imported.field.status === 'value'
              ? `${photo.rating.imported.field.value} 星`
              : '未取得有效星等'}
            ； 原圖色標：
            {photo.label.imported.state === 'imported' &&
            photo.label.imported.field.status === 'value'
              ? colors.find(
                  (color) =>
                    photo.label.imported.state === 'imported' &&
                    photo.label.imported.field.status === 'value' &&
                    color.value === photo.label.imported.field.value,
                )?.label
              : '未取得有效色標'}
          </p>
          <button
            type="button"
            onClick={() =>
              resource.mutate(
                endpoint + '/import',
                { versionId, expectedRevision: photo.revision },
                parse,
                'POST',
              )
            }
          >
            重新讀取原圖資訊
          </button>
        </fieldset>
      )}
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.busy && <p role="status">正在儲存…</p>}
      {resource.uncertain ? (
        <button
          type="button"
          disabled={resource.busy}
          onClick={() => resource.retry(parse)}
        >
          重試同一攝影師操作
        </button>
      ) : (
        <button
          type="button"
          disabled={resource.busy}
          onClick={resource.refresh}
        >
          重新整理標記
        </button>
      )}
    </section>
  );
}
