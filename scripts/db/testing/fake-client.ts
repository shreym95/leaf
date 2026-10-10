// In-memory stand-in for the slice of supabase-js the db scripts use.
// Test support only; not a test file.

type Row = Record<string, unknown>;
type Result<T> = Promise<{ data: T | null; error: { message: string } | null }>;

export interface FakeOptions {
  tables?: Record<string, Row[]>;
  /** Objects currently in the bucket: path -> bytes. */
  objects?: Record<string, Uint8Array>;
  authUserIds?: string[];
  failTables?: string[];
  failDownloads?: string[];
}

export function createFakeClient(options: FakeOptions = {}) {
  const tables = new Map<string, Row[]>(
    Object.entries(options.tables ?? {}).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
  );
  const objects = new Map<string, Uint8Array>(Object.entries(options.objects ?? {}));
  const calls = {
    ranges: [] as Array<{ table: string; from: number; to: number; order: string[] }>,
    upserts: [] as Array<{ table: string; rows: Row[]; onConflict?: string }>,
    uploads: [] as Array<{ path: string; upsert?: boolean; contentType?: string }>,
    listCalls: [] as Array<{ prefix: string; limit: number; offset: number }>,
    mutations: 0,
  };

  const pkOf = () => (rows: Row, onConflict: string) =>
    onConflict.split(",").map((c) => String(rows[c])).join("|");

  function from(table: string) {
    const order: string[] = [];
    let columns = "*";
    const builder = {
      select(cols: string) {
        columns = cols;
        return builder;
      },
      order(column: string) {
        order.push(column);
        return builder;
      },
      range(fromIdx: number, to: number): Result<Row[]> {
        calls.ranges.push({ table, from: fromIdx, to, order: [...order] });
        if (options.failTables?.includes(table)) {
          return Promise.resolve({ data: null, error: { message: `boom ${table}` } });
        }
        const rows = [...(tables.get(table) ?? [])].sort((a, b) => {
          for (const c of order) {
            const x = String(a[c]);
            const y = String(b[c]);
            if (x !== y) return x < y ? -1 : 1;
          }
          return 0;
        });
        const slice = rows.slice(fromIdx, to + 1).map((r) => {
          if (columns === "*") return { ...r };
          const out: Row = {};
          for (const c of columns.split(",")) out[c] = r[c];
          return out;
        });
        return Promise.resolve({ data: slice, error: null });
      },
      upsert(rows: Row[], opts?: { onConflict?: string }): Result<null> {
        calls.mutations += 1;
        calls.upserts.push({ table, rows, onConflict: opts?.onConflict });
        const existing = tables.get(table) ?? [];
        const key = pkOf();
        for (const row of rows) {
          const idx = existing.findIndex((e) => key(e, opts!.onConflict!) === key(row, opts!.onConflict!));
          if (idx >= 0) existing[idx] = { ...row };
          else existing.push({ ...row });
        }
        tables.set(table, existing);
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  const storage = {
    from(_bucket: string) {
      return {
        list(
          prefix: string,
          opts: { limit: number; offset: number },
        ): Result<Array<{ name: string; id: string | null }>> {
          calls.listCalls.push({ prefix, limit: opts.limit, offset: opts.offset });
          const lead = prefix === "" ? "" : `${prefix}/`;
          const seen = new Map<string, string | null>();
          for (const path of [...objects.keys()].sort()) {
            if (!path.startsWith(lead)) continue;
            const rest = path.slice(lead.length);
            const slash = rest.indexOf("/");
            if (slash === -1) seen.set(rest, "id");
            else seen.set(rest.slice(0, slash), null);
          }
          const entries = [...seen].map(([name, id]) => ({ name, id }));
          return Promise.resolve({ data: entries.slice(opts.offset, opts.offset + opts.limit), error: null });
        },
        async download(path: string): Result<Blob> {
          if (options.failDownloads?.includes(path)) return { data: null, error: { message: `boom ${path}` } };
          const bytes = objects.get(path);
          if (!bytes) return { data: null, error: { message: "not found" } };
          return { data: new Blob([bytes as BlobPart]), error: null };
        },
        async upload(path: string, bytes: Uint8Array, opts?: { upsert?: boolean; contentType?: string }): Result<null> {
          calls.mutations += 1;
          calls.uploads.push({ path, upsert: opts?.upsert, contentType: opts?.contentType });
          if (objects.has(path) && !opts?.upsert) return { data: null, error: { message: "already exists" } };
          objects.set(path, bytes);
          return { data: null, error: null };
        },
      };
    },
  };

  const auth = {
    admin: {
      async listUsers({ page, perPage }: { page: number; perPage: number }) {
        const ids = options.authUserIds ?? [];
        const users = ids.slice((page - 1) * perPage, page * perPage).map((id) => ({ id }));
        return { data: { users }, error: null };
      },
    },
  };

  return { client: { from, storage, auth }, tables, objects, calls };
}
