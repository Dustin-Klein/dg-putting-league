import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DataTypes,
  OmitId,
  Storage,
  Table,
} from 'brackets-manager';
import type { Id, Match } from 'brackets-model';
import { Status } from 'brackets-model';
import { createClient } from '@/lib/supabase/server';
import { BadRequestError, InternalError } from '@/lib/errors';

// Map brackets-manager table names to our Supabase table names
const TABLE_MAP: Record<Table, string> = {
  stage: 'bracket_stage',
  group: 'bracket_group',
  round: 'bracket_round',
  match: 'bracket_match',
  match_game: 'bracket_match_game',
  participant: 'bracket_participant',
};

/**
 * Supabase storage adapter for brackets-manager
 * Implements the Storage interface required by brackets-manager
 */
export class SupabaseBracketStorage implements Storage {
  private supabase: SupabaseClient;
  private eventId: string;

  constructor(supabase: SupabaseClient, eventId: string) {
    this.supabase = supabase;
    this.eventId = eventId;
  }

  private getTableName(table: Table): string {
    return TABLE_MAP[table];
  }

  /**
   * Insert a single value and return its ID
   */
  async insert<T extends Table>(
    table: T,
    value: OmitId<DataTypes[T]>
  ): Promise<number>;

  /**
   * Insert multiple values
   */
  async insert<T extends Table>(
    table: T,
    values: OmitId<DataTypes[T]>[]
  ): Promise<boolean>;

  async insert<T extends Table>(
    table: T,
    valueOrValues: OmitId<DataTypes[T]> | OmitId<DataTypes[T]>[]
  ): Promise<number | boolean> {
    const tableName = this.getTableName(table);

    if (Array.isArray(valueOrValues)) {
      // Insert multiple values
      const mappedValues = valueOrValues.map((v) =>
        this.mapToSupabaseFormat(table, v)
      );
      const { error } = await this.supabase.from(tableName).insert(mappedValues);

      if (error) {
        console.error(`Error inserting into ${tableName}:`, error);
        return false;
      }
      return true;
    } else {
      // Insert single value and return ID
      const mappedValue = this.mapToSupabaseFormat(table, valueOrValues);
      const { data, error } = await this.supabase
        .from(tableName)
        .insert(mappedValue)
        .select('id')
        .single();

      if (error || !data) {
        console.error(`Error inserting into ${tableName}:`, error);
        throw new Error(`Failed to insert into ${tableName}: ${error?.message}`);
      }

      return data.id as number;
    }
  }

  /**
   * Select all data from a table
   */
  async select<T extends Table>(table: T): Promise<Array<DataTypes[T]> | null>;

  /**
   * Select a single item by ID
   */
  async select<T extends Table>(
    table: T,
    id: Id
  ): Promise<DataTypes[T] | null>;

