import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSecondChanceRoster, syncSecondChancePlayers } from '@/lib/services/event';
import { BadRequestError, handleError } from '@/lib/errors';
import { withRateLimit } from '@/lib/middleware/rate-limit';

/** A second-chance event's roster against who is out of the main event. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    return NextResponse.json(await getSecondChanceRoster(eventId));
  } catch (error) {
    return handleError(error);
  }
}

const syncSchema = z.object({ player_id: z.uuid().optional() });

/** Enter one knocked-out player (`player_id`), or every pending one when omitted. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withRateLimit(req, 'event:second-chance-sync');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { eventId } = await params;
    const text = await req.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new BadRequestError('Invalid JSON');
      }
    }
    const parsed = syncSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestError('Invalid player');
    return NextResponse.json(await syncSecondChancePlayers(eventId, parsed.data.player_id));
  } catch (error) {
    return handleError(error);
  }
}
