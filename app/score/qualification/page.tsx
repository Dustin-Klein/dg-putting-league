'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RefreshCw, CheckCircle2, Users } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDisplayDate } from '@/lib/utils/date-utils';

interface PlayerInfo {
  event_player_id: string;
  player_id: string;
  full_name: string;
  nickname: string | null;
  player_number: number | null;
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
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Exit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => accessCode && fetchPlayers(accessCode)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Qualification Round</CardTitle>
            <CardDescription>
              {event?.location && `${event.location} - `}
              {event?.event_date && formatDisplayDate(event.event_date)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{completedCount} / {totalPlayers} players complete</span>
              </div>
              <Progress value={(completedCount / Math.max(totalPlayers, 1)) * 100} />
            </div>
          </CardContent>
        </Card>

        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Select players to score
          </h3>
          {incompletePlayers.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleSelectAll}>
              {selectedPlayers.size === incompletePlayers.length ? 'Deselect All' : 'Select All'}
            </Button>
          )}
        </div>

        {players.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No paid players found for qualification.
              <br />
              Players must be marked as paid to participate.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-2 mb-6">
              {sortedPlayers.map((player) => (
                <Card
                  key={player.event_player_id}
                  className={`cursor-pointer transition-colors ${
                    player.is_complete
                      ? 'opacity-60 cursor-not-allowed border-green-200'
                      : selectedPlayers.has(player.event_player_id)
                      ? 'border-primary ring-1 ring-primary'
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => !player.is_complete && handleTogglePlayer(player.event_player_id)}
                >
                  <CardContent className="py-3">
                    <div className="flex items-center gap-3">
                      {player.is_complete ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                      ) : (
                        <Checkbox
                          checked={selectedPlayers.has(player.event_player_id)}
                          onCheckedChange={() => handleTogglePlayer(player.event_player_id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{player.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {player.player_number ? `#${player.player_number}` : ''}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <Badge
                          variant={player.is_complete ? 'default' : 'secondary'}
                          className={player.is_complete ? 'bg-green-500' : ''}
                        >
                          {player.frames_completed}/{player.total_frames_required}
                        </Badge>
                        <div className="text-xs text-muted-foreground mt-1">
                          {player.total_points} pts
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Start Scoring Button */}
            {selectedPlayers.size > 0 && (
              <div className="sticky bottom-4">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={handleStartScoring}
                >
                  <Users className="mr-2 h-4 w-4" />
                  Score {selectedPlayers.size} Player{selectedPlayers.size !== 1 ? 's' : ''}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
