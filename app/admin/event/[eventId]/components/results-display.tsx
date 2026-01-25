'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { Match } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trophy, Medal, Award } from 'lucide-react';

interface ResultsDisplayProps {
  eventId: string;
}

interface TeamPlacement {
  place: number;
  team: Team;
  eliminatedIn: string;
}

function calculatePlacements(bracketData: BracketWithTeams | null): TeamPlacement[] {
  if (!bracketData) return [];

  const { bracket, participantTeamMap } = bracketData;
  const placements: TeamPlacement[] = [];
  const placedTeamIds = new Set<string>();

  // Helper to get team from participant ID
  const getTeam = (participantId: number | null): Team | undefined => {
    if (participantId === null) return undefined;
    return participantTeamMap[participantId];
  };

  // Helper to check if match has a result
  const hasResult = (match: Match): boolean => {
    const opp1 = match.opponent1 as { id: number | null; result?: string } | null;
    const opp2 = match.opponent2 as { id: number | null; result?: string } | null;
    return opp1?.result === 'win' || opp2?.result === 'win';
  };

  // Helper to get winner/loser of a match
  const getMatchResult = (match: Match): { winner?: Team; loser?: Team } => {
    const opp1 = match.opponent1 as { id: number | null; result?: string } | null;
    const opp2 = match.opponent2 as { id: number | null; result?: string } | null;

    if (opp1?.result === 'win') {
      return {
        winner: getTeam(opp1.id),
        loser: getTeam(opp2?.id ?? null),
      };
    } else if (opp2?.result === 'win') {
      return {
        winner: getTeam(opp2.id),
        loser: getTeam(opp1?.id ?? null),
      };
    }
    return {};
  };

  // Get groups
  const grandFinalGroup = bracket.groups.find((g) => g.number === 3);
  const losersGroup = bracket.groups.find((g) => g.number === 2);
  const winnersGroup = bracket.groups.find((g) => g.number === 1);

  // 1st and 2nd: From Grand Final
  if (grandFinalGroup) {
    const grandFinalRounds = bracket.rounds
      .filter((r) => r.group_id === grandFinalGroup.id)
      .sort((a, b) => b.number - a.number); // Latest round first

    for (const round of grandFinalRounds) {
      const matches = bracket.matches
        .filter((m) => m.round_id === round.id && hasResult(m))
        .sort((a, b) => b.number - a.number);

      for (const match of matches) {
        const { winner, loser } = getMatchResult(match);

        if (winner && !placedTeamIds.has(winner.id)) {
          placements.push({
            place: placements.length + 1,
            team: winner,
            eliminatedIn: 'Grand Final Winner',
          });
          placedTeamIds.add(winner.id);
        }

        if (loser && !placedTeamIds.has(loser.id)) {
          placements.push({
            place: placements.length + 1,
            team: loser,
            eliminatedIn: 'Grand Final',
          });
          placedTeamIds.add(loser.id);
        }
      }
    }
  }

  // 3rd and beyond: From Loser's Bracket (latest rounds first)
  if (losersGroup) {
    const losersRounds = bracket.rounds
      .filter((r) => r.group_id === losersGroup.id)
      .sort((a, b) => b.number - a.number);

    for (const round of losersRounds) {
      const matches = bracket.matches
        .filter((m) => m.round_id === round.id && hasResult(m))
        .sort((a, b) => a.number - b.number);

      const losersThisRound: Team[] = [];

      for (const match of matches) {
        const { loser } = getMatchResult(match);
        if (loser && !placedTeamIds.has(loser.id)) {
          losersThisRound.push(loser);
          placedTeamIds.add(loser.id);
        }
      }

      // Add all losers from this round at the same placement level
      for (const team of losersThisRound) {
        placements.push({
          place: placements.length + 1,
          team,
          eliminatedIn: `Loser's Bracket Round ${round.number}`,
        });
      }
    }
  }

  // Remaining: From Winner's Bracket (teams eliminated to loser's bracket, latest first)
  if (winnersGroup) {
    const winnersRounds = bracket.rounds
      .filter((r) => r.group_id === winnersGroup.id)
      .sort((a, b) => b.number - a.number);

    for (const round of winnersRounds) {
      const matches = bracket.matches
        .filter((m) => m.round_id === round.id && hasResult(m))
        .sort((a, b) => a.number - b.number);

      const losersThisRound: Team[] = [];

      for (const match of matches) {
        const { loser } = getMatchResult(match);
        if (loser && !placedTeamIds.has(loser.id)) {
          losersThisRound.push(loser);
          placedTeamIds.add(loser.id);
        }
      }

      for (const team of losersThisRound) {
        placements.push({
          place: placements.length + 1,
          team,
          eliminatedIn: `Winner's Bracket Round ${round.number}`,
        });
      }
    }
  }

  return placements;
}

export function ResultsDisplay({ eventId }: ResultsDisplayProps) {
  const [bracketData, setBracketData] = useState<BracketWithTeams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBracket = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/event/${eventId}/bracket`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('Bracket not found.');
        } else {
          const data = await response.json();
          throw new Error(data.error || 'Failed to load results');
        }
        return;
      }

      const data = await response.json();
      setBracketData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchBracket();
  }, [fetchBracket]);

  const placements = useMemo(() => calculatePlacements(bracketData), [bracketData]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-48"></div>
        <div className="h-64 bg-muted rounded"></div>
      </div>
    );
  }

  if (error || !bracketData) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{error || 'No results available'}</p>
      </div>
    );
  }

  const getPlaceIcon = (place: number) => {
    switch (place) {
      case 1:
        return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Award className="h-5 w-5 text-amber-600" />;
      default:
        return null;
    }
  };

  const getPlaceBadgeVariant = (place: number): "default" | "secondary" | "outline" => {
    if (place === 1) return "default";
    if (place <= 3) return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-6 w-6" />
        <h2 className="text-2xl font-bold">Final Results</h2>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Place</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Players</TableHead>
              <TableHead>Eliminated In</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {placements.map((placement) => {
              const poolAMember = placement.team.team_members?.find(
                (m) => m.role === 'A_pool'
              );
              const poolBMember = placement.team.team_members?.find(
                (m) => m.role === 'B_pool'
              );

              return (
                <TableRow key={placement.team.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getPlaceIcon(placement.place)}
                      <Badge variant={getPlaceBadgeVariant(placement.place)}>
                        {placement.place === 1
                          ? '1st'
                          : placement.place === 2
                          ? '2nd'
                          : placement.place === 3
                          ? '3rd'
                          : `${placement.place}th`}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">Seed #{placement.team.seed}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {poolAMember && (
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-xs">A</Badge>
                          {poolAMember.event_player.player.player_number ? (
                            <Link
                              href={`/player/${poolAMember.event_player.player.player_number}`}
                              className="hover:underline"
                            >
                              {poolAMember.event_player.player.full_name}
                            </Link>
                          ) : (
                            <span>{poolAMember.event_player.player.full_name}</span>
                          )}
                        </div>
                      )}
                      {poolBMember && (
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-xs bg-blue-500">B</Badge>
                          {poolBMember.event_player.player.player_number ? (
                            <Link
                              href={`/player/${poolBMember.event_player.player.player_number}`}
                              className="hover:underline"
                            >
                              {poolBMember.event_player.player.full_name}
                            </Link>
                          ) : (
                            <span>{poolBMember.event_player.player.full_name}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {placement.eliminatedIn}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
