const express = require("express");
const fs = require("fs");
const {
  getActivityLogsForUser, getTeamActivityLogs, upsertActivityLog, getActivityLogByDate, getActivityLogById,
  getCommentsForActivityLog, addActivityLogComment, getActivityLogCommentById, deleteActivityLogComment,
  getAttachmentsForActivityLog, getActivityLogAttachmentById, addActivityLogAttachment, deleteActivityLogAttachment,
} = require("../db");
const { authenticate } = require("../auth");
const { requireWorkspaceMember } = require("../middleware/workspace");
const { activityLogUpload } = require("../utils/upload");
const { notify, broadcastActivityComment } = require("../utils/notify");

const router = express.Router({ mergeParams: true });
router.use(authenticate, requireWorkspaceMember);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// A content block is either {type:"text", text, time?, links?} or
// {type:"table", rows: [[...]]}. Kept intentionally loose (validated shape,
// not exact schema) so the frontend can evolve the editor without a backend
// change every time. time and links are optional on text blocks — a quick
// timestamp and a way to paste supporting links (Google Drive, etc.)
// alongside what was worked on.
function validateContent(content) {
  if (!Array.isArray(content)) return "Log content must be a list of blocks";
  if (content.length > 200) return "That's a lot of blocks — keep it under 200 per entry";
  for (const block of content) {
    if (!block || typeof block !== "object") return "Each block must be an object";
    if (block.type === "text") {
      if (typeof block.text !== "string" || block.text.length > 8000) return "A text block is too long or invalid";
      if (block.time !== undefined && block.time !== null && block.time !== "" && !TIME_RE.test(block.time)) {
        return "A text block's time must be in HH:MM format";
      }
      if (block.links !== undefined) {
        if (!Array.isArray(block.links) || block.links.length > 20) return "A text block has too many links or an invalid links list";
        for (const link of block.links) {
          if (!link || typeof link.url !== "string" || link.url.length > 2000) return "A link is invalid";
          if (link.label !== undefined && (typeof link.label !== "string" || link.label.length > 200)) return "A link label is invalid";
        }
      }
      if (block.projectId !== undefined && block.projectId !== null && typeof block.projectId !== "string") {
        return "A text block's projectId is invalid";
      }
      if (block.notes !== undefined && block.notes !== null && (typeof block.notes !== "string" || block.notes.length > 4000)) {
        return "A text block's notes are invalid or too long";
      }
    } else if (block.type === "table") {
      if (!Array.isArray(block.rows) || block.rows.length > 200) return "A table block has too many rows or is invalid";
      for (const row of block.rows) {
        if (!Array.isArray(row) || row.length > 30) return "A table row is invalid or has too many columns";
      }
    } else {
      return `Unknown block type: ${block.type}`;
    }
  }
  return null;
}

// Own entries, optionally filtered by date range.
router.get("/mine", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (from && !DATE_RE.test(from)) return res.status(400).json({ error: "Invalid 'from' date" });
    if (to && !DATE_RE.test(to)) return res.status(400).json({ error: "Invalid 'to' date" });
    const logs = await getActivityLogsForUser(req.user.id, req.params.workspaceId, { from, to });
    res.json({ logs });
  } catch (err) { next(err); }
});

// Admin/lead only — the whole team's log, matching the supervisor-review
// pattern from the source activity-log documents this feature is based on.
// Was admin/lead only ("supervisor-review" pattern) — now open to every
// workspace member, per explicit request. Viewing everyone's logged
// activity is now the same visibility level as viewing everyone's tasks.
router.get("/team", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (from && !DATE_RE.test(from)) return res.status(400).json({ error: "Invalid 'from' date" });
    if (to && !DATE_RE.test(to)) return res.status(400).json({ error: "Invalid 'to' date" });
    const logs = await getTeamActivityLogs(req.params.workspaceId, { from, to });
    res.json({ logs });
  } catch (err) { next(err); }
});

// Deliberately separate from /team above: this is scoped to ONE day and
// open to every workspace member, not just admin/lead. Browsing anyone's
// full history stays a supervisor capability; seeing what the team logged
// TODAY, for a dashboard "what's everyone up to" glance, is the same kind
// of visibility tasks already have (everyone can see everyone's tasks).
router.get("/team/today", async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logs = await getTeamActivityLogs(req.params.workspaceId, { from: today, to: today });
    res.json({ logs });
  } catch (err) { next(err); }
});

// Create/update your own entry for a given date — one entry per person per
// day, but that entry can hold any number of blocks (including multiple
// tables, added one at a time from the editor).
router.put("/:date", async (req, res, next) => {
  try {
    if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
    const { content } = req.body || {};
    const error = validateContent(content);
    if (error) return res.status(400).json({ error });

    const log = await upsertActivityLog({
      userId: req.user.id, workspaceId: req.params.workspaceId, entryDate: req.params.date, content,
    });
    res.json({ log });
  } catch (err) { next(err); }
});

