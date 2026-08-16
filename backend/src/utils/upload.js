const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");

const DOCUMENT_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".zip",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function makeUploader({ destinationFn, allowedExtensions, maxBytes }) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = destinationFn(req);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });

  const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(ext)) {
      return cb(new Error(`File type ${ext || "(none)"} isn't allowed`));
    }
    cb(null, true);
  };

  return multer({ storage, fileFilter, limits: { fileSize: maxBytes } });
}

// Task attachments: uploads/tasks/<workspaceId>/<projectId>/<taskId>/<uuid>.ext
const taskUpload = makeUploader({
  destinationFn: (req) => path.join(UPLOAD_ROOT, "tasks", req.params.workspaceId, req.params.projectId, req.params.id),
  allowedExtensions: DOCUMENT_EXTENSIONS,
  maxBytes: 20 * 1024 * 1024, // 20MB
});

// Subtask attachments: uploads/subtasks/<workspaceId>/<projectId>/<taskId>/<subtaskId>/<uuid>.ext
const subtaskUpload = makeUploader({
  destinationFn: (req) => path.join(UPLOAD_ROOT, "subtasks", req.params.workspaceId, req.params.projectId, req.params.id, req.params.subtaskId),
  allowedExtensions: DOCUMENT_EXTENSIONS,
  maxBytes: 20 * 1024 * 1024,
});

// Project-level reference documents: uploads/projects/<workspaceId>/<projectId>/<uuid>.ext
const projectUpload = makeUploader({
  destinationFn: (req) => path.join(UPLOAD_ROOT, "projects", req.params.workspaceId, req.params.projectId),
  allowedExtensions: DOCUMENT_EXTENSIONS,
  maxBytes: 20 * 1024 * 1024,
});

// Avatars: uploads/avatars/<userId>/<uuid>.ext — images only, small limit
const avatarUpload = makeUploader({
  destinationFn: (req) => path.join(UPLOAD_ROOT, "avatars", req.user.id),
  allowedExtensions: IMAGE_EXTENSIONS,
  maxBytes: 4 * 1024 * 1024, // 4MB
});

// Milestone attachments: uploads/milestones/<workspaceId>/<projectId>/<milestoneId>/<uuid>.ext
const milestoneUpload = makeUploader({
  destinationFn: (req) => path.join(UPLOAD_ROOT, "milestones", req.params.workspaceId, req.params.projectId, req.params.milestoneId),
  allowedExtensions: DOCUMENT_EXTENSIONS,
  maxBytes: 20 * 1024 * 1024,
});

// Activity log attachments: uploads/activity-log/<workspaceId>/<userId>/<entryDate>/<uuid>.ext
const activityLogUpload = makeUploader({
  destinationFn: (req) => path.join(UPLOAD_ROOT, "activity-log", req.params.workspaceId, req.user.id, req.params.date),
  allowedExtensions: DOCUMENT_EXTENSIONS,
  maxBytes: 20 * 1024 * 1024,
});

module.exports = { UPLOAD_ROOT, taskUpload, subtaskUpload, projectUpload, avatarUpload, milestoneUpload, activityLogUpload };