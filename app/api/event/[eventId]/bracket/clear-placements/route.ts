import { NextResponse } from 'next/server';
import { clearBracketPlacements } from '@/lib/services/bracket';
import { handleError } from '@/lib/errors';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const data = await clearBracketPlacements(eventId);
    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}
