import { addDays, startOfDay } from 'date-fns';
import type { TeamAssignment } from '@/lib/types/event';
import type { ZoneDefinition } from '@/lib/types/handicap';
import { formatForDatabase } from './date-utils';
import { TEAM_SIZE_LABELS, teamAssignmentOptions } from './team-utils';

/** The settings an organizer chooses when creating an event (everything but date, place and code). */
export interface EventSetupValues {
  lane_count: number;
  putt_distance_ft: number;
  qualification_round_enabled: boolean;
  qualification_frame_count: number;
  bracket_frame_count: number;
  double_grand_final: boolean;
  team_size: number;
  team_assignment: TeamAssignment;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
}

export interface EventSetupContext {
  /** The league uses distance handicaps, so players putt from their zone, not one event distance. */
  handicapEnabled: boolean;
  /** The league ladder a new handicap event starts from. */
  zones: readonly ZoneDefinition[];
}

export const DEFAULT_EVENT_SETUP: EventSetupValues = {
  lane_count: 1,
  putt_distance_ft: 15,
  qualification_round_enabled: false,
  qualification_frame_count: 5,
  bracket_frame_count: 5,
  double_grand_final: true,
  team_size: 2,
  team_assignment: 'random_pairing',
  entry_fee_per_player: null,
  admin_fees: null,
  admin_fee_per_player: null,
};

/** Whether the organizer chooses how teams form; singles has only one way. */
export function teamAssignmentApplies(teamSize: number): boolean {
  return teamAssignmentOptions(teamSize).length > 1;
}

/** Settings that only matter given other answers; everything else always applies. */
export type ConditionalSetupField = 'team_assignment' | 'qualification_frame_count' | 'putt_distance_ft';

export function setupFieldApplies(
  field: ConditionalSetupField,
  values: Pick<EventSetupValues, 'team_size' | 'qualification_round_enabled'>,
  ctx: Pick<EventSetupContext, 'handicapEnabled'>
): boolean {
  switch (field) {
    case 'team_assignment':
      return teamAssignmentApplies(values.team_size);
    case 'qualification_frame_count':
      return values.qualification_round_enabled;
    case 'putt_distance_ft':
      return !ctx.handicapEnabled;
  }
}

