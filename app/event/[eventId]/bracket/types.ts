import type { Match, Participant, Stage, Group, Round } from 'brackets-model';
import type { Team } from '@/app/event/[eventId]/types';

export interface Lane {
  id: string;
  event_id: string;
  label: string;
  status: 'idle' | 'occupied' | 'maintenance';
}

export interface BracketData {
  stage: Stage;
  groups: Group[];
  rounds: Round[];
  matches: Match[];
  participants: Participant[];
}

export interface BracketWithTeams {
  bracket: BracketData;
  teams: Team[];
  participantTeamMap: Record<number, Team>;
  lanes: Lane[];
  laneMap: Record<string, string>;
}

export interface MatchDisplayData {
  match: Match;
  team1?: Team;
  team2?: Team;
  roundName: string;
  groupName: string;
}

// Group names for double elimination
export const GROUP_NAMES: Record<number, string> = {
  1: "Winner's Bracket",
  2: "Loser's Bracket",
  3: 'Grand Final',
};

// Match status enum from brackets-model
export enum MatchStatus {
  Locked = 0,
  Waiting = 1,
  Ready = 2,
  Running = 3,
  Completed = 4,
  Archived = 5,
}

export function getStatusLabel(status: number): string {
  switch (status) {
    case MatchStatus.Locked:
      return 'Locked';
    case MatchStatus.Waiting:
      return 'Waiting';
    case MatchStatus.Ready:
      return 'Ready';
    case MatchStatus.Running:
      return 'In Progress';
    case MatchStatus.Completed:
      return 'Completed';
    case MatchStatus.Archived:
      return 'Archived';
    default:
      return 'Unknown';
  }
}

export function getStatusColor(status: number): string {
  switch (status) {
    case MatchStatus.Locked:
      return 'bg-gray-200 text-gray-700';
    case MatchStatus.Waiting:
      return 'bg-yellow-100 text-yellow-700';
    case MatchStatus.Ready:
      return 'bg-green-100 text-green-700';
    case MatchStatus.Running:
      return 'bg-blue-100 text-blue-700';
    case MatchStatus.Completed:
      return 'bg-gray-100 text-gray-600';
    case MatchStatus.Archived:
      return 'bg-gray-100 text-gray-500';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
