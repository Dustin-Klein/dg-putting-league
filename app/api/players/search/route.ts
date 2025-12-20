import { NextResponse } from 'next/server';
import { searchPlayers } from '@/lib/players';
import { handleError } from '@/lib/errors';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const excludeEventId = searchParams.get('excludeEventId');

    const results = await searchPlayers(query, excludeEventId || undefined);

    return NextResponse.json({ results });
  } catch (error) {
    return handleError(error);
  }
}
