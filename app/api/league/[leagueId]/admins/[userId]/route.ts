import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError } from '@/lib/errors';
import { removeLeagueAdmin } from '@/lib/services/league';

type RouteParams = { params: { leagueId: string; userId: string } };

const paramsSchema = z.object({
  leagueId: z.uuid("Invalid league ID"),
  userId: z.uuid("Invalid user ID"),
});

export async function DELETE(
  request: Request,
  { params }: RouteParams
) {
  try {
    const { leagueId, userId } = paramsSchema.parse(params);

    await removeLeagueAdmin(leagueId, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
