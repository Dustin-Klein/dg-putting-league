'use client';

import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { EventWithDetails, UpdateEventStatusValues } from '../types';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const statusVariantMap = {
  registration: 'outline',
  qualification: 'secondary',
  bracket: 'default',
  completed: 'destructive',
} as const;

const statusLabelMap = {
  registration: 'Registration',
  qualification: 'Qualification',
  bracket: 'Bracket',
  completed: 'Completed',
} as const;

export function EventHeader({ event }: { event: EventWithDetails }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<EventWithDetails['status']>(event.status);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus: EventWithDetails['status']) => {
    try {
      setIsUpdating(true);
      setStatus(newStatus);
      
      const response = await fetch(`/api/event/${event.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus } as UpdateEventStatusValues),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      toast({
        title: 'Success',
        description: 'Event status updated successfully',
      });
    } catch (error) {
      console.error('Error updating status:', error);
      setStatus(event.status); // Revert on error
      toast({
        title: 'Error',
        description: 'Failed to update event status',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl font-bold">
              {format(new Date(event.event_date), 'MMMM d, yyyy')}
            </CardTitle>
            <p className="text-muted-foreground">
              {event.location || 'Location not specified'}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant={statusVariantMap[status]}>
              {statusLabelMap[status]}
            </Badge>
            <Select
              value={status}
              onValueChange={handleStatusChange}
              disabled={isUpdating}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Change status" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(statusLabelMap).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                  toast({
                    title: 'Copied!',
                    description: 'Access code copied to clipboard',
                  });
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
          
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Participants</h3>
            <p className="text-lg font-medium">{event.participant_count}</p>
          </div>
          
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Bonus Points</h3>
            <p className="text-lg font-medium">
              {event.bonus_point_enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
