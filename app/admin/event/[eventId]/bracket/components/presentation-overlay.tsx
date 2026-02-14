'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, RefreshCw, Maximize, Minimize } from 'lucide-react';

interface PresentationOverlayProps {
  stageName: string;
  scale: number;
  isAutoScale: boolean;
  onToggleAutoScale: () => void;
  onRefresh: () => void;
  onExit: () => void;
  isRefreshing?: boolean;
  accessCode?: string;
}

export function PresentationOverlay({
  stageName,
  scale,
  isAutoScale,
  onToggleAutoScale,
  onRefresh,
  onExit,
  isRefreshing = false,
  accessCode,
}: PresentationOverlayProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <>
      {/* Hover detection zone at top of screen */}
      <div
        className="fixed top-0 left-0 right-0 h-16 z-50"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {/* Overlay toolbar */}
        <div
          className={`
            absolute top-0 left-0 right-0
            bg-background/95 backdrop-blur-sm border-b
            transition-transform duration-200 ease-in-out
            ${isVisible ? 'translate-y-0' : '-translate-y-full'}
          `}
        >
          <div className="flex items-center justify-between px-4 py-2">
            {/* Stage name and scale */}
            <div className="flex items-center gap-4">
              <span className="font-semibold text-lg">{stageName}</span>
              <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
                {Math.round(scale * 100)}%
                {isAutoScale && ' (auto)'}
              </span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleAutoScale}
                title={isAutoScale ? 'Switch to manual zoom' : 'Switch to auto-fit'}
              >
                {isAutoScale ? (
                  <Minimize className="h-4 w-4 mr-2" />
                ) : (
                  <Maximize className="h-4 w-4 mr-2" />
                )}
                {isAutoScale ? 'Manual' : 'Auto-fit'}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={onExit}
                className="h-8 w-8"
                title="Exit presentation mode (Esc)"
                aria-label="Exit presentation mode"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Score entry info in top right */}
      {accessCode && (
        <div className="fixed top-4 right-4 z-40 text-right">
          <div className="bg-background/80 backdrop-blur-sm rounded-lg px-4 py-3 border">
            <p className="text-sm text-muted-foreground">Submit scores at</p>
            <p className="font-mono font-semibold text-base">dg-putting-league.vercel.app/score</p>
            <p className="text-sm text-muted-foreground mt-1">Access Code</p>
            <p className="font-mono font-bold text-lg tracking-wider">{accessCode}</p>
          </div>
        </div>
      )}

      {/* Always visible exit hint in corner */}
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="secondary"
          size="sm"
          onClick={onExit}
          className="opacity-50 hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4 mr-2" />
          Exit (Esc)
        </Button>
      </div>
    </>
  );
}
