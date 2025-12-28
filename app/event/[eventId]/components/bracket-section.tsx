'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Match } from 'brackets-model';
import type { Team } from '@/app/event/[eventId]/types';
import { createClient } from '@/lib/supabase/client';
import { BracketView, MatchScoreDialog } from '../bracket/components';
import type { BracketWithTeams } from '../bracket/types';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface MatchWithTeamInfo extends Match {
  team1?: Team;
  team2?: Team;
}

interface BracketSectionProps {
  eventId: string;
}

export function BracketSection({ eventId }: BracketSectionProps) {
  const [bracketData, setBracketData] = useState<BracketWithTeams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchWithTeamInfo | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const fetchBracket = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/event/${eventId}/bracket`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('Bracket not found.');
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

  // Initial fetch
  useEffect(() => {
    fetchBracket();
  }, [fetchBracket]);

  // Set up realtime subscription
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`bracket-section-${eventId}`)
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

  const handleMatchClick = (match: Match) => {
    if (!bracketData) return;

    const opp1 = match.opponent1 as { id: number | null } | null;
    const opp2 = match.opponent2 as { id: number | null } | null;

    const team1 = opp1?.id
      ? bracketData.participantTeamMap[opp1.id]
      : undefined;
    const team2 = opp2?.id
      ? bracketData.participantTeamMap[opp2.id]
      : undefined;

    setSelectedMatch({ ...match, team1, team2 });
    setIsDialogOpen(true);
  };

  const handleScoreSubmit = () => {
    fetchBracket();
  };

  if (loading && !bracketData) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-48"></div>
        <div className="h-64 bg-muted rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={fetchBracket} className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (!bracketData) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No bracket data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          {bracketData.bracket.stage.name}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchBracket}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <BracketView
        data={bracketData}
        onMatchClick={handleMatchClick}
      />

      <MatchScoreDialog
        match={selectedMatch}
        team1={selectedMatch?.team1}
        team2={selectedMatch?.team2}
        eventId={eventId}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onScoreSubmit={handleScoreSubmit}
      />
    </div>
  );
}
