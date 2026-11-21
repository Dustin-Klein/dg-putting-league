import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { previewPlayerZones } from '@/lib/services/event-player';
import { BadRequestError, handleError } from '@/lib/errors';

const playerIdsSchema = z.array(z.uuid()).min(1).max(4);

/** The zone and distance the given players (`?player_id=…`, repeatable) would get in this event. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const parsed = playerIdsSchema.safeParse(req.nextUrl.searchParams.getAll('player_id'));
    if (!parsed.success) throw new BadRequestError('Give one to four player ids');
    return NextResponse.json({ players: await previewPlayerZones(eventId, parsed.data) });
  } catch (error) {
    return handleError(error);
  }
}
