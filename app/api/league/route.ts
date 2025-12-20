import { NextResponse } from 'next/server';
import { createLeague } from '@/lib/league';
import { handleError, BadRequestError } from '@/lib/errors';

export async function POST(request: Request) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new BadRequestError('Invalid JSON body');
    }

    const league = await createLeague({
      name: body?.name,
      city: body?.city,
    });

    return NextResponse.json(league, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
