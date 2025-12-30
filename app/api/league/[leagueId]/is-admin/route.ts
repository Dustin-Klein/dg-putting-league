import { NextResponse } from 'next/server';
import { requireLeagueAdmin } from '@/lib/auth/league-auth';
import { handleError } from '@/lib/errors';

export async function GET(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ leagueId: string }> | { leagueId: string } }
) {
  try {
    const params = await Promise.resolve(paramsPromise);
    const leagueId = params.leagueId;
    
    const result = await requireLeagueAdmin(leagueId);

    return NextResponse.json({ isAdmin: result.isAdmin });
  } catch (error) {
    return handleError(error);
  }
}
