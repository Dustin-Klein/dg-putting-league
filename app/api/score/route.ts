import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAccessCode, getMatchesForScoring } from '@/lib/services/scoring/public-scoring';
import {
  validateQualificationAccessCode,
  getPlayersForQualification,
} from '@/lib/services/qualification';
import { handleError, BadRequestError, NotFoundError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const validateCodeSchema = z.object({
  access_code: z.string().min(1),
});

/**
 * POST: Validate access code and get event info
 * Returns different data based on event status:
 * - pre-bracket + qualification_round_enabled: players for qualification
 * - bracket: matches for scoring
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = validateCodeSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Access code is required');
    }

    const accessCode = parsed.data.access_code;

    // First, check if this is a pre-bracket event with qualification enabled
    const supabase = await createClient();
    const { data: eventCheck } = await supabase
      .from('events')
      .select('id, status, qualification_round_enabled')
      .eq('access_code', accessCode)
      .maybeSingle();

    if (!eventCheck) {
      throw new NotFoundError('Invalid access code');
    }

    // Handle qualification mode
    if (eventCheck.status === 'pre-bracket' && eventCheck.qualification_round_enabled) {
      const event = await validateQualificationAccessCode(accessCode);
      const players = await getPlayersForQualification(accessCode);

      return NextResponse.json({
        event,
        mode: 'qualification',
        players,
      });
    }

    // Handle bracket mode
    if (eventCheck.status === 'bracket') {
      const event = await validateAccessCode(accessCode);
      const matches = await getMatchesForScoring(accessCode);

      return NextResponse.json({
        event,
        mode: 'bracket',
        matches,
      });
    }

    // Event is not in a scoreable state
    throw new BadRequestError('Event is not accepting scores at this time');
  } catch (error) {
    return handleError(error);
  }
}
