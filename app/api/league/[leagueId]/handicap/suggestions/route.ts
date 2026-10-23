import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError } from '@/lib/errors';
import { listZoneSuggestions } from '@/lib/services/handicap';

type RouteParams = { params: Promise<{ leagueId: string }> };

const paramsSchema = z.object({ leagueId: z.uuid('Invalid league ID') });

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { leagueId } = paramsSchema.parse(await params);
    return NextResponse.json({ suggestions: await listZoneSuggestions(leagueId) });
  } catch (error) {
    return handleError(error);
  }
}
