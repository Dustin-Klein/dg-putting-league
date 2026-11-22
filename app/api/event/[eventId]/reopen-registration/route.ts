import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reopenRegistration } from '@/lib/services/event';
import { BadRequestError, handleError } from '@/lib/errors';

const reopenSchema = z.object({ keep_teams: z.boolean(), discard_scores: z.boolean().optional() });

/** Take an event back from bracket play to registration (admin); scores need `discard_scores`. */
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const parsed = reopenSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new BadRequestError('Say whether to keep the teams');
    const result = await reopenRegistration(eventId, {
      keepTeams: parsed.data.keep_teams,
      discardScores: parsed.data.discard_scores ?? false,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