  /**
   * Select items matching a filter
   */
  async select<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>
  ): Promise<Array<DataTypes[T]> | null>;

  async select<T extends Table>(
    table: T,
    idOrFilter?: Id | Partial<DataTypes[T]>
  ): Promise<DataTypes[T] | Array<DataTypes[T]> | null> {
    const tableName = this.getTableName(table);

    if (idOrFilter === undefined) {
      // Select all - filter by event_id/tournament_id for relevant tables
      let query = this.supabase.from(tableName).select('*');

      if (table === 'stage' || table === 'participant') {
        query = query.eq('tournament_id', this.eventId);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`Error selecting from ${tableName}:`, error);
        return null;
      }

      return (data?.map((row) => this.mapFromSupabaseFormat(table, row)) ??
        null) as Array<DataTypes[T]>;
    } else if (typeof idOrFilter === 'number' || typeof idOrFilter === 'string') {
      // Select by ID
      const { data, error } = await this.supabase
        .from(tableName)
        .select('*')
        .eq('id', idOrFilter)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapFromSupabaseFormat(table, data) as DataTypes[T];
    } else {
      // Select by filter
      const mappedFilter = this.mapFilterToSupabase(table, idOrFilter);
      let query = this.supabase.from(tableName).select('*');

      for (const [key, value] of Object.entries(mappedFilter)) {
        if (value !== undefined) {
          query = query.eq(key, value);
        }
      }

      const { data, error } = await query;

      if (error) {
        console.error(`Error selecting from ${tableName}:`, error);
        return null;
      }

      return (data?.map((row) => this.mapFromSupabaseFormat(table, row)) ??
        null) as Array<DataTypes[T]>;
    }
  }

  /**
   * Update a record by ID
   */
  async update<T extends Table>(
    table: T,
    id: Id,
    value: DataTypes[T]
  ): Promise<boolean>;

  /**
   * Update records matching a filter
   */
  async update<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>,
    value: Partial<DataTypes[T]>
  ): Promise<boolean>;

  async update<T extends Table>(
    table: T,
    idOrFilter: Id | Partial<DataTypes[T]>,
    value: DataTypes[T] | Partial<DataTypes[T]>
  ): Promise<boolean> {
    const tableName = this.getTableName(table);
    const mappedValue = this.mapToSupabaseFormat(table, value as OmitId<DataTypes[T]>);

    // For bracket_match updates, use SECURITY DEFINER function to bypass permission issues
    if (table === 'match' && typeof idOrFilter === 'number') {
      const { error } = await this.supabase.rpc('update_bracket_match_score', {
        p_match_id: idOrFilter,
        p_status: mappedValue.status ?? null,
        p_opponent1: mappedValue.opponent1 ?? null,
        p_opponent2: mappedValue.opponent2 ?? null,
      });

      if (error) {
        console.error(`Error updating ${tableName}:`, error);
        return false;
      }
      return true;
    }

    // Add updated_at timestamp only for tables that have it (only match)
    if (table === 'match') {
      (mappedValue as Record<string, unknown>).updated_at = new Date().toISOString();
    }

    if (typeof idOrFilter === 'number' || typeof idOrFilter === 'string') {
      // Update by ID
      const { error } = await this.supabase
        .from(tableName)
        .update(mappedValue)
        .eq('id', idOrFilter);

      if (error) {
        console.error(`Error updating ${tableName}:`, error);
        return false;
      }
      return true;
    } else {
      // Update by filter
      const mappedFilter = this.mapFilterToSupabase(table, idOrFilter);
      let query = this.supabase.from(tableName).update(mappedValue);

      for (const [key, val] of Object.entries(mappedFilter)) {
        if (val !== undefined) {
          query = query.eq(key, val);
        }
      }

      const { error } = await query;

      if (error) {
        console.error(`Error updating ${tableName}:`, error);
        return false;
      }
      return true;
    }
  }

  /**
   * Delete all records from a table
   */
  async delete<T extends Table>(table: T): Promise<boolean>;

  /**
   * Delete records matching a filter
   */
  async delete<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>
  ): Promise<boolean>;

  async delete<T extends Table>(
    table: T,
    filter?: Partial<DataTypes[T]>
  ): Promise<boolean> {
    const tableName = this.getTableName(table);

    if (filter === undefined) {
      // Delete all records for this event
      let query = this.supabase.from(tableName).delete();

      if (table === 'stage' || table === 'participant') {
        query = query.eq('tournament_id', this.eventId);
      }

      const { error } = await query;

      if (error) {
        console.error(`Error deleting from ${tableName}:`, error);
        return false;
      }
      return true;
    } else {
      // Delete by filter
      const mappedFilter = this.mapFilterToSupabase(table, filter);
      let query = this.supabase.from(tableName).delete();

      for (const [key, value] of Object.entries(mappedFilter)) {
        if (value !== undefined) {
          query = query.eq(key, value);
        }
      }

      const { error } = await query;

      if (error) {
        console.error(`Error deleting from ${tableName}:`, error);
        return false;
      }
      return true;
    }
  }

  /**
   * Select the first matching record
   */
  async selectFirst<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>,
    assertUnique?: boolean
  ): Promise<DataTypes[T] | null> {
    const tableName = this.getTableName(table);
    const mappedFilter = this.mapFilterToSupabase(table, filter);

    let query = this.supabase.from(tableName).select('*');

    for (const [key, value] of Object.entries(mappedFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    query = query.order('id', { ascending: true }).limit(1);

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return null;
    }

    if (assertUnique && data.length > 1) {
      throw new Error(`Expected unique result but found ${data.length} records`);
    }

    return this.mapFromSupabaseFormat(table, data[0]) as DataTypes[T];
  }

  /**
   * Select the last matching record
   */
  async selectLast<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>,
    assertUnique?: boolean
  ): Promise<DataTypes[T] | null> {
    const tableName = this.getTableName(table);
    const mappedFilter = this.mapFilterToSupabase(table, filter);

    let query = this.supabase.from(tableName).select('*');

    for (const [key, value] of Object.entries(mappedFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    query = query.order('id', { ascending: false }).limit(1);

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return null;
    }

    if (assertUnique && data.length > 1) {
      throw new Error(`Expected unique result but found ${data.length} records`);
    }

    return this.mapFromSupabaseFormat(table, data[0]) as DataTypes[T];
  }

  /**
   * Map brackets-manager format to Supabase format
   */
  private mapToSupabaseFormat<T extends Table>(
    table: T,
    value: OmitId<DataTypes[T]> | Partial<DataTypes[T]>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // Map field names
      if (key === 'tournament_id' && (table === 'stage' || table === 'participant')) {
        result['tournament_id'] = val;
      } else if (key === 'stage_id') {
        result['stage_id'] = val;
      } else if (key === 'group_id') {
        result['group_id'] = val;
      } else if (key === 'round_id') {
        result['round_id'] = val;
      } else if (key === 'parent_id') {
        result['parent_id'] = val;
      } else {
        result[key] = val;
      }
    }

    return result;
  }

  /**
   * Map Supabase format to brackets-manager format
   */
  private mapFromSupabaseFormat<T extends Table>(
    table: T,
    row: Record<string, unknown>
  ): DataTypes[T] {
    // The data is mostly compatible, just return with proper types
    return row as unknown as DataTypes[T];
  }

  /**
   * Map filter to Supabase format
   */
  private mapFilterToSupabase<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>
  ): Record<string, unknown> {
    return this.mapToSupabaseFormat(table, filter);
  }
}

