// Pagination helpers over a supabase-js client.

import { PAGE_SIZE, STORAGE_PAGE_SIZE } from "./tables.mjs";

/**
 * Every row of `table`, ordered by its primary key, `pageSize` at a time. Stops
 * on the first short (or empty) page. Throws on any error: a partial export
 * must never look like a complete one.
 */
export async function fetchAllRows(client, table, pk, { pageSize = PAGE_SIZE, columns = "*" } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(columns);
    for (const column of pk) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message ?? String(error)}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/**
 * Every object path in `bucket`, recursing into folders (entries with a null
 * id). Each folder is listed page by page.
 */
export async function listAllObjects(client, bucket, { pageSize = STORAGE_PAGE_SIZE } = {}) {
  const files = [];
  const pending = [""];
  while (pending.length > 0) {
    const prefix = pending.pop();
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.storage.from(bucket).list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`storage list "${prefix}": ${error.message ?? String(error)}`);
      const page = data ?? [];
      for (const entry of page) {
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.id === null || entry.id === undefined) pending.push(path);
        else files.push(path);
      }
      if (page.length < pageSize) break;
    }
  }
  return files.sort();
}

/** Every auth user id, paginated through the admin API. */
export async function listAuthUserIds(client, { perPage = PAGE_SIZE } = {}) {
  const ids = new Set();
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth users: ${error.message ?? String(error)}`);
    const users = data?.users ?? [];
    for (const user of users) ids.add(user.id);
    if (users.length < perPage) break;
  }
  return ids;
}
