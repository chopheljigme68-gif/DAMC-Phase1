const express = require("express");
const fs = require("fs");
const {
  getProjectsForWorkspace, createProject, deleteProject, getProjectById, setProjectComplete, setProjectLead, updateProject,
  getProjectMembers, addProjectMember, removeProjectMember, getMembership,
  getMilestones, getMilestoneById, createMilestone, updateMilestone, deleteMilestoneById, reorderMilestone,
  addMilestoneLink, deleteMilestoneLink,
  getAttachmentsForMilestone, getMilestoneAttachmentById, addMilestoneAttachment, deleteMilestoneAttachment,
  getDocumentsForProject, getDocumentById, addDocument, deleteDocument,
  getLinksForProject, addProjectLink, getProjectLinkById, deleteProjectLink,
} = require("../db");
const { authenticate } = require("../auth");
const { requireWorkspaceMember, requireRole, requireProjectInWorkspace, requireProjectManager } = require("../middleware/workspace");
const { broadcastProjectsChanged } = require("../utils/notify");
const { projectUpload, milestoneUpload } = require("../utils/upload");

const router = express.Router({ mergeParams: true });
router.use(authenticate, requireWorkspaceMember);

router.get("/", async (req, res, next) => {
  try {
    res.json({ projects: await getProjectsForWorkspace(req.params.workspaceId) });
  } catch (err) { next(err); }
});

router.post("/", requireRole("admin", "lead"), async (req, res, next) => {
  try {
    const { name, description, deadline, startDate, memberIds } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Project name is required" });
    const project = await createProject({
      workspaceId: req.params.workspaceId, name: name.trim(), description, deadline: deadline || null, startDate: startDate || null,
      createdBy: req.user.id, memberIds: Array.isArray(memberIds) ? memberIds : [],
    });
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(201).json({ project, members: await getProjectMembers(project.id) });
  } catch (err) { next(err); }
});

router.delete("/:projectId", requireRole("admin", "lead"), async (req, res, next) => {
  try {
    const project = await getProjectById(req.params.projectId);
    if (!project || project.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: "Project not found" });
    await deleteProject(req.params.projectId);
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// Editing the project's own name/description/deadline/start date — same
// authority as everything else project-scoped: workspace admin/lead, or
// this project's own lead.
router.patch("/:projectId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const { name, description, deadline, startDate } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Project name is required" });
    if (deadline && startDate && new Date(startDate) > new Date(deadline)) {
      return res.status(400).json({ error: "Start date can't be after the deadline" });
    }
    const project = await updateProject(req.params.projectId, { name: name.trim(), description, deadline, startDate });
    broadcastProjectsChanged(req.params.workspaceId);
    res.json({ project });
  } catch (err) { next(err); }
});

// Assigning WHO the project's lead is stays an admin-only decision — the
// lead role it grants is powerful (full edit rights across the project),
// so only the workspace admin hands it out, same as the workspace-wide Lead.
router.patch("/:projectId/lead", requireProjectInWorkspace, requireRole("admin"), async (req, res, next) => {
  try {
    const { leadId } = req.body || {};
    if (leadId) {
      const membership = await getMembership(req.params.workspaceId, leadId);
      if (!membership) return res.status(400).json({ error: "That person isn't a member of this workspace" });
    }
    const project = await setProjectLead(req.params.projectId, leadId || null);
    broadcastProjectsChanged(req.params.workspaceId);
    res.json({ project });
  } catch (err) { next(err); }
});

// Marking a project complete doesn't delete anything — its tasks, files,
// comments, and milestone all stay exactly where they are, just under a
// project that's now flagged "done" and moved to the workspace's history.
router.patch("/:projectId/complete", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const { complete } = req.body || {};
    const project = await setProjectComplete(req.params.projectId, req.user.id, complete !== false);
    broadcastProjectsChanged(req.params.workspaceId);
    res.json({ project });
  } catch (err) { next(err); }
});

// ---------------- milestones (multiple per project, shown in sequence) ----------------
// Viewable by every workspace member; only admin/lead can create/edit/reorder.

router.get("/:projectId/milestones", requireProjectInWorkspace, async (req, res, next) => {
  try {
    res.json({ milestones: await getMilestones(req.params.projectId) });
  } catch (err) { next(err); }
});

router.post("/:projectId/milestones", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const { title, description, targetDate } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: "Milestone title is required" });
    const milestone = await createMilestone({
      projectId: req.params.projectId, title: title.trim(), description, targetDate, createdBy: req.user.id,
    });
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(201).json({ milestone });
  } catch (err) { next(err); }
});

async function assertMilestoneInProject(milestoneId, projectId) {
  const m = await getMilestoneById(milestoneId);
  if (!m || m.projectId !== projectId) return null;
  return m;
}

router.put("/:projectId/milestones/:milestoneId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    const { title, description, targetDate } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: "Milestone title is required" });
    const milestone = await updateMilestone(req.params.milestoneId, { title: title.trim(), description, targetDate });
    broadcastProjectsChanged(req.params.workspaceId);
    res.json({ milestone });
  } catch (err) { next(err); }
});

router.delete("/:projectId/milestones/:milestoneId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    await deleteMilestoneById(req.params.milestoneId);
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post("/:projectId/milestones/:milestoneId/move", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    const { direction } = req.body || {};
    if (direction !== "up" && direction !== "down") return res.status(400).json({ error: "direction must be up or down" });
    const milestones = await reorderMilestone(req.params.milestoneId, direction);
    broadcastProjectsChanged(req.params.workspaceId);
    res.json({ milestones });
  } catch (err) { next(err); }
});

