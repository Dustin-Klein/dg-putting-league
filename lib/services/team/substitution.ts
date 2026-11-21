import 'server-only';
import { Status } from 'brackets-model';
import { requireEventAdmin } from '@/lib/services/event';
import { computePfaScores } from '@/lib/services/event-player';
import { refreshEntrySnapshots } from '@/lib/services/handicap/snapshot';
import { lockEvent, lockMatches, withTransaction, type Executor } from '@/lib/db/tx';
import * as eventDb from '@/lib/repositories/event-repository.db';
import * as eventPlayerDb from '@/lib/repositories/event-player-repository.db';
import * as teamDb from '@/lib/repositories/team-repository.db';
import * as bracketDb from '@/lib/repositories/bracket-repository.db';
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import type { PaymentType } from '@/lib/types/player';
import type { SubstitutionReason } from '@/lib/repositories/team-repository.db';

export type { SubstitutionReason };

export interface SubstituteInput {
  outEventPlayerId: string;
  /** The player coming in (players.id). */
  playerId: string;
  paymentType: PaymentType | null;
  reason: SubstitutionReason;
}

export interface SubstituteResult {
  inEventPlayerId: string;
  /** The outgoing entry had no frames, so it was removed and no longer counts toward payouts. */
  outEntryRemoved: boolean;
}

/**
 * Swap a player onto a team during bracket play, between the team's matches. The
 * incoming player gets an event entry of their own (their own zone and distance), in the
 * outgoing player's slot and pool. The outgoing entry stays when it has frames (its
 * putts still count for matches already played); otherwise it is removed, so the entry
 * count behind the payouts reflects who actually played.
 */
export async function substituteTeamMember(
  eventId: string,
  teamId: string,
  input: SubstituteInput
): Promise<SubstituteResult> {
  const { pg, user } = await requireEventAdmin(eventId);
  const result = await substituteTeamMemberDb(pg, eventId, teamId, user.id, input);
  logger.info('Team member substituted', {
    userId: user.id,
    action: 'substitute_team_member',
    eventId,
    teamId,
    outEventPlayerId: input.outEventPlayerId,
    inEventPlayerId: result.inEventPlayerId,
    outEntryRemoved: result.outEntryRemoved,
    reason: input.reason,
    outcome: 'success',
  });
  return result;
}

/** `substituteTeamMember` for a caller that has authorized as event admin. */
export function substituteTeamMemberDb(
  ex: Executor,
  eventId: string,
  teamId: string,
  userId: string | null,
  input: SubstituteInput
): Promise<SubstituteResult> {
  return withTransaction(ex, async (tx) => {
    await lockEvent(tx, eventId);
    const config = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'share' });
    const event = await eventDb.getEventById(tx, eventId);
    if (!config || !event) throw new NotFoundError('Event not found');
    if (config.status !== 'bracket') {
      throw new BadRequestError('Players can be substituted only during bracket play');
    }

    const members = await teamDb.getTeamMembersInEvent(tx, eventId, teamId);
    if (members.length === 0) throw new NotFoundError('Team not found');
    const outgoing = members.find((member) => member.event_player_id === input.outEventPlayerId);
    if (!outgoing) throw new BadRequestError('That player is not on this team');

    // Locking the team's unfinished matches keeps a scorer's first frame from landing mid-swap.
    const participantId = await teamDb.getParticipantIdForTeam(tx, eventId, teamId);
    if (participantId !== null) {
      const matchIds = await bracketDb.getUnfinishedMatchIdsForParticipant(tx, eventId, participantId);
      const locked = await lockMatches(tx, matchIds, eventId);
      if ([...locked.values()].some((match) => match.status === Status.Running)) {
        throw new ConflictError('This team is playing a match right now. Substitute after the match.');
      }
    }

    if (await teamDb.wasSubbedOut(tx, eventId, input.playerId)) {
      throw new BadRequestError('That player was substituted out of this event and can’t come back in');
    }
    const existing = await eventPlayerDb.getEventPlayerByPlayerAndEvent(tx, eventId, input.playerId);
    if (existing && (await teamDb.isEntryOnTeam(tx, existing.id))) {
      throw new BadRequestError('That player is already on a team in this event');
    }

    const pfa = (await computePfaScores(tx, [input.playerId])).get(input.playerId)!;
    let inEventPlayerId: string;
    if (existing) {
      inEventPlayerId = existing.id;
      await eventPlayerDb.applyPlayerScores(tx, eventId, [{
        event_player_id: existing.id,
        pool: outgoing.pool,
        pfa_score: pfa.score,
        scoring_method: pfa.scoringMethod,
      }]);
      await eventPlayerDb.updateEventPlayerPayment(tx, eventId, input.playerId, input.paymentType);
    } else {
      inEventPlayerId = await eventPlayerDb.insertLateEventPlayer(tx, eventId, {
        player_id: input.playerId,
        putt_distance_ft: event.putt_distance_ft,
        pool: outgoing.pool,
        pfa_score: pfa.score,
        scoring_method: pfa.scoringMethod,
        payment_type: input.paymentType,
      });
    }

    await teamDb.replaceTeamMember(tx, teamId, outgoing.event_player_id, inEventPlayerId);
    await teamDb.renameTeamFromMembers(tx, eventId, teamId);

    const outEntryRemoved = (await teamDb.countEntryFrames(tx, outgoing.event_player_id)) === 0;
    if (outEntryRemoved) {
      await eventPlayerDb.deleteEventPlayer(tx, eventId, outgoing.event_player_id);
    }

    await teamDb.insertSubstitution(tx, {
      event_id: eventId,
      team_id: teamId,
      slot: outgoing.slot,
      out_player_id: outgoing.player_id,
      out_event_player_id: outEntryRemoved ? null : outgoing.event_player_id,
      in_event_player_id: inEventPlayerId,
      reason: input.reason,
      created_by: userId,
    });

    // Last: gives the incoming player their own zone and takes the league handicap lock.
    await refreshEntrySnapshots(tx, eventId, { entryIds: [inEventPlayerId] });
    return { inEventPlayerId, outEntryRemoved };
  });
}
