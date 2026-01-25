import { NextResponse } from 'next/server';
import { getPublicLeagues } from '@/lib/services/public';
import { handleError } from '@/lib/errors';

export async function GET() {
  try {
    const leagues = await getPublicLeagues();
    return NextResponse.json(leagues);
  } catch (error) {
    return handleError(error);
  }
}
