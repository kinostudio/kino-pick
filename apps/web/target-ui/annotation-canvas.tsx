'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';
import {
  ANNOTATION_COORDINATE_SCALE,
  type AnnotationGeometry,
} from '../../../packages/contracts/src/annotation-geometry.ts';
import {
  freehandStrokeSchema,
  type FreehandStroke,
  type FreehandStrokeGeometry,
} from '../../../packages/contracts/src/freehand-stroke.ts';
import type {
  AnnotationClientPoint,
  AnnotationCoordinateContext,
  AnnotationPoint,
} from './annotation-coordinates.ts';
import {
  annotationPointToClientPoint,
  clientPointToAnnotationPoint,
  createAnnotationRectangle,
  getAnnotationImageRect,
} from './annotation-coordinates.ts';
import {
  FREEHAND_STROKE_MAX_INPUT_POINTS,
  sampleFreehandStroke,
} from './freehand-sampling.ts';
import { getFreehandStrokeRenderModel } from './freehand-render.ts';
import type { GuestAnnotationItem } from '../../../packages/contracts/src/guest-annotations.ts';

export type AnnotationTool = 'point' | 'rectangle';

export type AnnotationCanvasImageState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; width: number; height: number }
  | { status: 'error' };

type PointerDraft = {
  pointerId: number;
  start: AnnotationPoint;
};

export type AnnotationCanvasProps = {
  previewUrl: string | null;
  filename: string;
  annotations: GuestAnnotationItem[];
  selectedAnnotationId: string | null;
  draftGeometry: AnnotationGeometry | null;
  tool: AnnotationTool;
  color: 'amber' | 'red' | 'blue';
  canDraw: boolean;
  onDraftGeometry: (geometry: AnnotationGeometry) => void;
  onImageState: (state: AnnotationCanvasImageState) => void;
  onImageError: () => void;
  freehandMode?: boolean;
  freehandScopeKey?: string;
  freehandStrokes?: readonly FreehandStroke[];
  onDraftFreehand?: (stroke: FreehandStroke) => void;
};

export type AnnotationCanvasFreehandScope = Readonly<{
  scopeKey: string | null;
  previewUrl: string | null;
  canDraw: boolean;
  mode: boolean;
  ready: boolean;
  viewKey: string;
}>;

type FreehandPointerDraft = {
  pointerId: number;
  target: HTMLDivElement;
  points: AnnotationClientPoint[];
  context: AnnotationCoordinateContext;
  color: FreehandStroke['style']['color'];
  scope: AnnotationCanvasFreehandScope;
};

type FreehandKeyboardDraft = {
  points: AnnotationClientPoint[];
  context: AnnotationCoordinateContext;
  color: FreehandStroke['style']['color'];
  scope: AnnotationCanvasFreehandScope;
};

type FreehandPreview = {
  geometry: FreehandStrokeGeometry;
  color: FreehandStroke['style']['color'];
  scope: AnnotationCanvasFreehandScope;
};

const coordinateScale = ANNOTATION_COORDINATE_SCALE;
const markerColors = {
  amber: '#d97706',
  red: '#dc2626',
  blue: '#2563eb',
} as const;

export function matchesCurrentFreehandScope(
  started: AnnotationCanvasFreehandScope,
  current: AnnotationCanvasFreehandScope,
): boolean {
  return (
    started.ready &&
    current.ready &&
    started.scopeKey !== null &&
    started.scopeKey === current.scopeKey &&
    started.previewUrl === current.previewUrl &&
    started.canDraw === current.canDraw &&
    started.mode === current.mode &&
    started.viewKey === current.viewKey
  );
}

export function createAnnotationCanvasFreehandDraft(
  points: readonly AnnotationClientPoint[],
  context: AnnotationCoordinateContext,
  color: FreehandStroke['style']['color'],
): FreehandStroke | null {
  if (points.length > FREEHAND_STROKE_MAX_INPUT_POINTS) return null;
  const geometry = sampleFreehandStroke(points, context);
  if (!geometry) return null;

  const parsed = freehandStrokeSchema.safeParse({
    geometry,
    style: { color },
  });
  return parsed.success ? parsed.data : null;
}

export function getAnnotationCanvasFreehandRenderModel(
  stroke: unknown,
  context: AnnotationCoordinateContext,
) {
  const parsed = freehandStrokeSchema.safeParse(stroke);
  if (!parsed.success) return null;

  const geometry = getFreehandStrokeRenderModel(parsed.data.geometry, context);
  if (!geometry) return null;

  return {
    ...geometry,
    stroke: markerColors[parsed.data.style.color],
  };
}

