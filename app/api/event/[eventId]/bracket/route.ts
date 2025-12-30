import { NextResponse } from 'next/server';
import {
  getBracketWithTeams,
  createBracket,
  bracketExists,
} from '@/lib/bracket';
import { getEventLanes } from '@/lib/lane';
import { handleError, BadRequestError } from '@/lib/errors';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const [data, lanes] = await Promise.all([
      getBracketWithTeams(eventId),
      getEventLanes(eventId),
    ]);

    // Create a map of lane_id to lane label for easy lookup
    const laneMap: Record<string, string> = {};
    for (const lane of lanes) {
      laneMap[lane.id] = lane.label;
    }

    return NextResponse.json({ ...data, lanes, laneMap });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;

    // Check if bracket already exists
    const exists = await bracketExists(eventId);
    if (exists) {
      throw new BadRequestError('Bracket already exists for this event');
    }

    const data = await createBracket(eventId);
    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}