// ============================================================================
// Standalone bracket data access functions
// ============================================================================

export interface BracketMatchForScoring {
  id: number;
  status: number;
  round_id: number;
  number: number;
  lane_id: string | null;
  opponent1: { id?: number; score?: number } | null;
  opponent2: { id?: number; score?: number } | null;
  frames: Array<{
    id: string;
    frame_number: number;
    is_overtime: boolean;
    results: Array<{
      id: string;
      event_player_id: string;
      putts_made: number;
      points_earned: number;
    }>;
  }>;
}

/**
 * Get bracket matches for scoring by event (status = Ready or Running, with lane assigned)
 */
export async function getMatchesForScoringByEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<BracketMatchForScoring[]> {
  const { data: bracketMatches, error } = await supabase
    .from('bracket_match')
    .select(`
      id,
      status,
      round_id,
      number,
      lane_id,
      opponent1,
      opponent2,
      frames:match_frames(
        id,
        frame_number,
        is_overtime,
        results:frame_results(
          id,
          event_player_id,
          putts_made,
          points_earned
        )
      )
    `)
    .eq('event_id', eventId)
    .in('status', [2, 3]) // Ready = 2, Running = 3
    .not('lane_id', 'is', null);

  if (error) {
    throw new InternalError(`Failed to fetch matches for scoring: ${error.message}`);
  }

  return (bracketMatches || []) as unknown as BracketMatchForScoring[];
}

export interface SingleBracketMatchForScoring extends BracketMatchForScoring {
  event_id: string;
}

/**
 * Get a single bracket match for scoring by ID
 * Uses two parallel queries to avoid PostgREST 3-level nesting timeout issues
 */
