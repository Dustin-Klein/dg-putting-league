'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { MiniMap, TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { Move, Minus, Plus, Scan } from 'lucide-react';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { cn } from '@/lib/utils/utils';

export interface BracketCanvasHandle {
  /** Zooms to `percent` around the middle of the visible area. */
  setScale: (percent: number) => void;
  fit: () => void;
}

interface BracketCanvasProps {
  children: ReactNode;
  /** Called with the current zoom as a whole percentage whenever it changes. */
  onScaleChange?: (percent: number) => void;
  className?: string;
}

export const MOBILE_QUERY = '(max-width: 767px)';
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const BUTTON_ZOOM_FACTOR = 1.5;
const DRAG_CLICK_THRESHOLD_PX = 6;
const ANIMATION_MS = 200;
// Trackpad pinch arrives as a Ctrl+wheel event; plain wheel is left to scroll the page.
const isZoomModifier = (keys: string[]) => keys.includes('Control') || keys.includes('Meta');

interface Size {
  width: number;
  height: number;
}

/** Layout size (offsetWidth/Height), which CSS transforms on ancestors do not affect. */
function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setSize((prev) =>
        prev.width === el.offsetWidth && prev.height === el.offsetHeight
          ? prev
          : { width: el.offsetWidth, height: el.offsetHeight }
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

/**
 * Pinch/drag/zoom surface for a bracket. On phones it fills its container, opens
 * fitted to show the whole bracket and has floating zoom controls plus a minimap.
 * On desktop it opens fitted to width (never above 100%) at the matching height,
 * so it reads like a normal block; plain wheel scrolling still scrolls the page
 * and only Ctrl+wheel / trackpad pinch zooms.
 */
export const BracketCanvas = forwardRef<BracketCanvasHandle, BracketCanvasProps>(function BracketCanvas(
  { children, onScaleChange, className },
  ref
) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ReactZoomPanPinchRef | null>(null);
  const viewport = useElementSize(viewportRef);
  const content = useElementSize(contentRef);
  const [percent, setPercent] = useState(100);
  // Null until the first report, so a remounted canvas always re-syncs the parent's readout.
  const lastPercentRef = useRef<number | null>(null);
  // Once the user pans or zooms, data refreshes stop snapping the view back to fit.
  const userAdjustedRef = useRef(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const measured = viewport.width > 0 && content.width > 0 && content.height > 0;
  const fitScale = (() => {
    if (!measured) return 1;
    const byWidth = viewport.width / content.width;
    const scale = isMobile && viewport.height > 0 ? Math.min(byWidth, viewport.height / content.height) : byWidth;
    return Math.min(1, Math.max(MIN_SCALE, scale));
  })();

  const applyFit = useCallback(
    (animationTime: number) => {
      const api = apiRef.current;
      if (!api || !measured) return;
      const x = isMobile ? (viewport.width - content.width * fitScale) / 2 : 0;
      const y = isMobile ? Math.max(0, (viewport.height - content.height * fitScale) / 2) : 0;
      api.setTransform(x, y, fitScale, animationTime);
    },
    [measured, isMobile, viewport.width, viewport.height, content.width, content.height, fitScale]
  );

  useEffect(() => {
    if (!userAdjustedRef.current) applyFit(0);
  }, [applyFit]);

  const zoomAroundCenter = useCallback((scale: number) => {
    const api = apiRef.current;
    const wrapper = viewportRef.current;
    if (!api || !wrapper) return;
    userAdjustedRef.current = true;
    setHasInteracted(true);
    const rect = wrapper.getBoundingClientRect();
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    api.zoomToPoint(clamped, rect.left + rect.width / 2, rect.top + rect.height / 2, ANIMATION_MS);
  }, []);

  const fit = useCallback(() => {
    userAdjustedRef.current = false;
    applyFit(ANIMATION_MS);
  }, [applyFit]);

  useImperativeHandle(ref, () => ({ setScale: (p: number) => zoomAroundCenter(p / 100), fit }), [zoomAroundCenter, fit]);

  const handleTransform = useCallback(
    (_: ReactZoomPanPinchRef, state: { scale: number }) => {
      const next = Math.round(state.scale * 100);
      if (next === lastPercentRef.current) return;
      lastPercentRef.current = next;
      setPercent(next);
      onScaleChange?.(next);
    },
    [onScaleChange]
  );

  // A drag or pinch that ends over a match card must not also open it.
  const activePointersRef = useRef(new Set<number>());
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  // Releases are tracked on window: a drag can end outside the canvas.
  useEffect(() => {
    const active = activePointersRef.current;
    const release = (e: PointerEvent) => {
      if (!active.delete(e.pointerId) || active.size > 0) return;
      pointerStartRef.current = null;
      if (suppressClickRef.current) {
        userAdjustedRef.current = true;
        setHasInteracted(true);
      }
    };
    const reset = () => {
      active.clear();
      pointerStartRef.current = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const pointerHandlers = {
    onPointerDownCapture: (e: ReactPointerEvent) => {
      const active = activePointersRef.current;
      if (active.size === 0) {
        pointerStartRef.current = { x: e.clientX, y: e.clientY };
        suppressClickRef.current = false;
      } else {
        suppressClickRef.current = true;
      }
      active.add(e.pointerId);
    },
    onPointerMoveCapture: (e: ReactPointerEvent) => {
      const start = pointerStartRef.current;
      if (!start || suppressClickRef.current) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_CLICK_THRESHOLD_PX) {
        suppressClickRef.current = true;
      }
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };

  const desktopHeight = measured ? Math.ceil(content.height * fitScale) : undefined;
  const isZoomedIn = measured && percent > Math.round(fitScale * 100) + 2;

  return (
    <div
      ref={viewportRef}
      className={cn('relative overflow-hidden', !isMobile && !measured && 'min-h-64', className)}
      style={isMobile ? undefined : { height: desktopHeight }}
      {...pointerHandlers}
    >
      <TransformWrapper
        ref={apiRef}
        minScale={Math.min(MIN_SCALE, fitScale)}
        maxScale={MAX_SCALE}
        limitToBounds
        centerZoomedOut={isMobile}
        wheel={{ activationKeys: isZoomModifier, step: 0.003 }}
        doubleClick={{ disabled: !isMobile, mode: 'zoomIn', step: 0.6 }}
        onWheelStart={() => { userAdjustedRef.current = true; }}
        onPinchStart={() => {
          userAdjustedRef.current = true;
          setHasInteracted(true);
        }}
        onInit={(api) => handleTransform(api, api.state)}
        onTransform={handleTransform}
      >
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
          <div ref={contentRef} className="w-max p-4 md:p-6">
            {children}
          </div>
        </TransformComponent>

        {isMobile && (
          <>
            {!hasInteracted && (
              <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-board px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-white shadow-md">
                <Move className="size-4" aria-hidden="true" />
                Pinch to zoom · drag to move
              </div>
            )}
            {/* MiniMap sets its own inline position, so a wrapper places it. */}
            <div
              aria-hidden="true"
              className={cn(
                'absolute top-3 right-3 z-10 overflow-hidden rounded-lg border bg-card shadow-md transition-opacity',
                isZoomedIn ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <MiniMap width={120} height={80} borderColor="hsl(var(--foreground))">
                <div className="w-max p-4">{children}</div>
              </MiniMap>
            </div>
            <div
              role="group"
              aria-label="Zoom"
              className="absolute right-4 bottom-5 z-10 flex items-center gap-0.5 rounded-xl border bg-card p-1 shadow-lg"
            >
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => zoomAroundCenter((percent / 100) / BUTTON_ZOOM_FACTOR)}
                className="flex size-11 items-center justify-center rounded-lg hover:bg-muted"
              >
                <Minus className="size-[18px]" />
              </button>
              <span className="w-11 text-center font-score text-[17px] font-bold tabular-nums">{percent}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => zoomAroundCenter((percent / 100) * BUTTON_ZOOM_FACTOR)}
                className="flex size-11 items-center justify-center rounded-lg hover:bg-muted"
              >
                <Plus className="size-[18px]" />
              </button>
              <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />
              <button
                type="button"
                onClick={fit}
                className="flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold hover:bg-muted"
              >
                <Scan className="size-4" />
                Fit
              </button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
});
