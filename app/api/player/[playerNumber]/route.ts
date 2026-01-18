import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlayerProfile } from '@/lib/services/player-statistics';
import { handleError, BadRequestError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    playerNumber: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { playerNumber: playerNumberParam } = await params;

    const schema = z.coerce.number().int().positive();
    const parsed = schema.safeParse(playerNumberParam);

    if (!parsed.success) {
      throw new BadRequestError('Invalid player number');
    }

    const profile = await getPlayerProfile(parsed.data);

    return NextResponse.json(profile);
  } catch (error) {
    return handleError(error);
  }
}
