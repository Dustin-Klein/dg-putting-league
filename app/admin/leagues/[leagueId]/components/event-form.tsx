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
import { TEAM_SIZE_MAX, TEAM_SIZE_MIN } from '@/lib/types/event';
import { TEAM_SIZE_LABELS, teamAssignmentOptions } from '@/lib/utils/team-utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const eventFormSchema = z.object({
  event_date: z.date()
    .refine((date) => isFutureOrToday(date), {
      message: 'Event date must be today or in the future',
    }),
  location: z.string().min(2, 'Location must be at least 2 characters').optional(),
  lane_count: z.coerce.number().int().positive('Must have at least 1 lane').default(1),
  putt_distance_ft: z.coerce.number().positive('Distance must be greater than 0').default(15),
  access_code: z.string().trim().min(6, 'Access code must be at least 6 characters'),
  qualification_round_enabled: z.boolean().default(false),
  double_grand_final: z.boolean().default(true),
  bracket_frame_count: z.coerce.number().int().min(1).max(10).default(5),
  qualification_frame_count: z.coerce.number().int().min(1).max(10).default(5),
  entry_fee_per_player: z.coerce.number().min(0).nullable().default(null),
  admin_fees: z.coerce.number().min(0).nullable().default(null),
  admin_fee_per_player: z.coerce.number().min(0).nullable().default(null),
  team_size: z.coerce.number().int().min(TEAM_SIZE_MIN).max(TEAM_SIZE_MAX).default(2),
  team_assignment: z.enum(['random_pairing', 'random_flat', 'manual']).default('random_pairing'),
}).refine(
  (values) => teamAssignmentOptions(values.team_size).some((option) => option.value === values.team_assignment),
  { message: 'Choose how teams are formed for this team size', path: ['team_assignment'] }
);

export type EventFormValues = z.infer<typeof eventFormSchema>;

interface EventFormProps {
  onSubmit: (values: EventFormValues) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  submitButtonText?: string;
  showCancelButton?: boolean;
  defaultValues?: Partial<EventFormValues>;
  error?: string | null;
  extraContent?: React.ReactNode;
}

export function EventForm({
  onSubmit,
  onCancel,
  isLoading = false,
  submitButtonText = 'Create Event',
  showCancelButton = true,
  defaultValues,
  error,
  extraContent,
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
      double_grand_final: true,
      team_size: 2,
      team_assignment: 'random_pairing',
      ...defaultValues,
    },
  });

  const qualificationRoundEnabled = form.watch('qualification_round_enabled');
  const assignmentOptions = teamAssignmentOptions(form.watch('team_size'));

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
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-col">
        <div className="flex min-h-0 flex-col gap-[26px] overflow-y-auto px-5 py-6 sm:px-7">
      <FormGroup title="When & where">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="event_date"
          render={({ field }) => (
            <FormItem>
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
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
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
              <FormMessage />
            </FormItem>
          )}
        />

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
                    className="flex-1 font-score text-lg tracking-wider"
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
              <FormDescription className="text-xs">
                Players type this to score.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        </div>
      </FormGroup>

      <FormGroup title="Scoring">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
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
                <p className="text-xs text-muted-foreground">
                  If the league uses handicaps, players putt from their zone&apos;s distance instead.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

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
              <FormDescription className="text-xs">
                Frames per match in bracket play (1-10)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        </div>
        <FormField
          control={form.control}
          name="qualification_round_enabled"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 space-y-0 rounded-xl bg-muted px-3.5 py-3">
              <div className="flex flex-col gap-0.5">
                <FormLabel>Qualification Round</FormLabel>
                <FormDescription className="text-xs">
                  Include a qualification round to seed players (and set A/B pools for random doubles)
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="data-[state=checked]:bg-success"
                />
              </FormControl>
            </FormItem>
          )}
        />

        {qualificationRoundEnabled && (
          <FormField
            control={form.control}
            name="qualification_frame_count"
            render={({ field }) => (
              <FormItem className="sm:max-w-[calc(50%-0.5rem)]">
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
                <FormDescription className="text-xs">
                  Frames per player in the qualification round (1-10)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </FormGroup>

      <FormGroup title="Teams & bracket">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="team_size"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Team Size</FormLabel>
                <Select
                  value={String(field.value)}
                  onValueChange={(value) => {
                    const size = Number(value);
                    field.onChange(size);
                    const options = teamAssignmentOptions(size);
                    if (!options.some((option) => option.value === form.getValues('team_assignment'))) {
                      form.setValue('team_assignment', options[0].value);
                    }
                  }}
                  disabled={isLoading}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(TEAM_SIZE_LABELS).map(([size, label]) => (
                      <SelectItem key={size} value={size}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">Players per bracket entrant</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {assignmentOptions.length > 1 && (
            <FormField
              control={form.control}
              name="team_assignment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team Assignment</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={isLoading}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {assignmentOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">How teams are formed when bracket play starts</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
        <FormField
          control={form.control}
          name="double_grand_final"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 space-y-0 rounded-xl bg-muted px-3.5 py-3">
              <div className="flex flex-col gap-0.5">
                <FormLabel>Grand Final Reset</FormLabel>
                <FormDescription className="text-xs">
                  WB champion must lose twice in the grand final
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="data-[state=checked]:bg-success"
                />
              </FormControl>
            </FormItem>
          )}
        />
      </FormGroup>

      <FormGroup title="Money">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="entry_fee_per_player"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Entry Fee</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        field.onChange(val === '' ? null : Number(val));
                      }}
                      disabled={isLoading}
                      className="pl-7"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="admin_fee_per_player"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Admin Fee per Player</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        field.onChange(val === '' ? null : Number(val));
                      }}
                      disabled={isLoading}
                      className="pl-7"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="admin_fees"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Admin Fee per Event</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        field.onChange(val === '' ? null : Number(val));
                      }}
                      disabled={isLoading}
                      className="pl-7"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </FormGroup>

        {extraContent}
        </div>

        <div className="flex flex-col gap-2 border-t px-5 py-[18px] sm:px-7">
          {error && (
            <div className="text-sm font-medium text-destructive sm:text-right">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2.5">
            {showCancelButton && onCancel && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" size="lg" disabled={isLoading}>
              {isLoading ? 'Saving...' : submitButtonText}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}

function FormGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-0">
      <legend className="pb-3 text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}
