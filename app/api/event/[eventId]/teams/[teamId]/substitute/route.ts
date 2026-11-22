import { NextResponse } from 'next/server';
import { z } from 'zod';
import { substituteTeamMember } from '@/lib/services/team/substitution';
import { BadRequestError, handleError } from '@/lib/errors';
import { PAYMENT_TYPES } from '@/lib/types/player';

const substituteSchema = z.object({
  out_event_player_id: z.uuid(),
  player_id: z.uuid(),
  payment_type: z.enum(PAYMENT_TYPES).nullable(),
  reason: z.enum(['missed_registration', 'left_early', 'injury', 'wrong_player']),
});

/** Swap a player onto a team during bracket play (admin). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; teamId: string }> }
) {
  try {
    const { eventId, teamId } = await params;
    if (!z.uuid().safeParse(teamId).success) throw new BadRequestError('Invalid team ID');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new BadRequestError('Invalid JSON');
    }
    const parsed = substituteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestError('Choose who comes out, who goes in, a reason and a payment');
    const result = await substituteTeamMember(eventId, teamId, {
      outEventPlayerId: parsed.data.out_event_player_id,
      playerId: parsed.data.player_id,
      paymentType: parsed.data.payment_type,
      reason: parsed.data.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