function isAnnotationLive(item: GuestAnnotationItem) {
  return (
    item.state !== 'deleted' && item.geometry !== null && item.style !== null
  );
}

export function AnnotationCanvas({
  previewUrl,
  filename,
  annotations,
  selectedAnnotationId,
  draftGeometry,
  tool,
  color,
  canDraw,
  onDraftGeometry,
  onImageState,
  onImageError,
  freehandMode = false,
  freehandScopeKey,
  freehandStrokes = [],
  onDraftFreehand,
}: AnnotationCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [pointerDraft, setPointerDraft] = useState<PointerDraft | null>(null);
  const freehandPointerDraftRef = useRef<FreehandPointerDraft | null>(null);
  const freehandKeyboardDraftRef = useRef<FreehandKeyboardDraft | null>(null);
  const freehandPreviewFrameRef = useRef<number | null>(null);
  const [freehandPreview, setFreehandPreview] =
    useState<FreehandPreview | null>(null);

  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [panXPercent, setPanXPercent] = useState(0);
  const [panYPercent, setPanYPercent] = useState(0);
  const [pointerEnd, setPointerEnd] = useState<AnnotationPoint | null>(null);
  const [keyboardCursor, setKeyboardCursor] = useState<AnnotationPoint>({
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: coordinateScale / 2,
    y: coordinateScale / 2,
  });
  const [keyboardRectangleStart, setKeyboardRectangleStart] =
    useState<AnnotationPoint | null>(null);
  const [keyboardHelp, setKeyboardHelp] = useState<string | null>(null);

  const freehandCallbackAvailable = typeof onDraftFreehand === 'function';
  const freehandReady =
    freehandMode &&
    canDraw &&
    freehandCallbackAvailable &&
    typeof freehandScopeKey === 'string' &&
    freehandScopeKey.length > 0 &&
    naturalSize !== null;
  const freehandViewKey = [
    zoom,
    panXPercent,
    panYPercent,
    viewportSize.width,
    viewportSize.height,
    naturalSize?.width ?? 0,
    naturalSize?.height ?? 0,
  ].join(':');
  const freehandScope = useMemo<AnnotationCanvasFreehandScope>(
    () => ({
      scopeKey: typeof freehandScopeKey === 'string' ? freehandScopeKey : null,
      previewUrl,
      canDraw,
      mode: freehandMode,
      ready: freehandReady,
      viewKey: freehandViewKey,
    }),
    [
      canDraw,
      freehandMode,
      freehandReady,
      freehandScopeKey,
      freehandViewKey,
      previewUrl,
    ],
  );
  const freehandScopeRef = useRef(freehandScope);
  freehandScopeRef.current = freehandScope;

  const cancelFreehandDrafts = useCallback(() => {
    const activePointer = freehandPointerDraftRef.current;
    const hadDraft =
      activePointer !== null || freehandKeyboardDraftRef.current !== null;
    freehandPointerDraftRef.current = null;
    freehandKeyboardDraftRef.current = null;

    const frame = freehandPreviewFrameRef.current;
    freehandPreviewFrameRef.current = null;
    if (frame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame);
    }

    if (activePointer) {
      try {
        if (activePointer.target.hasPointerCapture(activePointer.pointerId)) {
          activePointer.target.releasePointerCapture(activePointer.pointerId);
        }
      } catch {
        // The browser may already have released pointer capture.
      }
    }

    setFreehandPreview(null);
    return hadDraft;
  }, []);

  useEffect(() => {
    const activePointer = freehandPointerDraftRef.current;
    freehandPointerDraftRef.current = null;
    freehandKeyboardDraftRef.current = null;

    const frame = freehandPreviewFrameRef.current;
    freehandPreviewFrameRef.current = null;
    if (frame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame);
    }

    if (activePointer) {
      try {
        if (activePointer.target.hasPointerCapture(activePointer.pointerId)) {
          activePointer.target.releasePointerCapture(activePointer.pointerId);
        }
      } catch {
        // The browser may already have released pointer capture.
      }
    }
  }, [freehandScope]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({
        width: Number.isFinite(bounds.width) ? bounds.width : 0,
        height: Number.isFinite(bounds.height) ? bounds.height : 0,
      });
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [previewUrl]);

  const pan = useMemo(
    () => ({
      x: (panXPercent / 100) * viewportSize.width,
      y: (panYPercent / 100) * viewportSize.height,
    }),
    [panXPercent, panYPercent, viewportSize.height, viewportSize.width],
  );

  const stageRect = useMemo(() => {
    if (!naturalSize || viewportSize.width <= 0 || viewportSize.height <= 0)
      return null;
    return getAnnotationImageRect({
      viewport: {
        x: 0,
        y: 0,
        width: viewportSize.width,
        height: viewportSize.height,
      },
      source: naturalSize,
      zoom,
      pan,
    });
  }, [naturalSize, pan, viewportSize.height, viewportSize.width, zoom]);

  const imageLoaded = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (
      !Number.isSafeInteger(image.naturalWidth) ||
      image.naturalWidth <= 0 ||
      !Number.isSafeInteger(image.naturalHeight) ||
      image.naturalHeight <= 0
    ) {
      setNaturalSize(null);
      onImageState({ status: 'error' });
      onImageError();
      return;
    }

    const size = { width: image.naturalWidth, height: image.naturalHeight };
    setNaturalSize(size);
    onImageState({ status: 'ready', ...size });
  };

  function sameCoordinateContext(
    left: AnnotationCoordinateContext,
    right: AnnotationCoordinateContext | null,
  ) {
    return (
      right !== null &&
      left.viewport.x === right.viewport.x &&
      left.viewport.y === right.viewport.y &&
      left.viewport.width === right.viewport.width &&
      left.viewport.height === right.viewport.height &&
      left.source.width === right.source.width &&
      left.source.height === right.source.height &&
      left.zoom === right.zoom &&
      left.pan.x === right.pan.x &&
      left.pan.y === right.pan.y
    );
  }

  function currentCoordinateContext(): AnnotationCoordinateContext | null {
    const viewport = viewportRef.current;
    if (!viewport || !naturalSize) return null;

    const bounds = viewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      viewport: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      source: naturalSize,
      zoom,
      pan,
    };
  }

  function pointerSamplingContext(): AnnotationCoordinateContext | null {
    const image = imageRef.current;
    if (
      !image ||
      !naturalSize ||
      !image.complete ||
      image.naturalWidth !== naturalSize.width ||
      image.naturalHeight !== naturalSize.height
    ) {
      return null;
    }

    const bounds = image.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      viewport: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      source: naturalSize,
      zoom: 1,
      pan: { x: 0, y: 0 },
    };
  }

  function scheduleFreehandPreview(
    active: FreehandPointerDraft | FreehandKeyboardDraft,
  ) {
    if (freehandPreviewFrameRef.current !== null) return;

    const update = () => {
      freehandPreviewFrameRef.current = null;
      const current =
        freehandPointerDraftRef.current ?? freehandKeyboardDraftRef.current;
      if (current !== active) return;
      const currentContext =
        freehandPointerDraftRef.current === active
          ? pointerSamplingContext()
          : currentCoordinateContext();
      if (
        !matchesCurrentFreehandScope(active.scope, freehandScopeRef.current) ||
        !sameCoordinateContext(active.context, currentContext)
      ) {
        cancelFreehandDrafts();
        setKeyboardHelp('自由筆畫已取消，因畫面或授權範圍變更。');
        return;
      }

      const stroke = createAnnotationCanvasFreehandDraft(
        active.points,
        active.context,
        active.color,
      );
      setFreehandPreview(
        stroke
          ? {
              geometry: stroke.geometry,
              color: stroke.style.color,
              scope: active.scope,
            }
          : null,
      );
    };

    if (typeof requestAnimationFrame !== 'function') {
      update();
      return;
    }
    freehandPreviewFrameRef.current = requestAnimationFrame(update);
  }

  const imageFailed = () => {
    cancelFreehandDrafts();
    setPointerDraft(null);
    setNaturalSize(null);
    setPointerEnd(null);
    setKeyboardRectangleStart(null);
    onImageState({ status: 'error' });
    onImageError();
  };

  function cancelFreehandPreviewFrame() {
    const frame = freehandPreviewFrameRef.current;
    freehandPreviewFrameRef.current = null;
    if (frame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame);
    }
  }

  function appendPointerSamples(
    draft: FreehandPointerDraft,
    event: PointerEvent<HTMLDivElement>,
  ): boolean {
    let samples: globalThis.PointerEvent[] = [];
    try {
      samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    } catch {
      // Some browsers expose coalesced events but reject access for a device.
    }
    if (samples.length === 0) samples = [event.nativeEvent];
    const last = samples[samples.length - 1];
    if (
      !last ||
      last.clientX !== event.clientX ||
      last.clientY !== event.clientY
    ) {
      samples.push(event.nativeEvent);
    }

    if (!sameCoordinateContext(draft.context, pointerSamplingContext())) {
      return false;
    }

    for (const sample of samples) {
      const previous = draft.points[draft.points.length - 1];
      if (
        previous &&
        previous.x === sample.clientX &&
        previous.y === sample.clientY
      ) {
        continue;
      }
      if (draft.points.length >= FREEHAND_STROKE_MAX_INPUT_POINTS) return false;
      if (!normalizedPoint(sample.clientX, sample.clientY)) return false;
      draft.points.push({ x: sample.clientX, y: sample.clientY });
    }
    return true;
  }

  function normalizedPoint(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (
      !viewport ||
      !image ||
      !naturalSize ||
      !image.complete ||
      image.naturalWidth !== naturalSize.width ||
      image.naturalHeight !== naturalSize.height
    ) {
      return null;
    }

    const clippedBounds = viewport.getBoundingClientRect();
    if (
      clientX < clippedBounds.left ||
      clientX > clippedBounds.right ||
      clientY < clippedBounds.top ||
      clientY > clippedBounds.bottom
    ) {
      return null;
    }

    // Pointer capture continues beyond ancestor scroll clipping. Hit testing
    // rejects endpoints that are no longer on this visible canvas surface.
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit || !viewport.contains(hit)) return null;

    const imageBounds = image.getBoundingClientRect();
    return clientPointToAnnotationPoint(
      { x: clientX, y: clientY },
      {
        viewport: {
          x: imageBounds.left,
          y: imageBounds.top,
          width: imageBounds.width,
          height: imageBounds.height,
        },
        source: {
          width: image.naturalWidth,
          height: image.naturalHeight,
        },
        zoom: 1,
        pan: { x: 0, y: 0 },
      },
    );
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (freehandMode) {
      if (!freehandReady || !naturalSize || event.button !== 0) return;
      if (freehandPointerDraftRef.current) return;

      const point = normalizedPoint(event.clientX, event.clientY);
      const context = pointerSamplingContext();
      if (!point || !context || freehandScope.scopeKey === null) return;

      freehandKeyboardDraftRef.current = null;
      setFreehandPreview(null);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        freehandPointerDraftRef.current = {
          pointerId: event.pointerId,
          target: event.currentTarget,
          points: [{ x: event.clientX, y: event.clientY }],
          context,
          color,
          scope: freehandScope,
        };
      } catch {
        freehandPointerDraftRef.current = null;
        setFreehandPreview(null);
      }
      return;
    }

    if (!canDraw || !naturalSize || event.button !== 0) return;
    const point = normalizedPoint(event.clientX, event.clientY);
    if (!point) return;

    setPointerDraft({ pointerId: event.pointerId, start: point });
    setPointerEnd(point);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      setPointerDraft(null);
      setPointerEnd(null);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const freehand = freehandPointerDraftRef.current;
    if (freehand) {
      if (freehand.pointerId !== event.pointerId) return;
      if (
        !matchesCurrentFreehandScope(freehand.scope, freehandScope) ||
        !appendPointerSamples(freehand, event)
      ) {
        cancelFreehandDrafts();
        setKeyboardHelp('自由筆畫已取消；路徑離開可見照片或超過取樣上限。');
        return;
      }
      scheduleFreehandPreview(freehand);
      return;
    }

    const active = pointerDraft;
    if (!active || active.pointerId !== event.pointerId) return;
    setPointerEnd(normalizedPoint(event.clientX, event.clientY));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const freehand = freehandPointerDraftRef.current;
    if (freehand) {
      if (freehand.pointerId !== event.pointerId) return;
      if (
        !matchesCurrentFreehandScope(freehand.scope, freehandScope) ||
        !appendPointerSamples(freehand, event)
      ) {
        cancelFreehandDrafts();
        setKeyboardHelp('自由筆畫已取消；路徑離開可見照片或超過取樣上限。');
        return;
      }

      const stroke = createAnnotationCanvasFreehandDraft(
        freehand.points,
        freehand.context,
        freehand.color,
      );
      freehandPointerDraftRef.current = null;
      cancelFreehandPreviewFrame();
      setFreehandPreview(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The browser can release capture before this handler after navigation.
      }
      if (!stroke) {
        setKeyboardHelp('筆畫太短，未建立草稿。');
        return;
      }
      onDraftFreehand?.(stroke);
      setKeyboardHelp('自由筆畫草稿已建立；檢查後再儲存。');
      return;
    }

    const active = pointerDraft;
    if (!active || active.pointerId !== event.pointerId) return;

    const end = normalizedPoint(event.clientX, event.clientY);
    setPointerDraft(null);
    setPointerEnd(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser can release capture before this handler after navigation.
    }
    if (!end) return;

    if (tool === 'point') {
      onDraftGeometry(active.start);
      return;
    }

    const rectangle = createAnnotationRectangle(active.start, end);
    if (rectangle) onDraftGeometry(rectangle);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const freehand = freehandPointerDraftRef.current;
    if (freehand?.pointerId === event.pointerId) {
      cancelFreehandDrafts();
      setKeyboardHelp('自由筆畫已取消。');
      return;
    }

    const active = pointerDraft;
    if (!active || active.pointerId !== event.pointerId) return;
    setPointerDraft(null);
    setPointerEnd(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the platform.
    }
  }

  function onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
    const freehand = freehandPointerDraftRef.current;
    if (freehand?.pointerId === event.pointerId) {
      cancelFreehandDrafts();
      setKeyboardHelp('自由筆畫已取消。');
      return;
    }

    const active = pointerDraft;
    if (!active || active.pointerId !== event.pointerId) return;
    setPointerDraft(null);
    setPointerEnd(null);
  }

  function nextKeyboardCursor(
    current: AnnotationPoint,
    key: string,
    shift: boolean,
  ): AnnotationPoint {
    const step = shift ? 1_000 : 10_000;
    return {
      ...current,
      x: Math.max(
        0,
        Math.min(
          coordinateScale,
          current.x +
            (key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          coordinateScale,
          current.y +
            (key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0),
        ),
      ),
    };
  }

  function moveKeyboardCursor(key: string, shift: boolean) {
    setKeyboardCursor((current) => nextKeyboardCursor(current, key, shift));
    setKeyboardHelp(
      shift
        ? '游標已微調；Enter 放置標記。'
        : '游標已移動；按住 Shift 可微調，Enter 放置標記。',
    );
  }

  function startKeyboardFreehand() {
    const context = currentCoordinateContext();
    const clientPoint =
      context && annotationPointToClientPoint(keyboardCursor, context);
    if (
      !context ||
      !clientPoint ||
      !clientPointToAnnotationPoint(clientPoint, context) ||
      freehandScope.scopeKey === null
    ) {
      setKeyboardHelp('目前游標不在可見照片範圍內，無法開始筆畫。');
      return;
    }

    freehandPointerDraftRef.current = null;
    freehandKeyboardDraftRef.current = {
      points: [clientPoint],
      context,
      color,
      scope: freehandScope,
    };
    setFreehandPreview(null);
    setKeyboardHelp(
      '已開始自由筆畫；方向鍵延伸，按 Enter 完成或 Escape 取消。',
    );
  }

  function finishKeyboardFreehand() {
    const active = freehandKeyboardDraftRef.current;
    if (!active) return;
    if (
      !matchesCurrentFreehandScope(active.scope, freehandScope) ||
      !sameCoordinateContext(active.context, currentCoordinateContext())
    ) {
      cancelFreehandDrafts();
      setKeyboardHelp('自由筆畫已取消，因畫面或授權範圍變更。');
      return;
    }

    const stroke = createAnnotationCanvasFreehandDraft(
      active.points,
      active.context,
      active.color,
    );
    freehandKeyboardDraftRef.current = null;
    cancelFreehandPreviewFrame();
    setFreehandPreview(null);
    if (!stroke) {
      setKeyboardHelp('筆畫太短，未建立草稿。');
      return;
    }
    onDraftFreehand?.(stroke);
    setKeyboardHelp('自由筆畫草稿已建立；檢查後再儲存。');
  }

  function onCanvasKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (freehandMode) {
      if (event.key === 'Escape') {
        cancelFreehandDrafts();
        setKeyboardHelp('自由筆畫已取消。');
        return;
      }
      if (!freehandReady || !naturalSize) return;
      if (freehandPointerDraftRef.current) return;

      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
      ) {
        event.preventDefault();
        const next = nextKeyboardCursor(
          keyboardCursor,
          event.key,
          event.shiftKey,
        );
        setKeyboardCursor(next);
        const active = freehandKeyboardDraftRef.current;
        if (!active) {
          setKeyboardHelp(
            '游標已移動；按 Enter 開始自由筆畫，方向鍵延伸，Escape 取消。',
          );
          return;
        }
        if (!matchesCurrentFreehandScope(active.scope, freehandScope)) {
          cancelFreehandDrafts();
          setKeyboardHelp('自由筆畫已取消，因畫面或授權範圍變更。');
          return;
        }

        const context = currentCoordinateContext();
        if (!sameCoordinateContext(active.context, context)) {
          cancelFreehandDrafts();
          setKeyboardHelp('自由筆畫已取消，因畫面或授權範圍變更。');
          return;
        }
        const clientPoint =
          context && annotationPointToClientPoint(next, context);
        if (
          !clientPoint ||
          !clientPointToAnnotationPoint(clientPoint, active.context)
        ) {
          cancelFreehandDrafts();
          setKeyboardHelp('自由筆畫已取消；游標移出可見照片範圍。');
          return;
        }
        const previous = active.points[active.points.length - 1];
        if (previous?.x === clientPoint.x && previous.y === clientPoint.y) {
          return;
        }
        if (active.points.length >= FREEHAND_STROKE_MAX_INPUT_POINTS) {
          cancelFreehandDrafts();
          setKeyboardHelp('自由筆畫已取消；已達取樣上限。');
          return;
        }
        active.points.push(clientPoint);
        scheduleFreehandPreview(active);
        setKeyboardHelp('自由筆畫進行中；按 Enter 完成或 Escape 取消。');
        return;
      }

      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (freehandKeyboardDraftRef.current) {
        finishKeyboardFreehand();
      } else {
        startKeyboardFreehand();
      }
      return;
    }

    if (!canDraw || !naturalSize) return;

    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      event.preventDefault();
      moveKeyboardCursor(event.key, event.shiftKey);
      return;
    }

    if (event.key === 'Escape') {
      setKeyboardRectangleStart(null);
      setKeyboardHelp('已取消目前的鍵盤繪製。');
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();

    if (tool === 'point') {
      onDraftGeometry(keyboardCursor);
      setKeyboardHelp('已放置點標記；檢查後按「儲存標記」。');
      return;
    }

    if (!keyboardRectangleStart) {
      setKeyboardRectangleStart(keyboardCursor);
      setKeyboardHelp('矩形起點已設定；移動游標至終點後再按 Enter。');
      return;
    }

    const rectangle = createAnnotationRectangle(
      keyboardRectangleStart,
      keyboardCursor,
    );
    setKeyboardRectangleStart(null);
    if (!rectangle) {
      setKeyboardHelp('矩形需要不同的水平與垂直位置，請重新設定起點。');
      return;
    }
    onDraftGeometry(rectangle);
    setKeyboardHelp('已放置矩形標記；檢查後按「儲存標記」。');
  }

  function pointRadii() {
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0)
      return { rx: 14_000, ry: 14_000 };
    return {
      rx: (12 * coordinateScale) / stageRect.width,
      ry: (12 * coordinateScale) / stageRect.height,
    };
  }

  const sourceUrl = previewUrl;
  const viewportStyle: CSSProperties = {
    touchAction: canDraw ? 'none' : 'pan-y',
    cursor: canDraw
      ? tool === 'point'
        ? 'crosshair'
        : 'crosshair'
      : 'default',
  };
  const stageStyle: CSSProperties | undefined = stageRect
    ? {
        position: 'absolute',
        left: stageRect.x,
        top: stageRect.y,
        width: stageRect.width,
        height: stageRect.height,
      }
    : undefined;
  const radii = pointRadii();
  const showGeometry = (geometry: AnnotationGeometry) =>
    geometry.type === 'point' ? (
      <ellipse
        cx={geometry.x}
        cy={geometry.y}
        rx={radii.rx}
        ry={radii.ry}
        vectorEffect="non-scaling-stroke"
      />
    ) : geometry.type === 'freehand' ? (
      <polyline
        points={geometry.points
          .map((point) => `${point.x},${point.y}`)
          .join(' ')}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    ) : (
      <rect
        x={geometry.x}
        y={geometry.y}
        width={geometry.width}
        height={geometry.height}
        vectorEffect="non-scaling-stroke"
      />
    );

  const liveRectangle =
    tool === 'rectangle' && pointerDraft && pointerEnd
      ? createAnnotationRectangle(pointerDraft.start, pointerEnd)
      : null;

  const cursorContext =
    naturalSize && viewportSize.width > 0 && viewportSize.height > 0
      ? {
          viewport: {
            x: 0,
            y: 0,
            width: viewportSize.width,
            height: viewportSize.height,
          },
          source: naturalSize,
          zoom,
          pan,
        }
      : null;
  const cursorPosition =
    cursorContext &&
    annotationPointToClientPoint(keyboardCursor, cursorContext);
  const currentFreehandPreview =
    freehandPreview &&
    matchesCurrentFreehandScope(freehandPreview.scope, freehandScope)
      ? freehandPreview
      : null;

  return (
    <section className="space-y-2" aria-label="標註畫布與檢視控制">
      <div
        data-testid="annotation-canvas"
        className="relative isolate h-[min(58vh,34rem)] min-h-64 w-full overflow-hidden rounded-lg border border-stone-300 bg-stone-950"
        aria-label={filename + ' 標註畫布'}
      >
        {sourceUrl !== null ? (
          <div
            ref={viewportRef}
            role={canDraw ? 'application' : 'img'}
            aria-label={
              canDraw
                ? freehandMode
                  ? freehandReady
                    ? filename +
                      '；自由筆畫模式，方向鍵移動游標，按 Enter 開始或完成，Escape 取消；也可用觸控筆或滑鼠繪製'
                    : filename + '；自由筆畫目前不可用'
                  : filename +
                    '；使用滑鼠繪製，或使用方向鍵移動鍵盤游標並按 Enter 放置標記'
                : filename + ' 標註預覽'
            }
            tabIndex={canDraw && naturalSize ? 0 : -1}
            className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
            style={viewportStyle}
            onKeyDown={onCanvasKeyDown}
          >
            {!naturalSize && (
              <img
                data-testid="annotation-preview-image"
                ref={imageRef}
                src={sourceUrl}
                alt={filename}
                draggable={false}
                onLoad={imageLoaded}
                onError={imageFailed}
                className="pointer-events-none absolute inset-0 m-auto block h-full w-full select-none object-contain"
              />
            )}

            {naturalSize && stageRect && (
              <div
                style={stageStyle}
                className="select-none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onLostPointerCapture={onLostPointerCapture}
              >
                <img
                  data-testid="annotation-preview-image"
                  ref={imageRef}
                  src={sourceUrl}
                  alt={filename}
                  draggable={false}
                  onLoad={imageLoaded}
                  onError={imageFailed}
                  className="pointer-events-none block h-full w-full select-none"
                  style={{ objectFit: 'contain' }}
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 1000000 1000000"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                >
                  {annotations.filter(isAnnotationLive).map((item) => {
                    const geometry = item.geometry;
                    const style = item.style;
                    if (!geometry || !style) return null;
                    const selected = selectedAnnotationId === item.annotationId;
                    const stroke = markerColors[style.color];
                    return (
                      <g
                        key={item.annotationId}
                        data-testid={'annotation-mark-' + item.annotationId}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={selected ? 4 : 3}
                        vectorEffect="non-scaling-stroke"
                      >
                        {showGeometry(geometry)}
                      </g>
                    );
                  })}
                  {cursorContext &&
                    freehandStrokes.map((stroke, index) => {
                      const model = getAnnotationCanvasFreehandRenderModel(
                        stroke,
                        cursorContext,
                      );
                      if (!model) return null;
                      return (
                        <polyline
                          key={'freehand-mark-' + index}
                          data-testid={'annotation-freehand-mark-' + index}
                          points={model.points
                            .map(({ x, y }) => String(x) + ',' + String(y))
                            .join(' ')}
                          fill="none"
                          stroke={model.stroke}
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  {currentFreehandPreview && cursorContext && (
                    <polyline
                      data-testid="annotation-freehand-preview"
                      points={getAnnotationCanvasFreehandRenderModel(
                        {
                          geometry: currentFreehandPreview.geometry,
                          style: { color: currentFreehandPreview.color },
                        },
                        cursorContext,
                      )
                        ?.points.map(({ x, y }) => String(x) + ',' + String(y))
                        .join(' ')}
                      fill="none"
                      stroke={markerColors[currentFreehandPreview.color]}
                      strokeDasharray="7 4"
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {liveRectangle && (
                    <g
                      fill="none"
                      stroke={markerColors[color]}
                      strokeDasharray="8 6"
                      strokeWidth={3}
                      vectorEffect="non-scaling-stroke"
                    >
                      {showGeometry(liveRectangle)}
                    </g>
                  )}
                  {draftGeometry && (
                    <g
                      data-testid="annotation-draft-mark"
                      fill="none"
                      stroke={markerColors[color]}
                      strokeDasharray="5 4"
                      strokeWidth={4}
                      vectorEffect="non-scaling-stroke"
                    >
                      {showGeometry(draftGeometry)}
                    </g>
                  )}
                  {keyboardRectangleStart && (
                    <g
                      fill="none"
                      stroke={markerColors[color]}
                      strokeDasharray="3 4"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    >
                      {showGeometry(keyboardRectangleStart)}
                    </g>
                  )}
                  {canDraw && cursorPosition && (
                    <ellipse
                      cx={keyboardCursor.x}
                      cy={keyboardCursor.y}
                      rx={radii.rx}
                      ry={radii.ry}
                      fill="rgba(255,255,255,.2)"
                      stroke="#ffffff"
                      strokeDasharray="3 3"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
              </div>
            )}

            {previewUrl !== null && (!naturalSize || !stageRect) && (
              <p
                role="status"
                className="pointer-events-none absolute inset-x-3 bottom-3 rounded bg-black/70 px-3 py-2 text-center text-xs text-white"
              >
                {!naturalSize ? '預覽載入中…' : '正在準備標註預覽…'}
              </p>
            )}
          </div>
        ) : (
          <p className="flex h-full min-h-64 items-center justify-center px-4 text-center text-sm text-white/70">
            目前版本沒有可用的授權預覽。
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-2">
        <label className="flex items-center gap-3 text-xs text-stone-700">
          <span className="w-14 shrink-0">縮放</span>
          <input
            data-testid="annotation-zoom"
            aria-label="標註畫布縮放"
            type="range"
            min={1}
            max={4}
            step={0.25}
            value={zoom}
            disabled={!naturalSize}
            onChange={(event) => setZoom(event.currentTarget.valueAsNumber)}
            className="min-h-8 min-w-0 flex-1 accent-amber-700 disabled:opacity-50"
          />
          <output className="w-10 text-right tabular-nums">
            {zoom.toFixed(2)}×
          </output>
        </label>
        <label className="flex items-center gap-3 text-xs text-stone-700">
          <span className="w-14 shrink-0">水平移動</span>
          <input
            data-testid="annotation-pan-x"
            aria-label="標註畫布水平移動"
            type="range"
            min={-50}
            max={50}
            step={1}
            value={panXPercent}
            disabled={!naturalSize}
            onChange={(event) =>
              setPanXPercent(event.currentTarget.valueAsNumber)
            }
            className="min-h-8 min-w-0 flex-1 accent-amber-700 disabled:opacity-50"
          />
        </label>
        <label className="flex items-center gap-3 text-xs text-stone-700">
          <span className="w-14 shrink-0">垂直移動</span>
          <input
            data-testid="annotation-pan-y"
            aria-label="標註畫布垂直移動"
            type="range"
            min={-50}
            max={50}
            step={1}
            value={panYPercent}
            disabled={!naturalSize}
            onChange={(event) =>
              setPanYPercent(event.currentTarget.valueAsNumber)
            }
            className="min-h-8 min-w-0 flex-1 accent-amber-700 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          data-testid="annotation-reset-view"
          disabled={!naturalSize}
          onClick={() => {
            setZoom(1);
            setPanXPercent(0);
            setPanYPercent(0);
          }}
          className="min-h-9 rounded-md border border-stone-300 px-3 text-xs text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          重設畫面
        </button>
      </div>
      <p aria-live="polite" className="min-h-5 text-xs text-stone-600">
        {keyboardHelp ??
          (freehandMode
            ? freehandReady
              ? '自由筆畫：方向鍵移動游標，按 Enter 開始或完成，Escape 取消；也可用觸控筆或滑鼠繪製。'
              : '自由筆畫目前不可用；請確認畫布授權後再操作。'
            : canDraw
              ? '點選點標記位置；矩形請拖曳。畫布可用方向鍵與 Enter 操作。'
              : '目前為唯讀標註預覽。')}
      </p>
    </section>
  );
}
