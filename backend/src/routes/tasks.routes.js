const express = require("express");
const fs = require("fs");
const {
  getTasks, getTaskById, createTask, updateTask, replaceSubtasks, deleteTask, getWorkspaceMembers, getSubtaskById, getProjectById,
  deleteUntouchedFutureOccurrences, promoteNextSeriesHead, addRecurrenceException, stopSeries,
  getAttachmentsForTask, getAttachmentById, addAttachment, deleteAttachment,
  getCommentsForTask, addComment,
  getLinksForTask, addLink, getLinkById, deleteLink,
  getAttachmentsForSubtask, getSubtaskAttachmentById, addSubtaskAttachment, deleteSubtaskAttachment,
  getLinksForSubtask, addSubtaskLink, getSubtaskLinkById, deleteSubtaskLink,
} = require("../db");
const { authenticate } = require("../auth");
const { requireWorkspaceMember, requireProjectInWorkspace } = require("../middleware/workspace");
const { notify, broadcastTaskChange } = require("../utils/notify");
const { taskUpload, subtaskUpload } = require("../utils/upload");
const { normalizeRecurrence, localDateStr } = require("../utils/recurrence");
const { generateForTask } = require("../utils/recurrenceRunner");

const router = express.Router({ mergeParams: true });
router.use(authenticate, requireWorkspaceMember, requireProjectInWorkspace);

const STAGE_LABEL = { todo: "Tasks", done: "Completed" };
// A "manager" for task purposes is the workspace admin/lead, OR this
// specific project's own assigned lead (req.project.leadId, set by
// requireProjectInWorkspace above) — giving a project lead real authority
// over their project's tasks without needing the workspace-wide Lead role.
const isManager = (req) => req.membership.role === "admin" || req.membership.role === "lead" || (req.project && req.project.leadId === req.user.id);

// Parses "9:00 AM", "2:30 pm", or "14:30" into a 24-hour "HH:MM" string, or
// null if it doesn't look like a time. Used by bulk-add to pull a leading
// time off a pasted line like "9:00 AM - Meeting with X".
// "Ends before it starts" is nonsense data, so it's rejected here rather
// than left to render as a negative range in the UI. An end time with no
// start is equally meaningless — there's nothing for it to end.
const TIME_RE = /^\d{2}:\d{2}$/;
function validateTimeRange(startTime, endTime) {
  if (endTime === undefined || endTime === null || endTime === "") return null;
  if (!TIME_RE.test(endTime)) return "End time must be in HH:MM format";
  if (!startTime) return "Add a start time before setting an end time";
  if (!TIME_RE.test(startTime)) return "Start time must be in HH:MM format";
  if (endTime <= startTime) return "The end time has to be after the start time";
  return null;
}

