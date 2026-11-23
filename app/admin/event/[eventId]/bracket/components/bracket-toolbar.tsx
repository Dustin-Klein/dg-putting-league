'use client';

import Link from 'next/link';
import { BarChart3, ChevronLeft, Presentation, RefreshCw, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BracketToolbarProps {
  title: string;
  scale: number;
  onScaleChange: (scale: number) => void;
  onBack: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPresent: () => void;
  /** Link to the event's public stats report. */
  statsHref?: string;
}

const MIN_SCALE = 25;
const MAX_SCALE = 150;

/** Back, title, zoom, refresh and present controls above a bracket (BracketPage.dc.html). */
export function BracketToolbar({
  title,
  scale,
  onScaleChange,
  onBack,
  onRefresh,
  isRefreshing,
  onPresent,
  statsHref,
}: BracketToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 md:gap-4">
      <Button variant="outline" size="icon" aria-label="Back" onClick={onBack}>
        <ChevronLeft className="size-[18px]" />
      </Button>
      <h1 className="mr-auto min-w-0 font-score text-[28px] leading-none font-bold md:text-4xl">{title}</h1>
      {/* Phones get floating zoom controls on the bracket itself. */}
      <div role="group" aria-label="Zoom" className="hidden h-11 items-center md:flex gap-0.5 rounded-[10px] border bg-card px-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => onScaleChange(Math.max(MIN_SCALE, scale - 10))}
          disabled={scale <= MIN_SCALE}
        >
          <ZoomOut className="size-4" />
        </Button>
        <input
          type="range"
          aria-label="Zoom level"
          value={scale}
          onChange={(e) => onScaleChange(Number(e.target.value))}
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={5}
          className="hidden w-24 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary sm:block"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => onScaleChange(Math.min(MAX_SCALE, scale + 10))}
          disabled={scale >= MAX_SCALE}
        >
          <ZoomIn className="size-4" />
        </Button>
        <span className="w-[52px] text-center font-score text-lg font-bold tabular-nums">{scale}%</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reset zoom"
          onClick={() => onScaleChange(100)}
          disabled={scale === 100}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
      <Button variant="outline" onClick={onRefresh} disabled={isRefreshing} aria-label="Refresh" className="max-md:size-11 max-md:px-0">
        <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        <span className="max-md:sr-only">Refresh</span>
      </Button>
      {statsHref && (
        <Button variant="outline" asChild className="max-md:size-11 max-md:px-0">
          <Link href={statsHref} aria-label="Stats">
            <BarChart3 className="size-4" />
            <span className="max-md:sr-only">Stats</span>
          </Link>
        </Button>
      )}
      <Button onClick={onPresent} className="max-md:hidden">
        <Presentation className="size-4" />
        Present on TV
      </Button>
    </div>
  );
}
