'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { Team } from '@/lib/types/team';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { PoolBadge } from '@/components/pool-badge';
import { sortBySlot } from '@/lib/utils/team-utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { formatPlacement } from '@/lib/utils/format-utils';
import { groupRole, stageFormat, type BracketFormat } from '@/lib/brackets/format';
import {
  decidedMatchesOf,
  placeDecidedMatchesDetailed,
  type DetailedPlacement,
  type PlacementOpponent,
} from '@/lib/brackets/placements';

interface ResultsDisplayProps {
  eventId: string;
  /** Shown beside the results table, e.g. the payouts panel. */
  aside?: React.ReactNode;
  /** Rendered after each team member's name, e.g. their handicap zone. */
  memberAccessory?: (eventPlayerId: string) => React.ReactNode;
}

interface TeamPlacement {
  place: number;
  team: Team;
  eliminatedIn: string;
}

function placementLabel(format: BracketFormat, placement: DetailedPlacement): string {
  const { decidedBy, won } = placement;
  const role = groupRole(format, decidedBy.groupNumber);
  if (role === 'grand_final') return won ? 'Grand Final Winner' : 'Grand Final';
  if (role === 'losers') return `Loser's Bracket Round ${decidedBy.roundNumber}`;
  if (role === 'winners') return `Winner's Bracket Round ${decidedBy.roundNumber}`;
  if (role === 'third_place') return won ? 'Third-Place Match Winner' : 'Third-Place Match';
  if (decidedBy.isLastRoundOfGroup) return won ? 'Final Winner' : 'Final';
  return `Round ${decidedBy.roundNumber}`;
}

function calculatePlacements(bracketData: BracketWithTeams | null): TeamPlacement[] {
  if (!bracketData) return [];

  const { bracket, participantTeamMap } = bracketData;
  const format = stageFormat(bracket.stage?.type);
  const participants = Object.entries(participantTeamMap).map(([id, team]) => ({ id: Number(id), team_id: team.id }));
  const decided = decidedMatchesOf({
    groups: bracket.groups.map((group) => ({ id: Number(group.id), number: group.number })),
    rounds: bracket.rounds.map((round) => ({ id: Number(round.id), group_id: Number(round.group_id), number: round.number })),
    matches: bracket.matches.map((match) => ({
      id: Number(match.id),
      round_id: Number(match.round_id),
      // Any recorded result places a team here, even before the match row is archived.
      status: 4,
      opponent1: match.opponent1 as PlacementOpponent | null,
      opponent2: match.opponent2 as PlacementOpponent | null,
    })),
    participants,
  });

  return placeDecidedMatchesDetailed('', format, decided).flatMap((placement) => {
    const team = participantTeamMap[
      Number(participants.find((participant) => participant.team_id === placement.teamId)?.id)
    ];
    return team ? [{ place: placement.placement, team, eliminatedIn: placementLabel(format, placement) }] : [];
  });
}

interface PayoutByPlace {
  [place: number]: number;
}

