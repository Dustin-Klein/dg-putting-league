import { NextResponse } from 'next/server';
import { getOpenByes } from '@/lib/services/bracket/fill-bye';
import { handleError } from '@/lib/errors';

/** Round 1 byes and whether a late team can still take each one (admin). */
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    return NextResponse.json(await getOpenByes(eventId));
  } catch (error) {
    return handleError(error);
  }
}
