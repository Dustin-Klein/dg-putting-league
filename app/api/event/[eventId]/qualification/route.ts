import { NextResponse } from 'next/server';
import { getEventQualificationStatus } from '@/lib/services/qualification';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError } from '@/lib/errors';

/**
 * GET: Get qualification status for an event (admin only)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;

    // Verify admin access
    await requireEventAdmin(eventId);

    const status = await getEventQualificationStatus(eventId);

    return NextResponse.json(status);
  } catch (error) {
    return handleError(error);
  }
}
