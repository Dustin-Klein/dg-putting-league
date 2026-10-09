import 'server-only';
import { and, asc, count, desc, eq, inArray, max, or, sql, type SQL } from 'drizzle-orm';
import { user_emails } from '@/lib/db/auth-schema';
import { toIsoTimestamp } from '@/lib/db/mappers';
import type { Executor } from '@/lib/db/tx';
import { event_players, events, league_admins, leagues } from '@/lib/db/schema';
import { InternalError, NotFoundError } from '@/lib/errors';
import type { PublicEvent, PublicLeague, PublicLeagueDetail } from '@/lib/types/public';

export type LeagueAdminRole = (typeof league_admins.$inferSelect)['role'];

export interface LeagueData {
  id: string;
  name: string;
  city: string | null;
  created_at: string;
}

export interface LeagueAdminData {
  league_id: string;
  role: string;
}

export interface LeagueAdminWithEmailRecord {
  user_id: string;
  role: string;
  email: string | null;
}

export interface LeagueEventStats {
  league_id: string;
  event_count: number;
  active_event_count: number;
  last_event_date: string | null;
}

function mapLeague(row: typeof leagues.$inferSelect): LeagueData {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    created_at: toIsoTimestamp(row.created_at),
  };
}

/**
 * This SQL predicate must match isEventPubliclyVisible in
 * lib/services/auth/visibility.ts. League admins may also see their private events.
 */
function eventVisibleTo(viewerUserId: string | null): SQL {
  const publiclyVisible = or(
    eq(events.status, 'bracket'),
    eq(events.status, 'completed'),
    and(eq(events.status, 'pre-bracket'), eq(events.qualification_round_enabled, true))
  )!;

  if (viewerUserId === null) return publiclyVisible;

  return or(
    publiclyVisible,
    sql`exists (
      select 1 from ${league_admins}
      where ${league_admins.league_id} = ${events.league_id}
        and ${league_admins.user_id} = ${viewerUserId}
    )`
  )!;
}

