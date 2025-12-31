import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CrudInterface,
  DataTypes,
  OmitId,
  Storage,
  Table,
} from 'brackets-manager';
import type { Id } from 'brackets-model';

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
