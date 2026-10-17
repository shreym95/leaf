// Tables outside the core TABLES list (tables.mjs). They are backed up and restored
// only when named explicitly (`npm run db:backup -- --tables ...`), so the core list
// and the default full backup stay unchanged.
//
// Same fields as TABLES. Listed after the core tables, so a bookColumn always points
// at a books row that was processed earlier in the same restore.

export const EXTRA_TABLES = [
  { name: "annotations", pk: ["id"], userColumn: "user_id", bookColumn: "book_id" },
  { name: "read_notes", pk: ["id"], userColumn: "user_id" },
];