export function ResultsDisplay({ eventId, aside, memberAccessory }: ResultsDisplayProps) {
  const [bracketData, setBracketData] = useState<BracketWithTeams | null>(null);
  const [payoutsByPlace, setPayoutsByPlace] = useState<PayoutByPlace>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const [bracketResponse, payoutsResponse] = await Promise.all([
        fetch(`/api/event/${eventId}/bracket`),
        fetch(`/api/event/${eventId}/payouts`),
      ]);

      if (!bracketResponse.ok) {
        if (bracketResponse.status === 404) {
          setError('Bracket not found.');
        } else {
          const data = await bracketResponse.json();
          throw new Error(data.error || 'Failed to load results');
        }
        return;
      }

      const bracketJson = await bracketResponse.json();
      setBracketData(bracketJson);

      if (payoutsResponse.ok) {
        const payoutsJson = await payoutsResponse.json();
        const map: PayoutByPlace = {};
        for (const p of payoutsJson.payouts ?? []) {
          map[p.place] = p.amount;
        }
        setPayoutsByPlace(map);
      } else if (payoutsResponse.status !== 404) {
        const data = await payoutsResponse.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load payout data');
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const placements = useMemo(() => calculatePlacements(bracketData), [bracketData]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-36 rounded-2xl bg-muted"></div>)}
        </div>
        <div className="h-64 rounded-2xl bg-muted"></div>
      </div>
    );
  }

  if (error || !bracketData) {
    return (
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex-[999_1_600px] rounded-2xl border bg-card py-8 text-center">
          <p className="text-muted-foreground">{error || 'No results available'}</p>
        </div>
        {aside && <div className="min-w-0 flex-[1_1_320px]">{aside}</div>}
      </div>
    );
  }

  const hasPayouts = Object.keys(payoutsByPlace).length > 0;
  const payoutFor = (place: number) =>
    payoutsByPlace[place] != null ? `$${payoutsByPlace[place].toFixed(2)}` : null;

  return (
    <div className="flex flex-col gap-6">
      {placements.length > 0 && (
        <section aria-labelledby="podium-heading" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          <h2 id="podium-heading" className="sr-only">Podium</h2>
          {placements.slice(0, 3).map((placement) => {
            const first = placement.place === 1;
            const payout = payoutFor(placement.place);
            return (
              <div
                key={placement.team.id}
                className={cn(
                  'flex flex-col gap-1.5 rounded-2xl border px-5 py-[18px]',
                  first ? 'border-gold bg-gold/15' : 'bg-card'
                )}
              >
                <span className={cn('flex items-center gap-1.5 font-score text-xl leading-none font-bold', first ? 'text-gold' : 'text-muted-foreground')}>
                  {first && <Trophy className="size-4" aria-hidden="true" />}
                  {formatPlacement(placement.place)}
                </span>
                <span className="text-[17px] font-bold">{teamName(placement.team)}</span>
                <span className="text-sm text-muted-foreground">
                  Seed {placement.team.seed} · {placement.eliminatedIn}
                </span>
                {payout && (
                  <span className="mt-1 font-score text-[32px] leading-none font-bold tabular-nums">{payout}</span>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <section aria-labelledby="final-results-heading" className="min-w-0 flex-[999_1_600px] rounded-2xl border bg-card">
          <h2 id="final-results-heading" className="border-b px-5 py-4 text-lg font-bold">Final results</h2>
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20 pl-5">Place</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Eliminated in</TableHead>
                {hasPayouts && <TableHead className="pr-5 text-right">Payout</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {placements.map((placement) => {
                const members = sortBySlot(placement.team.team_members ?? []);
                const first = placement.place === 1;
                const payout = payoutFor(placement.place);

                return (
                  <TableRow key={placement.team.id} className="border-muted">
                    <TableCell className="py-3 pl-5">
                      <span
                        className={cn(
                          'inline-flex h-8 w-11 items-center justify-center rounded-lg font-score text-lg font-bold',
                          first ? 'bg-gold/15 text-gold' : 'bg-muted'
                        )}
                      >
                        {formatPlacement(placement.place)}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-col gap-0.5">
                        {members.map((member) => (
                          <div key={member.event_player_id} className="flex items-center gap-2 font-semibold">
                            <PoolBadge pool={member.event_player.pool} className="text-[11px]" />
                            {member.event_player.player.player_number ? (
                              <Link
                                href={`/player/${member.event_player.player.player_number}`}
                                className="hover:underline"
                              >
                                {member.event_player.player.full_name}
                              </Link>
                            ) : (
                              <span>{member.event_player.player.full_name}</span>
                            )}
                            {memberAccessory?.(member.event_player_id)}
                          </div>
                        ))}
                        <span className="text-xs text-muted-foreground">Seed {placement.team.seed}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{placement.eliminatedIn}</TableCell>
                    {hasPayouts && (
                      <TableCell
                        className={cn(
                          'pr-5 text-right font-score text-xl font-bold tabular-nums',
                          !payout && 'text-muted-foreground/60'
                        )}
                      >
                        {payout ?? '—'}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
        {aside && <div className="min-w-0 flex-[1_1_320px]">{aside}</div>}
      </div>
    </div>
  );
}

function teamName(team: Team): string {
  const names = sortBySlot(team.team_members ?? []).map((member) => member.event_player.player.full_name);
  return names.length > 0 ? names.join(' & ') : team.pool_combo || `Seed ${team.seed}`;
}
