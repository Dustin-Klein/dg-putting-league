import 'server-only';
import type { LeagueAdminRole, LeagueNightEvent, LeagueWithRole } from '@/lib/types/league';
import type { PublicLeagueDetail, PublicLeagueStatus, PublicLeagueSummary } from '@/lib/types/public';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import {
  authorizeAuthenticated,
  authorizeLeagueCreation,
  authorizeLeagueOwner,
  authorizePublicRead,
  getViewer,
} from '@/lib/services/auth';
import { withTransaction } from '@/lib/db/tx';
import { isUuid } from '@/lib/utils/uuid';
import * as leagueRepo from '@/lib/repositories/league-repository.db';
import * as bracketRepo from '@/lib/repositories/bracket-repository.db';
import * as eventRepo from '@/lib/repositories/event-repository.db';
import * as laneRepo from '@/lib/repositories/lane-repository.db';
import { matchProgress } from '@/lib/utils/event-progress';
import { currentNight, groupEventsIntoNights, nightState, seasonSummary } from '@/lib/utils/league-nights';

export interface LeagueAdminWithEmail {
  userId: string;
  email: string;
  role: string;
}

const PUBLIC_STATUS_ORDER: PublicLeagueStatus[] = ['live', 'qualifying', 'scheduled', 'idle'];

/** Leagues with an event the viewer can see: live first, then by latest event, then name. */
export async function getPublicLeagues(): Promise<PublicLeagueSummary[]> {
  const { pg } = authorizePublicRead();
  const viewer = await getViewer();
  const leagues = await leagueRepo.getAllLeagues(pg, viewer?.id ?? null);

  const liveNights = new Map(leagues.map((league) => [
    league.id,
    groupEventsIntoNights(league.events).find((night) => nightState(night) === 'live'),
  ]));
  const liveEvents = [...liveNights.values()].flatMap((night) =>
    night ? [night.main, ...night.secondChances].filter((event) => event.status === 'bracket') : []
  );
  const progress = await bracketRepo.getBracketProgressRows(pg, liveEvents.map((event) => event.id));

  const summaries = leagues.map((league): PublicLeagueSummary => {
    const night = liveNights.get(league.id);
    const status: PublicLeagueStatus = night
      ? 'live'
      : league.events.some((event) => event.status === 'pre-bracket' && event.qualification_round_enabled)
        ? 'qualifying'
        : league.events.some((event) => event.status !== 'completed')
          ? 'scheduled'
          : 'idle';
    return {
      id: league.id,
      name: league.name,
      city: league.city,
      event_count: league.events.length,
      season: seasonSummary(league.events),
      status,
      live_events: night
        ? [night.main, ...night.secondChances]
            .filter((event) => event.status === 'bracket')
            .map((event) => {
              const rows = progress.get(event.id);
              return {
                id: event.id,
                second_chance: event.link_type === 'second_chance',
                match_progress: rows ? matchProgress(rows, event.double_grand_final) : null,
              };
            })
        : [],
    };
  });

  return summaries.sort((a, b) =>
    PUBLIC_STATUS_ORDER.indexOf(a.status) - PUBLIC_STATUS_ORDER.indexOf(b.status)
    || (b.season.latest_event_date ?? '').localeCompare(a.season.latest_event_date ?? '')
    || a.name.localeCompare(b.name)
  );
}

export async function getPublicLeagueWithEvents(leagueId: string): Promise<PublicLeagueDetail> {
  const { pg } = authorizePublicRead();
  const viewer = await getViewer();
  const league = isUuid(leagueId)
    ? await leagueRepo.getLeagueWithEvents(pg, leagueId, viewer?.id ?? null)
    : null;

  if (!league) {
    throw new NotFoundError('League not found');
  }

  const live = league.events.filter((event) => event.status === 'bracket').map((event) => event.id);
  const progress = await bracketRepo.getBracketProgressRows(pg, live);
  return {
    ...league,
    events: league.events.map(({ double_grand_final, ...event }) => {
      const rows = progress.get(event.id);
      return { ...event, match_progress: rows ? matchProgress(rows, double_grand_final) : null };
    }),
  };
}

/**
 * Get league by ID
 */
export async function getLeague(leagueId: string) {
  const { pg } = authorizePublicRead();
  if (!isUuid(leagueId)) return null;
  return leagueRepo.getLeagueById(pg, leagueId);
}

/**
 * Get all leagues where user is an admin with enriched data
 */
const NIGHT_KIND_ORDER = ['live', 'next', 'latest'] as const;

/**
 * The leagues the user administers, each with its season and current night: live leagues
 * first, then the soonest next night, then the latest finished one, then leagues with no events.
 */
