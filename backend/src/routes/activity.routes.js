const express = require("express");
const { getActivityLogsForUser, getTeamActivityLogs, upsertActivityLog } = require("../db");
const { authenticate } = require("../auth");
const { requireWorkspaceMember, requireRole } = require("../middleware/workspace");

const router = express.Router({ mergeParams: true });
router.use(authenticate, requireWorkspaceMember);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A content block is either {type:"text", text} or {type:"table", rows: [[...]]}.
// Kept intentionally loose (validated shape, not exact schema) so the
// frontend can evolve the editor without a backend change every time.
function validateContent(content) {
  if (!Array.isArray(content)) return "Log content must be a list of blocks";
  if (content.length > 200) return "That's a lot of blocks — keep it under 200 per entry";
  for (const block of content) {
    if (!block || typeof block !== "object") return "Each block must be an object";
    if (block.type === "text") {
      if (typeof block.text !== "string" || block.text.length > 8000) return "A text block is too long or invalid";
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
router.get("/team", requireRole("admin", "lead"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (from && !DATE_RE.test(from)) return res.status(400).json({ error: "Invalid 'from' date" });
    if (to && !DATE_RE.test(to)) return res.status(400).json({ error: "Invalid 'to' date" });
    const logs = await getTeamActivityLogs(req.params.workspaceId, { from, to });
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

module.exports = router;
