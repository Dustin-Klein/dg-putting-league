import { NextRequest, NextResponse } from 'next/server';
import { getAdminEventStats } from '@/lib/services/event-stats';
import { handleError } from '@/lib/errors';

/** The admin event report. Organizer-only data: never cached. */
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await props.params;
    const stats = await getAdminEventStats(eventId);
    return NextResponse.json(stats, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleError(error);
  }
}
