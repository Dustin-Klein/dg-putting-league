import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setByeHold } from '@/lib/services/bracket/fill-bye';
import { BadRequestError, handleError } from '@/lib/errors';

const holdSchema = z.object({ bye_match_id: z.number().int().positive(), hold: z.boolean() });

/** Hold or release the matches that would close a bye (admin). */
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const parsed = holdSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new BadRequestError('Give the bye match and whether to hold it');
    return NextResponse.json(await setByeHold(eventId, parsed.data.bye_match_id, parsed.data.hold));
  } catch (error) {
    return handleError(error);
  }
}