// ---------------- attachments — files for a given day's entry ----------------
// Always scoped to the CALLER's own entry for that date (nobody attaches
// files to someone else's log) — the entry must already exist (saved at
// least once) since attachments need a real row to attach to.

router.get("/:date/attachments", async (req, res, next) => {
  try {
    if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
    const log = await getActivityLogByDate(req.user.id, req.params.workspaceId, req.params.date);
    if (!log) return res.json({ attachments: [] }); // nothing saved yet for this date — not an error
    res.json({ attachments: await getAttachmentsForActivityLog(log.id) });
  } catch (err) { next(err); }
});

router.post("/:date/attachments", (req, res, next) => {
  activityLogUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!DATE_RE.test(req.params.date)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Invalid date" });
    }
    const log = await getActivityLogByDate(req.user.id, req.params.workspaceId, req.params.date);
    if (!log) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Save this day's entry before attaching files" });
    }
    if (!req.file) return res.status(400).json({ error: "No file was uploaded" });

    const attachment = await addActivityLogAttachment({
      activityLogId: log.id, uploadedBy: req.user.id,
      fileName: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size, storagePath: req.file.path,
    });
    res.status(201).json({ attachment });
  } catch (err) { next(err); }
});

router.get("/:date/attachments/:attachmentId/file", async (req, res, next) => {
  try {
    const log = await getActivityLogByDate(req.user.id, req.params.workspaceId, req.params.date);
    if (!log) return res.status(404).json({ error: "Entry not found" });

    const attachment = await getActivityLogAttachmentById(req.params.attachmentId);
    if (!attachment || attachment.activityLogId !== log.id) return res.status(404).json({ error: "Attachment not found" });
    if (!fs.existsSync(attachment.storagePath)) return res.status(404).json({ error: "File is missing from storage" });

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    fs.createReadStream(attachment.storagePath).pipe(res);
  } catch (err) { next(err); }
});

router.delete("/:date/attachments/:attachmentId", async (req, res, next) => {
  try {
    const log = await getActivityLogByDate(req.user.id, req.params.workspaceId, req.params.date);
    if (!log) return res.status(404).json({ error: "Entry not found" });

    const attachment = await deleteActivityLogAttachment(req.params.attachmentId);
    if (attachment && attachment.activityLogId === log.id && fs.existsSync(attachment.storagePath)) {
      fs.unlink(attachment.storagePath, () => {});
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- comments on a day's entry ----------------
// Keyed by the log's own id (not date), because you comment on OTHER
// people's entries in the Team Log, not just your own. Any workspace
// member can read and post; you can only delete your own comment (or an
// admin/lead can, checked via role).

router.get("/entry/:logId/comments", async (req, res, next) => {
  try {
    const log = await getActivityLogById(req.params.logId);
    if (!log || log.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: "Entry not found" });
    res.json({ comments: await getCommentsForActivityLog(log.id) });
  } catch (err) { next(err); }
});

router.post("/entry/:logId/comments", async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: "Comment can't be empty" });
    if (body.length > 4000) return res.status(400).json({ error: "Comment is too long" });

    const log = await getActivityLogById(req.params.logId);
    if (!log || log.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: "Entry not found" });

    const comment = await addActivityLogComment({ activityLogId: log.id, authorId: req.user.id, body: body.trim() });

    // Let the person whose entry this is know someone responded — unless
    // they're commenting on their own entry.
    if (log.userId && log.userId !== req.user.id) {
      await notify({
        userId: log.userId, type: "activity_comment", taskId: null, taskTitle: null,
        workspaceId: req.params.workspaceId, message: `${req.user.name} commented on your activity log for ${log.entryDate}`,
      });
    }
    broadcastActivityComment(req.params.workspaceId, log.id);
    res.status(201).json({ comment });
  } catch (err) { next(err); }
});

router.delete("/entry/:logId/comments/:commentId", async (req, res, next) => {
  try {
    const log = await getActivityLogById(req.params.logId);
    if (!log || log.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: "Entry not found" });

    const comment = await getActivityLogCommentById(req.params.commentId);
    if (!comment || comment.activityLogId !== log.id) return res.status(404).json({ error: "Comment not found" });

    const isManager = req.membership?.role === "admin" || req.membership?.role === "lead";
    if (comment.authorId !== req.user.id && !isManager) {
      return res.status(403).json({ error: "You can only delete your own comments" });
    }
    await deleteActivityLogComment(comment.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;