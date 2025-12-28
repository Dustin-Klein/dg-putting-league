import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPlayer } from '@/lib/players';
import { handleError, BadRequestError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  try {
    const schema = z.object({
      name: z.string().trim().min(1),
      email: z.string().email().optional().or(z.literal('')).transform(val => val || undefined),
      nickname: z.string().trim().optional(),
      default_pool: z.enum(['A','B']).optional(),
    });

    const body = await request.json();
    const parsed = schema.parse(body);

    const result = await createPlayer({
      name: parsed.name,
      email: parsed.email,
      nickname: parsed.nickname,
      defaultPool: parsed.default_pool as 'A' | 'B' | undefined,
    });

    logger.info('player_created', { playerId: result.id });

    return NextResponse.json({
      success: true,
      playerId: result.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(new BadRequestError('Invalid request data'));
    }
    return handleError(error);
  }
}
