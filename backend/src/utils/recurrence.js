/**
 * Recurring activities — rule validation and date expansion.
 *
 * A repeat rule is stored as JSONB on the series head task
 * (`tasks.recurrence`); every later occurrence is a real task row pointing
 * back at the head via `recurrence_parent_id`. See the schema comment in
 * backend/db/schema.sql for the shape and the reasoning.
 *
 * All date maths here is done on 'YYYY-MM-DD' strings via UTC-noon Date
 * objects. Dates in this app are calendar dates, not instants — using UTC
 * noon keeps a +/- 12h server timezone from ever shifting a date by a day,
 * which is the classic bug in this kind of code.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FREQS = new Set(["daily", "weekly", "monthly"]);

// How far ahead occurrences are materialised. Far enough that the month
// view and any "what's coming up" list are always complete, short enough
// that an open-ended daily rule doesn't create thousands of rows.
const HORIZON_DAYS = 60;
// Hard stop per series per sweep, so a malformed rule can never run away.
const MAX_OCCURRENCES_PER_RUN = 200;

const toDate = (str) => new Date(`${str}T12:00:00Z`);
const toStr = (date) => date.toISOString().slice(0, 10);
const addDays = (str, n) => {
  const d = toDate(str);
  d.setUTCDate(d.getUTCDate() + n);
  return toStr(d);
};
const weekdayOf = (str) => toDate(str).getUTCDay();

// Month arithmetic that never rolls over: "31 Jan + 1 month" is 28/29 Feb,
// not 2/3 March. Anchoring on the ORIGINAL day-of-month (not the clamped
// one) means a rule that started on the 31st goes back to the 31st in
// months that have one, instead of degrading to the 28th forever.
const addMonths = (str, n, anchorDay) => {
  const d = toDate(str);
  const day = anchorDay || d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInMonth));
  return toStr(target);
};

/**
 * Validates and normalises a rule coming off the wire.
 * @returns {{ recurrence: object|null }} on success, or {{ error: string }}.
 *          A null/absent rule is valid and means "does not repeat".
 */
function normalizeRecurrence(raw) {
  if (raw === undefined || raw === null || raw === "") return { recurrence: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "Repeat rule must be an object" };

  const freq = raw.freq;
  if (!FREQS.has(freq)) return { error: "Repeat must be daily, weekly, or monthly" };

  const interval = raw.interval === undefined || raw.interval === null ? 1 : Number(raw.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    return { error: "Repeat interval must be a whole number between 1 and 52" };
  }

  let byWeekday = null;
  if (freq === "weekly") {
    const days = Array.isArray(raw.byWeekday) ? raw.byWeekday.map(Number) : [];
    const valid = [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (valid.length === 0) return { error: "Pick at least one day of the week to repeat on" };
    byWeekday = valid;
  }

  let until = null;
  if (raw.until) {
    if (typeof raw.until !== "string" || !DATE_RE.test(raw.until)) return { error: "Repeat end date must be YYYY-MM-DD" };
    until = raw.until;
  }

  return { recurrence: { freq, interval, byWeekday, until } };
}

/**
 * Expands a rule into the calendar dates it lands on, strictly AFTER
 * `start` (the series head's own due date, which already exists as a task)
 * and up to and including `horizonEnd`.
 */
function occurrencesAfter(start, recurrence, horizonEnd) {
  if (!start || !DATE_RE.test(start) || !recurrence) return [];
  const limit = recurrence.until && recurrence.until < horizonEnd ? recurrence.until : horizonEnd;
  if (limit <= start) return [];

  const out = [];
  if (recurrence.freq === "daily") {
    let cursor = addDays(start, recurrence.interval);
    while (cursor <= limit && out.length < MAX_OCCURRENCES_PER_RUN) {
      out.push(cursor);
      cursor = addDays(cursor, recurrence.interval);
    }
    return out;
  }

  if (recurrence.freq === "weekly") {
    const days = recurrence.byWeekday && recurrence.byWeekday.length ? recurrence.byWeekday : [weekdayOf(start)];
    // Walk week by week from the start of the series' own week, so
    // "every 2 weeks on Tue+Thu" keeps a stable parity relative to the
    // date the user picked rather than to whatever today happens to be.
    let weekStart = addDays(start, -weekdayOf(start)); // the Sunday of the start's week
    while (weekStart <= limit && out.length < MAX_OCCURRENCES_PER_RUN) {
      for (const day of days) {
        const date = addDays(weekStart, day);
        if (date > start && date <= limit) out.push(date);
      }
      weekStart = addDays(weekStart, 7 * recurrence.interval);
    }
    return out.sort().slice(0, MAX_OCCURRENCES_PER_RUN);
  }

  // monthly
  const anchorDay = toDate(start).getUTCDate();
  let step = recurrence.interval;
  let cursor = addMonths(start, step, anchorDay);
  while (cursor <= limit && out.length < MAX_OCCURRENCES_PER_RUN) {
    out.push(cursor);
    step += recurrence.interval;
    cursor = addMonths(start, step, anchorDay);
  }
  return out;
}

/** Today (server-local calendar date) + HORIZON_DAYS, as 'YYYY-MM-DD'. */
function horizonEnd(fromDateStr) {
  const base = fromDateStr && DATE_RE.test(fromDateStr) ? fromDateStr : localDateStr();
  return addDays(base, HORIZON_DAYS);
}

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

module.exports = {
  DATE_RE,
  HORIZON_DAYS,
  normalizeRecurrence,
  occurrencesAfter,
  horizonEnd,
  localDateStr,
  addDays,
};