export async function getMatchForScoringById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bracketMatchId: number
): Promise<SingleBracketMatchForScoring | null> {
  const [matchWithFrames, frameResultsResponse] = await Promise.all([
    supabase
      .from('bracket_match')
      .select(`
        id,
        status,
        round_id,
        number,
        lane_id,
        opponent1,
        opponent2,
        event_id,
        frames:match_frames(
          id,
          frame_number,
          is_overtime
        )
      `)
      .eq('id', bracketMatchId)
      .order('frame_number', { foreignTable: 'frames', ascending: true })
      .maybeSingle(),
    supabase.rpc('get_frame_results_for_match', { p_bracket_match_id: bracketMatchId }),
  ]);

  if (matchWithFrames.error) {
    throw new InternalError(`Failed to fetch bracket match: ${matchWithFrames.error.message}`);
  }

  if (frameResultsResponse.error) {
    throw new InternalError(`Failed to fetch frame results: ${frameResultsResponse.error.message}`);
  }

  if (!matchWithFrames.data) {
    return null;
  }

  const resultsByFrameId = new Map<string, Array<{
    id: string;
    event_player_id: string;
    putts_made: number;
    points_earned: number;
  }>>();

  for (const result of frameResultsResponse.data) {
    const frameId = result.match_frame_id;
    if (!resultsByFrameId.has(frameId)) {
      resultsByFrameId.set(frameId, []);
    }
    resultsByFrameId.get(frameId)!.push({
      id: result.id,
      event_player_id: result.event_player_id,
      putts_made: result.putts_made,
      points_earned: result.points_earned,
    });
  }

  const framesWithResults = matchWithFrames.data.frames.map((frame) => ({
    ...frame,
    results: resultsByFrameId.get(frame.id) ?? [],
  }));

  return {
    ...matchWithFrames.data,
    frames: framesWithResults,
  } as SingleBracketMatchForScoring;
}

/**
 * Update bracket match status
 */
export async function updateMatchStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  status: number
): Promise<void> {
  const { error } = await supabase
    .from('bracket_match')
    .update({ status })
    .eq('id', matchId);

  if (error) {
    throw new InternalError(`Failed to update match status: ${error.message}`);
  }
}

/**
 * Bulk update match statuses (single query for multiple matches)
 */
export async function bulkUpdateMatchStatuses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchIds: number[],
  status: number
): Promise<void> {
  if (matchIds.length === 0) {
    return;
  }

  const { error } = await supabase
    .from('bracket_match')
    .update({ status })
    .in('id', matchIds);

  if (error) {
    throw new InternalError(`Failed to bulk update match statuses: ${error.message}`);
  }
}

/**
 * Check if bracket stage exists for an event
 */
export async function bracketStageExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to check bracket stage: ${error.message}`);
  }

  return !!data;
}

/**
 * Get bracket stage for an event
 */
export async function getBracketStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ id: number } | null> {
  const { data: stage, error } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Error fetching bracket stage: ${error.message}`);
  }

  return stage;
}

/**
 * Link participants to teams in batch (parallel updates)
 */
export async function linkParticipantsToTeams(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mappings: Array<{ participantId: number; teamId: string }>
): Promise<void> {
  const updatePromises = mappings.map(async (mapping) => {
    const { error } = await supabase
      .from('bracket_participant')
      .update({ team_id: mapping.teamId })
      .eq('id', mapping.participantId);

    if (error) {
      throw new InternalError(`Failed to link participant ${mapping.participantId} to team: ${error.message}`);
    }
  });

  await Promise.all(updatePromises);
}

/**
 * Get bracket participants for an event
 */
export async function getBracketParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Array<{ id: number; tournament_id: string; name: string | null; team_id: string | null }>> {
  const { data: participants, error } = await supabase
    .from('bracket_participant')
    .select('*')
    .eq('tournament_id', eventId)
    .order('id');

  if (error) {
    throw new InternalError(`Failed to fetch bracket participants: ${error.message}`);
  }

  return (participants || []) as Array<{ id: number; tournament_id: string; name: string | null; team_id: string | null }>;
}

/**
 * Update all bracket matches with event_id for a given stage
 */
export async function setEventIdOnMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from('bracket_match')
    .update({ event_id: eventId })
    .eq('stage_id', stageId);

  if (error) {
    throw new InternalError(`Failed to set event_id on matches: ${error.message}`);
  }
}

/**
 * Get all matches for a stage
 */
export async function getMatchesByStageId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number
): Promise<Array<{ id: number; opponent1: unknown; opponent2: unknown; status: number }>> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('stage_id', stageId)
    .not('opponent1', 'is', null)
    .not('opponent2', 'is', null);

  if (error) {
    throw new InternalError(`Failed to fetch matches: ${error.message}`);
  }

  return (matches || []) as Array<{ id: number; opponent1: unknown; opponent2: unknown; status: number }>;
}

export interface MatchWithGroupInfo {
  id: number;
  group_id: number;
  round_id: number;
  status: number;
  opponent1: { id?: number; score?: number; result?: string } | null;
  opponent2: { id?: number; score?: number; result?: string } | null;
  round: {
    number: number;
    group: {
      number: number;
    };
  };
}

