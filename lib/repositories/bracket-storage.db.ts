import 'server-only';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DataTypes, OmitId, Storage, Table } from 'brackets-manager';
import type { Id } from 'brackets-model';
import type { Executor } from '@/lib/db/tx';
import {
  bracket_group,
  bracket_match,
  bracket_match_game,
  bracket_participant,
  bracket_round,
  bracket_stage,
} from '@/lib/db/schema';
import { InternalError } from '@/lib/errors';

type Row = Record<string, unknown>;
type Opponent = Record<string, unknown> | null;

const TABLES: Record<Table, PgTable> = {
  stage: bracket_stage,
  group: bracket_group,
  round: bracket_round,
  match: bracket_match,
  match_game: bracket_match_game,
  participant: bracket_participant,
};

// Columns brackets-manager owns, per table. Anything else on a row (lane_id, event_id,
// team_id, timestamps) belongs to the app and is never read or written through here.
const COLUMNS: Record<Table, readonly string[]> = {
  stage: ['tournament_id', 'name', 'type', 'settings', 'number'],
  group: ['stage_id', 'number'],
  round: ['stage_id', 'group_id', 'number'],
  match: ['stage_id', 'group_id', 'round_id', 'number', 'child_count', 'status', 'opponent1', 'opponent2'],
  match_game: ['stage_id', 'parent_id', 'number', 'status', 'opponent1', 'opponent2'],
  participant: ['tournament_id', 'name'],
};

// Structural links: set on insert, never changed by an update.
const STRUCTURAL = new Set(['tournament_id', 'stage_id', 'group_id', 'round_id', 'parent_id']);

// Storage methods are generic over Table; drizzle can't type a table chosen at
// runtime, so values are checked against COLUMNS instead.
function tbl(table: Table): PgTable {
  return TABLES[table];
}

function column(table: Table, key: string): PgColumn {
  const col = (TABLES[table] as unknown as Record<string, PgColumn>)[key];
  if (!col) {
    throw new InternalError(`Unknown column ${key} on bracket table ${table}`);
  }
  return col;
}

function pick(value: object, keys: readonly string[]): Row {
  const row: Row = {};
  for (const key of keys) {
    const v = (value as Row)[key];
    if (v !== undefined) row[key] = v;
  }
  return row;
}

function hasId(opponent: Opponent): boolean {
  return opponent != null && opponent.id != null;
}

/**
 * Rules every write to a bracket_match row follows (formerly enforced by the
 * update_bracket_match_score RPC):
 * - `position` is structural: keep the stored value, never accept a caller's.
 * - A Locked/Waiting match whose two slots are filled becomes Ready.
 */
export function applyMatchWriteRules(
  existing: { opponent1: unknown; opponent2: unknown },
  next: { status?: number; opponent1?: Opponent; opponent2?: Opponent }
): { status?: number; opponent1?: Opponent; opponent2?: Opponent } {
  const result = { ...next };

  for (const slot of ['opponent1', 'opponent2'] as const) {
    if (result[slot] === undefined) continue;
    const stored = existing[slot] as Opponent;
    const incoming = result[slot];
    if (stored && 'position' in stored) {
      result[slot] = { ...(incoming ?? {}), position: stored.position };
    } else if (incoming && 'position' in incoming) {
      const rest = { ...incoming };
      delete rest.position;
      result[slot] = rest;
    }
  }

  const finalOpp1 = (result.opponent1 !== undefined ? result.opponent1 : existing.opponent1) as Opponent;
  const finalOpp2 = (result.opponent2 !== undefined ? result.opponent2 : existing.opponent2) as Opponent;
  if (result.status !== undefined && result.status < 2 && hasId(finalOpp1) && hasId(finalOpp2)) {
    result.status = 2;
  }

  return result;
}

/**
 * brackets-manager storage on Drizzle. Construct one per transaction:
 * `new BracketsManager(new DrizzleBracketStorage(tx, eventId))`.
 *
 * Every read, update and delete is scoped to the event's bracket (stage/participant by
 * tournament_id; everything else by the event's stage ids), so the manager can never
 * touch another event's rows, even through an unfiltered call. Database errors throw
 * (rolling back the transaction) instead of returning false.
 */
export class DrizzleBracketStorage implements Storage {
  private readonly verifiedStageIds = new Set<number>();

  constructor(
    private readonly ex: Executor,
    private readonly eventId: string
  ) {}

  private eventStageIds(): SQL {
    return sql`(select ${bracket_stage.id} from ${bracket_stage} where ${bracket_stage.tournament_id} = ${this.eventId})`;
  }

  private scope(table: Table): SQL {
    if (table === 'stage' || table === 'participant') {
      return eq(column(table, 'tournament_id'), this.eventId);
    }
    return inArray(column(table, 'stage_id'), this.eventStageIds());
  }

