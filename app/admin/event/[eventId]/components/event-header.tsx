'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NextStatusButton } from '@/components/next-status-button';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { EventWithDetails } from '@/lib/types/event';

export function EventHeader({ event, onStatusUpdate }: { event: EventWithDetails; onStatusUpdate?: () => void }) {
  // Use the event prop directly since state is now managed by parent

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl font-bold">
              {formatDisplayDate(event.event_date)}
            </CardTitle>
            <p className="text-muted-foreground">
              {event.location || 'Location not specified'}
            </p>
          </div>
          <NextStatusButton
            event={event}
            onStatusUpdate={onStatusUpdate}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Access Code</h3>
            <div className="flex items-center mt-1">
              <code className="font-mono bg-muted px-2 py-1 rounded">
                {event.access_code}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="ml-2"
                onClick={() => {
                  navigator.clipboard.writeText(event.access_code);
                }}
              >
                Copy
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Putt Distance</h3>
            <p className="text-lg font-medium">{event.putt_distance_ft} ft</p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Lanes</h3>
            <p className="text-lg font-medium">{event.lane_count}</p>
          </div>

          {event.entry_fee_per_player != null && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Entry Fee</h3>
              <p className="text-lg font-medium">${Number(event.entry_fee_per_player).toFixed(2)}</p>
            </div>
          )}

          {event.entry_fee_per_player != null && (() => {
            const entryFee = Number(event.entry_fee_per_player);
            const players = Array.isArray(event.players) ? event.players : [];
            const cashCount = players.filter(p => p.payment_type === 'cash').length;
            const electronicCount = players.filter(p => p.payment_type === 'electronic').length;
            return (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Fees Collected</h3>
                <p className="text-sm">Cash: ${(cashCount * entryFee).toFixed(2)}</p>
                <p className="text-sm">Electronic: ${(electronicCount * entryFee).toFixed(2)}</p>
              </div>
            );
          })()}

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Participants</h3>
            <p className="text-lg font-medium">
              {event.players?.filter(p => p.payment_type !== null).length || 0}/{event.players?.length || 0} paid
            </p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Bonus Points</h3>
            <p className="text-lg font-medium">
              {event.bonus_point_enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Qualification Round</h3>
            <p className="text-lg font-medium">
              {event.qualification_round_enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