/**
 * Get a match with its round and group information
 */
export async function getMatchWithGroupInfo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number
): Promise<MatchWithGroupInfo | null> {
  const { data: match, error } = await supabase
    .from('bracket_match')
    .select(`
      id,
      group_id,
      round_id,
      status,
      opponent1,
      opponent2,
      round:bracket_round!inner(
        number,
        group:bracket_group!inner(
          number
        )
      )
    `)
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch match with group info: ${error.message}`);
  }

  return match as unknown as MatchWithGroupInfo | null;
}

/**
 * Get the second grand final match (reset match) for a given group
 */
export async function getSecondGrandFinalMatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: number
): Promise<{ id: number; status: number } | null> {
  // Get all rounds in this group, ordered by number
  const { data: rounds, error: roundsError } = await supabase
    .from('bracket_round')
    .select('id, number')
    .eq('group_id', groupId)
    .order('number', { ascending: true });

  if (roundsError) {
    throw new InternalError(`Failed to fetch rounds: ${roundsError.message}`);
  }

  // The second round in the grand final group contains the reset match
  if (!rounds || rounds.length < 2) {
    return null;
  }

  const secondRoundId = rounds[1].id;

  // Get the match in the second round
  const { data: match, error: matchError } = await supabase
    .from('bracket_match')
    .select('id, status')
    .eq('round_id', secondRoundId)
    .maybeSingle();

  if (matchError) {
    throw new InternalError(`Failed to fetch second GF match: ${matchError.message}`);
  }

  return match;
}

/**
 * Archive a match (set status to Archived = 5)
 */
export async function archiveMatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number
): Promise<void> {
  const { error } = await supabase
    .from('bracket_match')
    .update({ status: 5 }) // Status.Archived = 5
    .eq('id', matchId);

  if (error) {
    throw new InternalError(`Failed to archive match: ${error.message}`);
  }
}

/**
 * Fetch complete bracket structure (stage, groups, rounds, matches, participants)
 */
export async function fetchBracketStructure(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
) {
  // Get bracket stage first
  const { data: stage, error: stageError } = await supabase
    .from('bracket_stage')
    .select('*')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (stageError) {
    throw new InternalError(`Error fetching bracket stage: ${stageError.message}`);
  }

  if (!stage) {
    return null;
  }

  // Get other bracket data in parallel
  const [groupsResult, roundsResult, matchesResult, participantsResult] = await Promise.all([
    supabase
      .from('bracket_group')
      .select('*')
      .eq('stage_id', stage.id)
      .order('number'),
    supabase
      .from('bracket_round')
      .select('*')
      .eq('stage_id', stage.id)
      .order('group_id')
      .order('number'),
    supabase
      .from('bracket_match')
      .select('*')
      .eq('stage_id', stage.id)
      .order('round_id')
      .order('number'),
    supabase
      .from('bracket_participant')
      .select('*')
      .eq('tournament_id', eventId)
      .order('id'),
  ]);

  if (groupsResult.error) throw new InternalError(`Error fetching bracket groups: ${groupsResult.error.message}`);
  if (roundsResult.error) throw new InternalError(`Error fetching bracket rounds: ${roundsResult.error.message}`);
  if (matchesResult.error) throw new InternalError(`Error fetching bracket matches: ${matchesResult.error.message}`);
  if (participantsResult.error) throw new InternalError(`Error fetching bracket participants: ${participantsResult.error.message}`);

  return {
    stage,
    groups: groupsResult.data || [],
    rounds: roundsResult.data || [],
    matches: matchesResult.data || [],
    participants: participantsResult.data || [],
  };
}

export interface MatchByIdAndEvent {
  id: number;
  status: number;
  event_id: string;
  lane_id: number | null;
  opponent1: { id: number | null } | null;
  opponent2: { id: number | null } | null;
}

/**
 * Get a bracket match by ID and event ID for validation
 */
export async function getMatchByIdAndEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  eventId: string
): Promise<MatchByIdAndEvent | null> {
  const { data: match, error } = await supabase
    .from('bracket_match')
    .select('id, status, event_id, lane_id, opponent1, opponent2')
    .eq('id', matchId)
    .eq('event_id', eventId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new InternalError(`Failed to fetch bracket match: ${error.message}`);
  }

  return match as MatchByIdAndEvent;
}

export interface MatchWithOpponents {
  id: number;
  status: number;
  opponent1: { id?: number; position?: number; score?: number } | null;
  opponent2: { id?: number; position?: number; score?: number } | null;
}

/**
 * Get a bracket match with opponent data for score correction
 */
export async function getMatchWithOpponents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  eventId: string
): Promise<MatchWithOpponents | null> {
  const { data: match, error } = await supabase
    .from('bracket_match')
    .select('id, status, opponent1, opponent2')
    .eq('id', matchId)
    .eq('event_id', eventId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new InternalError(`Failed to fetch bracket match: ${error.message}`);
  }

  return match as MatchWithOpponents;
}

export interface OpponentScoreUpdate {
  id?: number;
  position?: number;
  score: number;
  result: 'win' | 'loss';
}

/**
 * Update match opponent scores
 */
export async function updateMatchOpponentScores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  opponent1: OpponentScoreUpdate,
  opponent2: OpponentScoreUpdate
): Promise<void> {
  const { error } = await supabase
    .from('bracket_match')
    .update({
      opponent1,
      opponent2,
    })
    .eq('id', matchId);

  if (error) {
    throw new InternalError(`Failed to correct scores: ${error.message}`);
  }
}

/**
 * Get bracket participants with their team IDs for an event
 */
export async function getParticipantsWithTeamIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Array<{ id: number; team_id: string | null }>> {
  const { data: participants, error } = await supabase
    .from('bracket_participant')
    .select('id, team_id')
    .eq('tournament_id', eventId);

  if (error) {
    throw new InternalError(`Failed to fetch participants: ${error.message}`);
  }

  return (participants || []) as Array<{ id: number; team_id: string | null }>;
}

export interface MatchWithStage {
  id: number;
  opponent1: { id: number | null } | null;
  opponent2: { id: number | null } | null;
  bracket_stage: {
    tournament_id: string;
  };
}

/**
 * Get a bracket match with its stage information for event validation
 */
export async function getMatchWithStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number
): Promise<MatchWithStage | null> {
  const { data: match, error } = await supabase
    .from('bracket_match')
    .select('*, bracket_stage!inner(tournament_id)')
    .eq('id', matchId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new InternalError(`Failed to fetch match: ${error.message}`);
  }

  return match as unknown as MatchWithStage;
}

/**
 * Get ready matches (status=Ready) for a stage
 */
export async function getReadyMatchesByStageId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number
): Promise<Match[]> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('stage_id', stageId)
    .eq('status', Status.Ready)
    .order('round_id')
    .order('number');

  if (error) {
    throw new InternalError(`Failed to fetch ready matches: ${error.message}`);
  }

  return (matches || []) as unknown as Match[];
}

/**
 * Assign a lane to a match using atomic RPC
 * Returns true if assignment was successful, false if lane is not available
 */
export interface MatchForAdvancement {
  id: number;
  status: number;
  event_id: string;
  opponent1: { id?: number | null; position?: number } | null;
  opponent2: { id?: number | null; position?: number } | null;
}

/**
 * Get a bracket match for manual advancement with row-level lock context
 */
export async function getMatchForAdvancement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  eventId: string
): Promise<MatchForAdvancement | null> {
  const { data: match, error } = await supabase
    .from('bracket_match')
    .select('id, status, event_id, opponent1, opponent2')
    .eq('id', matchId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch match for advancement: ${error.message}`);
  }

  return match as MatchForAdvancement | null;
}

