import { NextResponse } from 'next/server';
import {
  getLanesWithMatches,
  autoAssignLanes,
  addLanes,
  resolveMatchDisplayNumber,
} from '@/lib/services/lane';
import { assignLaneToMatch } from '@/lib/services/bracket';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';

/**
 * GET /api/event/[eventId]/lanes
 * Returns all lanes for an event with their current match assignments
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    await requireEventAdmin(resolvedParams.eventId);
    const lanes = await getLanesWithMatches(resolvedParams.eventId);
    return NextResponse.json(lanes);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/event/[eventId]/lanes
 * Actions:
 *   - 'auto-assign' (default): trigger auto-assignment of lanes to ready matches
 *   - 'add': add new lanes to the event
 *   - 'assign': assign a specific lane to a specific match
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    await requireEventAdmin(resolvedParams.eventId);

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'auto-assign';

    if (action === 'add') {
      const count = body.count;
      if (typeof count !== 'number' || count < 1 || count > 20) {
        throw new BadRequestError('count must be a number between 1 and 20');
      }
      const lanes = await addLanes(resolvedParams.eventId, count);
      return NextResponse.json({ success: true, lanes });
    }

    if (action === 'assign') {
      const { laneId, matchNumber } = body;
      if (typeof laneId !== 'string' || typeof matchNumber !== 'number') {
        throw new BadRequestError('laneId (string) and matchNumber (number) are required');
      }
      const matchId = await resolveMatchDisplayNumber(resolvedParams.eventId, matchNumber);
      if (!matchId) {
        throw new BadRequestError(`Match M${matchNumber} not found`);
      }
      await assignLaneToMatch(resolvedParams.eventId, matchId, laneId);
      return NextResponse.json({ success: true });
    }

    if (action === 'auto-assign') {
      const assignedCount = await autoAssignLanes(resolvedParams.eventId);
      return NextResponse.json({
        success: true,
        assignedCount,
        message: `Assigned ${assignedCount} lane(s) to matches`
      });
    }

    throw new BadRequestError(`Unknown action: ${action}`);
  } catch (error) {
    return handleError(error);
  }
}
