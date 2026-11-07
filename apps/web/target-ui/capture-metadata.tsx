import { useEffect, useState } from 'react';
import {
  captureMetadataSchema,
  type CaptureMetadata,
} from '../../../packages/contracts/src/capture-metadata';

export function CaptureMetadataDetails({ url }: { url: string }) {
  const [revision, setRevision] = useState(0);
  const requestKey = `${url}:${revision}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    metadata: CaptureMetadata | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          if (active) setLoaded({ key: requestKey, metadata: null });
          return;
        }
        const json: unknown = await response.json();
        if (active)
          setLoaded({
            key: requestKey,
            metadata: captureMetadataSchema.parse(json),
          });
      } catch {
        if (active && !controller.signal.aborted)
          setLoaded({ key: requestKey, metadata: null });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [url, requestKey]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        setRevision((value) => value + 1);
      }
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const metadata = loaded?.key === requestKey ? loaded.metadata : null;
  return (
    <>
      <div>
        <dt>相機</dt>
        <dd aria-live="polite">{metadata?.cameraModel ?? '—'}</dd>
      </div>
      <div>
        <dt>鏡頭</dt>
        <dd aria-live="polite">{metadata?.lensModel ?? '—'}</dd>
      </div>
      <div>
        <dt>光圈</dt>
        <dd aria-live="polite">
          {metadata?.fNumber === null || metadata?.fNumber === undefined
            ? '—'
            : `f/${metadata.fNumber}`}
        </dd>
      </div>
      <div>
        <dt>快門</dt>
        <dd aria-live="polite">
          {metadata?.exposureSeconds === null ||
          metadata?.exposureSeconds === undefined
            ? '—'
            : `${metadata.exposureSeconds} 秒`}
        </dd>
      </div>
      <div>
        <dt>ISO</dt>
        <dd aria-live="polite">{metadata?.iso ?? '—'}</dd>
      </div>
    </>
  );
}