/** "$10" for whole dollars, "$10.50" otherwise. */
export function formatMoney(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** "21 / 27 / 33 ft" in zone order. */
export function zoneLadderLabel(zones: readonly ZoneDefinition[]): string {
  return `${[...zones].sort((a, b) => a.zone - b.zone).map((zone) => zone.distance_ft).join(' / ')} ft`;
}

/** How teams form, in words that finish "Doubles, …". Null when there is no choice (singles). */
export function teamAssignmentPhrase(teamSize: number, assignment: TeamAssignment): string | null {
  if (!teamAssignmentApplies(teamSize)) return null;
  return {
    random_pairing: 'one from each pool',
    random_flat: 'drawn at random',
    manual: 'teams picked by you',
  }[assignment];
}

export function teamSizeLabel(teamSize: number): string {
  return TEAM_SIZE_LABELS[teamSize] ?? `Teams of ${teamSize}`;
}

/** "Doubles, one from each pool" / "Singles". */
export function teamFormatLabel(teamSize: number, assignment: TeamAssignment): string {
  const phrase = teamAssignmentPhrase(teamSize, assignment);
  return phrase ? `${teamSizeLabel(teamSize)}, ${phrase}` : teamSizeLabel(teamSize);
}

export function distanceLabel(values: Pick<EventSetupValues, 'putt_distance_ft'>, ctx: EventSetupContext): string {
  return ctx.handicapEnabled ? `zones ${zoneLadderLabel(ctx.zones)}` : `${values.putt_distance_ft} ft`;
}

/** "no admin fee", "$1 per player to admin", "$1 per player + $5 to admin". */
export function adminFeeLabel(values: Pick<EventSetupValues, 'admin_fees' | 'admin_fee_per_player'>): string {
  const perPlayer = values.admin_fee_per_player ? `${formatMoney(values.admin_fee_per_player)} per player` : null;
  const perEvent = values.admin_fees ? formatMoney(values.admin_fees) : null;
  if (!perPlayer && !perEvent) return 'no admin fee';
  return `${[perPlayer, perEvent].filter(Boolean).join(' + ')} to admin`;
}

export interface SetupSummary {
  format: string;
  scoring: string;
  money: string;
}

/** One line per wizard step, for the review screen. */
export function setupSummary(values: EventSetupValues, ctx: EventSetupContext): SetupSummary {
  const format = [
    teamFormatLabel(values.team_size, values.team_assignment),
    values.qualification_round_enabled ? `${values.qualification_frame_count}-frame qualification` : 'seeded by past averages',
  ];
  const scoring = [
    `${values.bracket_frame_count}-frame matches`,
    distanceLabel(values, ctx),
    values.double_grand_final ? 'bracket reset' : 'no bracket reset',
  ];
  const money = values.entry_fee_per_player
    ? `${formatMoney(values.entry_fee_per_player)} entry · ${adminFeeLabel(values)}`
    : 'No entry fee';
  return { format: format.join(' · '), scoring: scoring.join(' · '), money };
}

/** What a tappable part of the event sentence edits. */
export type SetupEdit =
  | 'team_size'
  | 'team_assignment'
  | 'qualification'
  | 'bracket_frames'
  | 'grand_final'
  | 'lanes'
  | 'distance'
  | 'location'
  | 'entry_fee'
  | 'admin_fees';

export type SentencePart = { text: string; edit?: SetupEdit };

/**
 * The whole event as plain sentences, with the changeable values marked. Settings
 * that don't apply (assignment for singles, frames without a qualification round, the
 * distance in a handicap league) never appear.
 */
export function describeEventSetup(
  values: EventSetupValues,
  ctx: EventSetupContext,
  location: string | null | undefined
): SentencePart[] {
  const parts: SentencePart[] = [{ text: teamSizeLabel(values.team_size), edit: 'team_size' }];
  const assignment = teamAssignmentPhrase(values.team_size, values.team_assignment);
  if (assignment) parts.push({ text: ', ' }, { text: assignment, edit: 'team_assignment' });
  parts.push({ text: ', seeded by ' });
  parts.push(values.qualification_round_enabled
    ? { text: `a ${values.qualification_frame_count}-frame qualification round`, edit: 'qualification' }
    : { text: 'past averages', edit: 'qualification' });
  parts.push(
    { text: '. Bracket matches are ' },
    { text: `${values.bracket_frame_count} frames`, edit: 'bracket_frames' },
    { text: ', double elimination ' },
    { text: values.double_grand_final ? 'with a bracket reset' : 'without a bracket reset', edit: 'grand_final' },
    { text: '. Played on ' },
    { text: `${values.lane_count} lane${values.lane_count === 1 ? '' : 's'}`, edit: 'lanes' },
  );
  if (ctx.handicapEnabled) {
    parts.push({ text: ` from each player's handicap zone (${zoneLadderLabel(ctx.zones)})` });
  } else {
    parts.push({ text: ' from ' }, { text: `${values.putt_distance_ft} ft`, edit: 'distance' });
  }
  parts.push({ text: ' at ' }, { text: location?.trim() ? location.trim() : 'no location set', edit: 'location' });
  if (values.entry_fee_per_player) {
    parts.push(
      { text: '. Entry is ' },
      { text: formatMoney(values.entry_fee_per_player), edit: 'entry_fee' },
      { text: ', ' },
      { text: adminFeeLabel(values), edit: 'admin_fees' },
      { text: '.' },
    );
  } else {
    parts.push({ text: '. ' }, { text: 'No entry fee', edit: 'entry_fee' }, { text: '.' });
  }
  return parts;
}

/** The parts of an existing event's format worth mentioning; disabled features are left out. */
export function eventFormatParts(event: {
  team_size: number;
  team_assignment: TeamAssignment;
  qualification_round_enabled: boolean;
  qualification_frame_count: number;
  bracket_frame_count: number | null;
  double_grand_final: boolean;
  bonus_point_enabled: boolean;
}): string[] {
  return [
    teamFormatLabel(event.team_size, event.team_assignment),
    ...(event.qualification_round_enabled ? [`${event.qualification_frame_count}-frame qualification`] : []),
    ...(event.bracket_frame_count ? [`${event.bracket_frame_count}-frame matches`] : []),
    ...(event.double_grand_final ? ['bracket reset'] : []),
    ...(event.bonus_point_enabled ? ['bonus point for 3 of 3'] : []),
  ];
}

/** A previous event's settings for a new one. Date, place, code, players and payouts are not settings. */
export function templateToSetupValues(event: EventSetupValues): EventSetupValues {
  return {
    lane_count: event.lane_count,
    putt_distance_ft: event.putt_distance_ft,
    qualification_round_enabled: event.qualification_round_enabled,
    qualification_frame_count: event.qualification_frame_count,
    bracket_frame_count: event.bracket_frame_count,
    double_grand_final: event.double_grand_final,
    team_size: event.team_size,
    team_assignment: event.team_assignment,
    entry_fee_per_player: event.entry_fee_per_player,
    admin_fees: event.admin_fees,
    admin_fee_per_player: event.admin_fee_per_player,
  };
}

/** The next `count` dates (from today, inclusive) falling on `weekday` (0 = Sunday). */
export function upcomingWeekdayDates(weekday: number, today: Date, count = 2): Date[] {
  const start = startOfDay(today);
  const first = addDays(start, (weekday - start.getDay() + 7) % 7);
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

export interface CreateEventInput extends EventSetupValues {
  event_date: Date;
  location?: string | null;
  access_code: string;
}

/** The POST /api/league/[leagueId] body. */
export function toCreateEventBody(values: CreateEventInput, copyPlayersFromEventId?: string | null) {
  return {
    event_date: formatForDatabase(values.event_date),
    location: values.location?.trim() ? values.location.trim() : null,
    lane_count: values.lane_count,
    putt_distance_ft: values.putt_distance_ft,
    access_code: values.access_code,
    qualification_round_enabled: values.qualification_round_enabled,
    double_grand_final: values.double_grand_final,
    bracket_frame_count: values.bracket_frame_count,
    qualification_frame_count: values.qualification_frame_count,
    entry_fee_per_player: values.entry_fee_per_player ?? null,
    admin_fees: values.admin_fees ?? null,
    admin_fee_per_player: values.admin_fee_per_player ?? null,
    team_size: values.team_size,
    team_assignment: values.team_assignment,
    ...(copyPlayersFromEventId ? { copy_players_from_event_id: copyPlayersFromEventId } : {}),
  };
}

const ACCESS_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random 6-character code without look-alike characters (0/O, 1/I). */
export function generateAccessCode(length = 6): string {
  return Array.from({ length }, () => ACCESS_CODE_CHARS[Math.floor(Math.random() * ACCESS_CODE_CHARS.length)]).join('');
}
