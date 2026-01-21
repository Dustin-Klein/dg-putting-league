import { NextResponse } from 'next/server';
import { getEventWithPlayers } from '@/lib/services/event';
import { requireEventAdmin } from '@/lib/services/event/event-service';
import { computePoolAssignments } from '@/lib/services/event-player';
import { computeTeamPairings } from '@/lib/services/team';
import { handleError, BadRequestError } from '@/lib/errors';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const eventId = resolvedParams.eventId;

    await requireEventAdmin(eventId);

    const event = await getEventWithPlayers(eventId);

    if (event.status !== 'pre-bracket') {
      throw new BadRequestError('Team preview is only available for events in pre-bracket status');
    }

    const poolAssignments = await computePoolAssignments(eventId, event);
    const teamPairings = computeTeamPairings(poolAssignments);

    return NextResponse.json({
      poolAssignments,
      teamPairings,
    });
  } catch (error) {
    return handleError(error);
  }
}