function parseClockTime(raw) {
  const m = raw.trim().match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const meridiem = m[3]?.toUpperCase();
  if (hours > 23 || minutes > 59) return null;
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
// Every remaining use of this is a WRITE action (add/remove a file, link,
// or checklist entry) — viewing was already opened to every workspace
// member separately. Members are view + comment only now, so this is just
// isManager under a name that still reads clearly at each call site.
// Managers can touch any task's files/links, as before. Additionally, the
// person who created a task can manage ITS files/links (add/remove),
// including right after creating it — a narrow, permanent "you made it, you
// can attach to it" right, distinct from general task editing (which stays
// manager-only regardless of who created the task).
// Managers can touch any task's files/links. The person who created a task
// keeps that right permanently (see the round this was added). Now also
// extended to the task's current assignee — it's your work, you should be
// able to attach to it — but NOT to a past assignee if it's been reassigned
// since (task.assigneeId always reflects who owns it right now).
const canTouchTask = (req, task) => isManager(req) || (task && (task.createdBy === req.user.id || task.assigneeId === req.user.id));

async function assertBelongsToProject(taskId, projectId) {
  const task = await getTaskById(taskId);
  if (!task || task.projectId !== projectId) return null;
  return task;
}

async function assertAssigneeIsMember(workspaceId, assigneeId) {
  const members = await getWorkspaceMembers(workspaceId);
  return members.some((m) => m.id === assigneeId);
}

// Members only ever see tasks assigned to them — enforced here, not just
// hidden client-side. Admin/lead see everything in the project.
router.get("/", async (req, res, next) => {
  try {
    res.json({ tasks: await getTasks(req.params.projectId) });
  } catch (err) { next(err); }
});

// Any workspace member can create a single task — editing it afterward is
// still admin/lead/project-lead only (see PATCH below), and bulk-add stays
// manager-only since it's a distinct power-user feature, not requested to
// be opened up.
router.post("/", async (req, res, next) => {
  try {
    const { title, description, meetingNotes, status, priority, assigneeId, due, dueTime, endTime, subtasks, links, recurrence } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
    if (!assigneeId) return res.status(400).json({ error: "Assignee is required" });
    if (!(await assertAssigneeIsMember(req.params.workspaceId, assigneeId))) {
      return res.status(400).json({ error: "Assignee must be a member of this workspace" });
    }
    // A repeat rule needs a date to repeat FROM — without one there's no
    // anchor to expand against, so reject it here rather than silently
    // storing a rule that can never produce an occurrence.
    const timeError = validateTimeRange(dueTime, endTime);
    if (timeError) return res.status(400).json({ error: timeError });
    const { recurrence: rule, error: ruleError } = normalizeRecurrence(recurrence);
    if (ruleError) return res.status(400).json({ error: ruleError });
    if (rule && !due) return res.status(400).json({ error: "Pick a due date — a repeating activity repeats from its first date" });

    const task = await createTask({
      title: title.trim(), description, meetingNotes, status, priority, assigneeId, due, dueTime, endTime, subtasks, links,
      recurrence: rule,
      createdBy: req.user.id, workspaceId: req.params.workspaceId, projectId: req.params.projectId,
    });

    // Materialise the upcoming occurrences now, so they're on the board the
    // moment the dialog closes instead of on the next hourly sweep.
    if (rule) await generateForTask(task.id);

    if (assigneeId !== req.user.id) {
      await notify({
        userId: assigneeId, type: "assigned", taskId: task.id, taskTitle: task.title,
        workspaceId: req.params.workspaceId, message: `${req.user.name} assigned you "${task.title}" in ${req.project.name}`,
      });
    }

    broadcastTaskChange(req.params.workspaceId, { reason: "created", taskId: task.id, projectId: req.params.projectId });
    res.status(201).json({ task });
  } catch (err) { next(err); }
});

// Bulk create — one line of pasted text per task. Built for logs like
// "9:00 AM - Meeting with X" / "Draft the proposal" pasted straight from a
// day's list, all going to the same assignee/due date in one submission
// instead of opening the dialog once per line.
// Bulk create — built for pasting straight from a written activity log:
// one task per entry, each with its own assignee (parsed client-side from
// lines like "Leo: 9:00 AM - Meeting with Director"), optional leading time,
// and optional subtasks (parsed from indented lines underneath).
router.post("/bulk", async (req, res, next) => {
  try {
    if (!isManager(req)) return res.status(403).json({ error: "Only the workspace admin, team lead, or this project's lead can create tasks" });
    const { tasks, due, priority } = req.body || {};
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: "Paste at least one line" });

    const items = tasks.slice(0, 100);
    for (const t of items) {
      if (!t.title || !t.title.trim()) return res.status(400).json({ error: "Every task needs a title" });
      if (!t.assigneeId) return res.status(400).json({ error: `Missing assignee for "${t.title}"` });
      if (!(await assertAssigneeIsMember(req.params.workspaceId, t.assigneeId))) {
        return res.status(400).json({ error: `Assignee for "${t.title}" isn't a member of this workspace` });
      }
    }

    const created = [];
    const notifyTargets = new Map(); // assigneeId -> count, so each person gets one summary notification

    for (const t of items) {
      const title = t.title.trim();
      const timeMatch = title.match(/^(\d{1,2}[:.]\d{2}\s*(?:AM|PM|am|pm)?)\s*[-–—]?\s*(.*)$/);
      let taskTitle = title;
      let taskTime = t.dueTime || null;
      if (timeMatch && timeMatch[2].trim()) {
        const parsed = parseClockTime(timeMatch[1]);
        if (parsed) { taskTime = parsed; taskTitle = timeMatch[2].trim(); }
      }

      const subtasks = Array.isArray(t.subtasks) ? t.subtasks.filter(Boolean).map((s) => ({ text: s, done: false })) : [];

      const task = await createTask({
        title: taskTitle, description: "", status: "todo", priority: t.priority || priority || "medium",
        assigneeId: t.assigneeId, due: t.due || due, dueTime: taskTime, subtasks,
        createdBy: req.user.id, workspaceId: req.params.workspaceId, projectId: req.params.projectId,
      });
      created.push(task);
      if (t.assigneeId !== req.user.id) notifyTargets.set(t.assigneeId, (notifyTargets.get(t.assigneeId) || 0) + 1);
    }

    for (const [userId, count] of notifyTargets) {
      await notify({
        userId, type: "assigned", taskId: created[0].id, taskTitle: created[0].title,
        workspaceId: req.params.workspaceId,
        message: `${req.user.name} assigned you ${count} task${count > 1 ? "s" : ""} in ${req.project.name}`,
      });
    }

    broadcastTaskChange(req.params.workspaceId, { reason: "created", projectId: req.params.projectId });
    res.status(201).json({ tasks: created });
  } catch (err) { next(err); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const existing = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Task not found" });

    // A member may edit a task that is THEIRS — either assigned to them or
    // created by them. Anything that is neither (work between two other
    // people) stays view + comment only. Reassignment is still excluded even
    // on your own task: handing work to someone else is a management
    // decision, not an "edit my own task" one.
    const manager = isManager(req);
    const isOwnTask = existing.assigneeId === req.user.id || existing.createdBy === req.user.id;
    if (!manager && !isOwnTask) {
      return res.status(403).json({ error: "You can only edit a task assigned to you or one you created" });
    }
    if (!manager && req.body.assigneeId !== undefined && req.body.assigneeId !== existing.assigneeId) {
      return res.status(403).json({ error: "Only the workspace admin, team lead, or this project's lead can reassign a task" });
    }

    const patch = {};
    ["title", "description", "meetingNotes", "status", "priority", "assigneeId", "due", "dueTime", "endTime"].forEach((k) => {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    });
    // Validate the range as it will BE after this patch, not just what the
    // request happens to carry — changing only the start time can invalidate
    // an end time that's already stored.
    {
      const nextStart = patch.dueTime !== undefined ? patch.dueTime : existing.dueTime;
      const nextEnd = patch.endTime !== undefined ? patch.endTime : existing.endTime;
      const timeError = validateTimeRange(nextStart, nextEnd);
      if (timeError) return res.status(400).json({ error: timeError });
    }
    if (patch.assigneeId && !(await assertAssigneeIsMember(req.params.workspaceId, patch.assigneeId))) {
      return res.status(400).json({ error: "Assignee must be a member of this workspace" });
    }
    // Moving a task to a different project (fixing a mis-filed task). The
    // target must be a real project in THIS workspace — never another
    // workspace's — so a bad/foreign id can't smuggle a task across
    // workspace boundaries.
    if (req.body.projectId !== undefined && req.body.projectId !== existing.projectId) {
      const target = await getProjectById(req.body.projectId);
      if (!target || target.workspaceId !== req.params.workspaceId) {
        return res.status(400).json({ error: "That project isn't in this workspace" });
      }
      patch.projectId = req.body.projectId;
    }

    // Repeat rule. Only editable on the series HEAD — changing it from one
    // occurrence in the middle would make "which task owns the rule"
    // ambiguous, so the client edits the series from its first task.
    // A rule change coming from an occurrence in the MIDDLE of a series used
    // to be rejected with "open the first activity" — which is unhelpful
    // when you don't know which one that is, and was the practical reason a
    // repeating activity couldn't be switched off. It now applies to the
    // series head on the caller's behalf.
    let ruleChanged = false;
    let seriesHeadId = null;
    if (req.body.recurrence !== undefined) {
      const { recurrence: rule, error: ruleError } = normalizeRecurrence(req.body.recurrence);
      if (ruleError) return res.status(400).json({ error: ruleError });

      if (existing.recurrenceParentId) {
        // Only switching the series OFF is meaningful from an occurrence —
        // redefining the schedule needs the series' own start date as its
        // anchor, which this task isn't.
        if (rule) {
          return res.status(400).json({ error: "Open the first activity in this series to change its schedule. From here you can only stop it repeating." });
        }
        seriesHeadId = existing.recurrenceParentId;
        await stopSeries(seriesHeadId);
        ruleChanged = true;
      } else {
        const nextDue = patch.due !== undefined ? patch.due : existing.due;
        if (rule && !nextDue) return res.status(400).json({ error: "Pick a due date — a repeating activity repeats from its first date" });
        ruleChanged = JSON.stringify(rule) !== JSON.stringify(existing.recurrence || null);
        patch.recurrence = rule;
      }
    }

    const { task, prevStatus, prevAssignee } = await updateTask(req.params.id, patch);

    // A changed (or removed) rule invalidates future occurrences built from
    // the old one — clear the untouched ones, then regenerate. Occurrences
    // someone has already worked on are left alone (see
    // deleteUntouchedFutureOccurrences).
    if (seriesHeadId) {
      // Stopped from an occurrence: clear the series' untouched future
      // occurrences, this task included if it's still ahead of today.
      await deleteUntouchedFutureOccurrences(seriesHeadId, localDateStr());
    } else if (ruleChanged || (patch.due !== undefined && task.recurrence)) {
      await deleteUntouchedFutureOccurrences(task.id, localDateStr());
      if (task.recurrence) await generateForTask(task.id);
    }
    const members = await getWorkspaceMembers(req.params.workspaceId);
    const admin = members.find((m) => m.role === "admin");

    if (patch.assigneeId && patch.assigneeId !== prevAssignee && patch.assigneeId !== req.user.id) {
      await notify({
        userId: patch.assigneeId, type: "reassigned", taskId: task.id, taskTitle: task.title,
        workspaceId: req.params.workspaceId, message: `${req.user.name} reassigned "${task.title}" to you`,
      });
    }
    if (patch.status && patch.status !== prevStatus && task.assigneeId !== req.user.id) {
      await notify({
        userId: task.assigneeId, type: "moved", taskId: task.id, taskTitle: task.title,
        workspaceId: req.params.workspaceId, message: `"${task.title}" moved to ${STAGE_LABEL[patch.status] || patch.status}`,
      });
    }
    if (patch.status === "done" && prevStatus !== "done" && admin && admin.id !== task.assigneeId) {
      await notify({
        userId: admin.id, type: "shipped", taskId: task.id, taskTitle: task.title,
        workspaceId: req.params.workspaceId, message: `"${task.title}" was marked done`,
      });
    }

    broadcastTaskChange(req.params.workspaceId, { reason: "updated", taskId: task.id, projectId: req.params.projectId });
    res.json({ task });
  } catch (err) { next(err); }
});

