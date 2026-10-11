import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSecondChanceEvent } from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

const secondChanceSchema = z.object({
  access_code: z.string().trim().min(6).max(50),
  exclude_top_placements: z.number().int().min(1).optional(),
  event_date: z.iso.date().optional(),
  location: z.string().nullable().optional(),
  lane_count: z.number().int().positive().optional(),
  putt_distance_ft: z.number().positive().optional(),
  bracket_frame_count: z.number().int().min(1).max(10).optional(),
  double_grand_final: z.boolean().optional(),
  entry_fee_per_player: z.number().min(0).nullable().optional(),
  admin_fees: z.number().min(0).nullable().optional(),
  admin_fee_per_player: z.number().min(0).nullable().optional(),
});

/**
 * Create a singles second-chance event linked to this (completed) event.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(req, 'event:second-chance');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await req.json().catch(() => {
      throw new BadRequestError('Invalid JSON body');
    });
    const parsed = secondChanceSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const { eventId } = await params;
    const event = await createSecondChanceEvent(eventId, parsed.data);
    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
