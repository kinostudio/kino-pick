import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AnnotationGeometry } from '../../../packages/contracts/src/annotation-geometry';
import type { FreehandStroke } from '../../../packages/contracts/src/freehand-stroke';
import { AnnotationCanvas } from './annotation-canvas';
import type { AnnotationCanvasImageState } from './annotation-canvas';
import './style.css';

type FixtureAction =
  | { type: 'mode'; value: boolean }
  | { type: 'scope'; value: string }
  | { type: 'draw'; value: boolean };

const fixturePreviewUrl =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e7e5e4"/><path d="M20 270L380 30" stroke="#78716c" stroke-width="8"/></svg>',
  );

function Fixture() {
  const [freehandMode, setFreehandMode] = useState<boolean | undefined>();
  const [canDraw, setCanDraw] = useState(true);
  const [scopeKey, setScopeKey] = useState('fixture/scope-a');
  const [freehandDrafts, setFreehandDrafts] = useState<FreehandStroke[]>([]);
  const [geometryDrafts, setGeometryDrafts] = useState<AnnotationGeometry[]>(
    [],
  );
  const [imageState, setImageState] = useState<AnnotationCanvasImageState>({
    status: 'empty',
  });

  useEffect(() => {
    const handleFixtureAction = (event: Event) => {
      const action = (event as CustomEvent<FixtureAction>).detail;
      if (!action) return;

      switch (action.type) {
        case 'mode':
          setFreehandMode(action.value);
          break;
        case 'scope':
          setScopeKey(action.value);
          break;
        case 'draw':
          setCanDraw(action.value);
          break;
      }
    };

    window.addEventListener('annotation-canvas-fixture', handleFixtureAction);
    return () =>
      window.removeEventListener(
        'annotation-canvas-fixture',
        handleFixtureAction,
      );
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-6">
      <output data-testid="fixture-state" className="block font-mono text-xs">
        {JSON.stringify({
          modeProp: freehandMode === undefined ? 'omitted' : freehandMode,
          canDraw,
          scopeKey,
          imageState,
        })}
      </output>
      <AnnotationCanvas
        previewUrl={fixturePreviewUrl}
        filename="fixture-photo.svg"
        annotations={[]}
        selectedAnnotationId={null}
        draftGeometry={null}
        tool="point"
        color="blue"
        canDraw={canDraw}
        onDraftGeometry={(geometry) =>
          setGeometryDrafts((current) => [...current, geometry])
        }
        onImageState={setImageState}
        onImageError={() => undefined}
        {...(freehandMode === undefined ? {} : { freehandMode })}
        freehandScopeKey={scopeKey}
        freehandStrokes={[]}
        onDraftFreehand={(stroke) =>
          setFreehandDrafts((current) => [...current, stroke])
        }
      />
      <output data-testid="freehand-drafts" className="block break-all">
        {JSON.stringify(freehandDrafts)}
      </output>
      <output data-testid="geometry-drafts" className="block break-all">
        {JSON.stringify(geometryDrafts)}
      </output>
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