/** The user's role in the league, or null when they aren't one of its admins. */
export async function getLeagueAdminRole(
  ex: Executor,
  leagueId: string,
  userId: string
): Promise<LeagueAdminRole | null> {
  const rows = await ex
    .select({ role: league_admins.role })
    .from(league_admins)
    .where(and(eq(league_admins.league_id, leagueId), eq(league_admins.user_id, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Whether the user is an admin (any role) of at least one league. */
export async function isAnyLeagueAdmin(ex: Executor, userId: string): Promise<boolean> {
  const rows = await ex
    .select({ id: league_admins.id })
    .from(league_admins)
    .where(eq(league_admins.user_id, userId))
    .limit(1);
  return rows.length > 0;
}

export async function getLeagueById(ex: Executor, leagueId: string): Promise<LeagueData | null> {
  const rows = await ex.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  return rows[0] ? mapLeague(rows[0]) : null;
}

export async function getLeagueAdminsForUser(
  ex: Executor,
  userId: string
): Promise<LeagueAdminData[]> {
  return ex
    .select({ league_id: league_admins.league_id, role: league_admins.role })
    .from(league_admins)
    .where(eq(league_admins.user_id, userId));
}

export async function getLeaguesByIds(ex: Executor, leagueIds: string[]): Promise<LeagueData[]> {
  if (leagueIds.length === 0) return [];
  const rows = await ex.select().from(leagues).where(inArray(leagues.id, leagueIds));
  return rows.map(mapLeague);
}

/** Get event totals for every requested league in one grouped query. */
export async function getLeagueEventStats(
  ex: Executor,
  leagueIds: string[]
): Promise<LeagueEventStats[]> {
  if (leagueIds.length === 0) return [];

  const rows = await ex
    .select({
      league_id: events.league_id,
      event_count: count(events.id),
      active_event_count: sql<number>`count(*) filter (where ${events.status} <> 'completed')::int`,
      last_event_date: max(events.event_date),
    })
    .from(events)
    .where(inArray(events.league_id, leagueIds))
    .groupBy(events.league_id);

  return rows.map((row) => ({
    ...row,
    event_count: Number(row.event_count),
    active_event_count: Number(row.active_event_count),
  }));
}

export async function insertLeague(
  ex: Executor,
  leagueId: string,
  name: string,
  city: string | null
): Promise<void> {
  await ex.insert(leagues).values({ id: leagueId, name, city });
}

export async function insertLeagueAdmin(
  ex: Executor,
  leagueId: string,
  userId: string,
  role: LeagueAdminRole
): Promise<void> {
  await ex.insert(league_admins).values({ league_id: leagueId, user_id: userId, role });
}

export async function fetchLeague(ex: Executor, leagueId: string): Promise<LeagueData> {
  const league = await getLeagueById(ex, leagueId);
  if (!league) throw new InternalError('Failed to fetch league: league not found');
  return league;
}

export async function getLeagueAdminByUserAndLeague(
  ex: Executor,
  leagueId: string,
  userId: string
): Promise<{ id: string } | null> {
  const rows = await ex
    .select({ id: league_admins.id })
    .from(league_admins)
    .where(and(eq(league_admins.league_id, leagueId), eq(league_admins.user_id, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Fetch every admin and their account email in one query. */
export async function getLeagueAdminsWithEmails(
  ex: Executor,
  leagueId: string
): Promise<LeagueAdminWithEmailRecord[]> {
  return ex
    .select({
      user_id: league_admins.user_id,
      role: league_admins.role,
      email: user_emails.email,
    })
    .from(league_admins)
    .leftJoin(user_emails, eq(user_emails.id, league_admins.user_id))
    .where(eq(league_admins.league_id, leagueId));
}

/** Look up an auth user by a normalized email address. */
export async function getUserIdByEmail(ex: Executor, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await ex
    .select({ id: user_emails.id })
    .from(user_emails)
    .where(sql`lower(${user_emails.email}) = ${normalized}`)
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function deleteLeagueAdmin(
  ex: Executor,
  leagueId: string,
  userId: string
): Promise<void> {
  await ex
    .delete(league_admins)
    .where(and(eq(league_admins.league_id, leagueId), eq(league_admins.user_id, userId)));
}

export async function deleteLeague(ex: Executor, leagueId: string): Promise<void> {
  const deleted = await ex
    .delete(leagues)
    .where(eq(leagues.id, leagueId))
    .returning({ id: leagues.id });
  if (deleted.length === 0) throw new NotFoundError('League not found');
}

export async function getAllLeagues(
  ex: Executor,
  viewerUserId: string | null
): Promise<PublicLeague[]> {
  const rows = await ex
    .select({ id: leagues.id, name: leagues.name, event_count: count(events.id) })
    .from(leagues)
    .innerJoin(events, and(eq(events.league_id, leagues.id), eventVisibleTo(viewerUserId)))
    .groupBy(leagues.id, leagues.name)
    .orderBy(asc(leagues.name));

  return rows.map((row) => ({ ...row, event_count: Number(row.event_count) }));
}

export async function getLeagueWithEvents(
  ex: Executor,
  leagueId: string,
  viewerUserId: string | null
): Promise<PublicLeagueDetail | null> {
  const leagueRows = await ex
    .select({ id: leagues.id, name: leagues.name })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  const league = leagueRows[0];
  if (!league) return null;

  const eventRows = await ex
    .select({
      id: events.id,
      event_date: events.event_date,
      location: events.location,
      status: events.status,
    })
    .from(events)
    .where(and(eq(events.league_id, leagueId), eventVisibleTo(viewerUserId)))
    .orderBy(desc(events.event_date));

  const eventIds = eventRows.map((event) => event.id);
  const participantRows = eventIds.length === 0
    ? []
    : await ex
        .select({ event_id: event_players.event_id, participant_count: count(event_players.id) })
        .from(event_players)
        .where(inArray(event_players.event_id, eventIds))
        .groupBy(event_players.event_id);
  const participantsByEvent = new Map(
    participantRows.map((row) => [row.event_id, Number(row.participant_count)])
  );
  const publicEvents: PublicEvent[] = eventRows.map((event) => ({
    ...event,
    participant_count: participantsByEvent.get(event.id) ?? 0,
  }));

  return {
    ...league,
    event_count: publicEvents.length,
    events: publicEvents,
  };
}
