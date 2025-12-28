import { NextResponse } from 'next/server';
import {
  getBracketWithTeams,
  createBracket,
  bracketExists,
} from '@/lib/bracket';
import { handleError, BadRequestError } from '@/lib/errors';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const data = await getBracketWithTeams(eventId);
    return NextResponse.json(data);
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
