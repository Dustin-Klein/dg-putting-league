import 'server-only';
import { Status } from 'brackets-model';
import { lockEvent, lockMatches, withTransaction, type Executor } from '@/lib/db/tx';
import * as eventDb from '@/lib/repositories/event-repository.db';
import * as eventPlayerDb from '@/lib/repositories/event-player-repository.db';
import * as teamDb from '@/lib/repositories/team-repository.db';
import * as bracketDb from '@/lib/repositories/bracket-repository.db';
import { deleteBracketRows } from '@/lib/repositories/bracket-storage.db';
import { getFrameCountsForMatches } from '@/lib/repositories/frame-repository.db';
import { lockEventLanes, resetOccupiedLanesToIdle } from '@/lib/repositories/lane-repository.db';
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import { requireEventAdmin } from './event-service';

function isBye(match: { opponent1: unknown; opponent2: unknown }): boolean {
  return match.opponent1 === null || match.opponent2 === null;
}

export interface ReopenOptions {
  keepTeams: boolean;
  /** Required once any match has a score: those scores are deleted with the bracket. */
  discardScores?: boolean;
}

export interface ReopenResult {
  keptTeams: number;
  /** Matches whose scores were deleted. */
  discardedMatches: number;
}

/**
 * Take an event from bracket play back to registration so a missed player can be added
 * and the bracket drawn again. Players, payments and zones stay; the bracket, its lane
 * assignments, any scores and the teams go. With `keepTeams`, the next start keeps the
 * announced teams and pairs only the newcomers.
 *
 * This is the only path from bracket back to pre-bracket; the status PATCH never allows it.
 */
export async function reopenRegistration(eventId: string, options: ReopenOptions): Promise<ReopenResult> {
  const { pg, user } = await requireEventAdmin(eventId);
  const result = await reopenRegistrationDb(pg, eventId, options);
  logger.info('Registration reopened', {
    userId: user.id,
    action: 'reopen_registration',
    eventId,
    keepTeams: options.keepTeams,
    keptTeams: result.keptTeams,
    discardedMatches: result.discardedMatches,
    outcome: 'success',
  });
  return result;
}

/** `reopenRegistration` for a caller that has authorized as event admin. */
export function reopenRegistrationDb(ex: Executor, eventId: string, options: ReopenOptions): Promise<ReopenResult> {
  return withTransaction(ex, async (tx) => {
    await lockEvent(tx, eventId);
    const config = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'update' });
    if (!config) throw new NotFoundError('Event not found');
    if (config.status !== 'bracket') {
      throw new BadRequestError('Registration can be reopened only from bracket play');
    }
    const child = await eventDb.getSecondChanceChild(tx, eventId);
    if (child && child.status !== 'created' && child.status !== 'pre-bracket') {
      throw new ConflictError('The second chance has already started, so registration can’t be reopened');
    }

    // Every match locked, so a frame can't land between this check and the delete.
    const matchIds = await bracketDb.getMatchIdsForEvent(tx, eventId);
    const locked = await lockMatches(tx, matchIds, eventId);
    const frames = await getFrameCountsForMatches(tx, matchIds);
    const scored = [...locked.values()].filter((match) =>
      (frames[match.id] ?? 0) > 0 ||
      match.status === Status.Running ||
      (match.status >= Status.Completed && match.status !== Status.Archived && !isBye(match))
    ).length;
    if (scored > 0 && !options.discardScores) {
      throw new ConflictError(
        `${scored} match${scored === 1 ? ' has' : 'es have'} scores. Reopening deletes them; confirm to continue.`
      );
    }

    let keptTeams = 0;
    if (options.keepTeams) {
      const teams = await teamDb.getFullTeamsForEvent(tx, eventId, false);
      keptTeams = teams.length;
      await eventDb.setReopenedTeamDraft(tx, eventId, teams.map((team) => ({
        seed: team.seed,
        members: team.team_members.map((member) => ({
          event_player_id: member.event_player_id,
          slot: member.slot,
          pool: member.event_player.pool ?? null,
        })),
      })));
    } else {
      await eventDb.setReopenedTeamDraft(tx, eventId, null);
    }

    await lockEventLanes(tx, eventId);
    await resetOccupiedLanesToIdle(tx, eventId);
    await deleteBracketRows(tx, eventId);
    await teamDb.deleteTeamsForEvent(tx, eventId);
    await eventPlayerDb.clearPlayerScores(tx, eventId);
    // Frames and results go with the bracket matches (ON DELETE CASCADE).
    await eventDb.setEventStatus(tx, eventId, 'pre-bracket');
    return { keptTeams, discardedMatches: scored };
  });
}
