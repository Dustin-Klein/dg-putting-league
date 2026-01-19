import { NextResponse } from 'next/server';
import { handleError } from '@/lib/errors';
import { getLeagueAdminsForOwner, addLeagueAdmin } from '@/lib/services/league';

type RouteParams = { params: Promise<{ leagueId: string }> | { leagueId: string } };

export async function GET(
  request: Request,
  { params: paramsPromise }: RouteParams
) {
  try {
    const params = await Promise.resolve(paramsPromise);
    const admins = await getLeagueAdminsForOwner(params.leagueId);
    return NextResponse.json({ admins });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: Request,
  { params: paramsPromise }: RouteParams
) {
  try {
    const params = await Promise.resolve(paramsPromise);
    const body = await request.json();
    const { email } = body;

    await addLeagueAdmin(params.leagueId, email);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
