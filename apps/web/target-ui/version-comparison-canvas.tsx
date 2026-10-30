'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type CompareMode = 'slider' | 'side' | 'overlay';
export type ManualOverlayMode = 'before' | 'after' | null;

export type VersionComparisonCanvasImage = {
  id: string;
  src: string;
  alt: string;
  caption: string;
  label: string;
  retryKey: string | number;
  badge?: string;
};

export type VersionComparisonCanvasProps = {
  scopeKey: string;
  mode: CompareMode;
  before: VersionComparisonCanvasImage;
  after: VersionComparisonCanvasImage;
  splitPosition: number;
  onSplitPositionChange: (value: number) => void;
  zoom: number;
  panX: number;
  panY: number;
  opacity: number;
  manualOverlayMode: ManualOverlayMode;
  onImageError: (id: string) => void;
  testIdPrefix?: string;
  ariaLabel?: string;
  maxWidthClassName?: string;
};

export function VersionComparisonCanvas({
  scopeKey,
  mode,
  before,
  after,
  splitPosition,
  onSplitPositionChange,
  zoom,
  panX,
  panY,
  opacity,
  manualOverlayMode,
  onImageError,
  testIdPrefix = 'compare',
  ariaLabel = '版本比較畫布',
  maxWidthClassName = 'max-w-[56vh]',
}: VersionComparisonCanvasProps) {
  const sliderId = useId();
  const [splitHintState, setSplitHintState] = useState(() => ({
    scopeKey,
    dismissed: false,
  }));
  const splitHintDismissed =
    splitHintState.scopeKey === scopeKey && splitHintState.dismissed;
  const splitPointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    splitPointerIdRef.current = null;
  }, [scopeKey]);

  const dismissSplitHint = useCallback(
    () => setSplitHintState({ scopeKey, dismissed: true }),
    [scopeKey],
  );

  const updateSplitFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = (event.clientX - bounds.left) / bounds.width;
    onSplitPositionChange(Math.round(Math.max(0, Math.min(1, ratio)) * 100));
  };

  const handleSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    splitPointerIdRef.current = event.pointerId;
    dismissSplitHint();
    updateSplitFromPointer(event);
  };

  const handleSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitPointerIdRef.current !== event.pointerId) return;
    updateSplitFromPointer(event);
  };

  const handleSplitPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitPointerIdRef.current === event.pointerId) {
      splitPointerIdRef.current = null;
    }
  };

  const handleSplitKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      dismissSplitHint();
    }
    if (
      !event.shiftKey ||
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    ) {
      return;
    }
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 10 : -10;
    onSplitPositionChange(Math.max(0, Math.min(100, splitPosition + delta)));
  };

  const canvasStyle: CSSProperties = { aspectRatio: '4 / 3' };
  const splitDisplayPosition =
    'clamp(0%, calc(var(--guest-compare-split-position, 50%) + var(--guest-compare-split-offset, 0%)), 100%)';
  const splitStageStyle = {
    ...canvasStyle,
    '--guest-compare-split-position': splitPosition + '%',
  } as CSSProperties;
  const transform =
    'translate(' + panX + '%, ' + panY + '%) scale(' + zoom + ')';
  const beforeImageKey =
    scopeKey +
    ':' +
    before.id +
    ':' +
    String(before.retryKey) +
    ':' +
    before.src;
  const afterImageKey =
    scopeKey + ':' + after.id + ':' + String(after.retryKey) + ':' + after.src;

  return (
    <>
      <div
        data-testid={testIdPrefix + '-canvas'}
        role="group"
        className="min-w-0"
        aria-label={ariaLabel}
      >
        {mode === 'slider' && (
          <div
            data-testid={testIdPrefix + '-slider-stage'}
            data-hint-active={splitHintDismissed ? 'false' : 'true'}
            className={
              'guest-compare-slider-stage version-comparison-slider-stage relative mx-auto w-full ' +
              maxWidthClassName +
              ' cursor-col-resize overflow-hidden bg-black ' +
              (splitHintDismissed
                ? ''
                : 'guest-compare-slider-stage-hint version-comparison-slider-stage-hint')
            }
            style={splitStageStyle}
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={handleSplitPointerEnd}
            onPointerCancel={handleSplitPointerEnd}
            onLostPointerCapture={handleSplitPointerEnd}
          >
            <img
              key={beforeImageKey}
              src={before.src}
              alt={before.alt}
              draggable={false}
              onError={() => onImageError(before.id)}
              className="absolute inset-0 h-full w-full select-none object-contain"
            />
            <img
              key={afterImageKey}
              src={after.src}
              alt={after.alt}
              draggable={false}
              onError={() => onImageError(after.id)}
              className="absolute inset-0 h-full w-full select-none object-contain"
              style={{
                clipPath: 'inset(0 0 0 ' + splitDisplayPosition + ')',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-3 z-10 rounded bg-black/65 px-2 py-1 text-[10px] font-semibold tracking-wide text-white shadow"
            >
              {before.badge ?? 'BEFORE'}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-3 z-10 rounded bg-black/65 px-2 py-1 text-[10px] font-semibold tracking-wide text-white shadow"
            >
              {after.badge ?? 'AFTER'}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-20 w-0"
              style={{ left: splitDisplayPosition }}
            >
              <div
                data-testid={testIdPrefix + '-split-divider'}
                className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-white shadow"
              />
              <div
                data-testid={testIdPrefix + '-drag-handle'}
                data-hint-active={splitHintDismissed ? 'false' : 'true'}
                className="guest-compare-slider-handle absolute left-0 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-amber-100 bg-stone-950/90 text-xl font-semibold leading-none text-amber-100 shadow-md"
              >
                <span>↔</span>
              </div>
            </div>
          </div>
        )}

        {mode === 'side' && (
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <div className="min-w-0">
              <p className="mb-1 truncate text-center text-xs text-white/70">
                {before.caption}
              </p>
              <div
                className={
                  'relative mx-auto w-full ' +
                  maxWidthClassName +
                  ' overflow-hidden bg-black'
                }
                style={canvasStyle}
              >
                <img
                  key={beforeImageKey}
                  src={before.src}
                  alt={before.alt}
                  draggable={false}
                  onError={() => onImageError(before.id)}
                  className="absolute inset-0 h-full w-full select-none object-contain"
                  style={{ transform, transformOrigin: 'center' }}
                />
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-1 truncate text-center text-xs text-white/70">
                {after.caption}
              </p>
              <div
                className={
                  'relative mx-auto w-full ' +
                  maxWidthClassName +
                  ' overflow-hidden bg-black'
                }
                style={canvasStyle}
              >
                <img
                  key={afterImageKey}
                  src={after.src}
                  alt={after.alt}
                  draggable={false}
                  onError={() => onImageError(after.id)}
                  className="absolute inset-0 h-full w-full select-none object-contain"
                  style={{ transform, transformOrigin: 'center' }}
                />
              </div>
            </div>
          </div>
        )}

        {mode === 'overlay' && (
          <div
            className={
              'relative mx-auto w-full ' +
              maxWidthClassName +
              ' overflow-hidden bg-black'
            }
            style={canvasStyle}
          >
            <img
              key={beforeImageKey}
              src={before.src}
              alt={before.alt}
              draggable={false}
              onError={() => onImageError(before.id)}
              className="absolute inset-0 h-full w-full select-none object-contain"
              style={{
                opacity: manualOverlayMode === 'after' ? 0 : 1,
              }}
            />
            <img
              key={afterImageKey}
              src={after.src}
              alt={after.alt}
              draggable={false}
              onError={() => onImageError(after.id)}
              className="absolute inset-0 h-full w-full select-none object-contain"
              style={{
                opacity:
                  manualOverlayMode === 'before'
                    ? 0
                    : manualOverlayMode === 'after'
                      ? 1
                      : opacity / 100,
              }}
            />
          </div>
        )}
      </div>

      {mode === 'slider' && (
        <div className="min-w-0 space-y-1">
          <label htmlFor={sliderId} className="block text-xs">
            比較分隔位置
          </label>
          <input
            id={sliderId}
            data-testid={testIdPrefix + '-slider'}
            type="range"
            min={0}
            max={100}
            step={1}
            value={splitPosition}
            onPointerDown={dismissSplitHint}
            onChange={(event) => {
              dismissSplitHint();
              onSplitPositionChange(event.currentTarget.valueAsNumber);
            }}
            onKeyDown={handleSplitKeyDown}
            aria-valuetext={
              '分隔線基準位置位於左側 ' +
              splitPosition +
              '%；左側 ' +
              before.label +
              '，右側 ' +
              after.label
            }
            className="min-h-8 w-full accent-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          />
          <output htmlFor={sliderId} className="block text-xs text-white/65">
            分隔線基準位置位於左側 {splitPosition}%；左側 {before.label}，右側
            {after.label}。閒置時會輕微左右移動提示；操作後固定。 Shift
            加方向鍵每次移動 10%
          </output>
        </div>
      )}
    </>
  );
}
