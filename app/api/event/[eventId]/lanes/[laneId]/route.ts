import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  setLaneMaintenance,
  setLaneIdle,
  autoAssignLanes,
} from '@/lib/lane';
import { handleError, BadRequestError } from '@/lib/errors';

const updateLaneSchema = z.object({
  status: z.enum(['idle', 'maintenance']),
});

/**
 * PATCH /api/event/[eventId]/lanes/[laneId]
 * Update lane status (set to maintenance or idle)
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string; laneId: string }> }
) {
  try {
    const body = await req.json();
    const parsed = updateLaneSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data. Status must be "idle" or "maintenance"');
    }

    const resolvedParams = await Promise.resolve(params);
    const { eventId, laneId } = resolvedParams;

    let lane;
    if (parsed.data.status === 'maintenance') {
      lane = await setLaneMaintenance(eventId, laneId);
    } else {
      lane = await setLaneIdle(eventId, laneId);
      // After setting to idle, try to auto-assign if there are waiting matches
      await autoAssignLanes(eventId);
    }

    return NextResponse.json(lane);
  } catch (error) {
    return handleError(error);
  }
}
