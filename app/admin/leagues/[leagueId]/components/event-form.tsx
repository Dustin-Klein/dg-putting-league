'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { formatDisplayDate, isFutureOrToday } from '@/lib/utils/date-utils';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils/utils';

export const eventFormSchema = z.object({
  event_date: z.date()
    .refine((date) => isFutureOrToday(date), {
      message: 'Event date must be today or in the future',
    }),
  location: z.string().min(2, 'Location must be at least 2 characters').optional(),
  lane_count: z.coerce.number().int().positive('Must have at least 1 lane').default(1),
  putt_distance_ft: z.coerce.number().positive('Distance must be greater than 0').default(15),
  access_code: z.string().min(4, 'Access code must be at least 4 characters'),
  qualification_round_enabled: z.boolean().default(false),
  bracket_frame_count: z.coerce.number().int().min(1).max(10).default(5),
  qualification_frame_count: z.coerce.number().int().min(1).max(10).default(5),
});

export type EventFormValues = z.infer<typeof eventFormSchema>;

interface EventFormProps {
  onSubmit: (values: EventFormValues) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  submitButtonText?: string;
  showCancelButton?: boolean;
  defaultValues?: Partial<EventFormValues>;
  error?: string | null;
}

export function EventForm({
  onSubmit,
  onCancel,
  isLoading = false,
  submitButtonText = 'Create Event',
  showCancelButton = true,
  defaultValues,
  error,
}: EventFormProps) {
  // Generate initial code
  const initialCode = (() => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  })();

  const form = useForm<z.infer<typeof eventFormSchema>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(eventFormSchema) as any,
    defaultValues: {
      lane_count: 1,
      putt_distance_ft: 15,
      access_code: initialCode,
      bracket_frame_count: 5,
      qualification_frame_count: 5,
      ...defaultValues,
    },
  });

  const qualificationRoundEnabled = form.watch('qualification_round_enabled');

  const generateRandomCode = (length: number = 6): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(
      { length },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  const handleGenerateCode = () => {
    form.setValue('access_code', generateRandomCode(6));
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="event_date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Event Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      type="button"
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        formatDisplayDate(field.value)
                      ) : (
                        <span>Pick a date</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => !isFutureOrToday(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormDescription>
                Select the date for this event.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location (Optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., Central Park"
                  {...field}
                  value={field.value || ''}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                Where will this event take place?
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="lane_count"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Number of Lanes</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    {...field}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="putt_distance_ft"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Putt Distance (ft)</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.5"
                      min="1"
                      {...field}
                      disabled={isLoading}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      ft
                    </span>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="bracket_frame_count"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bracket Frames</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                Number of frames per match in bracket play (1-10)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="qualification_round_enabled"
          render={({ field }) => (
            <FormItem className="w-full">
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Qualification Round</FormLabel>
                    <FormDescription>
                      Enable to include a qualification round to determine A/B pools
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </div>
              </div>
            </FormItem>
          )}
        />

        {qualificationRoundEnabled && (
          <FormField
            control={form.control}
            name="qualification_frame_count"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Qualification Frames</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    {...field}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormDescription>
                  Number of frames per player in qualification round (1-10)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="access_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Access Code</FormLabel>
              <div className="flex gap-2">
                <FormControl>
                  <Input
                    placeholder="e.g., ABC123"
                    {...field}
                    disabled={isLoading}
                    className="flex-1"
                  />
                </FormControl>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleGenerateCode}
                  disabled={isLoading}
                >
                  Generate
                </Button>
              </div>
              <FormDescription>
                This code will be used by participants to join the event.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && (
          <div className="text-sm font-medium text-destructive text-right mb-2">
            {error}
          </div>
        )}

        <div className="flex justify-end space-x-4">
          {showCancelButton && onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving...' : submitButtonText}
          </Button>
        </div>
      </form>
    </Form>
  );
}
