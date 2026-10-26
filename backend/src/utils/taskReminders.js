/**
 * Task reminders, the way Google Calendar does them: each task can carry up
 * to five reminders such as "10 minutes before" or "1 day before", each one
 * sent as an in-app notification (bell + desktop pop-up) or as an email.
 *
 * WHEN a reminder fires is never stored. It is always worked out from the
 * task as it is NOW (see FIRE_AT), so moving a task to another day or time
 * moves its reminders with it automatically.
 *
 *   start of a task = due date + due_time, in office time (REMINDER_TZ)
 *                     due date at 9:00 AM when the task has no time (an
 *                     "all-day" task, as Google treats it)
 *   fires at        = start - minutes_before
 *
 * Reminders go to the people doing the work: the assignee and, if there is
 * one, the second assignee.
 */
const { pool } = require("../pool");
const { notify } = require("./notify");
const { sendTaskReminderEmail } = require("./mailer");

const REMINDER_TZ = process.env.REMINDER_TZ || process.env.REPORT_TZ || "Asia/Thimphu";
const ALL_DAY_HOUR = "09:00";
const MAX_REMINDERS = 5; // Google Calendar's limit, and plenty
const MAX_MINUTES = 4 * 7 * 24 * 60; // 4 weeks, matches the CHECK constraint
const METHODS = ["notification", "email"];
// A reminder whose moment passed more than this long ago (server was down,
// say) is dropped rather than delivered: "starts in 10 minutes", three hours
// late, is wrong and alarming.
const STALE_AFTER_MINUTES = 120;

// The one definition of when a reminder fires. $TZ is bound as a parameter.
const fireAt = (t, r, tzParam) =>
  `((${t}.due + COALESCE(${t}.due_time, TIME '${ALL_DAY_HOUR}'))::timestamp AT TIME ZONE ${tzParam}) - (${r}.minutes_before * INTERVAL '1 minute')`;

/**
 * Validates what a client sent. Returns { reminders, error }.
 * Accepts [{ minutesBefore, method }]; duplicates are dropped quietly (the
 * same reminder twice is one reminder).
 */
function normalizeReminders(input) {
  if (input === undefined || input === null) return { reminders: [] };
  if (!Array.isArray(input)) return { error: "Reminders must be a list" };
  const seen = new Set();
  const reminders = [];
  for (const raw of input) {
    const minutes = Number(raw?.minutesBefore);
    const method = raw?.method || "notification";
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) {
      return { error: "A reminder can be set from 0 minutes up to 4 weeks before" };
    }
    if (!METHODS.includes(method)) return { error: "A reminder is sent as a notification or an email" };
    const key = `${minutes}:${method}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reminders.push({ minutesBefore: minutes, method });
  }
  if (reminders.length > MAX_REMINDERS) return { error: `Up to ${MAX_REMINDERS} reminders per task` };
  reminders.sort((a, b) => a.minutesBefore - b.minutesBefore || a.method.localeCompare(b.method));
  return { reminders };
}

const REMINDER_COLUMNS = `r.id, r.minutes_before AS "minutesBefore", r.method, r.sent_at AS "sentAt"`;

async function getTaskReminders(taskId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${REMINDER_COLUMNS} FROM task_reminders r WHERE r.task_id = $1
     ORDER BY r.minutes_before ASC, r.method ASC`,
    [taskId]
  );
  return rows;
}

/**
 * Marks as "sent" (without sending) every unsent reminder on these tasks
 * whose moment has already passed, and re-arms any already-sent one whose
 * moment is now in the future (the task was moved later). Called after
 * every write that can change WHEN a reminder fires.
 */
async function rearmReminders(taskIds, db = pool) {
  if (!taskIds.length) return;
  await db.query(
    `UPDATE task_reminders r
     SET sent_at = CASE
       -- moved into the future: arm it (again)
       WHEN ${fireAt("t", "r", "$2")} > now() THEN NULL
       -- its moment is clearly past: settle it without sending
       WHEN ${fireAt("t", "r", "$2")} <= now() - INTERVAL '2 minutes' THEN COALESCE(r.sent_at, now())
       -- just past: leave it for the sweep, which runs every minute
       ELSE r.sent_at
     END
     FROM tasks t
     WHERE t.id = r.task_id AND r.task_id = ANY($1) AND t.due IS NOT NULL`,
    [taskIds, REMINDER_TZ]
  );
}