router.put("/:id/subtasks", async (req, res, next) => {
  try {
    const { subtasks } = req.body || {};
    if (!Array.isArray(subtasks)) return res.status(400).json({ error: "subtasks must be an array" });
    const existing = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Task not found" });

    if (!isManager(req) && existing.assigneeId !== req.user.id) {
      return res.status(403).json({ error: "You can only update the checklist on tasks assigned to you" });
    }

    const task = await replaceSubtasks(req.params.id, subtasks);
    broadcastTaskChange(req.params.workspaceId, { reason: "subtasks", taskId: task.id, projectId: req.params.projectId });
    res.json({ task });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    // 404 before 403 deliberately: whether a task exists in a project you
    // can already see is not a secret, and checking permission against a
    // task we haven't loaded would mean guessing.
    const existing = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Task not found" });
    // Same boundary as editing: yours to delete if it is assigned to you or
    // you created it. A member cannot delete work that belongs to two other
    // people, which is the case this rule exists to protect.
    if (!isManager(req) && existing.assigneeId !== req.user.id && existing.createdBy !== req.user.id) {
      return res.status(403).json({ error: "You can only delete a task assigned to you or one you created" });
    }
    // Deleting one occurrence has to STICK. The generator fills in missing
    // dates for a series, so without recording this date as an exception
    // the next sweep would put the task straight back — which is exactly
    // what made a repeating activity look impossible to remove.
    if (existing.recurrenceParentId && existing.due) {
      await addRecurrenceException(existing.recurrenceParentId, existing.due);
    }
    // Deleting the first activity of a repeating series must not cascade
    // the whole series away — hand the rule (and the exception list) to the
    // next occurrence first, then exclude this date on the new head.
    if (existing.recurrence && !existing.recurrenceParentId) {
      const newHeadId = await promoteNextSeriesHead(req.params.id);
      if (newHeadId && existing.due) await addRecurrenceException(newHeadId, existing.due);
    }
    await deleteTask(req.params.id);
    broadcastTaskChange(req.params.workspaceId, { reason: "deleted", taskId: req.params.id, projectId: req.params.projectId });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- attachments ----------------

router.get("/:id/attachments", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Any workspace member can view a task's attachments — only adding/removing is restricted.
    res.json({ attachments: await getAttachmentsForTask(req.params.id) });
  } catch (err) { next(err); }
});

router.post("/:id/attachments", (req, res, next) => {
  taskUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Task not found" });
    }
    if (!canTouchTask(req, task)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can add files" });
    }
    if (!req.file) return res.status(400).json({ error: "No file was uploaded" });

    const attachment = await addAttachment({
      taskId: req.params.id,
      uploadedBy: req.user.id,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storagePath: req.file.path,
    });

    if (task.assigneeId !== req.user.id) {
      await notify({
        userId: task.assigneeId, type: "attachment", taskId: task.id, taskTitle: task.title,
        workspaceId: req.params.workspaceId, message: `${req.user.name} added a file to "${task.title}"`,
      });
    }

    broadcastTaskChange(req.params.workspaceId, { reason: "attachment", taskId: task.id, projectId: req.params.projectId });
    res.status(201).json({ attachment });
  } catch (err) { next(err); }
});

