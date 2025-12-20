import { NextResponse } from 'next/server';
import { createPlayer } from '@/lib/players';
import { handleError } from '@/lib/errors';

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
    return handleError(error);
  }
}
