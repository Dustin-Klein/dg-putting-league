import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPlayer } from '@/lib/services/player';
import { handleError, BadRequestError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import { withRateLimit } from '@/lib/middleware/rate-limit';

export async function POST(request: NextRequest) {
  const rateLimitResponse = withRateLimit(request, 'players:create');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const schema = z.object({
      name: z.string().trim().min(1),
      email: z.string().trim().email(),
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
