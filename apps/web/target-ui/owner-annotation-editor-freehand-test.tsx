'use client';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OwnerAnnotationEditor } from './owner-annotation-editor.tsx';
import './style.css';
const ownerId = '11111111-1111-4111-8111-111111111111',
  albumId = '22222222-2222-4222-8222-222222222222',
  inviteId = '33333333-3333-4333-8333-333333333333',
  photoId = '44444444-4444-4444-8444-444444444444',
  versionId = '55555555-5555-4555-8555-555555555555',
  annotationId = '66666666-6666-4666-8666-666666666666';
const resultKey = 'owner-editor-freehand-test:result',
  requestsKey = 'owner-editor-freehand-test:requests',
  readsKey = 'owner-editor-freehand-test:reads',
  requireReadKey = 'owner-editor-freehand-test:require-read',
  writeDisabledKey = 'owner-editor-freehand-test:write-disabled',
  writeCapabilityKey = 'owner-editor-freehand-test:write-capability',
  writeCapabilityErrorKey = 'owner-editor-freehand-test:write-capability-error',
  writeCapabilityChecksKey =
    'owner-editor-freehand-test:write-capability-checks';
function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const requestUrl =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  const url = new URL(requestUrl, window.location.origin),
    method = (init?.method ?? 'GET').toUpperCase();
  if (url.pathname === '/api/v1/annotations/authoring/freehand-capabilities') {
    const checks =
      (Number(localStorage.getItem(writeCapabilityChecksKey) ?? '0') || 0) + 1;
    localStorage.setItem(writeCapabilityChecksKey, String(checks));
    if (localStorage.getItem(writeCapabilityErrorKey) === '1')
      return jsonResponse({ error: { code: 'CAPABILITY_UNAVAILABLE' } }, 503);
    return jsonResponse({
      enabled: localStorage.getItem(writeCapabilityKey) === '1',
    });
  }
  if (url.pathname === '/api/v1/annotations/authoring/capabilities')
    return jsonResponse({ enabled: true });
  if (url.pathname === '/api/v1/me')
    return jsonResponse({
      actor: { id: ownerId },
      role: 'owner',
      sessionId: 'owner-test-session',
    });
  if (url.pathname.endsWith('/annotations/owner') && method === 'GET') {
    const readCapability = new Headers(init?.headers).get(
      'X-Kino-Annotation-Read-Capabilities',
    );
    const reads = JSON.parse(localStorage.getItem(readsKey) ?? '[]') as {
      capability: string | null;
      annotationId: string | null;
    }[];
    reads.push({
      capability: readCapability,
      annotationId: url.searchParams.get('annotationId'),
    });
    localStorage.setItem(readsKey, JSON.stringify(reads));
    const raw = localStorage.getItem(resultKey),
      item = raw
        ? (JSON.parse(raw) as { result: { item: Record<string, unknown> } })
            .result.item
        : null;
    const requested = url.searchParams.get('annotationId'),
      items =
        item && (requested === null || item.annotationId === requested)
          ? [item]
          : [];
    if (
      localStorage.getItem(requireReadKey) === '1' &&
      item?.geometry &&
      typeof item.geometry === 'object' &&
      'type' in item.geometry &&
      item.geometry.type === 'freehand' &&
      readCapability !== 'freehand-v1'
    )
      return jsonResponse(
        { error: { code: 'ANNOTATION_CLIENT_UPGRADE_REQUIRED' } },
        426,
      );
    return jsonResponse({
      ownerId,
      inviteId,
      photoId,
      versionId,
      items,
      nextCursor: null,
    });
  }
  if (
    url.pathname ===
      '/api/v1/albums/' + albumId + '/annotations/owner/commands' &&
    method === 'POST'
  ) {
    const command = JSON.parse(String(init?.body ?? 'null')) as Record<
        string,
        unknown
      >,
      requests = JSON.parse(
        localStorage.getItem(requestsKey) ?? '[]',
      ) as Record<string, unknown>[];
    requests.push(command);
    localStorage.setItem(requestsKey, JSON.stringify(requests));
    if (localStorage.getItem(writeDisabledKey) === '1')
      return jsonResponse(
        { error: { code: 'FREEHAND_ANNOTATIONS_DISABLED' } },
        409,
      );
    const saved = localStorage.getItem(resultKey);
    if (saved) {
      const prior = JSON.parse(saved) as {
        command: Record<string, unknown>;
        result: Record<string, unknown>;
      };
      if (JSON.stringify(prior.command) !== JSON.stringify(command))
        return jsonResponse({ error: { code: 'REQUEST_REUSED' } }, 409);
      return jsonResponse(prior.result);
    }
    const occurredAt = '2026-10-29T00:00:00.000Z',
      result = {
        ownerId,
        requestId: command.requestId,
        operation: 'create',
        item: {
          annotationId,
          inviteId,
          photoId,
          versionId,
          revision: 1,
          geometry: command.geometry,
          style: command.style,
          commentId: null,
          state: 'open',
          authorType: 'owner',
          authorLabel: 'Owner test',
          canEdit: true,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        occurredAt,
      };
    localStorage.setItem(resultKey, JSON.stringify({ command, result }));
    if (requests.length === 1) throw new TypeError('Simulated lost response');
    return jsonResponse(result);
  }
  return nativeFetch(input, init);
};
function Fixture() {
  const [freehandReadCapability, setFreehandReadCapability] = useState(true);
  useEffect(() => {
    const handler = (event: Event) => {
      const value = (event as CustomEvent<{ freehandReadCapability?: boolean }>)
        .detail;
      if (!value) return;
      if (typeof value.freehandReadCapability === 'boolean')
        setFreehandReadCapability(value.freehandReadCapability);
    };
    window.addEventListener('owner-editor-freehand-read-capability', handler);
    return () =>
      window.removeEventListener(
        'owner-editor-freehand-read-capability',
        handler,
      );
  }, []);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <OwnerAnnotationEditor
        albumId={albumId}
        inviteId={inviteId}
        photoId={photoId}
        versionId={versionId}
        filename="owner-test.svg"
        previewUrl={
          '/api/v1/photos/' +
          photoId +
          '/versions/' +
          versionId +
          '/assets/preview'
        }
        freehandReadCapability={freehandReadCapability}
      />
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(<Fixture />);
