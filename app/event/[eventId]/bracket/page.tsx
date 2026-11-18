'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Match } from 'brackets-model';
import { createClient } from '@/lib/supabase/client';
import { BracketCanvas, BracketLegend, BracketToolbar, BracketView, HideFinishedToggle, MatchResultsDialog, PresentationOverlay, useHideFinished, type BracketCanvasHandle } from '@/app/admin/event/[eventId]/bracket/components';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw } from 'lucide-react';
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
  const canvasRef = useRef<BracketCanvasHandle>(null);
  const [hideFinished, setHideFinished] = useHideFinished();
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

  // Hiding finished matches changes the bracket's size, so the TV fit must be redone.
  useEffect(() => {
    if (!isPresentationMode || isMeasuring) return;
    const rafId = requestAnimationFrame(() => recalculate());
    return () => cancelAnimationFrame(rafId);
  }, [hideFinished, isPresentationMode, isMeasuring, recalculate]);

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
          hideFinished={hideFinished}
          onToggleHideFinished={() => setHideFinished((prev) => !prev)}
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
              readOnly
              compact
              hideFinished={hideFinished}
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
    <div className="mx-auto flex h-[calc(100dvh-65px)] max-w-[1200px] flex-col gap-3 px-4 pt-4 md:h-auto md:gap-5 md:px-6 md:pt-6 md:pb-12">
      <BracketToolbar
        title={bracketData.bracket.stage.name}
        scale={scale}
        onScaleChange={(percent) => canvasRef.current?.setScale(percent)}
        onBack={() => router.back()}
        onRefresh={bracketRefresh.refresh}
        isRefreshing={loading}
        onPresent={enterPresentationMode}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <BracketLegend showAdminEdits={false} />
        <HideFinishedToggle hideFinished={hideFinished} onToggle={() => setHideFinished((prev) => !prev)} />
      </div>

      <div className="-mx-4 min-h-0 flex-1 overflow-hidden border-t bg-card md:mx-0 md:flex-none md:rounded-[18px] md:border">
        <BracketCanvas ref={canvasRef} onScaleChange={setScale} className="h-full">
          <BracketView
            data={bracketData}
            eventStatus={bracketData.eventStatus}
            onMatchClick={handleMatchClick}
            readOnly
            hideFinished={hideFinished}
          />
        </BracketCanvas>
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
