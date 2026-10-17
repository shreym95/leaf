// Read schedules: optional dated checkpoints on a group read ("Through chapter 3 by
// Friday"). Pure data, style-agnostic: nothing here imports from the reader, the UI or
// Supabase. Stored in `group_reads.schedule` (jsonb, 0009) as
// `[{ chapter_index, due_on }]`, so the field names stay snake_case.

/** Most checkpoints one read may carry. */
export const SCHEDULE_MAX = 12;

/** One dated checkpoint. `due_on` is a calendar date, `YYYY-MM-DD`. */
export interface ScheduleCheckpoint {
  /** 0-based outline chapter index. */
  chapter_index: number;
  /** `YYYY-MM-DD`, a real calendar date. */
  due_on: string;
}

export type ScheduleResult =
  /** `schedule` is null when the input was null or empty: "clear the schedule". */
  | { ok: true; schedule: ScheduleCheckpoint[] | null }
  | { ok: false; message: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a real calendar date in `YYYY-MM-DD` form. Rejects impossible days such as
 * `2026-02-30`. Year 0000 is rejected, as Postgres `date` rejects it too.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0-99 onto 1900-1999.
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a schedule from a request body against the read's outline length.
 *
 * Rules: null or an empty array clears the schedule. Otherwise an array of 1 to
 * SCHEDULE_MAX items, each with an integer `chapter_index` in 0..outlineLength-1 and
 * a calendar `due_on`; `chapter_index` strictly increasing; `due_on` non-decreasing.
 * The first broken rule is the message.
 */
export function validateSchedule(raw: unknown, outlineLength: number): ScheduleResult {
  if (raw === null) return { ok: true, schedule: null };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Schedule must be a list of checkpoints or null." };
  }
  if (raw.length === 0) return { ok: true, schedule: null };
  if (raw.length > SCHEDULE_MAX) {
    return {
      ok: false,
      message: `A schedule can have at most ${SCHEDULE_MAX} checkpoints.`,
    };
  }

  const out: ScheduleCheckpoint[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      return { ok: false, message: "Each checkpoint must be an object." };
    }
    const { chapter_index: index, due_on: dueOn } = item;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > outlineLength - 1
    ) {
      return {
        ok: false,
        message: `Each chapter_index must be a whole number from 0 to ${Math.max(0, outlineLength - 1)}.`,
      };
    }
    if (!isCalendarDate(dueOn)) {
      return { ok: false, message: "Each due_on must be a real date as YYYY-MM-DD." };
    }
    const prev = out[out.length - 1];
    if (prev) {
      if (index <= prev.chapter_index) {
        return {
          ok: false,
          message: "Checkpoints must go in chapter order, with no repeats.",
        };
      }
      if (dueOn < prev.due_on) {
        return {
          ok: false,
          message: "Checkpoint dates must not go backwards in chapter order.",
        };
      }
    }
    out.push({ chapter_index: index, due_on: dueOn });
  }
  return { ok: true, schedule: out };
}

/**
 * Tolerant reader for a stored schedule, for display. Anything that is not an array
 * is null. Items that are malformed, out of order or past SCHEDULE_MAX are dropped
 * one by one. The outline length is not known here, so chapter bounds are not checked.
 * Null when nothing valid is left.
 */
export function parseSchedule(raw: unknown): ScheduleCheckpoint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ScheduleCheckpoint[] = [];
  for (const item of raw) {
    if (out.length >= SCHEDULE_MAX) break;
    if (!isRecord(item)) continue;
    const { chapter_index: index, due_on: dueOn } = item;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) continue;
    if (!isCalendarDate(dueOn)) continue;
    const prev = out[out.length - 1];
    if (prev && (index <= prev.chapter_index || dueOn < prev.due_on)) continue;
    out.push({ chapter_index: index, due_on: dueOn });
  }
  return out.length > 0 ? out : null;
}
