import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fillBye } from '@/lib/services/bracket/fill-bye';
import { BadRequestError, handleError } from '@/lib/errors';

const fillSchema = z
  .object({
    bye_match_id: z.number().int().positive(),
    player_ids: z.array(z.uuid()).min(1).max(4),
    payments: z.array(z.enum(['cash', 'electronic']).nullable()).min(1).max(4),
  })
  .refine((body) => body.payments.length === body.player_ids.length, { message: 'One payment per player' });

/** Enter a new team into a Round 1 bye during bracket play (admin). */
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const parsed = fillSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new BadRequestError('Choose a bye, the new team’s players and their payments');
    return NextResponse.json(
      await fillBye(eventId, {
        byeMatchId: parsed.data.bye_match_id,
        playerIds: parsed.data.player_ids,
        payments: parsed.data.payments,
      })
    );
  } catch (error) {
    return handleError(error);
  }
}
