import { NextResponse } from 'next/server';
import { getPublicBracket } from '@/lib/services/public';
import { handleError } from '@/lib/errors';

export async function GET(
  _req: Request,
  { params }: { params: { eventId: string } }
) {
  try {
    const { eventId } = params;
    const bracket = await getPublicBracket(eventId);
    return NextResponse.json(bracket);
  } catch (error) {
    return handleError(error);
  }
}
