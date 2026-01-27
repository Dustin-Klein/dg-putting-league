import { NextResponse } from 'next/server';
import {
  getLanesWithMatches,
  autoAssignLanes,
} from '@/lib/services/lane';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError } from '@/lib/errors';

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
 * Trigger auto-assignment of lanes to ready matches
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    await requireEventAdmin(resolvedParams.eventId);
    const assignedCount = await autoAssignLanes(resolvedParams.eventId);
    return NextResponse.json({
      success: true,
      assignedCount,
      message: `Assigned ${assignedCount} lane(s) to matches`
    });
  } catch (error) {
    return handleError(error);
  }
}
