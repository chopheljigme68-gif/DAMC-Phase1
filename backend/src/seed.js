require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("./pool");
const { createUser, getUserByEmail, createTask, createWorkspace, addWorkspaceMember, setMemberRole, createProject } = require("./db");

const MEMBERS = [
  { name: "Daniel Cho", email: "daniel@flowhub.dev", title: "Founder", role: "admin" },
  { name: "Priya Nair", email: "priya@flowhub.dev", title: "Product Designer", role: "lead" },
  { name: "Leo Marchetti", email: "leo@flowhub.dev", title: "Frontend Engineer", role: "member" },
  { name: "Sena Osei", email: "sena@flowhub.dev", title: "Backend Engineer", role: "member" },
  { name: "Astrid Voss", email: "astrid@flowhub.dev", title: "QA Engineer", role: "member" },
  { name: "Ravi Kapoor", email: "ravi@flowhub.dev", title: "Founding Engineer", role: "member" },
];

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const daysAhead = (n) => daysAgo(-n);

async function main() {
  const existing = await getUserByEmail("daniel@flowhub.dev");
  if (existing) {
    console.log("Seed data already present (daniel@flowhub.dev exists) — skipping.");
    await pool.end();
    return;
  }

  const passwordHash = bcrypt.hashSync("password123", 8);
  const adminPasswordHash = bcrypt.hashSync("admin123", 8);
  const users = {};
  for (const m of MEMBERS) {
    const user = await createUser({ name: m.name, email: m.email, passwordHash: m.role === "admin" ? adminPasswordHash : passwordHash });
    users[m.name] = user.id;
  }

  // Daniel creates the workspace -> becomes admin automatically.
  const workspaceId = await createWorkspace({ name: "Product Studio", createdBy: users["Daniel Cho"] });
  for (const m of MEMBERS) {
    if (m.name === "Daniel Cho") continue;
    await addWorkspaceMember({ workspaceId, userId: users[m.name], title: m.title });
  }
  await pool.query("UPDATE workspace_members SET title = $1 WHERE workspace_id = $2 AND user_id = $3", ["Founder", workspaceId, users["Daniel Cho"]]);
  await setMemberRole(workspaceId, users["Priya Nair"], "lead");

  const projectWeb = await createProject({ workspaceId, name: "Website Relaunch", description: "Rebuilding the marketing site and onboarding flow.", createdBy: users["Daniel Cho"] });
  const projectMobile = await createProject({ workspaceId, name: "Mobile App v2", description: "Native app rewrite with offline support.", createdBy: users["Daniel Cho"] });

  const tasksSeed = [
    { project: projectWeb.id, title: "Design onboarding flow v2", description: "Simplify the first-run experience for new workspaces; reduce steps from 6 to 3.", status: "todo", priority: "high", assignee: "Priya Nair", due: daysAhead(2), subtasks: [{ text: "Wireframe empty states", done: true }, { text: "Prototype in Figma", done: true }, { text: "Run 3 hallway tests", done: false }] },
    { project: projectWeb.id, title: "Fix drag-and-drop ghost image on Safari", description: "Card preview renders offset when dragging between columns in Safari 17.", status: "todo", priority: "medium", assignee: "Leo Marchetti", due: daysAhead(5), subtasks: [{ text: "Repro on Safari 17", done: true }, { text: "Patch drag image offset", done: false }] },
    { project: projectWeb.id, title: "Migrate auth to new provider", description: "Swap session handling over to the new identity provider without downtime.", status: "todo", priority: "high", assignee: "Sena Osei", due: daysAgo(1), subtasks: [{ text: "Shadow-write sessions", done: true }, { text: "Cut over read path", done: false }, { text: "Remove legacy provider", done: false }] },
    { project: projectWeb.id, title: "Write Q3 release notes", description: "Summarize shipped features for the quarterly changelog email.", status: "todo", priority: "low", assignee: "Priya Nair", due: daysAhead(1), subtasks: [{ text: "Draft copy", done: true }] },
    { project: projectWeb.id, title: "Icon set audit", description: "Check every icon against the new 1.5px stroke standard.", status: "done", priority: "low", assignee: "Priya Nair", due: daysAgo(4), subtasks: [{ text: "Audit nav icons", done: true }, { text: "Audit board icons", done: true }] },
    { project: projectWeb.id, title: "Ship dark mode toggle", description: "Persist theme choice and audit contrast across every view.", status: "done", priority: "medium", assignee: "Leo Marchetti", due: daysAgo(2), subtasks: [{ text: "Theme tokens", done: true }, { text: "Contrast pass", done: true }] },

    { project: projectMobile.id, title: "Regression pass on billing", description: "Full manual regression on the billing flow before the release cut.", status: "todo", priority: "high", assignee: "Astrid Voss", due: daysAhead(4), subtasks: [{ text: "Card update flow", done: false }, { text: "Proration edge cases", done: false }] },
    { project: projectMobile.id, title: "Set up product analytics dashboard", description: "Wire up activation and retention charts for the leadership review.", status: "todo", priority: "medium", assignee: "Ravi Kapoor", due: daysAhead(8), subtasks: [] },
    { project: projectMobile.id, title: "Refactor task card component", description: "Split TaskCard into presentational + container to cut re-renders.", status: "done", priority: "medium", assignee: "Ravi Kapoor", due: daysAgo(6), subtasks: [{ text: "Extract subcomponents", done: true }] },
    { project: projectMobile.id, title: "Cache warm-up job", description: "Background job to pre-warm the task list cache after deploys.", status: "done", priority: "low", assignee: "Sena Osei", due: daysAgo(9), subtasks: [] },
    { project: projectMobile.id, title: "Notification bell polish", description: "Unread badge, mark-all-read, and empty state copy.", status: "done", priority: "medium", assignee: "Astrid Voss", due: daysAgo(1), subtasks: [{ text: "Empty state copy", done: true }] },
  ];

  for (const t of tasksSeed) {
    const task = await createTask({
      title: t.title, description: t.description, status: t.status, priority: t.priority,
      assigneeId: users[t.assignee], due: t.due, subtasks: t.subtasks, createdBy: users["Daniel Cho"],
      workspaceId, projectId: t.project,
    });
    const createdDaysAgo = { done: 10, todo: 4 }[t.status] ?? 3;
    const completedDaysAgo = t.status === "done" ? Math.max(1, Math.floor(Math.random() * 12)) : null;
    await pool.query(
      `UPDATE tasks SET created_at = now() - ($1 || ' days')::interval,
       completed_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() - ($2 || ' days')::interval END
       WHERE id = $3`,
      [createdDaysAgo, completedDaysAgo, task.id]
    );
  }

  console.log(`✅ Seeded workspace "Product Studio" — Daniel (admin), Priya (lead), 4 members, 2 projects, ${tasksSeed.length} tasks.`);
  console.log(`   Admin password (daniel@flowhub.dev): admin123`);
  console.log(`   Everyone else's password: password123`);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
