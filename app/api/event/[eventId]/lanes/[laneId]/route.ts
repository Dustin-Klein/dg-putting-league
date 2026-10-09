import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  setLaneMaintenance,
  setLaneIdle,
  deleteLane,
} from '@/lib/services/lane';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';

export const updateLaneSchema = z.object({
  status: z.enum(['idle', 'maintenance']),
  confirm: z.boolean().optional().default(false),
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
      lane = await setLaneMaintenance(eventId, laneId, parsed.data.confirm);
    } else {
      lane = await setLaneIdle(eventId, laneId);
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