router.get("/:id/attachments/:attachmentId/file", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Any workspace member can view a task's attachments — only adding/removing is restricted.

    const attachment = await getAttachmentById(req.params.attachmentId);
    if (!attachment || attachment.taskId !== req.params.id) return res.status(404).json({ error: "Attachment not found" });
    if (!fs.existsSync(attachment.storagePath)) return res.status(404).json({ error: "File is missing from storage" });

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    fs.createReadStream(attachment.storagePath).pipe(res);
  } catch (err) { next(err); }
});

router.delete("/:id/attachments/:attachmentId", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!canTouchTask(req, task)) return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can remove files" });

    const attachment = await deleteAttachment(req.params.attachmentId);
    if (attachment && attachment.taskId === req.params.id && fs.existsSync(attachment.storagePath)) {
      fs.unlink(attachment.storagePath, () => {});
    }
    broadcastTaskChange(req.params.workspaceId, { reason: "attachment", taskId: req.params.id, projectId: req.params.projectId });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- comments (flat, chronological — open to every workspace member, not gated by role or assignment) ----------------

router.get("/:id/comments", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ comments: await getCommentsForTask(req.params.id) });
  } catch (err) { next(err); }
});

router.post("/:id/comments", async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: "Comment can't be empty" });
    if (body.length > 4000) return res.status(400).json({ error: "Keep comments under 4000 characters" });

    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const comment = await addComment({ taskId: req.params.id, userId: req.user.id, body: body.trim() });

    // Notify everyone with a stake in this task — the assignee, this
    // project's own lead (if it has one), and any workspace-wide admin/lead
    // — except whoever just wrote the comment.
    const members = await getWorkspaceMembers(req.params.workspaceId);
    const targets = new Set();
    if (task.assigneeId !== req.user.id) targets.add(task.assigneeId);
    if (req.project.leadId && req.project.leadId !== req.user.id) targets.add(req.project.leadId);
    members.filter((m) => (m.role === "admin" || m.role === "lead") && m.id !== req.user.id).forEach((m) => targets.add(m.id));

    for (const userId of targets) {
      await notify({
        userId, type: "comment", taskId: task.id, taskTitle: task.title,
        workspaceId: req.params.workspaceId, message: `${req.user.name} commented on "${task.title}"`,
      });
    }

    broadcastTaskChange(req.params.workspaceId, { reason: "comment", taskId: task.id, projectId: req.params.projectId });
    res.status(201).json({ comment });
  } catch (err) { next(err); }
});

