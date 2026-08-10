const { getTasksDueInTwoDays, markDueReminderSent } = require("../db");
const { notify } = require("./notify");

async function runDueSoonSweep() {
  let tasks;
  try {
    tasks = await getTasksDueInTwoDays();
  } catch (err) {
    console.error("Due-soon reminder sweep failed to query tasks:", err.message);
    return;
  }

  for (const task of tasks) {
    try {
      await notify({
        userId: task.assigneeId,
        type: "due_soon",
        taskId: task.id,
        taskTitle: task.title,
        workspaceId: task.workspaceId,
        message: `Only 2 days left for "${task.title}"`,
      });
      await markDueReminderSent(task.id);
    } catch (err) {
      console.error(`Due-soon reminder failed for task ${task.id}:`, err.message);
    }
  }

  if (tasks.length > 0) {
    console.log(`Due-soon sweep: sent ${tasks.length} "2 days left" reminder(s).`);
  }
}

// Runs shortly after boot, then once an hour. A task is due on a single
// calendar date, so checking hourly is more than enough to catch it the
// day it crosses the 2-day mark without spamming — markDueReminderSent
// also means it only ever fires once per task regardless of how often
// this runs.
function startDueSoonScheduler() {
  setTimeout(runDueSoonSweep, 10_000);
  setInterval(runDueSoonSweep, 60 * 60 * 1000);
}

module.exports = { startDueSoonScheduler, runDueSoonSweep };
