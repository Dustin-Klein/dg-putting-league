'use client';

import { use } from 'react';
import { RosterScreen } from './roster-screen';

export default function RosterPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  return <RosterScreen eventId={eventId} />;
}
