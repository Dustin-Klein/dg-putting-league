import { NextResponse } from 'next/server';
import { handleError } from '@/lib/errors';
import { removeLeagueAdmin } from '@/lib/services/league';

type RouteParams = { params: Promise<{ leagueId: string; userId: string }> | { leagueId: string; userId: string } };

export async function DELETE(
  request: Request,
  { params: paramsPromise }: RouteParams
) {
  try {
    const params = await Promise.resolve(paramsPromise);
    await removeLeagueAdmin(params.leagueId, params.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