// ---------------- links (external URLs, alongside file attachments) ----------------

router.get("/:id/links", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Any workspace member can view a task's links — only adding/removing is restricted.
    res.json({ links: await getLinksForTask(req.params.id) });
  } catch (err) { next(err); }
});

router.post("/:id/links", async (req, res, next) => {
  try {
    const { label, url } = req.body || {};
    if (!url || !url.trim()) return res.status(400).json({ error: "URL is required" });
    let parsed;
    try { parsed = new URL(url.trim()); } catch { return res.status(400).json({ error: "That doesn't look like a valid URL (include https://)" }); }
    if (!["http:", "https:"].includes(parsed.protocol)) return res.status(400).json({ error: "Only http:// or https:// links are allowed" });

    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!canTouchTask(req, task)) return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can add links" });

    const link = await addLink({
      taskId: req.params.id, addedBy: req.user.id,
      label: (label || "").trim() || parsed.hostname, url: parsed.toString(),
    });

    if (task.assigneeId !== req.user.id) {
      await notify({
        userId: task.assigneeId, type: "link", taskId: task.id, taskTitle: task.title,
        workspaceId: req.params.workspaceId, message: `${req.user.name} added a link to "${task.title}"`,
      });
    }

    broadcastTaskChange(req.params.workspaceId, { reason: "link", taskId: task.id, projectId: req.params.projectId });
    res.status(201).json({ link });
  } catch (err) { next(err); }
});

