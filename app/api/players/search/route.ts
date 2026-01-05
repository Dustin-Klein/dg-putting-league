import { NextResponse } from 'next/server';
import { z } from 'zod';
import { searchPlayers } from '@/lib/services/player';
import { handleError, BadRequestError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const query = searchParams.get('query');
    const excludeEventId = searchParams.get('excludeEventId') || undefined;

    const schema = z.object({
      query: z.string().trim().min(1).max(100),
      excludeEventId: z.string().uuid().optional(),
    });

    const parsed = schema.safeParse({ query, excludeEventId });
    if (!parsed.success) {
      throw new BadRequestError('Invalid query parameters');
    }

    const results = await searchPlayers(parsed.data.query, parsed.data.excludeEventId);

    return NextResponse.json({ results });
  } catch (error) {
    return handleError(error);
  }
}
