import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reopenRegistration } from '@/lib/services/event';
import { BadRequestError, handleError } from '@/lib/errors';

const reopenSchema = z.object({ keep_teams: z.boolean() });

/** Take an event with no scoring yet back from bracket play to registration (admin). */
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const parsed = reopenSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new BadRequestError('Say whether to keep the teams');
    await reopenRegistration(eventId, { keepTeams: parsed.data.keep_teams });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