router.post("/:projectId/milestones/:milestoneId/links", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    const { label, url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url.trim())) return res.status(400).json({ error: "A valid http(s) link is required" });
    const link = await addMilestoneLink({ milestoneId: req.params.milestoneId, label: (label || url).trim(), url: url.trim(), createdBy: req.user.id });
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(201).json({ link });
  } catch (err) { next(err); }
});

router.delete("/:projectId/milestones/:milestoneId/links/:linkId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    await deleteMilestoneLink(req.params.linkId);
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- milestone files (view open to all, upload/remove admin/lead) ----------------

router.get("/:projectId/milestones/:milestoneId/attachments", requireProjectInWorkspace, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    res.json({ attachments: await getAttachmentsForMilestone(req.params.milestoneId) });
  } catch (err) { next(err); }
});

router.post("/:projectId/milestones/:milestoneId/attachments", requireProjectInWorkspace, requireProjectManager, (req, res, next) => {
  milestoneUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Milestone not found" });
    }
    if (!req.file) return res.status(400).json({ error: "No file was uploaded" });
    const attachment = await addMilestoneAttachment({
      milestoneId: req.params.milestoneId, uploadedBy: req.user.id,
      fileName: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size, storagePath: req.file.path,
    });
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(201).json({ attachment });
  } catch (err) { next(err); }
});

router.get("/:projectId/milestones/:milestoneId/attachments/:attachmentId/file", requireProjectInWorkspace, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    const attachment = await getMilestoneAttachmentById(req.params.attachmentId);
    if (!attachment || attachment.milestoneId !== req.params.milestoneId) return res.status(404).json({ error: "Attachment not found" });
    if (!fs.existsSync(attachment.storagePath)) return res.status(404).json({ error: "File is missing from storage" });
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    fs.createReadStream(attachment.storagePath).pipe(res);
  } catch (err) { next(err); }
});

router.delete("/:projectId/milestones/:milestoneId/attachments/:attachmentId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const existing = await assertMilestoneInProject(req.params.milestoneId, req.params.projectId);
    if (!existing) return res.status(404).json({ error: "Milestone not found" });
    const attachment = await deleteMilestoneAttachment(req.params.attachmentId);
    if (attachment && attachment.milestoneId === req.params.milestoneId && fs.existsSync(attachment.storagePath)) {
      fs.unlink(attachment.storagePath, () => {});
    }
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- project-level reference links ----------------

router.get("/:projectId/links", requireProjectInWorkspace, async (req, res, next) => {
  try {
    res.json({ links: await getLinksForProject(req.params.projectId) });
  } catch (err) { next(err); }
});

router.post("/:projectId/links", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const { label, url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url.trim())) return res.status(400).json({ error: "A valid http(s) link is required" });
    const link = await addProjectLink({ projectId: req.params.projectId, label: (label || url).trim(), url: url.trim(), createdBy: req.user.id });
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(201).json({ link });
  } catch (err) { next(err); }
});

router.delete("/:projectId/links/:linkId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const link = await getProjectLinkById(req.params.linkId);
    if (!link || link.projectId !== req.params.projectId) return res.status(404).json({ error: "Link not found" });
    await deleteProjectLink(req.params.linkId);
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- project-level reference documents ----------------
// Visible to every workspace member (unlike task attachments, these are
// shared reference material — circulars, guidelines — not tied to who a
// task is assigned to). Only admin/lead can upload or remove them.

router.get("/:projectId/documents", requireProjectInWorkspace, async (req, res, next) => {
  try {
    res.json({ documents: await getDocumentsForProject(req.params.projectId) });
  } catch (err) { next(err); }
});

router.post("/:projectId/documents", requireProjectInWorkspace, requireProjectManager, (req, res, next) => {
  projectUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file was uploaded" });
    const document = await addDocument({
      projectId: req.params.projectId,
      uploadedBy: req.user.id,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storagePath: req.file.path,
    });
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(201).json({ document });
  } catch (err) { next(err); }
});

router.get("/:projectId/documents/:documentId/file", requireProjectInWorkspace, async (req, res, next) => {
  try {
    const doc = await getDocumentById(req.params.documentId);
    if (!doc || doc.projectId !== req.params.projectId) return res.status(404).json({ error: "Document not found" });
    if (!fs.existsSync(doc.storagePath)) return res.status(404).json({ error: "File is missing from storage" });

    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    fs.createReadStream(doc.storagePath).pipe(res);
  } catch (err) { next(err); }
});

router.delete("/:projectId/documents/:documentId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const doc = await deleteDocument(req.params.documentId);
    if (doc && doc.projectId === req.params.projectId && fs.existsSync(doc.storagePath)) {
      fs.unlink(doc.storagePath, () => {});
    }
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------- project team (who's on this project — separate from task assignment) ----------------

router.get("/:projectId/members", requireProjectInWorkspace, async (req, res, next) => {
  try {
    res.json({ members: await getProjectMembers(req.params.projectId) });
  } catch (err) { next(err); }
});

router.post("/:projectId/members", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const members = await addProjectMember(req.params.projectId, userId);
    broadcastProjectsChanged(req.params.workspaceId);
    res.status(201).json({ members });
  } catch (err) { next(err); }
});

router.delete("/:projectId/members/:userId", requireProjectInWorkspace, requireProjectManager, async (req, res, next) => {
  try {
    const members = await removeProjectMember(req.params.projectId, req.params.userId);
    broadcastProjectsChanged(req.params.workspaceId);
    res.json({ members });
  } catch (err) { next(err); }
});

module.exports = router;
