'use client';

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  guestAnnotationJournalMetadata,
  saveGuestAnnotationIntent,
} from './guest-annotation-journal.ts';
import { GuestAnnotationsPanel } from './guest-annotations.tsx';
import './style.css';

const albumId = '11111111-1111-4111-8111-111111111111';
const photoId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const pendingRequestId = '77777777-7777-4777-8777-777777777777';

function seedPendingFreehandJournal() {
  if (new URLSearchParams(window.location.search).get('pending') !== 'true')
    return false;

  const command = {
    requestId: pendingRequestId,
    expectedGuestId: '22222222-2222-4222-8222-222222222222',
    operation: 'create' as const,
    photoId,
    versionId,
    geometry: {
      type: 'freehand' as const,
      coordinateSpace: 'normalized_1e6' as const,
      version: 1 as const,
      points: [
        { x: 100_000, y: 200_000 },
        { x: 400_000, y: 800_000 },
      ],
    },
    style: { color: 'blue' as const },
    commentId: null,
  };
  const metadata = guestAnnotationJournalMetadata({
    albumId,
    expectedGuestId: command.expectedGuestId,
    photoId,
    versionId,
    command,
    expectedCurrent: null,
  });
  const saved = saveGuestAnnotationIntent(metadata);
  if (!saved.ok) throw new Error('Could not seed the Guest journal');
  return true;
}

const seededJournal = seedPendingFreehandJournal();

function Fixture() {
  const freehandReadCapability =
    new URLSearchParams(window.location.search).get('read-capability') ===
    'true';
  const [pending, setPending] = useState(false);

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      <output data-testid="guest-freehand-read-capability-state">
        {freehandReadCapability ? 'enabled' : 'disabled'}
      </output>
      <output data-testid="guest-journal-seeded">
        {seededJournal ? 'seeded' : 'empty'}
      </output>
      <output data-testid="guest-pending-state">
        {pending ? 'pending' : 'clear'}
      </output>
      <GuestAnnotationsPanel
        albumId={albumId}
        photoId={photoId}
        versionId={versionId}
        filename="guest-freehand.svg"
        previewUrl={
          '/api/guest/photos/' +
          photoId +
          '/versions/' +
          versionId +
          '/assets/preview'
        }
        isCurrentVersion
        freehandReadCapability={freehandReadCapability}
        onPendingChange={setPending}
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
