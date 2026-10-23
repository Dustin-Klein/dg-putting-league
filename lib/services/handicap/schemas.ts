import { z } from 'zod';
import { MAX_ZONES } from '@/lib/types/handicap';

/** Request schemas shared by the handicap routes (and their tests). */

const distanceFt = z.number().positive().max(999.99);

export const zoneDefinitionSchema = z.object({
  zone: z.number().int().min(1).max(MAX_ZONES),
  distance_ft: distanceFt,
});

export const zoneListSchema = z.array(zoneDefinitionSchema).min(2).max(MAX_ZONES);

export const handicapSettingsSchema = z.object({
  enabled: z.boolean(),
  default_zone: z.number().int().min(1).max(MAX_ZONES),
  demote_below_pct: z.number().min(0).max(100),
  promote_above_pct: z.number().min(0).max(100),
  min_putts: z.number().int().min(0).max(100000),
  min_matches: z.number().int().min(0).max(1000),
  window_putts: z.number().int().positive().max(100000).nullable(),
  count_qualification_putts: z.boolean(),
  auto_demote_enabled: z.boolean(),
}).refine((s) => s.demote_below_pct < s.promote_above_pct, {
  message: 'The demotion threshold must be below the promotion threshold',
}).refine((s) => s.min_putts > 0 || s.min_matches > 0, {
  message: 'At least one eligibility minimum must be greater than 0',
});

export const updateHandicapSettingsSchema = z.object({
  settings: handicapSettingsSchema,
  zones: zoneListSchema.optional(),
});

export const setPlayerZoneSchema = z.object({
  zone: z.number().int().min(1).max(MAX_ZONES),
  note: z.string().trim().min(1, 'A note is required').max(1000),
});

export const resolveSuggestionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('apply'), note: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal('dismiss'), note: z.string().trim().min(1, 'A note is required to dismiss').max(1000) }),
]);

export const eventZoneDistancesSchema = z.object({ zones: zoneListSchema });

export const entryHandicapSchema = z.object({
  putt_distance_ft: distanceFt.nullable().optional(),
  exclude_from_handicap: z.boolean().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}).refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });
