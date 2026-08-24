const express = require("express");
const {
  getWorkspacesForUser, createWorkspace, getWorkspaceById, getWorkspaceMembers, getUserByEmail,
  addWorkspaceMember, setMemberRole, updateMemberTitle, removeMember, countAdmins, createInvite, getMembership,
  getWorkspaceWorkload, getHolidays, addHoliday, deleteHoliday, getHolidayById, getAllTasksForWorkspace,
} = require("../db");
const { authenticate } = require("../auth");
const { requireWorkspaceMember, requireRole, requirePlatformAdmin } = require("../middleware/workspace");
const { notify, broadcastLeadChange, broadcastMemberAdded } = require("../utils/notify");
const { sendAddedToWorkspaceEmail, sendInviteEmail } = require("../utils/mailer");

const router = express.Router();

router.get("/", authenticate, async (req, res, next) => {
  try {
    res.json({ workspaces: await getWorkspacesForUser(req.user.id) });
  } catch (err) { next(err); }
});

// Platform-admin only: creates a new workspace. Regular
// staff never see this — they're invited into an existing one instead.
router.post("/", authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Workspace name is required" });
    const workspaceId = await createWorkspace({ name: name.trim(), createdBy: req.user.id });
    const workspaces = await getWorkspacesForUser(req.user.id);
    res.status(201).json({ workspace: workspaces.find((w) => w.id === workspaceId), workspaces });
  } catch (err) { next(err); }
});

router.get("/:workspaceId/members", authenticate, requireWorkspaceMember, async (req, res, next) => {
  try {
    res.json({ members: await getWorkspaceMembers(req.params.workspaceId) });
  } catch (err) { next(err); }
});

// Invites an email to the workspace. If the person already has an account,
// they're added immediately as a member. If not, the invite is stored and
// silently redeemed the moment they register (see auth.routes.js /register).
router.post("/:workspaceId/invite", authenticate, requireWorkspaceMember, requireRole("admin", "lead"), async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Valid email is required" });

    const workspace = await getWorkspaceById(req.params.workspaceId);
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    const existing = await getUserByEmail(email);
    if (existing) {
      const already = await getMembership(req.params.workspaceId, existing.id);
      if (already) return res.status(409).json({ error: "That person is already on this workspace" });

      await addWorkspaceMember({ workspaceId: req.params.workspaceId, userId: existing.id, title: existing.defaultTitle || null });
      await notify({
        userId: existing.id, type: "invited", taskId: null, taskTitle: null,
        workspaceId: req.params.workspaceId, message: `${req.user.name} added you to a workspace`,
      });
      try {
        await sendAddedToWorkspaceEmail({ to: existing.email, workspaceName: workspace.name, invitedByName: req.user.name, appUrl });
      } catch (mailErr) {
        console.error("Failed to send 'added to workspace' email:", mailErr.message);
      }
      broadcastMemberAdded(req.params.workspaceId);
      return res.status(201).json({ status: "added", members: await getWorkspaceMembers(req.params.workspaceId) });
    }

    await createInvite({ workspaceId: req.params.workspaceId, email, invitedBy: req.user.id });
    try {
      await sendInviteEmail({ to: email, workspaceName: workspace.name, invitedByName: req.user.name, appUrl });
    } catch (mailErr) {
      console.error("Failed to send invite email:", mailErr.message);
    }
    res.status(201).json({ status: "invited", message: "They'll be added automatically the moment they create an account with this email." });
  } catch (err) { next(err); }
});

// Admin-only: set someone's role. Exactly one 'lead' at a time (enforced by
// a DB constraint too — this isn't just a nice UI rule). Refuses to demote
// the workspace's last remaining admin so it never gets orphaned.
router.patch("/:workspaceId/members/:userId/role", authenticate, requireWorkspaceMember, requireRole("admin"), async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (!["admin", "lead", "member"].includes(role)) {
      return res.status(400).json({ error: "role must be admin, lead, or member" });
    }
    const target = await getMembership(req.params.workspaceId, req.params.userId);
    if (!target) return res.status(404).json({ error: "That person isn't on this workspace" });

    if (target.role === "admin" && role !== "admin") {
      const admins = await countAdmins(req.params.workspaceId);
      if (admins <= 1) return res.status(400).json({ error: "A workspace needs at least one admin — promote someone else first" });
    }

    await setMemberRole(req.params.workspaceId, req.params.userId, role);
    broadcastLeadChange(req.params.workspaceId, req.params.userId);

    if (req.params.userId !== req.user.id) {
      const label = role === "admin" ? "an admin" : role === "lead" ? "the team lead" : "a team member";
      await notify({
        userId: req.params.userId, type: "role", taskId: null, taskTitle: null,
        workspaceId: req.params.workspaceId, message: `${req.user.name} made you ${label}`,
      });
    }
    res.json({ members: await getWorkspaceMembers(req.params.workspaceId) });
  } catch (err) { next(err); }
});