router.delete("/:id/links/:linkId", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!canTouchTask(req, task)) return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can remove links" });

    const link = await getLinkById(req.params.linkId);
    if (!link || link.taskId !== req.params.id) return res.status(404).json({ error: "Link not found" });
    await deleteLink(req.params.linkId);
    broadcastTaskChange(req.params.workspaceId, { reason: "link", taskId: req.params.id, projectId: req.params.projectId });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- subtask attachments & links ----------------
// Same access rule as the parent task's own attachments/links: admin/lead
// on anything, a member only on a task assigned to them.

async function assertSubtaskBelongsToTask(subtaskId, taskId) {
  const sub = await getSubtaskById(subtaskId);
  if (!sub || sub.taskId !== taskId) return null;
  return sub;
}

router.get("/:id/subtasks/:subtaskId/attachments", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Any workspace member can view a task's attachments — only adding/removing is restricted.
    const sub = await assertSubtaskBelongsToTask(req.params.subtaskId, req.params.id);
    if (!sub) return res.status(404).json({ error: "Subtask not found" });
    res.json({ attachments: await getAttachmentsForSubtask(req.params.subtaskId) });
  } catch (err) { next(err); }
});

router.post("/:id/subtasks/:subtaskId/attachments", (req, res, next) => {
  subtaskUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Task not found" });
    }
    if (!canTouchTask(req, task)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can add files" });
    }
    const sub = await assertSubtaskBelongsToTask(req.params.subtaskId, req.params.id);
    if (!sub) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Subtask not found" });
    }
    if (!req.file) return res.status(400).json({ error: "No file was uploaded" });

    const attachment = await addSubtaskAttachment({
      subtaskId: req.params.subtaskId, uploadedBy: req.user.id,
      fileName: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size, storagePath: req.file.path,
    });
    broadcastTaskChange(req.params.workspaceId, { reason: "attachment", taskId: task.id, projectId: req.params.projectId });
    res.status(201).json({ attachment });
  } catch (err) { next(err); }
});

