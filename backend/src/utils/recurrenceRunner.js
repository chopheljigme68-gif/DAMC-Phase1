/**
 * Materialises recurring activities into real task rows.
 *
 * Runs in two places, deliberately:
 *   - inline, right after a repeat rule is created or changed, so the user
 *     sees the next occurrences immediately rather than "sometime within
 *     the hour";
 *   - on an hourly sweep, so an open-ended rule keeps rolling forward as
 *     the horizon moves (same pattern as the due-soon reminder sweep).
 *
 * Both paths call the same idempotent function, so running it twice is a
 * no-op rather than a duplicate.
 */

const {
  getActiveRecurringHeads, getSeriesOccurrenceDates, getSeriesTemplateSubtasks,
  createRecurrenceOccurrence, getTaskById,
} = require("../db");
const { occurrencesAfter, horizonEnd, localDateStr } = require("./recurrence");
const { broadcastTaskChange } = require("./notify");

/**
 * Generates any missing occurrences for one series head.
 * @returns {number} how many task rows were created.
 */
async function generateForHead(head) {
  if (!head || !head.recurrence || !head.due) return 0;

  // Generate from today OR from the head's own date, whichever is later —
  // a rule created with a due date in the past shouldn't backfill weeks of
  // tasks nobody asked for, but one created for next month must still fill
  // forward from next month.
  const today = localDateStr();
  const wanted = occurrencesAfter(head.due, head.recurrence, horizonEnd(today));
  if (wanted.length === 0) return 0;

  const taken = new Set(await getSeriesOccurrenceDates(head.id));
  const missing = wanted.filter((d) => !taken.has(d) && d >= today);
  if (missing.length === 0) return 0;

  const subtasks = await getSeriesTemplateSubtasks(head.id);
  let created = 0;
  for (const due of missing) {
    // eslint-disable-next-line no-await-in-loop
    const task = await createRecurrenceOccurrence(head, due, subtasks);
    if (task) created += 1;
  }
  if (created > 0) {
    broadcastTaskChange(head.workspaceId, { reason: "recurrence", projectId: head.projectId });
  }
  return created;
}

/** Same, addressed by task id — used from the routes after a save. */
async function generateForTask(taskId) {
  const task = await getTaskById(taskId);
  if (!task || !task.recurrence || task.recurrenceParentId) return 0;
  return generateForHead({
    id: task.id, title: task.title, description: task.description, priority: task.priority,
    assigneeId: task.assigneeId, createdBy: task.createdBy, workspaceId: task.workspaceId,
    projectId: task.projectId, due: task.due, dueTime: task.dueTime, recurrence: task.recurrence,
  });
}

async function runRecurrenceSweep() {
  let heads;
  try {
    heads = await getActiveRecurringHeads();
  } catch (err) {
    console.error("Recurrence sweep failed to query series:", err.message);
    return;
  }

  let total = 0;
  for (const head of heads) {
    try {
      // eslint-disable-next-line no-await-in-loop
      total += await generateForHead(head);
    } catch (err) {
      // One bad series must never stop the rest from rolling forward.
      console.error(`Recurrence generation failed for series ${head.id}:`, err.message);
    }
  }
  if (total > 0) console.log(`Recurrence sweep: created ${total} occurrence(s) across ${heads.length} series.`);
}

// Boots shortly after start, then hourly — the horizon is 60 days out, so
// hourly is far more often than strictly needed and costs one cheap query
// per series when there's nothing to do.
function startRecurrenceScheduler() {
  setTimeout(runRecurrenceSweep, 15_000);
  setInterval(runRecurrenceSweep, 60 * 60 * 1000);
}

module.exports = { startRecurrenceScheduler, runRecurrenceSweep, generateForHead, generateForTask };