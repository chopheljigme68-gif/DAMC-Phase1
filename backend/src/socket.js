const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { getWorkspacesForUser, getUserById, getMembership } = require("./db");
const { isStale } = require("./auth");

let io = null;

function initSocket(httpServer, corsOrigin) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("unauthorized"));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      // Same checks as the REST API: the account must still exist, and a
      // token from before the last password change is refused.
      getUserById(payload.id).then((user) => {
        if (!user || isStale(payload, user)) return next(new Error("unauthorized"));
        socket.data.userId = user.id;
        socket.data.isSuperAdmin = Boolean(user.isPlatformAdmin);
        next();
      }).catch(() => next(new Error("unauthorized")));
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    socket.join(`user:${socket.data.userId}`);

    // Join a room per workspace this user actually belongs to — this is
    // what keeps realtime events from leaking across projects.
    try {
      const workspaces = await getWorkspacesForUser(socket.data.userId, { includeAll: socket.data.isSuperAdmin });
      workspaces.forEach((w) => socket.join(`workspace:${w.id}`));
    } catch (err) {
      console.error("Failed to join workspace rooms for socket", err);
    }

    // Called by the client after creating/joining a new workspace mid-session
    // so the socket starts receiving realtime events for it immediately.
    // Verified: this used to join ANY room it was asked for, so anyone signed
    // in could listen to another workspace's live updates by sending its id.
    socket.on("workspace:join", async (workspaceId) => {
      if (typeof workspaceId !== "string") return;
      try {
        if (socket.data.isSuperAdmin || (await getMembership(workspaceId, socket.data.userId))) {
          socket.join(`workspace:${workspaceId}`);
        }
      } catch { /* not joined */ }
    });

    socket.on("disconnect", () => {
      // no-op, room membership is cleaned up automatically
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.io not initialized yet");
  return io;
}

module.exports = { initSocket, getIO };
