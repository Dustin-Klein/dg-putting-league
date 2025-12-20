import { NextResponse } from 'next/server';
import { createPlayer } from '@/lib/players';
import {
  UnauthorizedError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = await createPlayer({
      name: body.name?.toString(),
      email: body.email?.toString(),
      nickname: body.nickname?.toString(),
      defaultPool: body.default_pool as 'A' | 'B' | undefined,
    });

    return NextResponse.json({
      success: true,
      playerId: result.id,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof BadRequestError) {
      return NextResponse.json(
        {
          error: error.message,
          playerId: (error as any).playerId,
        },
        { status: 400 }
      );
    }

    if (error instanceof InternalError) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    console.error('Unhandled error in create player route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
