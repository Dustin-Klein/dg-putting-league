import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  setLaneMaintenance,
  setLaneIdle,
  autoAssignLanes,
  deleteLane,
} from '@/lib/services/lane';
import { requireEventAdmin } from '@/lib/services/event';
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
    const resolvedParams = await Promise.resolve(params);
    const { eventId, laneId } = resolvedParams;
    await requireEventAdmin(eventId);

    const body = await req.json();
    const parsed = updateLaneSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data. Status must be "idle" or "maintenance"');
    }

    let lane;
    if (parsed.data.status === 'maintenance') {
      lane = await setLaneMaintenance(eventId, laneId);
    } else {
      lane = await setLaneIdle(eventId, laneId);
      // After setting to idle, try to auto-assign if there are waiting matches
      // Wrap in try/catch so auto-assign failure doesn't fail the main operation
      try {
        await autoAssignLanes(eventId);
      } catch (assignError) {
        console.error('Failed to auto-assign lanes after setting idle:', assignError);
      }
    }

    return NextResponse.json(lane);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * DELETE /api/event/[eventId]/lanes/[laneId]
 * Delete a lane (only if idle)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ eventId: string; laneId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const { eventId, laneId } = resolvedParams;
    await requireEventAdmin(eventId);

    const deleted = await deleteLane(eventId, laneId);

    if (!deleted) {
      throw new BadRequestError('Lane could not be deleted. Only idle lanes can be removed.');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
