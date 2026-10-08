import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { _createPrivilegedClient, type PrivilegedClient } from '@/lib/supabase/privileged';
import { _getDb, type Db } from '@/lib/db/client';
import { UnauthorizedError, ForbiddenError, NotFoundError, InvalidAccessCodeError } from '@/lib/errors';
import {
  getLeagueAdminByUserAndLeague,
  isLeagueOwner,
  isAnyLeagueAdmin,
} from '@/lib/repositories/league-repository';
import {
  getEventLeagueId,
  type AccessCodeEvent,
} from '@/lib/repositories/event-repository';
import { getEventByAccessCode } from '@/lib/repositories/event-repository.db';
import { normalizeAccessCode } from '@/lib/utils/access-code';

export type { PrivilegedClient } from '@/lib/supabase/privileged';
export type { Db } from '@/lib/db/client';
export type { AccessCodeEvent } from '@/lib/repositories/event-repository';

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

export async function requireLeagueAdmin(leagueId: string) {
    const { user } = await authorizeLeagueAdmin(leagueId);

    return {
        user,
        isAdmin: true,
    };
}

// ---------------------------------------------------------------------------
// Authorization → privileged client
//
// These are the only way to obtain a PrivilegedClient or a Db (both bypass RLS).
// Each one performs its authorization check before handing them out.
// `db` is the Supabase (PostgREST) client; `pg` is the direct Postgres connection
// used for transactional service methods (lib/db). Plan 04 retires `db`.
// ---------------------------------------------------------------------------

/**
 * Require the current user to be an admin (or owner) of the league.
 */
export async function authorizeLeagueAdmin(
    leagueId: string
): Promise<{ user: User; db: PrivilegedClient; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const db = _createPrivilegedClient();

    const leagueAdmin = await getLeagueAdminByUserAndLeague(db, leagueId, user.id);
    if (!leagueAdmin) {
        throw new ForbiddenError('Insufficient permissions');
    }

    return { user, db, pg: _getDb() };
}

/**
 * Require the current user to be the owner of the league.
 */
export async function authorizeLeagueOwner(
    leagueId: string,
    forbiddenMessage = 'Only the league owner can perform this action'
): Promise<{ user: User; db: PrivilegedClient; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const db = _createPrivilegedClient();

    const isOwner = await isLeagueOwner(db, leagueId, user.id);
    if (!isOwner) {
        throw new ForbiddenError(forbiddenMessage);
    }

    return { user, db, pg: _getDb() };
}

/**
 * Require the current user to be an admin of the event's league.
 */
export async function authorizeEventAdmin(
    eventId: string
): Promise<{ user: User; db: PrivilegedClient; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const db = _createPrivilegedClient();

    const leagueId = await getEventLeagueId(db, eventId);
    if (!leagueId) {
        throw new ForbiddenError('Event not found');
    }

    const leagueAdmin = await getLeagueAdminByUserAndLeague(db, leagueId, user.id);
    if (!leagueAdmin) {
        throw new ForbiddenError('Insufficient permissions');
    }

    return { user, db, pg: _getDb() };
}

/**
 * Require the current user to be an admin of at least one league
 * (e.g. to create players, which are shared across leagues).
 */
export async function authorizeAnyLeagueAdmin(): Promise<{ user: User; db: PrivilegedClient; pg: Db }> {
    const user = await requireAuthenticatedUser();
    const db = _createPrivilegedClient();

    const isAdmin = await isAnyLeagueAdmin(db, user.id);
    if (!isAdmin) {
        throw new ForbiddenError('Only league admins can perform this action');
    }

    return { user, db, pg: _getDb() };
}

/**
 * Require an authenticated user who may create a new league.
 * Today any signed-in user may create a league (they become its owner).
 */
export async function authorizeLeagueCreation(): Promise<{ user: User; db: PrivilegedClient; pg: Db }> {
    const user = await requireAuthenticatedUser();
    return { user, db: _createPrivilegedClient(), pg: _getDb() };
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
): Promise<{ event: AccessCodeEvent; db: PrivilegedClient; pg: Db }> {
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

    return { event, db: _createPrivilegedClient(), pg };
}