router.get("/:id/subtasks/:subtaskId/attachments/:attachmentId/file", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Any workspace member can view a task's attachments — only adding/removing is restricted.
    const sub = await assertSubtaskBelongsToTask(req.params.subtaskId, req.params.id);
    if (!sub) return res.status(404).json({ error: "Subtask not found" });

    const attachment = await getSubtaskAttachmentById(req.params.attachmentId);
    if (!attachment || attachment.subtaskId !== req.params.subtaskId) return res.status(404).json({ error: "Attachment not found" });
    if (!fs.existsSync(attachment.storagePath)) return res.status(404).json({ error: "File is missing from storage" });

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    fs.createReadStream(attachment.storagePath).pipe(res);
  } catch (err) { next(err); }
});

router.delete("/:id/subtasks/:subtaskId/attachments/:attachmentId", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!canTouchTask(req, task)) return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can remove files" });
    const sub = await assertSubtaskBelongsToTask(req.params.subtaskId, req.params.id);
    if (!sub) return res.status(404).json({ error: "Subtask not found" });

    const attachment = await deleteSubtaskAttachment(req.params.attachmentId);
    if (attachment && attachment.subtaskId === req.params.subtaskId && fs.existsSync(attachment.storagePath)) {
      fs.unlink(attachment.storagePath, () => {});
    }
    broadcastTaskChange(req.params.workspaceId, { reason: "attachment", taskId: req.params.id, projectId: req.params.projectId });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get("/:id/subtasks/:subtaskId/links", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Any workspace member can view a task's links — only adding/removing is restricted.
    const sub = await assertSubtaskBelongsToTask(req.params.subtaskId, req.params.id);
    if (!sub) return res.status(404).json({ error: "Subtask not found" });
    res.json({ links: await getLinksForSubtask(req.params.subtaskId) });
  } catch (err) { next(err); }
});

router.post("/:id/subtasks/:subtaskId/links", async (req, res, next) => {
  try {
    const { label, url } = req.body || {};
    if (!url || !url.trim()) return res.status(400).json({ error: "URL is required" });
    let parsed;
    try { parsed = new URL(url.trim()); } catch { return res.status(400).json({ error: "That doesn't look like a valid URL (include https://)" }); }
    if (!["http:", "https:"].includes(parsed.protocol)) return res.status(400).json({ error: "Only http:// or https:// links are allowed" });

    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!canTouchTask(req, task)) return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can add links" });
    const sub = await assertSubtaskBelongsToTask(req.params.subtaskId, req.params.id);
    if (!sub) return res.status(404).json({ error: "Subtask not found" });

    const link = await addSubtaskLink({ subtaskId: req.params.subtaskId, label: (label || "").trim() || parsed.hostname, url: parsed.toString(), createdBy: req.user.id });
    broadcastTaskChange(req.params.workspaceId, { reason: "link", taskId: task.id, projectId: req.params.projectId });
    res.status(201).json({ link });
  } catch (err) { next(err); }
});

router.delete("/:id/subtasks/:subtaskId/links/:linkId", async (req, res, next) => {
  try {
    const task = await assertBelongsToProject(req.params.id, req.params.projectId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!canTouchTask(req, task)) return res.status(403).json({ error: "Only the workspace admin, team lead, this project's lead, the task's creator, or its current assignee can remove links" });
    const sub = await assertSubtaskBelongsToTask(req.params.subtaskId, req.params.id);
    if (!sub) return res.status(404).json({ error: "Subtask not found" });

    const link = await getSubtaskLinkById(req.params.linkId);
    if (!link || link.subtaskId !== req.params.subtaskId) return res.status(404).json({ error: "Link not found" });
    await deleteSubtaskLink(req.params.linkId);
    broadcastTaskChange(req.params.workspaceId, { reason: "link", taskId: req.params.id, projectId: req.params.projectId });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;