/**
 * Update match opponents and status atomically via the merge RPC
 */
export async function updateMatchWithOpponents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  opponent1: { id?: number | null; position?: number } | null,
  opponent2: { id?: number | null; position?: number } | null,
  status: number
): Promise<void> {
  const { error } = await supabase.rpc('update_bracket_match_score', {
    p_match_id: matchId,
    p_status: status,
    p_opponent1: opponent1,
    p_opponent2: opponent2,
  });

  if (error) {
    throw new InternalError(`Failed to update match opponents: ${error.message}`);
  }
}

/**
 * Clear all match opponents, lane assignments, and reset status to Waiting for a stage
 */
export async function clearAllMatchOpponents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number
): Promise<void> {
  const { error } = await supabase
    .from('bracket_match')
    .update({
      opponent1: { id: null },
      opponent2: { id: null },
      status: Status.Waiting,
      lane_id: null,
      lane_assigned_at: null,
    })
    .eq('stage_id', stageId);

  if (error) {
    throw new InternalError(`Failed to clear match opponents: ${error.message}`);
  }
}

export interface BracketMatchForReset {
  id: number;
  stage_id?: number;
  number: number;
  status: number;
  round_id: number;
  group_id: number;
  opponent1: { id?: number | null; position?: number; score?: number; result?: string } | null;
  opponent2: { id?: number | null; position?: number; score?: number; result?: string } | null;
}