  private where(table: Table, filter?: object, id?: Id): SQL {
    const conditions: SQL[] = [this.scope(table)];
    if (id !== undefined) {
      conditions.push(eq(column(table, 'id'), Number(id)));
    }
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        if (value === undefined) continue;
        const col = column(table, key);
        conditions.push(value === null ? isNull(col) : eq(col, key === 'id' ? Number(value) : value));
      }
    }
    return and(...conditions)!;
  }

  private selection(table: Table): Record<string, PgColumn> {
    const fields: Record<string, PgColumn> = { id: column(table, 'id') };
    for (const key of COLUMNS[table]) fields[key] = column(table, key);
    return fields;
  }

  private async assertInsertable(table: Table, row: Row): Promise<void> {
    if (table === 'stage' || table === 'participant') {
      if (String(row.tournament_id) !== this.eventId) {
        throw new InternalError(`Refusing to insert ${table} for another event`);
      }
      return;
    }
    const stageId = Number(row.stage_id);
    if (this.verifiedStageIds.has(stageId)) return;
    const found = await this.ex
      .select({ id: bracket_stage.id })
      .from(bracket_stage)
      .where(and(eq(bracket_stage.id, stageId), eq(bracket_stage.tournament_id, this.eventId)));
    if (found.length === 0) {
      throw new InternalError(`Refusing to insert ${table} for a stage outside the event`);
    }
    this.verifiedStageIds.add(stageId);
  }

  insert<T extends Table>(table: T, value: OmitId<DataTypes[T]>): Promise<number>;
  insert<T extends Table>(table: T, values: OmitId<DataTypes[T]>[]): Promise<boolean>;
  async insert<T extends Table>(
    table: T,
    valueOrValues: OmitId<DataTypes[T]> | OmitId<DataTypes[T]>[]
  ): Promise<number | boolean> {
    const values = Array.isArray(valueOrValues) ? valueOrValues : [valueOrValues];
    const rows = values.map((v) => pick(v, COLUMNS[table]));
    for (const row of rows) {
      await this.assertInsertable(table, row);
    }
    if (table === 'match') {
      // bracket_match.event_id is NOT NULL and app-owned; the stage was just verified
      // to belong to this event.
      for (const row of rows) row.event_id = this.eventId;
    }

    if (rows.length === 0) {
      return true;
    }

    const inserted = await this.ex
      .insert(tbl(table))
      .values(rows as never)
      .returning({ id: column(table, 'id') });

    if (table === 'stage') {
      for (const r of inserted) this.verifiedStageIds.add(Number(r.id));
    }

    return Array.isArray(valueOrValues) ? true : Number(inserted[0].id);
  }

  select<T extends Table>(table: T): Promise<Array<DataTypes[T]> | null>;
  select<T extends Table>(table: T, id: Id): Promise<DataTypes[T] | null>;
  select<T extends Table>(table: T, filter: Partial<DataTypes[T]>): Promise<Array<DataTypes[T]> | null>;
  async select<T extends Table>(
    table: T,
    idOrFilter?: Id | Partial<DataTypes[T]>
  ): Promise<DataTypes[T] | Array<DataTypes[T]> | null> {
    const byId = typeof idOrFilter === 'number' || typeof idOrFilter === 'string';
    const rows = await this.ex
      .select(this.selection(table))
      .from(tbl(table))
      .where(byId ? this.where(table, undefined, idOrFilter) : this.where(table, idOrFilter as object | undefined))
      .orderBy(asc(column(table, 'id')));

    if (byId) {
      return (rows[0] as unknown as DataTypes[T]) ?? null;
    }
    return rows as unknown as Array<DataTypes[T]>;
  }

  update<T extends Table>(table: T, id: Id, value: DataTypes[T]): Promise<boolean>;
  update<T extends Table>(table: T, filter: Partial<DataTypes[T]>, value: Partial<DataTypes[T]>): Promise<boolean>;
  async update<T extends Table>(
    table: T,
    idOrFilter: Id | Partial<DataTypes[T]>,
    value: DataTypes[T] | Partial<DataTypes[T]>
  ): Promise<boolean> {
    const byId = typeof idOrFilter === 'number' || typeof idOrFilter === 'string';
    const updatable = COLUMNS[table].filter((key) => !STRUCTURAL.has(key));
    let set: Row = pick(value, updatable);

    if (table === 'match' && byId) {
      const [existing] = await this.ex
        .select({ opponent1: bracket_match.opponent1, opponent2: bracket_match.opponent2 })
        .from(bracket_match)
        .where(this.where('match', undefined, idOrFilter));
      if (!existing) return false;
      set = { ...set, ...applyMatchWriteRules(existing, set as Parameters<typeof applyMatchWriteRules>[1]) };
    }

    if (table === 'match') {
      // clock_timestamp: rows updated in one transaction keep their real order, which
      // lane auto-assignment uses for "longest waiting first".
      set.updated_at = sql`clock_timestamp()`;
    }

    if (Object.keys(set).length === 0) return true;

    const updated = await this.ex
      .update(tbl(table))
      .set(set as never)
      .where(byId ? this.where(table, undefined, idOrFilter) : this.where(table, idOrFilter as object))
      .returning({ id: column(table, 'id') });

    return byId ? updated.length > 0 : true;
  }

  delete<T extends Table>(table: T): Promise<boolean>;
  delete<T extends Table>(table: T, filter: Partial<DataTypes[T]>): Promise<boolean>;
  async delete<T extends Table>(table: T, filter?: Partial<DataTypes[T]>): Promise<boolean> {
    await this.ex.delete(tbl(table)).where(this.where(table, filter as object | undefined));
    return true;
  }

  async selectFirst<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>,
    assertUnique = true
  ): Promise<DataTypes[T] | null> {
    return this.selectOne(table, filter, assertUnique, 'first');
  }

  async selectLast<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>,
    assertUnique = true
  ): Promise<DataTypes[T] | null> {
    return this.selectOne(table, filter, assertUnique, 'last');
  }

  private async selectOne<T extends Table>(
    table: T,
    filter: Partial<DataTypes[T]>,
    assertUnique: boolean,
    end: 'first' | 'last'
  ): Promise<DataTypes[T] | null> {
    const idCol = column(table, 'id');
    const rows = await this.ex
      .select(this.selection(table))
      .from(tbl(table))
      .where(this.where(table, filter))
      .orderBy(end === 'first' ? asc(idCol) : desc(idCol))
      .limit(assertUnique ? 2 : 1);

    if (assertUnique && rows.length > 1) {
      throw new InternalError(`Expected a unique ${table} but found several`);
    }
    return (rows[0] as unknown as DataTypes[T]) ?? null;
  }
}
