require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");

const { initSocket } = require("./socket");
const { startDueSoonScheduler } = require("./utils/reminders");

const authRoutes = require("./routes/auth.routes");
const usersRoutes = require("./routes/users.routes");
const workspacesRoutes = require("./routes/workspaces.routes");
const projectsRoutes = require("./routes/projects.routes");
const tasksRoutes = require("./routes/tasks.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const activityRoutes = require("./routes/activity.routes");

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

if (!process.env.JWT_SECRET) {
  console.warn("⚠️  JWT_SECRET is not set — copy .env.example to .env and set one before deploying.");
  process.env.JWT_SECRET = "dev-only-insecure-secret";
}

const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/workspaces", workspacesRoutes);
app.use("/api/workspaces/:workspaceId/projects", projectsRoutes);
app.use("/api/workspaces/:workspaceId/projects/:projectId/tasks", tasksRoutes);
app.use("/api/workspaces/:workspaceId/projects/:projectId/analytics", analyticsRoutes);
app.use("/api/workspaces/:workspaceId/activity-log", activityRoutes);
app.use("/api/notifications", notificationsRoutes);

app.use((err, req, res, next) => {
  // Malformed JSON in the request body (express.json() throws this before
  // any route handler ever runs) — a client-side mistake, not a server
  // failure, so it should read as a normal 400, not "internal server error".
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "That request wasn't formatted correctly. Please try again." });
  }

  // A file exceeding multer's size limit surfaces here too if it wasn't
  // already caught by the route's own upload error handler.
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "That file is too large." });
  }

  // Postgres unique-constraint violations that slipped past an explicit
  // check in a route — still a client-facing 409, not a server crash.
  if (err.code === "23505") {
    return res.status(409).json({ error: "That already exists." });
  }

  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again in a moment." });
});

const server = http.createServer(app);
initSocket(server, CORS_ORIGIN);

server.listen(PORT, () => {
  console.log(`Team Flow Hub API + realtime server listening on http://localhost:${PORT}`);
  startDueSoonScheduler();
});
