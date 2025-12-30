'use client';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EventWithDetails } from '@/lib/types/event';
import { Team } from '@/lib/types/team';
import { Trophy, Users } from 'lucide-react';

interface TeamDisplayProps {
  event: EventWithDetails;
  isAdmin: boolean;
}

export function TeamDisplay({ event, isAdmin }: TeamDisplayProps) {
  const teams = event.teams || [];

  if (teams.length === 0) {
    return (
      <div className="text-center py-12">
        <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground mb-2">No Teams Generated</h3>
        <p className="text-sm text-muted-foreground">
          Teams will be generated when the event status changes to bracket play.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="h-6 w-6" />
          Teams
        </h2>
        <Badge variant="secondary">
          {teams.length} teams
        </Badge>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Seed</TableHead>
              <TableHead>Team Members</TableHead>
              <TableHead>Pool Assignment</TableHead>
              <TableHead>Combined Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => {
              const poolAMember = team.team_members.find(member => member.role === 'A_pool');
              const poolBMember = team.team_members.find(member => member.role === 'B_pool');

              return (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">
                    <Badge variant="outline">#{team.seed}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {poolAMember && (
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-xs">A</Badge>
                          <span className="font-medium">
                            {poolAMember.event_player.player.full_name}
                          </span>
                          {poolAMember.event_player.player.player_number && (
                            <Badge variant="secondary" className="text-xs">
                              #{poolAMember.event_player.player.player_number}
                            </Badge>
                          )}
                        </div>
                      )}
                      {poolBMember && (
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-xs bg-blue-500">B</Badge>
                          <span className="font-medium">
                            {poolBMember.event_player.player.full_name}
                          </span>
                          {poolBMember.event_player.player.player_number && (
                            <Badge variant="secondary" className="text-xs">
                              #{poolBMember.event_player.player.player_number}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {poolAMember && (
                        <Badge variant="outline" className="text-xs">
                          Pool {poolAMember.event_player.pool}
                        </Badge>
                      )}
                      {poolBMember && (
                        <Badge variant="outline" className="text-xs">
                          Pool {poolBMember.event_player.pool}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {(() => {
                        const poolAScore = poolAMember?.event_player.pfa_score;
                        const poolBScore = poolBMember?.event_player.pfa_score;
                        const poolAScoringMethod = poolAMember?.event_player.scoring_method;
                        const poolBScoringMethod = poolBMember?.event_player.scoring_method;

                        const poolAHasScore = poolAScoringMethod !== 'default' && poolAScore != null;
                        const poolBHasScore = poolBScoringMethod !== 'default' && poolBScore != null;

                        const formatScore = (score: number | null | undefined, hasScore: boolean) => {
                          if (!hasScore) return 'X';
                          return score?.toFixed(1) ?? 'X';
                        };

                        const poolADisplay = formatScore(poolAScore, poolAHasScore);
                        const poolBDisplay = formatScore(poolBScore, poolBHasScore);

                        if (!poolAHasScore && !poolBHasScore) {
                          return (
                            <span className="text-muted-foreground">
                              {poolADisplay} + {poolBDisplay} = No data
                            </span>
                          );
                        }

                        if (!poolAHasScore || !poolBHasScore) {
                          return (
                            <span>
                              <span className={!poolAHasScore ? 'text-muted-foreground' : ''}>
                                {poolADisplay}
                              </span>
                              {' + '}
                              <span className={!poolBHasScore ? 'text-muted-foreground' : ''}>
                                {poolBDisplay}
                              </span>
                              {' = '}
                              <span className="text-muted-foreground">Incomplete</span>
                            </span>
                          );
                        }

                        const combinedScore = (poolAScore ?? 0) + (poolBScore ?? 0);
                        return (
                          <span className="font-medium">
                            {poolADisplay} + {poolBDisplay} = {combinedScore.toFixed(1)}
                          </span>
                        );
                      })()}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="bg-muted/50 rounded-lg p-4">
        <h3 className="font-medium mb-2">Team Generation Details</h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• Teams are formed with 1 player from Pool A and 1 player from Pool B</li>
          <li>• Teams are seeded based on combined scores (lower seed = higher combined score)</li>
          {event.qualification_round_enabled ? (
            <li>• Scores based on qualification round performance</li>
          ) : (
            <>
              <li>• Scores based on PFA (Per Frame Average) from the last 6 months</li>
              <li>• Players with no frame history show &quot;X&quot; and are assigned pools by default pool setting</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
