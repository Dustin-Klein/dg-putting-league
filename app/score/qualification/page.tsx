'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { ScoringBoard, ScoringFooter } from '@/app/score/components/scoring-wizard/scoring-board';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { ZoneBadge } from '@/components/zone-badge';

interface PlayerInfo {
  event_player_id: string;
  player_id: string;
  full_name: string;
  nickname: string | null;
  player_number: number | null;
  /** Handicap zone; null when the event has no handicaps. */
  zone?: number | null;
  putt_distance_ft?: number;
  frames_completed: number;
  total_frames_required: number;
  total_points: number;
  is_complete: boolean;
}

interface EventInfo {
  id: string;
  event_date: string;
  location: string | null;
  qualification_round_enabled: boolean;
  status: string;
}

export default function QualificationPage() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlayers = useCallback(async (code: string) => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load players');
      }

      const data = await response.json();

      if (data.mode !== 'qualification') {
        router.push('/score/matches');
        return;
      }

      setEvent(data.event);
      const fetchedPlayers = data.players || [];
      setPlayers(fetchedPlayers);

      // Clear any selected players that are now complete
      const completedIds = new Set(
        fetchedPlayers.filter((p: PlayerInfo) => p.is_complete).map((p: PlayerInfo) => p.event_player_id)
      );
      setSelectedPlayers((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if (!completedIds.has(id)) {
            next.add(id);
          }
        }
        return next;
      });

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load players');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const code = sessionStorage.getItem('scoring_access_code');
    if (!code) {
      router.push('/score');
      return;
    }
    setAccessCode(code);
    fetchPlayers(code);
  }, [router, fetchPlayers]);

  const handleTogglePlayer = (eventPlayerId: string) => {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(eventPlayerId)) {
        next.delete(eventPlayerId);
      } else {
        next.add(eventPlayerId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const incompletePlayers = players.filter((p) => !p.is_complete);
    if (selectedPlayers.size === incompletePlayers.length) {
      setSelectedPlayers(new Set());
    } else {
      setSelectedPlayers(new Set(incompletePlayers.map((p) => p.event_player_id)));
    }
  };

  const handleStartScoring = () => {
    if (selectedPlayers.size === 0) return;

    // Store selected players in session storage
    sessionStorage.setItem('qualification_selected_players', JSON.stringify(Array.from(selectedPlayers)));
    router.push('/score/qualification/scoring');
  };

  const handleBack = () => {
    sessionStorage.removeItem('scoring_access_code');
    router.push('/score');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading players...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={handleBack}>Back to Access Code</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sort players: incomplete first, then by name
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.is_complete !== b.is_complete) {
      return a.is_complete ? 1 : -1;
    }
    return a.full_name.localeCompare(b.full_name);
  });

  const incompletePlayers = players.filter((p) => !p.is_complete);
  const completedCount = players.filter((p) => p.is_complete).length;
  const totalPlayers = players.length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <ScoringBoard
        backLabel="Exit"
        onBack={handleBack}
        className="max-w-2xl pb-[18px] gap-3"
        meta={
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            aria-label="Refresh"
            onClick={() => accessCode && fetchPlayers(accessCode)}
          >
            <RefreshCw className="size-4" />
          </Button>
        }
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground">QUALIFICATION ROUND</span>
          <h1 className="font-score text-3xl leading-tight font-bold">Qualification Round</h1>
          <p className="text-sm text-muted-foreground">
            {[event?.location, event?.event_date && formatDisplayDate(event.event_date)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[13px] font-semibold">
            <span className="text-foreground/85">Progress</span>
            <span>{completedCount} / {totalPlayers} players complete</span>
          </div>
          <div
            role="progressbar"
            aria-label="Players complete"
            aria-valuemin={0}
            aria-valuemax={totalPlayers}
            aria-valuenow={completedCount}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{ width: `${(completedCount / Math.max(totalPlayers, 1)) * 100}%` }}
            />
          </div>
        </div>
      </ScoringBoard>

      <div className="flex-1 w-full max-w-2xl mx-auto px-4 py-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">Who&apos;s putting on your lane?</h2>
          {incompletePlayers.length > 0 && (
            <Button variant="ghost" className="h-9 px-2" onClick={handleSelectAll}>
              {selectedPlayers.size === incompletePlayers.length ? 'Deselect All' : 'Select All'}
            </Button>
          )}
        </div>

        {players.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No paid players found for qualification.
              <br />
              Players must be marked as paid to participate.
            </CardContent>
          </Card>
        ) : (
          <div className="bg-card rounded-2xl border overflow-hidden flex flex-col divide-y divide-muted">
            {sortedPlayers.map((player) => {
              const selected = selectedPlayers.has(player.event_player_id);
              return (
                <button
                  key={player.event_player_id}
                  type="button"
                  role="checkbox"
                  aria-checked={player.is_complete || selected}
                  aria-disabled={player.is_complete || undefined}
                  onClick={() => !player.is_complete && handleTogglePlayer(player.event_player_id)}
                  className={cn(
                    'flex min-h-[60px] w-full items-center gap-3 px-3.5 py-3 text-left transition-colors outline-none focus-visible:bg-muted',
                    player.is_complete ? 'cursor-not-allowed' : 'hover:bg-muted/60',
                    selected && 'bg-foreground/[0.06]'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-[26px] shrink-0 items-center justify-center rounded-lg border-2',
                      player.is_complete
                        ? 'border-transparent bg-success/15 text-success'
                        : selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input'
                    )}
                  >
                    {(player.is_complete || selected) && <Check className="size-4" strokeWidth={3} />}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={cn('truncate text-base font-semibold', player.is_complete && 'text-muted-foreground')}>
                      {player.full_name}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ZoneBadge zone={player.zone} distanceFt={player.putt_distance_ft} size="sm" />
                      {player.player_number && (
                        <span className="text-xs text-muted-foreground">#{player.player_number}</span>
                      )}
                    </span>
                  </span>

                  <span className="flex shrink-0 flex-col items-end">
                    <span className="font-score text-[22px] leading-none font-bold tabular-nums">
                      {player.total_points} pts
                    </span>
                    <span className={cn('text-xs font-semibold', player.is_complete ? 'text-success' : 'text-muted-foreground')}>
                      {player.is_complete
                        ? 'Done'
                        : `${player.frames_completed}/${player.total_frames_required} frames`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {players.length > 0 && (
        <ScoringFooter className="max-w-2xl pt-3">
          <Button
            className="w-full h-14 rounded-[14px] text-[17px]"
            onClick={handleStartScoring}
            disabled={selectedPlayers.size === 0}
          >
            {selectedPlayers.size === 0 ? (
              'Select the players on your lane'
            ) : (
              <>
                Score {selectedPlayers.size} Player{selectedPlayers.size !== 1 ? 's' : ''}
                <ArrowRight className="size-[18px]" />
              </>
            )}
          </Button>
        </ScoringFooter>
      )}
    </div>
  );
}