// Workspace-wide workload (across every project, not just one) — this is
// what the Team page's "Active workload" chart uses. Admin/lead only.
router.get("/:workspaceId/workload", authenticate, requireWorkspaceMember, requireRole("admin", "lead"), async (req, res, next) => {
  try {
    res.json({ workload: await getWorkspaceWorkload(req.params.workspaceId) });
  } catch (err) { next(err); }
});

// Admin-only: remove someone from the workspace entirely. Their existing
// tasks keep their history (assignee id stays as-is for the record) but
// they'll no longer appear as a valid assignee for new work.
router.delete("/:workspaceId/members/:userId", authenticate, requireWorkspaceMember, requireRole("admin"), async (req, res, next) => {
  try {
    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: "You can't remove yourself. Promote someone else to admin first." });
    }
    const target = await getMembership(req.params.workspaceId, req.params.userId);
    if (!target) return res.status(404).json({ error: "That person isn't on this workspace" });

    if (target.role === "admin") {
      const admins = await countAdmins(req.params.workspaceId);
      if (admins <= 1) return res.status(400).json({ error: "A workspace needs at least one admin — promote someone else first" });
    }

    await removeMember(req.params.workspaceId, req.params.userId);
    broadcastMemberAdded(req.params.workspaceId);

    await notify({
      userId: req.params.userId, type: "removed", taskId: null, taskTitle: null,
      workspaceId: req.params.workspaceId, message: `${req.user.name} removed you from a workspace`,
    });

    res.json({ members: await getWorkspaceMembers(req.params.workspaceId) });
  } catch (err) { next(err); }
});

// Update someone's post/designation. Members can edit their own; admin can
// edit anyone's. This is deliberately separate from the role endpoint above
// — "Post" is just a label (e.g. "Section Head"), it carries no permissions.
router.patch("/:workspaceId/members/:userId/title", authenticate, requireWorkspaceMember, async (req, res, next) => {
  try {
    const { title } = req.body || {};
    if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "Post/designation is required" });
    if (title.length > 120) return res.status(400).json({ error: "Keep it under 120 characters" });

    const isSelf = req.params.userId === req.user.id;
    if (!isSelf && req.membership.role !== "admin") {
      return res.status(403).json({ error: "You can only edit your own post, or ask your admin to update it" });
    }
    const target = await getMembership(req.params.workspaceId, req.params.userId);
    if (!target) return res.status(404).json({ error: "That person isn't on this workspace" });

    await updateMemberTitle(req.params.workspaceId, req.params.userId, title.trim());
    broadcastMemberAdded(req.params.workspaceId);
    res.json({ members: await getWorkspaceMembers(req.params.workspaceId) });
  } catch (err) { next(err); }
});

// ---------------- holidays (workspace-wide, shown on the calendar) ----------------

router.get("/:workspaceId/holidays", authenticate, requireWorkspaceMember, async (req, res, next) => {
  try {
    res.json({ holidays: await getHolidays(req.params.workspaceId) });
  } catch (err) { next(err); }
});

router.post("/:workspaceId/holidays", authenticate, requireWorkspaceMember, requireRole("admin", "lead"), async (req, res, next) => {
  try {
    const { date, name } = req.body || {};
    if (!date) return res.status(400).json({ error: "Date is required" });
    if (!name || !name.trim()) return res.status(400).json({ error: "Holiday name is required" });
    const holiday = await addHoliday({ workspaceId: req.params.workspaceId, date, name: name.trim(), createdBy: req.user.id });
    broadcastMemberAdded(req.params.workspaceId); // reuse the generic "workspace data changed" ping
    res.status(201).json({ holiday });
  } catch (err) { next(err); }
});

router.delete("/:workspaceId/holidays/:holidayId", authenticate, requireWorkspaceMember, requireRole("admin", "lead"), async (req, res, next) => {
  try {
    const holiday = await getHolidayById(req.params.holidayId);
    if (!holiday || holiday.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: "Holiday not found" });
    await deleteHoliday(req.params.holidayId);
    broadcastMemberAdded(req.params.workspaceId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// Every task across every project in the workspace, in one call — the
// Board and Dashboard both use this now instead of being locked to
// whichever project happens to be currently selected. Same visibility
// rule as project-scoped tasks: everyone can view, editing stays
// role-gated at the individual task level (enforced in tasks.routes.js).
router.get("/:workspaceId/tasks", authenticate, requireWorkspaceMember, async (req, res, next) => {
  try {
    res.json({ tasks: await getAllTasksForWorkspace(req.params.workspaceId) });
  } catch (err) { next(err); }
});

module.exports = router;
