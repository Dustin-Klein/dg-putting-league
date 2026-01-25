import { NextResponse } from 'next/server';
import { getPublicLeagueWithEvents } from '@/lib/services/league/league-service';
import { handleError } from '@/lib/errors';

export async function GET(
  _req: Request,
  props: { params: Promise<{ leagueId: string }> }
) {
  try {
    const params = await props.params;
    const { leagueId } = params;
    const league = await getPublicLeagueWithEvents(leagueId);
    return NextResponse.json(league);
  } catch (error) {
    return handleError(error);
  }
}
