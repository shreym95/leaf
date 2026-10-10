// In-memory stand-in for the service-role Supabase client, for the groups
// handler tests only. It implements just the query-builder calls the groups
// handlers use. Database triggers are not simulated; tests inject their effects
// through the hooks.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export interface DbError {
  code: string;
  message: string;
}

type Mode = "many" | "single" | "maybe";
type Op = "select" | "insert" | "update" | "delete" | "upsert";

const PRIMARY_KEYS: Record<string, string[]> = {
  groups: ["id"],
  group_members: ["group_id", "user_id"],
  group_invites: ["token"],
  group_reads: ["id"],
  read_copies: ["read_id", "user_id"],
  books: ["id"],
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  files = new Map<string, Uint8Array>();
  /** Return an error to make an insert into `table` fail. */
  insertHook?: (table: string, row: Row) => DbError | undefined;
  /** Runs at the start of every update, before rows are matched (race simulation). */
  beforeUpdate?: (table: string, patch: Row) => void;
  /** Return an error to make any operation on `table` fail. */
  failOn?: (table: string, op: Op) => DbError | undefined;
  updates: Array<{ table: string; patch: Row; matched: number }> = [];

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  seed(table: string, ...rows: Row[]): void {
    this.rows(table).push(...rows);
  }

  client(): SupabaseClient {
    return {
      from: (table: string) => new Query(this, table),
      storage: {
        from: () => ({
          download: async (path: string) => {
            const bytes = this.files.get(path);
            if (!bytes) {
              return { data: null, error: { message: "Object not found" } };
            }
            return { data: new Blob([bytes as BlobPart]), error: null };
          },
        }),
      },
    } as unknown as SupabaseClient;
  }
}

class Query implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private op: Op = "select";
  private filters: Array<(r: Row) => boolean> = [];
  private payload: Row | Row[] = {};
  private returning = false;
  private mode: Mode = "many";
  private orderCol?: { col: string; ascending: boolean };
  private max?: number;
  private conflict: string[] = [];
  private ignoreDuplicates = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols?: string) {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  upsert(
    payload: Row | Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.op = "upsert";
    this.payload = payload;
    this.conflict = (opts?.onConflict ?? "").split(",").filter(Boolean);
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push((r) => (r[col] as number | string) < (val as number | string));
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push((r) => (r[col] as number | string) > (val as number | string));
    return this;
  }
  is(col: string, val: null) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = { col, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<R1, R2>(
    onfulfilled?: ((v: { data: unknown; error: DbError | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[]): { data: unknown; error: DbError | null } {
    if (this.mode === "many") return { data: rows.map((r) => ({ ...r })), error: null };
    if (this.mode === "maybe") return { data: rows[0] ? { ...rows[0] } : null, error: null };
    if (rows.length !== 1) {
      return { data: null, error: { code: "PGRST116", message: "no single row" } };
    }
    return { data: { ...rows[0] }, error: null };
  }

  private pk(row: Row): string {
    const keys = PRIMARY_KEYS[this.table] ?? ["id"];
    return keys.map((k) => String(row[k])).join("|");
  }

  private run(): { data: unknown; error: DbError | null } {
    const failure = this.db.failOn?.(this.table, this.op);
    if (failure) return { data: null, error: failure };

    switch (this.op) {
      case "select": {
        let rows = this.matching();
        if (this.orderCol) {
          const { col, ascending } = this.orderCol;
          rows = [...rows].sort((a, b) => {
            const x = a[col] as string | number;
            const y = b[col] as string | number;
            return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
        if (this.max !== undefined) rows = rows.slice(0, this.max);
        return this.shape(rows);
      }
      case "insert":
      case "upsert": {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
        const stored: Row[] = [];
        for (const raw of incoming) {
          const row: Row = { ...raw };
          if (this.table === "groups" || this.table === "group_reads") {
            row.id ??= crypto.randomUUID();
          }
          const existing = this.db.rows(this.table).find((r) =>
            this.op === "upsert" && this.conflict.length
              ? this.conflict.every((c) => r[c] === row[c])
              : this.pk(r) === this.pk(row),
          );
          if (existing) {
            if (this.op === "upsert") {
              if (!this.ignoreDuplicates) Object.assign(existing, row);
              continue;
            }
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value" },
            };
          }
          const err = this.db.insertHook?.(this.table, row);
          if (err) return { data: null, error: err };
          this.db.rows(this.table).push(row);
          stored.push(row);
        }
        return this.returning ? this.shape(stored) : { data: null, error: null };
      }
      case "update": {
        this.db.beforeUpdate?.(this.table, this.payload as Row);
        const matched = this.matching();
        for (const r of matched) Object.assign(r, this.payload);
        this.db.updates.push({
          table: this.table,
          patch: this.payload as Row,
          matched: matched.length,
        });
        return this.returning ? this.shape(matched) : { data: null, error: null };
      }
      case "delete": {
        const matched = this.matching();
        this.db.tables[this.table] = this.db
          .rows(this.table)
          .filter((r) => !matched.includes(r));
        return this.returning ? this.shape(matched) : { data: null, error: null };
      }
    }
  }
}
