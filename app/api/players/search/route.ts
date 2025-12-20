import { NextResponse } from 'next/server';
import { searchPlayers } from '@/lib/players';
import {
  UnauthorizedError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');

    const results = await searchPlayers(query);

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof InternalError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.error('Unhandled error in search players route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
