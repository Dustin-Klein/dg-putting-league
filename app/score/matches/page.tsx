'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, RefreshCw, LayoutGrid, MapPin } from 'lucide-react';
import Link from 'next/link';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { MatchStatus } from '@/lib/types/bracket';
import type { PublicMatchInfo, PublicPlayerInfo, ScoringLane } from '@/lib/types/scoring';
import { ZoneBadge } from '@/components/zone-badge';

interface EventInfo {
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  status: string;
}

function safeStorageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unavailable (quota exceeded, private mode, etc.)
  }
}

function safeStorageRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage unavailable
  }
}

export default function MatchesPage() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [matches, setMatches] = useState<PublicMatchInfo[]>([]);
  const [lanes, setLanes] = useState<ScoringLane[]>([]);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatches = useCallback(async (code: string) => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load matches');
      }

      const data = await response.json();
      setEvent(data.event);
      setMatches(data.matches);
      setLanes(data.lanes ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const code = safeStorageGet(sessionStorage, 'scoring_access_code');
    if (!code) {
      router.push('/score');
      return;
    }
    setAccessCode(code);

    const storedLane = safeStorageGet(localStorage, 'scoring_device_lane');
    if (storedLane) setSelectedLaneId(storedLane);

    fetchMatches(code);
  }, [router, fetchMatches]);

  // Clear a persisted selectedLaneId if it isn't present in the loaded lanes.
  // Prevents a stale localStorage value from filtering matches with no way to clear it.
  useEffect(() => {
    if (isLoading) return;
    if (selectedLaneId && !lanes.find(l => l.id === selectedLaneId)) {
      setSelectedLaneId(null);
      safeStorageRemove(localStorage, 'scoring_device_lane');
    }
  }, [lanes, isLoading, selectedLaneId]);

  // Auto-navigate when a match on the selected lane becomes active.
  // Skips navigation if we already auto-navigated to this match ID, so
  // returning via the back button doesn't immediately redirect again.
  useEffect(() => {
    if (!selectedLaneId || !event) return;
    const laneMatch = matches.find(
      m => m.lane_id === selectedLaneId &&
      (m.status === MatchStatus.Ready || m.status === MatchStatus.Running)
    );
    if (!laneMatch) return;

    const lastNavKey = 'scoring_last_autonav_match';
    const lastNavId = safeStorageGet(sessionStorage, lastNavKey);
    if (lastNavId === String(laneMatch.id)) return;

    safeStorageSet(sessionStorage, lastNavKey, String(laneMatch.id));
    router.push(`/score/match/${laneMatch.id}`);
  }, [selectedLaneId, matches, event, router]);

  const handleLaneSelect = (value: string) => {
    const laneId = value === 'all' ? null : value;
    setSelectedLaneId(laneId);
    if (laneId) {
      safeStorageSet(localStorage, 'scoring_device_lane', laneId);
    } else {
      safeStorageRemove(localStorage, 'scoring_device_lane');
    }
  };

  const handleSelectMatch = (matchId: number) => {
    router.push(`/score/match/${matchId}`);
  };

  const handleBack = () => {
    safeStorageRemove(sessionStorage, 'scoring_access_code');
    router.push('/score');
  };

  const displayedMatches = selectedLaneId
    ? matches.filter(m => m.lane_id === selectedLaneId)
    : matches;

  const selectedLane = lanes.find(l => l.id === selectedLaneId);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading matches...</div>
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

  return (
    <div className="min-h-screen bg-background">
      {/* Scoreboard band: dark in both themes, like the site header. */}
      <header className="bg-board border-b border-board dark:border-border">
        <div className="dark text-foreground max-w-2xl mx-auto px-4 pt-2 pb-[18px] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={handleBack} className="-ml-3 px-3 font-medium">
              <ArrowLeft className="size-5" />
              Exit
            </Button>
            <div className="flex items-center gap-1.5">
              {event && (
                <Button variant="outline" asChild className="h-10 px-3">
                  <Link href={`/event/${event.id}/bracket`}>
                    <LayoutGrid className="size-4" />
                    Bracket
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                className="size-10"
                aria-label="Refresh"
                onClick={() => accessCode && fetchMatches(accessCode)}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <h1 className="font-score text-3xl leading-tight font-bold">Matches</h1>
            <p className="text-sm text-muted-foreground">
              {[event?.location, event?.event_date && formatDisplayDate(event.event_date)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          {lanes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="device-lane" className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground/85">
                <MapPin className="size-3.5" aria-hidden="true" />
                This device scores
              </label>
              <Select
                value={selectedLaneId ?? 'all'}
                onValueChange={handleLaneSelect}
              >
                <SelectTrigger id="device-lane" className="w-full data-[size=default]:h-12 rounded-xl text-base font-semibold">
                  <SelectValue placeholder="All lanes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All lanes</SelectItem>
                  {lanes.map(lane => (
                    <SelectItem key={lane.id} value={lane.id}>
                      {lane.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-4 flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">
          {selectedLane ? `Matches on ${selectedLane.label}` : 'Matches on the lanes'}
        </h2>

        {displayedMatches.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              {selectedLane ? (
                <>
                  Waiting for match on {selectedLane.label}...
                  <br />
                  The page will navigate automatically when a match is assigned.
                </>
              ) : (
                <>
                  No matches available for scoring right now.
                  <br />
                  Check back when matches are ready to play.
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          displayedMatches.map((match) => {
            const running = match.status === MatchStatus.Running;
            return (
              <div
                key={match.id}
                data-state={running ? 'running' : 'ready'}
                className={cn(
                  'bg-card rounded-2xl border p-3.5 flex flex-col gap-3 cursor-pointer transition-colors',
                  running ? 'border-success ring-[0.5px] ring-success' : 'hover:border-input'
                )}
                onClick={() => handleSelectMatch(match.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-score text-base font-bold tracking-[0.04em] text-muted-foreground">
                    M{match.number}
                  </span>
                  <StatusBadge tone={running ? 'success' : 'warning'}>
                    {match.lane_label && `${match.lane_label} · `}
                    {running ? 'In Progress' : 'Ready'}
                  </StatusBadge>
                </div>

                <TeamRow team={match.team_one} score={match.team_one_score} side="one" showScore={running} />
                <TeamRow team={match.team_two} score={match.team_two_score} side="two" showScore={running} />

                <Button className="h-[50px] rounded-xl">
                  {running ? 'Continue scoring' : 'Score this match'}
                </Button>
              </div>
            );
          })
        )}

        {lanes.length > 0 && (
          <p className="mt-1 text-center text-[13px] text-muted-foreground">
            {selectedLane
              ? `Showing matches for ${selectedLane.label}. Its next match opens automatically.`
              : 'Pick a lane above and its next match opens automatically.'}
          </p>
        )}
      </div>
    </div>
  );
}

function TeamRow({
  team,
  score,
  side,
  showScore,
}: {
  team: PublicMatchInfo['team_one'];
  score: number;
  side: 'one' | 'two';
  showScore: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn('w-[5px] self-stretch rounded-[3px]', side === 'one' ? 'bg-team-1' : 'bg-team-2')}
      />
      <span className="w-6 shrink-0 font-score text-sm font-semibold text-muted-foreground tabular-nums">
        #{team.seed}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold leading-snug">
          {team.players.map(p => p.full_name).join(' & ')}
        </div>
        <div className="text-xs text-muted-foreground">{team.pool_combo}</div>
        <TeamZoneBadges players={team.players} />
      </div>
      <span className="font-score text-[28px] leading-none font-bold tabular-nums">
        {showScore ? score : ''}
      </span>
    </div>
  );
}

/** Each player's zone on a match card; nothing for an event without handicaps. */
function TeamZoneBadges({ players }: { players: PublicPlayerInfo[] }) {
  if (!players.some((player) => player.zone !== null)) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {players.map((player) => (
        <ZoneBadge
          key={player.event_player_id}
          zone={player.zone}
          distanceFt={player.putt_distance_ft}
          size="sm"
        />
      ))}
    </div>
  );
}