export async function getUserAdminLeagues(): Promise<LeagueWithRole[]> {
  const { user, pg } = await authorizeAuthenticated();

  const adminRecords = await leagueRepo.getLeagueAdminsForUser(pg, user.id);
  if (adminRecords.length === 0) {
    return [];
  }

  const leagueIds = adminRecords.map((a) => a.league_id);
  const [leagues, events] = await Promise.all([
    leagueRepo.getLeaguesByIds(pg, leagueIds),
    eventRepo.getEventsByLeagueIds(pg, leagueIds),
  ]);

  const eventsByLeague = new Map<string, eventRepo.EventWithCounts[]>();
  for (const event of events) {
    eventsByLeague.set(event.league_id, [...(eventsByLeague.get(event.league_id) ?? []), event]);
  }
  const current = new Map(leagues.map((league) => [
    league.id,
    currentNight(groupEventsIntoNights(eventsByLeague.get(league.id) ?? [])),
  ]));
  const nightEvents = [...current.values()].flatMap((entry) =>
    entry ? [entry.night.main, ...entry.night.secondChances] : []
  );
  const [progress, borrowed] = await Promise.all([
    bracketRepo.getBracketProgressRows(pg, nightEvents.filter((event) => event.status === 'bracket').map((event) => event.id)),
    laneRepo.getBorrowedLaneLabels(
      pg,
      nightEvents.filter((event) => event.link_type === 'second_chance' && event.status !== 'completed').map((event) => event.id)
    ),
  ]);
  const nightEvent = (event: eventRepo.EventWithCounts): LeagueNightEvent => {
    const rows = progress.get(event.id);
    return {
      id: event.id,
      event_date: event.event_date,
      status: event.status,
      link_type: event.link_type,
      qualification_round_enabled: event.qualification_round_enabled,
      participant_count: event.participant_count,
      paid_count: event.paid_count,
      lane_count: event.lane_count,
      entry_fee_per_player: event.entry_fee_per_player,
      match_progress: rows ? matchProgress(rows, event.double_grand_final) : null,
      borrowed_lane_labels: borrowed.get(event.id) ?? [],
    };
  };

  const result = leagues.map((league): LeagueWithRole => {
    const admin = adminRecords.find((a) => a.league_id === league.id);
    const leagueEvents = eventsByLeague.get(league.id) ?? [];
    const entry = current.get(league.id);
    return {
      ...league,
      role: (admin?.role ?? 'admin') as LeagueAdminRole,
      eventCount: leagueEvents.length,
      activeEventCount: leagueEvents.filter((event) => event.status !== 'completed').length,
      season: seasonSummary(leagueEvents),
      currentNight: entry
        ? { kind: entry.kind, main: nightEvent(entry.night.main), secondChances: entry.night.secondChances.map(nightEvent) }
        : null,
    };
  });

  const rank = (league: LeagueWithRole) =>
    league.currentNight ? NIGHT_KIND_ORDER.indexOf(league.currentNight.kind) : NIGHT_KIND_ORDER.length;
  return result.sort((a, b) => {
    const byKind = rank(a) - rank(b);
    if (byKind !== 0) return byKind;
    const dateA = a.currentNight?.main.event_date ?? '';
    const dateB = b.currentNight?.main.event_date ?? '';
    const byDate = a.currentNight?.kind === 'next' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    return byDate || a.name.localeCompare(b.name);
  });
}

type CreateLeagueInput = {
  name: string;
  city?: string | null;
};

/**
 * Create a new league with the current user as owner
 */
export async function createLeague(input: CreateLeagueInput) {
  const { user, pg } = await authorizeLeagueCreation();

  const { name, city } = input;

  if (!name || typeof name !== 'string') {
    throw new BadRequestError('League name is required');
  }

  const leagueId = crypto.randomUUID();

  return withTransaction(pg, async (tx) => {
    await leagueRepo.insertLeague(tx, leagueId, name, city ?? null);
    await leagueRepo.insertLeagueAdmin(tx, leagueId, user.id, 'owner');
    return leagueRepo.fetchLeague(tx, leagueId);
  });
}

/**
 * Get all league admins with emails (owner-only)
 */
export async function getLeagueAdminsForOwner(leagueId: string): Promise<LeagueAdminWithEmail[]> {
  const { pg } = await authorizeLeagueOwner(
    leagueId,
    'Only the league owner can view admins'
  );
  const admins = await leagueRepo.getLeagueAdminsWithEmails(pg, leagueId);
  return admins.map((admin) => ({
    userId: admin.user_id,
    email: admin.email ?? 'Unknown',
    role: admin.role,
  }));
}

/**
 * Check if current user is the league owner
 */
export async function checkIsLeagueOwner(leagueId: string): Promise<boolean> {
  const { user, pg } = await authorizeAuthenticated();
  if (!isUuid(leagueId)) return false;
  return (await leagueRepo.getLeagueAdminRole(pg, leagueId, user.id)) === 'owner';
}

/**
 * Delete a league (owner-only)
 */
export async function deleteLeague(leagueId: string): Promise<void> {
  const { pg } = await authorizeLeagueOwner(leagueId, 'Only the league owner can delete the league');

  await leagueRepo.deleteLeague(pg, leagueId);
}

/**
 * Add a league admin by email (owner-only)
 */
export async function addLeagueAdmin(leagueId: string, email: string): Promise<void> {
  const { pg } = await authorizeLeagueOwner(leagueId, 'Only the league owner can add admins');

  const normalizedEmail = (email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    throw new BadRequestError('Invalid email format');
  }

  await withTransaction(pg, async (tx) => {
    const targetUserId = await leagueRepo.getUserIdByEmail(tx, normalizedEmail);
    if (!targetUserId) {
      throw new NotFoundError('No account found with that email');
    }

    const existingAdmin = await leagueRepo.getLeagueAdminByUserAndLeague(tx, leagueId, targetUserId);
    if (existingAdmin) {
      throw new BadRequestError('User is already an admin');
    }

    await leagueRepo.insertLeagueAdmin(tx, leagueId, targetUserId, 'admin');
  });
}

/**
 * Remove a league admin (owner-only, can't remove self)
 */
export async function removeLeagueAdmin(leagueId: string, targetUserId: string): Promise<void> {
  const { user, pg } = await authorizeLeagueOwner(leagueId, 'Only the league owner can remove admins');

  if (targetUserId === user.id) {
    throw new BadRequestError('Cannot remove yourself as owner');
  }

  await leagueRepo.deleteLeagueAdmin(pg, leagueId, targetUserId);
}
