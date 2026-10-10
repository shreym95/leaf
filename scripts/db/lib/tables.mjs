// The tables that are backed up, in foreign-key order (parents first).
// Restore upserts in this order; a table is deleted/cleaned in reverse, but the
// scripts never delete anything.
//
// pk          primary-key columns, used for ordering pages and for upsert conflicts.
// userColumn  column referencing auth.users (rows whose user is gone are skipped).
// bookColumn  column referencing public.books (rows whose book is skipped are skipped).

export const TABLES = [
  { name: "profiles", pk: ["id"], userColumn: "id" },
  { name: "reader_settings", pk: ["user_id"], userColumn: "user_id" },
  { name: "books", pk: ["id"], userColumn: "user_id" },
  { name: "reading_state", pk: ["book_id", "user_id"], userColumn: "user_id", bookColumn: "book_id" },
  { name: "highlights", pk: ["id"], userColumn: "user_id", bookColumn: "book_id" },
  { name: "bookmarks", pk: ["id"], userColumn: "user_id", bookColumn: "book_id" },
];

export const TABLE_NAMES = TABLES.map((t) => t.name);

export const BUCKET = "epubs";

export const PAGE_SIZE = 1000;
export const STORAGE_PAGE_SIZE = 100;
export const UPSERT_BATCH = 500;
