import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GuestAnnotationsPanel } from './guest-annotations.tsx';
import { OwnerAnnotationEditor } from './owner-annotation-editor.tsx';
import './style.css';

function Fixture() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');
  const albumId = params.get('albumId') ?? '';
  const inviteId = params.get('inviteId') ?? '';
  const photoId = params.get('photoId') ?? '';
  const versionId = params.get('versionId') ?? '';
  const filename = params.get('filename') ?? 'freehand-e2e.jpg';

  if (role === 'owner') {
    return (
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <h1 className="text-lg font-semibold">Isolated Owner freehand E2E</h1>
        <OwnerAnnotationEditor
          albumId={albumId}
          inviteId={inviteId}
          photoId={photoId}
          versionId={versionId}
          filename={filename}
          previewUrl={
            '/api/v1/photos/' +
            encodeURIComponent(photoId) +
            '/versions/' +
            encodeURIComponent(versionId) +
            '/assets/preview'
          }
          freehandReadCapability
        />
      </main>
    );
  }

  if (role === 'guest') {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-lg font-semibold">Isolated Guest freehand E2E</h1>
        <GuestAnnotationsPanel
          albumId={albumId}
          photoId={photoId}
          versionId={versionId}
          filename={filename}
          previewUrl={
            '/api/guest/photos/' +
            encodeURIComponent(photoId) +
            '/versions/' +
            encodeURIComponent(versionId) +
            '/assets/preview'
          }
          isCurrentVersion
          freehandReadCapability
        />
      </main>
    );
  }

  return <p role="alert">Choose role=owner or role=guest.</p>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing freehand E2E fixture root');
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
