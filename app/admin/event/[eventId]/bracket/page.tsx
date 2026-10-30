'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Match } from 'brackets-model';
import { Status } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import { createClient } from '@/lib/supabase/client';
import { BracketLegend, BracketToolbar, BracketView, MatchScoringDialog, PresentationOverlay } from './components';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useAutoScale } from '@/lib/hooks/use-auto-scale';
import { useCoalescedRefresh } from '@/lib/hooks/use-coalesced-refresh';

interface MatchWithTeamInfo extends Match {
  team1?: Team;
  team2?: Team;
}

export default function BracketPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const router = useRouter();
  const [eventId, setEventId] = useState<string | null>(null);
  const [bracketData, setBracketData] = useState<BracketWithTeams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchWithTeamInfo | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [scale, setScale] = useState(100);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isAutoScaleEnabled, setIsAutoScaleEnabled] = useState(true);
  const [isMeasuring, setIsMeasuring] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { autoScale, recalculate } = useAutoScale(containerRef, contentRef);

  // Resolve params
  useEffect(() => {
    params.then((p) => setEventId(p.eventId));
  }, [params]);

  // Fetch bracket data
  const fetchBracket = useCallback(async (signal: AbortSignal) => {
    if (!eventId) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/event/${eventId}/bracket`, { signal });

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

  // Initial fetch
  useEffect(() => {
    if (eventId) {
      bracketRefresh.refresh();
    }
  }, [eventId, bracketRefresh]);

  // Set up realtime subscription
  useEffect(() => {
    if (!eventId) return;

    const supabase = createClient();

    // Subscribe to bracket_match changes
    const channel = supabase
      .channel(`bracket-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'putting_league',
          table: 'bracket_match',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          // Refetch bracket data when a match changes
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

  // Handle ESC key to exit presentation mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPresentationMode) {
        setIsPresentationMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresentationMode]);

  // Handle measuring phase - render at scale 1, measure, then apply scale
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

  // Recalculate scale when bracket data changes in presentation mode
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

  const enterPresentationMode = () => {
    setIsMeasuring(true);
    setIsPresentationMode(true);
    setIsAutoScaleEnabled(true);
  };

  const exitPresentationMode = () => {
    setIsPresentationMode(false);
  };

  const handleMatchClick = (match: Match) => {
    if (!bracketData) return;

    const opp1 = match.opponent1 as { id: number | null } | null;
    const opp2 = match.opponent2 as { id: number | null } | null;

    const team1 = bracketData.participantTeamMap[opp1?.id ?? -1];
    const team2 = bracketData.participantTeamMap[opp2?.id ?? -1];

    setSelectedMatch({ ...match, team1, team2 });
    setIsDialogOpen(true);
  };

  const handleScoreSubmit = () => {
    bracketRefresh.refresh();
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

  // Use scale 1 during measuring phase to get accurate dimensions
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
          accessCode={bracketData.accessCode}
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
          <MatchScoringDialog
            match={selectedMatch}
            team1={selectedMatch?.team1}
            team2={selectedMatch?.team2}
            eventId={eventId}
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            onScoreSubmit={handleScoreSubmit}
            isCorrectionMode={
              bracketData?.eventStatus === 'bracket' &&
              selectedMatch !== null &&
              (selectedMatch.status === Status.Completed || selectedMatch.status === Status.Archived)
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 pb-12 md:px-6">
      <BracketToolbar
        title={bracketData.bracket.stage.name}
        scale={scale}
        onScaleChange={setScale}
        onBack={() => router.back()}
        onRefresh={bracketRefresh.refresh}
        isRefreshing={loading}
        onPresent={enterPresentationMode}
      />

      <BracketLegend />

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
        <MatchScoringDialog
          match={selectedMatch}
          team1={selectedMatch?.team1}
          team2={selectedMatch?.team2}
          eventId={eventId}
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onScoreSubmit={handleScoreSubmit}
          isCorrectionMode={
            bracketData?.eventStatus === 'bracket' &&
            selectedMatch !== null &&
            (selectedMatch.status === Status.Completed || selectedMatch.status === Status.Archived)
          }
        />
      )}
    </div>
  );
}