/** Replaces a task's reminders with exactly this set, in one transaction. */
async function setTaskReminders(taskIds, reminders, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const taskId of taskIds) {
      // Keep the ones that are unchanged (and their sent state), so saving a
      // dialog without touching reminders never re-sends one that already
      // went out today.
      const existing = await getTaskReminders(taskId, client);
      const wanted = new Set(reminders.map((r) => `${r.minutesBefore}:${r.method}`));
      const have = new Set(existing.map((r) => `${r.minutesBefore}:${r.method}`));
      const drop = existing.filter((r) => !wanted.has(`${r.minutesBefore}:${r.method}`)).map((r) => r.id);
      if (drop.length) await client.query("DELETE FROM task_reminders WHERE id = ANY($1)", [drop]);
      for (const r of reminders) {
        if (have.has(`${r.minutesBefore}:${r.method}`)) continue;
        await client.query(
          `INSERT INTO task_reminders (task_id, minutes_before, method, created_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (task_id, minutes_before, method) DO NOTHING`,
          [taskId, r.minutesBefore, r.method, userId || null]
        );
      }
    }
    await rearmReminders(taskIds, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The future, not-yet-completed occurrences of the series a task belongs to
 * (including the task itself) — for "apply to all upcoming repeats".
 */
async function upcomingSeriesTaskIds(task) {
  const headId = task.recurrenceParentId || task.id;
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE (id = $1 OR recurrence_parent_id = $1)
       AND status <> 'done'
       AND (due IS NULL OR due >= $2::date)`,
    [headId, task.due || "1970-01-01"]
  );
  const ids = rows.map((r) => r.id);
  return ids.includes(task.id) ? ids : [task.id, ...ids];
}

/** A new occurrence of a repeating activity inherits the head's reminders. */
async function copyReminders(fromTaskId, toTaskId) {
  await pool.query(
    `INSERT INTO task_reminders (task_id, minutes_before, method, created_by)
     SELECT $2, minutes_before, method, created_by FROM task_reminders WHERE task_id = $1
     ON CONFLICT (task_id, minutes_before, method) DO NOTHING`,
    [fromTaskId, toTaskId]
  );
  await rearmReminders([toTaskId]);
}

/* ------------------------------ wording ------------------------------ */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// 1440 → "1 day", 90 → "1 hour 30 minutes", 10080 → "1 week".
function describeOffset(minutes) {
  if (minutes === 0) return "";
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  if (minutes > 60) return `${plural(Math.floor(minutes / 60), "hour")} ${plural(minutes % 60, "minute")}`;
  return plural(minutes, "minute");
}
const clock = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
};

function reminderMessage(row) {
  const title = `"${row.title}"`;
  if (row.dueTime) {
    const when = `${clock(row.dueTime)}${row.endTime ? `–${clock(row.endTime)}` : ""}, ${dayLabel(row.due)}`;
    return row.minutesBefore === 0
      ? `Reminder: ${title} starts now (${when})`
      : `Reminder: ${title} starts in ${describeOffset(row.minutesBefore)} (${when})`;
  }
  const days = Math.round(row.minutesBefore / 1440);
  if (row.minutesBefore < 1440) return `Reminder: ${title} is due today (${dayLabel(row.due)})`;
  if (days === 1) return `Reminder: ${title} is due tomorrow (${dayLabel(row.due)})`;
  return `Reminder: ${title} is due in ${describeOffset(row.minutesBefore)} (${dayLabel(row.due)})`;
}

/* ------------------------------ the sweep ------------------------------ */

/**
 * Claims every reminder whose moment has come and delivers it. Claiming is
 * an UPDATE … SKIP LOCKED, so two overlapping sweeps (or two servers) can
 * never send the same reminder twice.
 */
async function runReminderSweep() {
  let due;
  try {
    const { rows } = await pool.query(
      `WITH ready AS (
         SELECT r.id FROM task_reminders r JOIN tasks t ON t.id = r.task_id
         WHERE r.sent_at IS NULL AND t.due IS NOT NULL AND ${fireAt("t", "r", "$1")} <= now()
         ORDER BY r.created_at
         FOR UPDATE OF r SKIP LOCKED
         LIMIT 500
       )
       UPDATE task_reminders r SET sent_at = now()
       FROM ready, tasks t
       WHERE r.id = ready.id AND t.id = r.task_id
       RETURNING r.id, r.minutes_before AS "minutesBefore", r.method,
         t.id AS "taskId", t.title, t.status, t.workspace_id AS "workspaceId",
         t.assignee_id AS "assigneeId", t.assignee_2_id AS "assignee2Id",
         to_char(t.due, 'YYYY-MM-DD') AS due, to_char(t.due_time, 'HH24:MI') AS "dueTime",
         to_char(t.end_time, 'HH24:MI') AS "endTime",
         (${fireAt("t", "r", "$1")} < now() - ($2 * INTERVAL '1 minute')) AS stale`,
      [REMINDER_TZ, STALE_AFTER_MINUTES]
    );
    due = rows;
  } catch (err) {
    console.error("Reminder sweep failed to query:", err.message);
    return;
  }

  let sent = 0;
  for (const row of due) {
    // A finished task needs no reminder; one that is hours late is dropped.
    if (row.status === "done" || row.stale) continue;
    const recipients = [...new Set([row.assigneeId, row.assignee2Id].filter(Boolean))];
    const message = reminderMessage(row);
    for (const userId of recipients) {
      try {
        if (row.method === "email") {
          const { rows: u } = await pool.query("SELECT email, name FROM users WHERE id = $1", [userId]);
          const delivered = u[0] ? await sendTaskReminderEmail({ to: u[0].email, name: u[0].name, message, title: row.title }) : false;
          // No mail provider configured: the reminder still reaches them in
          // the app rather than vanishing into the server log.
          if (!delivered) await notify({ userId, type: "reminder", taskId: row.taskId, taskTitle: row.title, workspaceId: row.workspaceId, message });
        } else {
          await notify({ userId, type: "reminder", taskId: row.taskId, taskTitle: row.title, workspaceId: row.workspaceId, message });
        }
        sent += 1;
      } catch (err) {
        console.error(`Reminder ${row.id} to ${userId} failed:`, err.message);
      }
    }
  }
  if (sent > 0) console.log(`Reminder sweep: sent ${sent} reminder(s).`);
}

// Every minute — a "10 minutes before" reminder must not arrive 50 minutes
// late. The query is one indexed scan of unsent rows, so this is cheap.
function startReminderScheduler() {
  setTimeout(runReminderSweep, 20_000);
  setInterval(runReminderSweep, 60 * 1000);
}

module.exports = {
  normalizeReminders, getTaskReminders, setTaskReminders, rearmReminders, copyReminders,
  upcomingSeriesTaskIds, runReminderSweep, startReminderScheduler, reminderMessage, describeOffset,
  MAX_REMINDERS,
};
