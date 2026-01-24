import { useState, useCallback, useEffect, type RefObject } from 'react';

interface UseAutoScaleOptions {
  padding?: number;
  minScale?: number;
  maxScale?: number;
}

interface UseAutoScaleReturn {
  autoScale: number;
  recalculate: () => void;
}

export function useAutoScale(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: UseAutoScaleOptions = {}
): UseAutoScaleReturn {
  const { padding = 32, minScale = 0.1, maxScale = 1 } = options;
  const [autoScale, setAutoScale] = useState(1);

  const recalculate = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;

    if (!container || !content) {
      return;
    }

    const containerWidth = container.clientWidth - padding * 2;
    const containerHeight = container.clientHeight - padding * 2;

    // scrollWidth/scrollHeight give intrinsic content size, unaffected by transforms
    const contentWidth = content.scrollWidth;
    const contentHeight = content.scrollHeight;

    if (contentWidth === 0 || contentHeight === 0) {
      return;
    }

    // Calculate scale needed to fit both dimensions
    const scaleX = containerWidth / contentWidth;
    const scaleY = containerHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY);

    // Clamp to min/max bounds
    const clampedScale = Math.min(Math.max(scale, minScale), maxScale);
    setAutoScale(clampedScale);
  }, [containerRef, contentRef, padding, minScale, maxScale]);

  useEffect(() => {
    const handleResize = () => {
      recalculate();
    };

    window.addEventListener('resize', handleResize);
    recalculate();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [recalculate]);

  return { autoScale, recalculate };
}
