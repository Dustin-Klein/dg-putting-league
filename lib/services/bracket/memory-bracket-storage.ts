import type { CrudInterface, DataTypes, OmitId, Table } from 'brackets-manager';
import type { Id } from 'brackets-model';

type Row = Record<string, unknown> & { id: number };

const TABLES: readonly Table[] = ['participant', 'stage', 'group', 'round', 'match', 'match_game'];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameValue(stored: unknown, wanted: unknown): boolean {
  if (wanted === null) return stored == null;
  if (stored == null) return false;
  if (typeof wanted === 'object' || typeof stored === 'object') return false;
  return String(stored) === String(wanted);
}

/**
 * In-memory brackets-manager storage for one request. Used to run the library
 * without database round trips: generating a fresh bracket before it is written in
 * bulk, and graph lookups over an already-loaded bracket snapshot.
 *
 * Semantics follow `DrizzleBracketStorage`: selects return rows ordered by id
 * (copies, so callers can't mutate stored rows), a filter value of null matches a
 * missing/null column, updates merge into the stored row, and ids are never changed.
 * New ids are assigned in insertion order, starting after the largest seeded id.
 */
export class MemoryBracketStorage implements CrudInterface {
  private readonly rows = new Map<Table, Row[]>(TABLES.map((table) => [table, []]));
  private nextId = new Map<Table, number>(TABLES.map((table) => [table, 0]));

  /** Load existing rows (with their ids), e.g. a bracket read from the database. */
  seed<T extends Table>(table: T, values: Array<DataTypes[T]>): void {
    const rows = this.table(table);
    for (const value of values) rows.push(clone(value) as unknown as Row);
    rows.sort((a, b) => a.id - b.id);
    const maxId = rows.length > 0 ? rows[rows.length - 1].id : -1;
    this.nextId.set(table, Math.max(this.nextId.get(table)!, maxId + 1));
  }

  /** Every stored row of a table, in id order (copies). */
  dump<T extends Table>(table: T): Array<DataTypes[T]> {
    return this.table(table).map((row) => clone(row) as unknown as DataTypes[T]);
  }

  private table(table: Table): Row[] {
    const rows = this.rows.get(table);
    if (!rows) throw new Error(`Unknown bracket table ${table}`);
    return rows;
  }

  private matches(row: Row, filter: object): boolean {
    return Object.entries(filter).every(([key, value]) => value === undefined || sameValue(row[key], value));
  }

  private find(table: Table, id: Id): Row | undefined {
    return this.table(table).find((row) => sameValue(row.id, id));
  }

  insert<T extends Table>(table: T, value: OmitId<DataTypes[T]>): Promise<number>;
  insert<T extends Table>(table: T, values: OmitId<DataTypes[T]>[]): Promise<boolean>;
  async insert<T extends Table>(
    table: T,
    valueOrValues: OmitId<DataTypes[T]> | OmitId<DataTypes[T]>[]
  ): Promise<number | boolean> {
    const values = Array.isArray(valueOrValues) ? valueOrValues : [valueOrValues];
    const rows = this.table(table);
    let lastId = -1;
    for (const value of values) {
      lastId = this.nextId.get(table)!;
      this.nextId.set(table, lastId + 1);
      rows.push({ ...clone(value as object), id: lastId });
    }
    return Array.isArray(valueOrValues) ? true : lastId;
  }

  select<T extends Table>(table: T): Promise<Array<DataTypes[T]> | null>;
  select<T extends Table>(table: T, id: Id): Promise<DataTypes[T] | null>;
  select<T extends Table>(table: T, filter: Partial<DataTypes[T]>): Promise<Array<DataTypes[T]> | null>;
  async select<T extends Table>(
    table: T,
    idOrFilter?: Id | Partial<DataTypes[T]>
  ): Promise<DataTypes[T] | Array<DataTypes[T]> | null> {
    if (typeof idOrFilter === 'number' || typeof idOrFilter === 'string') {
      const row = this.find(table, idOrFilter);
      return row ? (clone(row) as unknown as DataTypes[T]) : null;
    }
    return this.table(table)
      .filter((row) => !idOrFilter || this.matches(row, idOrFilter))
      .map((row) => clone(row) as unknown as DataTypes[T]);
  }

  update<T extends Table>(table: T, id: Id, value: DataTypes[T]): Promise<boolean>;
  update<T extends Table>(table: T, filter: Partial<DataTypes[T]>, value: Partial<DataTypes[T]>): Promise<boolean>;
  async update<T extends Table>(
    table: T,
    idOrFilter: Id | Partial<DataTypes[T]>,
    value: DataTypes[T] | Partial<DataTypes[T]>
  ): Promise<boolean> {
    const targets =
      typeof idOrFilter === 'number' || typeof idOrFilter === 'string'
        ? [this.find(table, idOrFilter)].filter((row): row is Row => row !== undefined)
        : this.table(table).filter((row) => this.matches(row, idOrFilter));
    const changes = clone(value as object) as Record<string, unknown>;
    delete changes.id;
    for (const row of targets) Object.assign(row, changes);
    return typeof idOrFilter === 'object' || targets.length > 0;
  }

  delete<T extends Table>(table: T): Promise<boolean>;
  delete<T extends Table>(table: T, filter: Partial<DataTypes[T]>): Promise<boolean>;
  async delete<T extends Table>(table: T, filter?: Partial<DataTypes[T]>): Promise<boolean> {
    const rows = this.table(table);
    const kept = rows.filter((row) => filter !== undefined && !this.matches(row, filter));
    rows.splice(0, rows.length, ...kept);
    return true;
  }
}
