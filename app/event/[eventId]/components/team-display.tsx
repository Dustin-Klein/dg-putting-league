'use client';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EventWithDetails, Team } from '../types';
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
                    <div className="text-sm text-muted-foreground">
                      {/* This could be calculated from qualification scores in a future enhancement */}
                      Seeded by qualification performance
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
          <li>• Teams are seeded based on combined qualification scores</li>
          <li>• Higher seeds indicate better combined performance</li>
          {event.qualification_round_enabled && (
            <li>• Seeding based on qualification round performance</li>
          )}
          {!event.qualification_round_enabled && (
            <li>• Random seeding within pools (no qualification round)</li>
          )}
        </ul>
      </div>
    </div>
  );
}