export interface BracketResetContextStage {
  id: number;
  type: string;
  settings: { skipFirstRound?: boolean } | null;
}

export interface BracketResetContextGroup {
  id: number;
  number: number;
}

export interface BracketResetContextRound {
  id: number;
  group_id: number;
  number: number;
}

export interface BracketResetContextMatch extends BracketMatchForReset {
  stage_id: number;
}

export interface BracketResetContext {
  stage: BracketResetContextStage;
  groups: BracketResetContextGroup[];
  rounds: BracketResetContextRound[];
  matches: BracketResetContextMatch[];
}

/**
 * Fetch deterministic reset context for an event.
 */
export async function getBracketResetContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<BracketResetContext | null> {
  const { data: stage, error: stageError } = await supabase
    .from('bracket_stage')
    .select('id, type, settings')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (stageError) {
    throw new InternalError(`Failed to fetch bracket reset stage: ${stageError.message}`);
  }

  if (!stage) {
    return null;
  }

  const [groupsResult, roundsResult, matchesResult] = await Promise.all([
    supabase
      .from('bracket_group')
      .select('id, number')
      .eq('stage_id', stage.id)
      .order('number'),
    supabase
      .from('bracket_round')
      .select('id, group_id, number')
      .eq('stage_id', stage.id)
      .order('group_id')
      .order('number'),
    supabase
      .from('bracket_match')
      .select('id, stage_id, group_id, round_id, number, status, opponent1, opponent2')
      .eq('event_id', eventId)
      .eq('stage_id', stage.id)
      .order('round_id')
      .order('number'),
  ]);

  if (groupsResult.error) {
    throw new InternalError(`Failed to fetch bracket reset groups: ${groupsResult.error.message}`);
  }
  if (roundsResult.error) {
    throw new InternalError(`Failed to fetch bracket reset rounds: ${roundsResult.error.message}`);
  }
  if (matchesResult.error) {
    throw new InternalError(`Failed to fetch bracket reset matches: ${matchesResult.error.message}`);
  }

  return {
    stage: stage as BracketResetContextStage,
    groups: (groupsResult.data || []) as BracketResetContextGroup[],
    rounds: (roundsResult.data || []) as BracketResetContextRound[],
    matches: (matchesResult.data || []) as BracketResetContextMatch[],
  };
}

/**
 * Get all bracket matches for an event (for reset cascade computation)
 */
export async function getAllMatchesForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<BracketMatchForReset[]> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('id, stage_id, number, status, round_id, group_id, opponent1, opponent2')
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError(`Failed to fetch matches for event: ${error.message}`);
  }

  return (matches || []) as BracketMatchForReset[];
}

/**
 * Delete match frames for a bracket match (frame_results cascade-delete via FK)
 */
export async function deleteMatchFrames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bracketMatchId: number
): Promise<void> {
  const { error } = await supabase
    .from('match_frames')
    .delete()
    .eq('bracket_match_id', bracketMatchId);

  if (error) {
    throw new InternalError(`Failed to delete match frames: ${error.message}`);
  }
}

export async function assignLaneToMatchRpc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  laneId: string,
  matchId: number
): Promise<boolean> {
  const { data: assigned, error } = await supabase
    .rpc('assign_lane_to_match', {
      p_event_id: eventId,
      p_lane_id: laneId,
      p_match_id: matchId,
    });

  if (error) {
    throw new InternalError(`Failed to assign lane to match: ${error.message}`);
  }

  if (!assigned) {
    throw new BadRequestError('Lane is not available for assignment');
  }

  return true;
}

