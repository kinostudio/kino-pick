'use client';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OwnerAnnotationItem } from '../../../packages/contracts/src/owner-annotations.ts';
import { OwnerAnnotationProcessingPanel } from './owner-annotation-processing.tsx';
import { OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE } from './owner-annotation-read-support.ts';
import './style.css';

const ownerId = '11111111-1111-4111-8111-111111111111';
const albumId = '22222222-2222-4222-8222-222222222222';
const inviteId = '33333333-3333-4333-8333-333333333333';
const photoId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const annotationId = '66666666-6666-4666-8666-666666666666';
const targetedReadKey = 'owner-processing-freehand-test:targeted-read';

const item: OwnerAnnotationItem = {
  annotationId,
  photoId,
  versionId,
  authorGuestId: '77777777-7777-4777-8777-777777777777',
  revision: 1,
  geometry: {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: 120_000,
    y: 240_000,
  },
  style: { color: 'amber' },
  commentId: null,
  state: 'open',
  authorLabel: 'Guest test',
  canEdit: false,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  processing: {
    state: 'open',
    revision: 0,
    annotationRevision: null,
    contentRevision: null,
    updatedAt: null,
    stale: false,
  },
};

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
  const url = new URL(requestUrl, window.location.origin);
  if (url.pathname === '/api/v1/annotation-processing/capabilities')
    return jsonResponse({ enabled: true });
  if (url.pathname === '/api/v1/me')
    return jsonResponse({
      actor: { id: ownerId },
      role: 'owner',
      sessionId: 'owner-test-session',
    });
  if (
    url.pathname.endsWith('/annotations') &&
    url.searchParams.get('annotationId') === annotationId
  ) {
    localStorage.setItem(targetedReadKey, annotationId);
    localStorage.setItem(
      'owner-processing-freehand-test:read-capability',
      new Headers(init?.headers).get('X-Kino-Annotation-Read-Capabilities') ??
        'missing',
    );
    return jsonResponse(
      { error: { code: 'ANNOTATION_CLIENT_UPGRADE_REQUIRED' } },
      426,
    );
  }
  return nativeFetch(input, init);
};

function Fixture() {
  const [items, setItems] = useState([item]);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      {items.map((current) => (
        <p data-testid="owner-old-row" key={current.annotationId}>
          Previously loaded Owner result
        </p>
      ))}
      {items.length > 0 && (
        <OwnerAnnotationProcessingPanel
          ownerId={ownerId}
          albumId={albumId}
          inviteId={inviteId}
          photoId={photoId}
          versionId={versionId}
          items={items}
          onReconcile={() => undefined}
          onUpgradeRequired={() => {
            setItems([]);
            setUpgradeRequired(true);
          }}
        />
      )}
      {upgradeRequired && (
        <p role="alert">{OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE}</p>
      )}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(<Fixture />);
