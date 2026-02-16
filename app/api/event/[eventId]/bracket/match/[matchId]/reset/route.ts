import { NextResponse } from 'next/server';
import { resetMatchResult } from '@/lib/services/bracket';
import { handleError, BadRequestError } from '@/lib/errors';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const matchIdNum = parseInt(matchId, 10);

    if (isNaN(matchIdNum)) {
      throw new BadRequestError('Invalid match ID');
    }

    const result = await resetMatchResult(eventId, matchIdNum);

    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
