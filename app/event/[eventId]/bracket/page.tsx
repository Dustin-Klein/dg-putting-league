'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Match } from 'brackets-model';
import { createClient } from '@/lib/supabase/client';
import { BracketLegend, BracketView, MatchResultsDialog, PresentationOverlay } from '@/app/admin/event/[eventId]/bracket/components';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Presentation } from 'lucide-react';
import { useAutoScale } from '@/lib/hooks/use-auto-scale';
import { useCoalescedRefresh } from '@/lib/hooks/use-coalesced-refresh';

export default function PublicBracketPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const router = useRouter();
  const [eventId, setEventId] = useState<string | null>(null);
  const [bracketData, setBracketData] = useState<BracketWithTeams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [scale, setScale] = useState(100);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isAutoScaleEnabled, setIsAutoScaleEnabled] = useState(true);
  const [isMeasuring, setIsMeasuring] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { autoScale, recalculate } = useAutoScale(containerRef, contentRef);

  useEffect(() => {
    params.then((p) => setEventId(p.eventId));
  }, [params]);

  const fetchBracket = useCallback(async (signal: AbortSignal) => {
    if (!eventId) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/public/event/${eventId}/bracket`, { signal });

      if (!response.ok) {
        if (response.status === 404) {
          if (!signal.aborted) setError('Bracket not found. The event may not have started bracket play yet.');
        } else {
          const data = await response.json();
          throw new Error(data.error || 'Failed to load bracket');
        }
        return;
      }

      const data = await response.json();
      if (signal.aborted) return;
      setBracketData(data);
      setError(null);
    } catch (err) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load bracket');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [eventId]);
  const bracketRefresh = useCoalescedRefresh(fetchBracket, eventId);

  useEffect(() => {
    if (eventId) {
      bracketRefresh.refresh();
    }
  }, [eventId, bracketRefresh]);

  useEffect(() => {
    if (!eventId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`public-bracket-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'putting_league',
          table: 'bracket_match',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          bracketRefresh.request();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'putting_league',
          table: 'lanes',
          filter: `event_id=eq.${eventId}`,
        },
        () => { bracketRefresh.request(); }
      )
      // Realtime DELETE events cannot be filtered by event_id.
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'putting_league', table: 'lanes' },
        () => { bracketRefresh.request(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, bracketRefresh]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPresentationMode) {
        setIsPresentationMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresentationMode]);

  useEffect(() => {
    if (isMeasuring && isPresentationMode && bracketData) {
      let innerRaf: number;
      const outerRaf = requestAnimationFrame(() => {
        innerRaf = requestAnimationFrame(() => {
          recalculate();
          setIsMeasuring(false);
        });
      });
      return () => {
        cancelAnimationFrame(outerRaf);
        cancelAnimationFrame(innerRaf);
      };
    }
  }, [isMeasuring, isPresentationMode, bracketData, recalculate]);

  const prevBracketDataRef = useRef(bracketData);
  useEffect(() => {
    if (isPresentationMode && !isMeasuring && bracketData !== prevBracketDataRef.current) {
      prevBracketDataRef.current = bracketData;
      const rafId = requestAnimationFrame(() => {
        recalculate();
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [bracketData, isPresentationMode, isMeasuring, recalculate]);

  const handleMatchClick = (match: Match) => {
    setSelectedMatch(match);
    setIsDialogOpen(true);
  };

  const enterPresentationMode = () => {
    setIsMeasuring(true);
    setIsPresentationMode(true);
    setIsAutoScaleEnabled(true);
  };

  const exitPresentationMode = () => {
    setIsPresentationMode(false);
  };

  if (loading && !bracketData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">{error}</p>
          <Button onClick={bracketRefresh.refresh} className="mt-4">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!bracketData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">No bracket data available</p>
        </div>
      </div>
    );
  }

  const effectiveScale = isMeasuring ? 1 : (isAutoScaleEnabled ? autoScale : scale / 100);

  if (isPresentationMode) {
    return (
      <div className="fixed inset-0 z-40 bg-background">
        <PresentationOverlay
          stageName={bracketData.bracket.stage.name}
          scale={effectiveScale}
          isAutoScale={isAutoScaleEnabled}
          onToggleAutoScale={() => setIsAutoScaleEnabled(!isAutoScaleEnabled)}
          onRefresh={bracketRefresh.refresh}
          onExit={exitPresentationMode}
          isRefreshing={loading}
        />
        <div
          ref={containerRef}
          className="w-full h-full overflow-hidden flex items-center justify-center"
        >
          <div
            ref={contentRef}
            style={{
              transform: `scale(${effectiveScale})`,
              transformOrigin: 'center center',
              visibility: isMeasuring ? 'hidden' : 'visible',
            }}
          >
            <BracketView
              data={bracketData}
              eventStatus={bracketData.eventStatus}
              onMatchClick={handleMatchClick}
              compact
            />
          </div>
        </div>
        {eventId && (
          <MatchResultsDialog
            match={selectedMatch}
            eventId={eventId}
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 pb-12 md:px-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          aria-label="Back"
          onClick={() => router.back()}
        >
          <ChevronLeft className="size-[18px]" />
        </Button>
        <h1 className="mr-auto font-score text-4xl leading-none font-bold">
          {bracketData.bracket.stage.name}
        </h1>
        <div role="group" aria-label="Zoom" className="flex h-11 items-center gap-0.5 rounded-[10px] border bg-card px-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => setScale(Math.max(25, scale - 10))}
            disabled={scale <= 25}
          >
            <ZoomOut className="size-4" />
          </Button>
          <input
            type="range"
            aria-label="Zoom level"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            min={25}
            max={150}
            step={5}
            className="hidden w-24 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary sm:block"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => setScale(Math.min(150, scale + 10))}
            disabled={scale >= 150}
          >
            <ZoomIn className="size-4" />
          </Button>
          <span className="w-[52px] text-center font-score text-lg font-bold tabular-nums">
            {scale}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reset zoom"
            onClick={() => setScale(100)}
            disabled={scale === 100}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          onClick={bracketRefresh.refresh}
          disabled={loading}
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button onClick={enterPresentationMode}>
          <Presentation className="size-4" />
          Present on TV
        </Button>
      </div>

      <BracketLegend showAdminEdits={false} />

      <div className="overflow-auto rounded-[18px] border bg-card p-6">
        <div
          style={{
            transform: `scale(${scale / 100})`,
            transformOrigin: 'top left',
          }}
        >
          <BracketView
            data={bracketData}
            eventStatus={bracketData.eventStatus}
            onMatchClick={handleMatchClick}
          />
        </div>
      </div>

      {eventId && (
        <MatchResultsDialog
          match={selectedMatch}
          eventId={eventId}
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
        />
      )}
    </div>
  );
}
