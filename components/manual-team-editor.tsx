'use client';

import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TeamPreviewPlayer } from '@/lib/types/team';
import type { TeamDraft } from '@/lib/utils/team-utils';

function formatScore(player: TeamPreviewPlayer): string {
  return player.scoringMethod === 'default' ? 'X' : player.pfaScore.toFixed(2);
}

/**
 * Member scores and their sum, e.g. "3.10 + 2.40 = 5.50". Players with no score
 * history show as X, and the sum reads "Incomplete" (or "No data" if nobody has one).
 */
export function CombinedScore({ members }: { members: TeamPreviewPlayer[] }) {
  const scored = members.filter((player) => player.scoringMethod !== 'default');
  const total = members.reduce((sum, player) => sum + player.pfaScore, 0);
  const parts = members.map((player, index) => (
    <span key={player.eventPlayerId} className={player.scoringMethod === 'default' ? 'text-muted-foreground' : ''}>
      {index > 0 && ' + '}
      {formatScore(player)}
    </span>
  ));

  if (members.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  if (scored.length === 0) {
    return <span className="text-sm text-muted-foreground">{parts} = No data</span>;
  }
  if (scored.length < members.length) {
    return (
      <span className="text-sm">
        {parts} = <span className="text-muted-foreground">Incomplete</span>
      </span>
    );
  }
  return (
    <span className="text-sm font-medium">
      {members.length > 1 ? <>{parts} = </> : null}
      {total.toFixed(2)}
    </span>
  );
}

interface ManualTeamEditorProps {
  players: TeamPreviewPlayer[];
  draft: TeamDraft;
  onChange: (draft: TeamDraft) => void;
  disabled?: boolean;
}

/**
 * Build teams by hand: an unassigned-players list and one row of slots per team.
 * Scores are the server-computed ones from the team preview.
 */
export function ManualTeamEditor({ players, draft, onChange, disabled = false }: ManualTeamEditorProps) {
  const playerById = new Map(players.map((player) => [player.eventPlayerId, player]));
  const placed = new Set(draft.flat());
  const unassigned = players
    .filter((player) => !placed.has(player.eventPlayerId))
    .sort((a, b) => b.pfaScore - a.pfaScore);

  const setSlot = (teamIndex: number, slotIndex: number, eventPlayerId: string | null) => {
    onChange(draft.map((team, t) =>
      t === teamIndex ? team.map((id, s) => (s === slotIndex ? eventPlayerId : id)) : team
    ));
  };

  const addToFirstOpenSlot = (eventPlayerId: string) => {
    const teamIndex = draft.findIndex((team) => team.includes(null));
    if (teamIndex === -1) return;
    setSlot(teamIndex, draft[teamIndex].indexOf(null), eventPlayerId);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">
          Unassigned players <span className="text-muted-foreground">({unassigned.length})</span>
        </h3>
        {unassigned.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everyone is on a team.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unassigned.map((player) => (
              <Button
                key={player.eventPlayerId}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addToFirstOpenSlot(player.eventPlayerId)}
                disabled={disabled}
                title="Add to the first open slot"
              >
                {player.playerName}
                <span className="ml-1 text-xs text-muted-foreground">{formatScore(player)}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {draft.map((team, teamIndex) => {
          const members = team
            .map((id) => (id ? playerById.get(id) : undefined))
            .filter((player): player is TeamPreviewPlayer => player !== undefined);
          return (
            <div key={teamIndex} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="outline">Team {teamIndex + 1}</Badge>
                <CombinedScore members={members} />
              </div>
              {team.map((eventPlayerId, slotIndex) => {
                const player = eventPlayerId ? playerById.get(eventPlayerId) : undefined;
                return player ? (
                  <div key={slotIndex} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium truncate">{player.playerName}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">{formatScore(player)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setSlot(teamIndex, slotIndex, null)}
                        disabled={disabled}
                        aria-label={`Remove ${player.playerName} from team ${teamIndex + 1}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </span>
                  </div>
                ) : (
                  <Select
                    key={slotIndex}
                    value=""
                    onValueChange={(value) => setSlot(teamIndex, slotIndex, value)}
                    disabled={disabled || unassigned.length === 0}
                  >
                    <SelectTrigger className="w-full h-8" aria-label={`Team ${teamIndex + 1}, player ${slotIndex + 1}`}>
                      <SelectValue placeholder="Add player" />
                    </SelectTrigger>
                    <SelectContent>
                      {unassigned.map((option) => (
                        <SelectItem key={option.eventPlayerId} value={option.eventPlayerId}>
                          {option.playerName} ({formatScore(option)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
