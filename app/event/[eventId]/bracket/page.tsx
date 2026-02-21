'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Match } from 'brackets-model';
import { createClient } from '@/lib/supabase/client';
import { BracketView, MatchResultsDialog, PresentationOverlay } from '@/app/admin/event/[eventId]/bracket/components';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Presentation } from 'lucide-react';
import { useAutoScale } from '@/lib/hooks/use-auto-scale';

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

  const fetchBracket = useCallback(async () => {
    if (!eventId) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/public/event/${eventId}/bracket`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('Bracket not found. The event may not have started bracket play yet.');
        } else {
          const data = await response.json();
          throw new Error(data.error || 'Failed to load bracket');
        }
        return;
      }

      const data = await response.json();
      setBracketData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bracket');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (eventId) {
      fetchBracket();
    }
  }, [eventId, fetchBracket]);

  useEffect(() => {
    if (!eventId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`public-bracket-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bracket_match',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          fetchBracket();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, fetchBracket]);

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
          <Button onClick={fetchBracket} className="mt-4">
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
          onRefresh={fetchBracket}
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
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.back()}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-2xl font-bold">
            {bracketData.bracket.stage.name}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Zoom out"
              onClick={() => setScale(Math.max(25, scale - 10))}
              disabled={scale <= 25}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <input
              type="range"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              min={25}
              max={150}
              step={5}
              className="w-32 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setScale(Math.min(150, scale + 10))}
              disabled={scale >= 150}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground w-12 text-center">
              {scale}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setScale(100)}
              disabled={scale === 100}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchBracket}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={enterPresentationMode}
          >
            <Presentation className="mr-2 h-4 w-4" />
            Present
          </Button>
        </div>
      </div>

      <div className="overflow-auto">
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
