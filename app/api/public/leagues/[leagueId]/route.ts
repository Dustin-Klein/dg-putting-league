import { NextResponse } from 'next/server';
import { getPublicLeagueWithEvents } from '@/lib/services/public';
import { handleError } from '@/lib/errors';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await params;
    const league = await getPublicLeagueWithEvents(leagueId);
    return NextResponse.json(league);
  } catch (error) {
    return handleError(error);
  }
}
