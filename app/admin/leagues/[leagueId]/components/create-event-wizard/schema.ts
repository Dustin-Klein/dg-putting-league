import * as z from 'zod';
import { isFutureOrToday } from '@/lib/utils/date-utils';
import { TEAM_SIZE_MAX, TEAM_SIZE_MIN } from '@/lib/types/event';
import { teamAssignmentOptions } from '@/lib/utils/team-utils';

const money = z.coerce.number().min(0, "Can't be negative").nullable().default(null);

export const createEventSchema = z.object({
  event_date: z.date({ error: 'Choose a date for the event' })
    .refine((date) => isFutureOrToday(date), { message: 'Event date must be today or in the future' }),
  location: z.string().trim().max(200).optional(),
  lane_count: z.coerce.number().int('Whole lanes only').min(1, 'Must have at least 1 lane'),
  putt_distance_ft: z.coerce.number().positive('Distance must be greater than 0'),
  access_code: z.string().trim().min(6, 'Access code must be at least 6 characters').max(50),
  qualification_round_enabled: z.boolean(),
  double_grand_final: z.boolean(),
  bracket_frame_count: z.coerce.number().int().min(1).max(10),
  qualification_frame_count: z.coerce.number().int().min(1).max(10),
  entry_fee_per_player: money,
  admin_fees: money,
  admin_fee_per_player: money,
  team_size: z.coerce.number().int().min(TEAM_SIZE_MIN).max(TEAM_SIZE_MAX),
  team_assignment: z.enum(['random_pairing', 'random_flat', 'manual']),
  handicap_enabled: z.boolean(),
}).refine(
  (values) => teamAssignmentOptions(values.team_size).some((option) => option.value === values.team_assignment),
  { message: 'Choose how teams are formed for this team size', path: ['team_assignment'] }
);

export type CreateEventFormValues = z.infer<typeof createEventSchema>;
export type CreateEventField = keyof CreateEventFormValues;
