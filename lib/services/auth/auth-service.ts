import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { _getDb, type Db } from '@/lib/db/client';
import { UnauthorizedError, ForbiddenError, NotFoundError, InvalidAccessCodeError } from '@/lib/errors';
import { getLeagueAdminRole, isAnyLeagueAdmin } from '@/lib/repositories/league-repository.db';
import {
  getEventAccess,
  getEventByAccessCode,
  type AccessCodeEvent,
  type EventAccess,
} from '@/lib/repositories/event-repository.db';
import { normalizeAccessCode } from '@/lib/utils/access-code';
import { isUuid } from '@/lib/utils/uuid';
import { isPubliclyVisible, type EventVisibilityScope } from './visibility';

export type { Db } from '@/lib/db/client';
export type { AccessCodeEvent, EventAccess } from '@/lib/repositories/event-repository.db';

export async function requireAuthenticatedUser() {
    const supabase = await createClient();

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        throw new UnauthorizedError('Authentication required');
    }

    return user;
}

/**
 * The signed-in user, or null for anonymous visitors.
 */
export async function getViewer(): Promise<User | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user ?? null;
}

export async function requireLeagueAdmin(leagueId: string) {
    const { user } = await authorizeLeagueAdmin(leagueId);

    return {
        user,
        isAdmin: true,
    };
}

// ---------------------------------------------------------------------------
// Authorization → direct Postgres connection. These are the only way services
// obtain a Db, which bypasses RLS, after the relevant authorization check.
// ---------------------------------------------------------------------------

async function leagueRole(pg: Db, leagueId: string, userId: string) {
    return isUuid(leagueId) ? getLeagueAdminRole(pg, leagueId, userId) : null;
}

/**
 * Require the current user to be an admin (or owner) of the league.
 */
export async function authorizeLeagueAdmin(
    leagueId: string
): Promise<{ user: User; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const pg = _getDb();

    if (!(await leagueRole(pg, leagueId, user.id))) {
        throw new ForbiddenError('Insufficient permissions');
    }

    return { user, pg };
}

/**
 * Require the current user to be the owner of the league.
 */
export async function authorizeLeagueOwner(
    leagueId: string,
    forbiddenMessage = 'Only the league owner can perform this action'
): Promise<{ user: User; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const pg = _getDb();

    if ((await leagueRole(pg, leagueId, user.id)) !== 'owner') {
        throw new ForbiddenError(forbiddenMessage);
    }

    return { user, pg };
}

/**
 * Require the current user to be an admin of the event's league.
 */
export async function authorizeEventAdmin(
    eventId: string
): Promise<{ user: User; event: EventAccess; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const pg = _getDb();

    const event = isUuid(eventId) ? await getEventAccess(pg, eventId, user.id) : null;
    if (!event) {
        throw new ForbiddenError('Event not found');
    }
    if (!event.admin_role) {
        throw new ForbiddenError('Insufficient permissions');
    }

    return { user, event, pg };
}

/**
 * Require the current user to be an admin of at least one league
 * (e.g. to create players, which are shared across leagues).
 */
export async function authorizeAnyLeagueAdmin(): Promise<{ user: User; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const pg = _getDb();

    if (!(await isAnyLeagueAdmin(pg, user.id))) {
        throw new ForbiddenError('Only league admins can perform this action');
    }

    return { user, pg };
}

/**
 * Require an authenticated user who may create a new league.
 * Today any signed-in user may create a league (they become its owner).
 */
export async function authorizeLeagueCreation(): Promise<{ user: User; pg: Db }> {
    const user = await requireAuthenticatedUser();
    return { user, pg: _getDb() };
}

/**
 * Require a signed-in user, for reads scoped to that user's own records
 * (e.g. the leagues they administer). Query only by `user.id`.
 */
export async function authorizeAuthenticated(): Promise<{ user: User; pg: Db }> {
    const user = await requireAuthenticatedUser();
    return { user, pg: _getDb() };
}

/**
 * Database access for reads that anyone may make. `pg` bypasses RLS: before
 * returning event-scoped data, check it with `lib/services/auth/visibility.ts`
 * (or use `authorizeEventView`). Only data that is public for every row
 * (leagues, players without email, placements) may be returned unchecked.
 */
export function authorizePublicRead(): { pg: Db } {
    return { pg: _getDb() };
}

/**
 * Authorize reading an event's data. League admins may read any of their events;
 * everyone else only when `scope` is publicly visible (see visibility.ts).
 * Throws NotFoundError otherwise, so private events don't reveal they exist.
 */
export async function authorizeEventView(
    eventId: string,
    scope: EventVisibilityScope = 'event'
): Promise<{ user: User | null; event: EventAccess; isAdmin: boolean; pg: Db }> {
    const pg = _getDb();
    if (!isUuid(eventId)) {
        throw new NotFoundError('Event not found');
    }

    const user = await getViewer();
    const event = await getEventAccess(pg, eventId, user?.id ?? null);
    if (!event) {
        throw new NotFoundError('Event not found');
    }

    const isAdmin = event.admin_role !== null;
    if (!isAdmin && !isPubliclyVisible(event, scope)) {
        throw new NotFoundError('Event not found');
    }

    return { user, event, isAdmin, pg };
}

export type AccessCodeMode = 'bracket' | 'qualification';

function eventAcceptsMode(event: AccessCodeEvent, mode: AccessCodeMode): boolean {
    if (mode === 'bracket') {
        return event.status === 'bracket';
    }
    return event.status === 'pre-bracket' && event.qualification_round_enabled;
}

/**
 * Authorize a public scorer by event access code.
 *
 * The code is normalized and matched exactly (never with LIKE). When `mode` is
 * given, the event must currently accept that kind of scoring.
 */
export async function authorizeAccessCode(
    accessCode: string,
    opts: { mode?: AccessCodeMode } = {}
): Promise<{ event: AccessCodeEvent; pg: Db }> {
    const notFoundMessage =
        opts.mode === 'bracket'
            ? 'Invalid access code or event is not in bracket play'
            : opts.mode === 'qualification'
                ? 'Invalid access code or event is not accepting qualification scores'
                : 'Invalid access code';

    const normalized = normalizeAccessCode(accessCode);
    if (!normalized) {
        throw new InvalidAccessCodeError(notFoundMessage);
    }

    const pg = _getDb();
    const event = await getEventByAccessCode(pg, normalized);

    if (!event) {
        throw new InvalidAccessCodeError(notFoundMessage);
    }

    // A real code for an event in the wrong state: same message, but not counted
    // as a failed guess by the rate limiter.
    if (opts.mode && !eventAcceptsMode(event, opts.mode)) {
        throw new NotFoundError(notFoundMessage);
    }

    return { event, pg };
}
