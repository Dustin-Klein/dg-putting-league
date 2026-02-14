'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Match } from 'brackets-model';
import { Status } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import { createClient } from '@/lib/supabase/client';
import { BracketView, MatchScoringDialog, LaneManagement, AdvanceTeamDialog } from '../bracket/components';
import { PayoutsDisplay } from './payouts-display';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, Maximize2, Settings, Pencil, MapPin, DollarSign, Eraser, X } from 'lucide-react';
import Link from 'next/link';

interface MatchWithTeamInfo extends Match {
  team1?: Team;
  team2?: Team;
}

interface BracketSectionProps {
  eventId: string;
  isAdmin?: boolean;
}

export function BracketSection({ eventId, isAdmin = false }: BracketSectionProps) {
  const [bracketData, setBracketData] = useState<BracketWithTeams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchWithTeamInfo | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLaneDialogOpen, setIsLaneDialogOpen] = useState(false);
  const [isPayoutsDialogOpen, setIsPayoutsDialogOpen] = useState(false);
  const [isEditBracketMode, setIsEditBracketMode] = useState(false);
  const [advanceMatch, setAdvanceMatch] = useState<Match | null>(null);
  const [isAdvanceDialogOpen, setIsAdvanceDialogOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

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
      channel.unsubscribe();
    };
  }, [eventId, fetchBracket]);

  const handleMatchClick = (match: Match) => {
    if (!bracketData) return;

    const opp1 = match.opponent1 as { id: number | null } | null;
    const opp2 = match.opponent2 as { id: number | null } | null;

    if (
      isEditBracketMode &&
      (match.status === Status.Waiting || match.status === Status.Ready || match.status === Status.Locked) &&
      bracketData.eventStatus === 'bracket'
    ) {
      setAdvanceMatch(match);
      setIsAdvanceDialogOpen(true);
      return;
    }

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

  const handleClearPlacements = async () => {
    if (!confirm('Clear all bracket placements? This will empty every match slot. You can then manually place teams using the Advance Team dialog.')) return;

    try {
      setIsClearing(true);
      const response = await fetch(`/api/event/${eventId}/bracket/clear-placements`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to clear placements');
      }

      await fetchBracket();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clear placements');
    } finally {
      setIsClearing(false);
    }
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
        <div className="flex items-center gap-2">
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
            variant="outline"
            size="sm"
            asChild
          >
            <Link href={`/admin/event/${eventId}/bracket`}>
              <Maximize2 className="mr-2 h-4 w-4" />
              Full View
            </Link>
          </Button>
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsEditBracketMode(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Bracket
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsLaneDialogOpen(true)}>
                  <MapPin className="mr-2 h-4 w-4" />
                  Edit Lanes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsPayoutsDialogOpen(true)}>
                  <DollarSign className="mr-2 h-4 w-4" />
                  Edit Payouts
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleClearPlacements}
                  disabled={isClearing}
                  className="text-destructive focus:text-destructive"
                >
                  <Eraser className="mr-2 h-4 w-4" />
                  {isClearing ? 'Clearing...' : 'Clear Placements'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {isEditBracketMode && (
        <div className="flex items-center justify-between bg-amber-500/15 border border-amber-500/25 text-amber-700 dark:text-amber-400 rounded-lg px-4 py-2">
          <span className="text-sm font-medium">
            Edit Mode — Click matches to advance or remove teams
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200"
            onClick={() => setIsEditBracketMode(false)}
          >
            <X className="mr-1 h-4 w-4" />
            Exit Edit Mode
          </Button>
        </div>
      )}

      <BracketView
        data={bracketData}
        eventStatus={bracketData.eventStatus}
        onMatchClick={handleMatchClick}
        isEditMode={isEditBracketMode}
      />

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

      <AdvanceTeamDialog
        match={advanceMatch}
        eventId={eventId}
        open={isAdvanceDialogOpen}
        onOpenChange={setIsAdvanceDialogOpen}
        onAdvanceComplete={fetchBracket}
        participants={bracketData?.bracket.participants ?? []}
        participantTeamMap={bracketData?.participantTeamMap ?? {}}
      />

      <Dialog open={isLaneDialogOpen} onOpenChange={setIsLaneDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lane Management</DialogTitle>
          </DialogHeader>
          <LaneManagement eventId={eventId} />
        </DialogContent>
      </Dialog>

      <Dialog open={isPayoutsDialogOpen} onOpenChange={setIsPayoutsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payouts</DialogTitle>
          </DialogHeader>
          <PayoutsDisplay
            eventId={eventId}
            eventStatus={bracketData?.eventStatus ?? 'bracket'}
            isAdmin={true}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
