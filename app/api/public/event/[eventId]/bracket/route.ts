import { NextResponse } from 'next/server';
import { getPublicBracket } from '@/lib/services/bracket/bracket-service';
import { handleError } from '@/lib/errors';

export async function GET(
  _req: Request,
  props: { params: Promise<{ eventId: string }> }
) {
  try {
    const params = await props.params;
    const { eventId } = params;
    const bracket = await getPublicBracket(eventId);
    return NextResponse.json(bracket);
  } catch (error) {
    return handleError(error);
  }
}
