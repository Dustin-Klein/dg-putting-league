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

/**
 * Take an event from bracket play back to registration, before any scoring, so a missed
 * player can be added and the bracket drawn again. Players, payments, zones and
 * qualification scores stay; the bracket, its lane assignments and the teams go. With
 * `keepTeams`, the next start keeps the announced teams and pairs only the newcomers.
 *
 * This is the only path from bracket back to pre-bracket; the status PATCH never allows it.
 */
export async function reopenRegistration(eventId: string, options: { keepTeams: boolean }): Promise<void> {
  const { pg, user } = await requireEventAdmin(eventId);
  const kept = await reopenRegistrationDb(pg, eventId, options);
  logger.info('Registration reopened', {
    userId: user.id,
    action: 'reopen_registration',
    eventId,
    keepTeams: options.keepTeams,
    keptTeams: kept,
    outcome: 'success',
  });
}

/** `reopenRegistration` for a caller that has authorized as event admin. Returns the teams kept. */
export function reopenRegistrationDb(ex: Executor, eventId: string, options: { keepTeams: boolean }): Promise<number> {
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

    // Every match locked, so a first frame can't land between this check and the delete.
    const matchIds = await bracketDb.getMatchIdsForEvent(tx, eventId);
    const locked = await lockMatches(tx, matchIds, eventId);
    const frames = await getFrameCountsForMatches(tx, matchIds);
    const played = [...locked.values()].some((match) =>
      (frames[match.id] ?? 0) > 0 ||
      match.status === Status.Running ||
      (match.status >= Status.Completed && match.status !== Status.Archived && !isBye(match))
    );
    if (played) {
      throw new ConflictError('Scoring has started, so registration can’t be reopened. Substitute or fill a bye instead.');
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
    await eventDb.setEventStatus(tx, eventId, 'pre-bracket');
    return keptTeams;
  });
}
