const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { getWorkspacesForUser } = require("./db");

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
      socket.data.userId = payload.id;
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    socket.join(`user:${socket.data.userId}`);

    // Join a room per workspace this user actually belongs to — this is
    // what keeps realtime events from leaking across projects.
    try {
      const workspaces = await getWorkspacesForUser(socket.data.userId);
      workspaces.forEach((w) => socket.join(`workspace:${w.id}`));
    } catch (err) {
      console.error("Failed to join workspace rooms for socket", err);
    }

    // Called by the client after creating/joining a new workspace mid-session
    // so the socket starts receiving realtime events for it immediately.
    socket.on("workspace:join", (workspaceId) => {
      if (typeof workspaceId === "string") socket.join(`workspace:${workspaceId}`);
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
