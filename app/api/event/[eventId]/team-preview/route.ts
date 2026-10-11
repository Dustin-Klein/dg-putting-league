import { NextResponse } from 'next/server';
import { previewTeams } from '@/lib/services/event';
import { handleError } from '@/lib/errors';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    return NextResponse.json(await previewTeams(eventId));
  } catch (error) {
    return handleError(error);
  }
}
