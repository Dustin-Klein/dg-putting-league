import { NextResponse } from 'next/server';
import { getPublicBracket } from '@/lib/services/public';
import { handleError } from '@/lib/errors';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const bracket = await getPublicBracket(eventId);
    return NextResponse.json(bracket);
  } catch (error) {
    return handleError(error);
  }
}
