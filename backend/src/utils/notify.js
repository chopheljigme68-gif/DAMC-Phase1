const { createNotification } = require("../db");
const { getIO } = require("../socket");

async function notify({ userId, type, taskId, taskTitle, workspaceId, message }) {
  const notif = await createNotification({ userId, type, taskId, taskTitle, workspaceId, message });
  try {
    getIO().to(`user:${userId}`).emit("notification:new", notif);
  } catch (err) {
    // Socket layer not ready (e.g. during tests) — notification is still persisted.
  }
  return notif;
}

function broadcastTaskChange(workspaceId, payload) {
  try {
    getIO().to(`workspace:${workspaceId}`).emit("task:changed", { workspaceId, ...payload });
  } catch (err) {
    // ignore if socket layer isn't up
  }
}

function broadcastLeadChange(workspaceId, leadId) {
  try {
    getIO().to(`workspace:${workspaceId}`).emit("lead:changed", { workspaceId, leadId });
  } catch (err) {
    // ignore
  }
}

function broadcastMemberAdded(workspaceId) {
  try {
    getIO().to(`workspace:${workspaceId}`).emit("members:changed", { workspaceId });
  } catch (err) {
    // ignore
  }
}

function broadcastProjectsChanged(workspaceId) {
  try {
    getIO().to(`workspace:${workspaceId}`).emit("projects:changed", { workspaceId });
  } catch (err) {
    // ignore
  }
}

module.exports = { notify, broadcastTaskChange, broadcastLeadChange, broadcastMemberAdded, broadcastProjectsChanged };
