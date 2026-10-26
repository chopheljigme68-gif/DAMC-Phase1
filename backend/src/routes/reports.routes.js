const express = require("express");
const { authenticate } = require("../auth");
const { requireWorkspaceMember } = require("../middleware/workspace");
const { gatherReportData } = require("../reports/reportData");
const { buildTeamReportDocx, reportFileName } = require("../reports/teamReportDocx");
const { buildProjectReportDocx, projectReportFileName } = require("../reports/projectReportDocx");
const { pool } = require("../pool");

const router = express.Router({ mergeParams: true });
router.use(authenticate, requireWorkspaceMember);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/workspaces/:workspaceId/reports/team.docx
 *   ?userId=…      one member, omitted for the whole team
 *   &projectId=…   one project, omitted for every project
 *   &from=&to=     YYYY-MM-DD bounds, both optional
 *
 * A plain member may only pull their OWN report — the same boundary the
 * rest of the app enforces, applied here too, because a report is a very
 * efficient way to read everyone else's work in one go.
 */
router.get("/team.docx", async (req, res, next) => {
  try {
    const { userId, projectId, from, to } = req.query;
    for (const [name, value] of [["from", from], ["to", to]]) {
      if (value && !DATE_RE.test(value)) {
        return res.status(400).json({ error: `${name} must be a YYYY-MM-DD date` });
      }
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: "from must be on or before to" });
    }

    const isManager = req.membership.role === "admin" || req.membership.role === "lead";
    if (!isManager && userId !== req.user.id) {
      return res.status(403).json({ error: "You can only download your own report" });
    }

    const data = await gatherReportData({
      workspaceId: req.params.workspaceId,
      userId: userId || null,
      projectId: projectId || null,
      from: from || null,
      to: to || null,
    });
    // Every refusal says WHY, in the response and in the server log. A bare
    // 404 in a browser is indistinguishable from "this route does not exist",
    // which cost a long hunt once already.
    const refuse = (status, error) => {
      console.warn(`[report] ${status} ${error} (workspace=${req.params.workspaceId} user=${userId || "all"} project=${projectId || "all"})`);
      return res.status(status).json({ error });
    };

    if (!data) return refuse(404, "Workspace not found");
    if (userId && !data.members.some((m) => m.id === userId)) {
      return refuse(404, "That person is not a member of this workspace, so there is nothing to report on");
    }
    if (!data.members.length) return refuse(404, "This workspace has no members");

    // The generic "something went wrong on our end" from the global error
    // handler is useless for a report: it hides which record broke it, and
    // this is an internal tool for the people who can act on that. Say what
    // actually failed, and log the stack next to it.
    let buffer;
    let fileName;
    try {
      buffer = await buildTeamReportDocx(data, req.user.name);
      fileName = reportFileName(data);
    } catch (err) {
      console.error("[report] build failed:", err);
      return res.status(500).json({
        error: `The report could not be built: ${err.message}. This has been logged on the server with the full details.`,
      });
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    // Both forms: the plain one for older clients, the RFC 5987 one so a
    // name with non-ASCII in it survives.
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) { next(err); }
});

/**
 * GET /api/workspaces/:workspaceId/reports/project.docx
 *   ?projectId=…   required — the project
 *   &from=&to=     YYYY-MM-DD bounds, both optional
 *
 * Everything that happened on ONE project, in date order: every activity in
 * full (whoever it belongs to), the day-book lines tagged to the project,
 * milestones, files and links.
 *
 * Who may pull it: the workspace admin/lead, or that project's own lead —
 * the people who manage the project. It reads every person's work on it in
 * one go, which is the same reason the team report is limited for members.
 */
router.get("/project.docx", async (req, res, next) => {
  try {
    const { projectId, from, to } = req.query;
    if (!projectId) return res.status(400).json({ error: "Choose a project for the report" });
    for (const [name, value] of [["from", from], ["to", to]]) {
      if (value && !DATE_RE.test(value)) return res.status(400).json({ error: `${name} must be a YYYY-MM-DD date` });
    }
    if (from && to && from > to) return res.status(400).json({ error: "from must be on or before to" });

    const { rows } = await pool.query(
      "SELECT id, lead_id AS \"leadId\" FROM projects WHERE id::text = $1 AND workspace_id = $2",
      [String(projectId), req.params.workspaceId]
    );
    const project = rows[0];
    if (!project) return res.status(404).json({ error: "That project isn't in this workspace" });

    const isManager = req.membership.role === "admin" || req.membership.role === "lead";
    if (!isManager && project.leadId !== req.user.id) {
      return res.status(403).json({ error: "Only the admin, a team lead, or this project's lead can download the project report" });
    }

    const data = await gatherReportData({
      workspaceId: req.params.workspaceId,
      userId: null,
      projectId: project.id,
      from: from || null,
      to: to || null,
    });
    if (!data || !data.projects.length) return res.status(404).json({ error: "That project isn't in this workspace" });

    let buffer;
    let fileName;
    try {
      buffer = await buildProjectReportDocx(data, req.user.name);
      fileName = projectReportFileName(data);
    } catch (err) {
      console.error("[project report] build failed:", err);
      return res.status(500).json({
        error: `The project report could not be built: ${err.message}. This has been logged on the server with the full details.`,
      });
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) { next(err); }
});

module.exports = router;
