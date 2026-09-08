const { pool } = require("./pool");

/* ==================== users ==================== */

const USER_COLUMNS = `id, name, email, password_hash AS "passwordHash", color, initials,
  is_platform_admin AS "isPlatformAdmin", avatar_path AS "avatarPath", default_title AS "defaultTitle", created_at AS "createdAt"`;

async function getUserById(id) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getUserByEmail(email) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`, [email]);
  return rows[0] || null;
}

const PALETTE = ["#E8A33D", "#6E9BFF", "#4FD1C5", "#E8615B", "#B48CFF", "#8FD16B", "#F0A6CA", "#7FD0E8"];
const initials = (name) => name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

async function createUser({ name, email, passwordHash, defaultTitle }) {
  const { rows: countRows } = await pool.query("SELECT count(*)::int AS n FROM users");
  const color = PALETTE[countRows[0].n % PALETTE.length];
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, color, initials, default_title)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${USER_COLUMNS}`,
    [name, email, passwordHash, color, initials(name), defaultTitle || null]
  );
  return rows[0];
}

async function updateUserPassword(userId, passwordHash) {
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
}

// Self-healing bootstrap: if this user's email is in PLATFORM_ADMIN_EMAILS,
// make sure they're flagged as a platform admin. Cheap to call on every
// login — an ops person can grant/verify admin access just by editing an
// env var and having that person log in again, no manual DB work needed.
async function ensurePlatformAdminFromEnv(user) {
  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowlist.includes(user.email.toLowerCase()) && !user.isPlatformAdmin) {
    await pool.query("UPDATE users SET is_platform_admin = true WHERE id = $1", [user.id]);
    return { ...user, isPlatformAdmin: true };
  }
  return user;
}

async function updateUserAvatar(userId, avatarPath) {
  const { rows } = await pool.query(`UPDATE users SET avatar_path = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`, [avatarPath, userId]);
  return rows[0];
}

/* ==================== password resets ==================== */

async function createPasswordReset({ userId, tokenHash, expiresAt }) {
  await pool.query(
    "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt]
  );
}

async function getValidPasswordReset(tokenHash) {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", expires_at AS "expiresAt", used
     FROM password_resets WHERE token_hash = $1 AND used = false AND expires_at > now()`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function consumePasswordReset(id) {
  await pool.query("UPDATE password_resets SET used = true WHERE id = $1", [id]);
}

/* ==================== workspaces ==================== */

const slugify = (name) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);

async function getWorkspacesForUser(userId) {
  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.slug, w.created_at AS "createdAt",
            wm.title, wm.role,
            (SELECT count(*)::int FROM workspace_members m2 WHERE m2.workspace_id = w.id) AS "memberCount",
            (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = w.id) AS "taskCount",
            (SELECT count(*)::int FROM projects p WHERE p.workspace_id = w.id) AS "projectCount"
     FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = $1
     ORDER BY w.created_at ASC`,
    [userId]
  );
  return rows;
}

async function getWorkspaceById(id) {
  const { rows } = await pool.query(`SELECT id, name, slug, created_by AS "createdBy", created_at AS "createdAt" FROM workspaces WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createWorkspace({ name, createdBy }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const base = slugify(name) || "workspace";
    let slug = base;
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { rows: existing } = await client.query("SELECT 1 FROM workspaces WHERE slug = $1", [slug]);
      if (existing.length === 0) break;
      n += 1;
      slug = `${base}-${n}`;
    }
    const { rows } = await client.query(
      "INSERT INTO workspaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id",
      [name, slug, createdBy]
    );
    const workspaceId = rows[0].id;
    await client.query(
      "INSERT INTO workspace_members (workspace_id, user_id, title, role) VALUES ($1, $2, 'Workspace Admin', 'admin')",
      [workspaceId, createdBy]
    );
    await client.query("COMMIT");
    return workspaceId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getMembership(workspaceId, userId) {
  const { rows } = await pool.query(
    `SELECT id, title, role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
  return rows[0] || null;
}

async function getWorkspaceMembers(workspaceId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.color, u.initials,
            CASE WHEN u.avatar_path IS NOT NULL THEN '/api/users/' || u.id || '/avatar' ELSE NULL END AS "avatarUrl",
            wm.title, wm.role
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY (wm.role = 'admin') DESC, (wm.role = 'lead') DESC, wm.joined_at ASC`,
    [workspaceId]
  );
  return rows;
}

async function countAdmins(workspaceId) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1 AND role = 'admin'",
    [workspaceId]
  );
  return rows[0].n;
}

async function addWorkspaceMember({ workspaceId, userId, title }) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, title)
     VALUES ($1, $2, COALESCE($3, 'Team member'))
     ON CONFLICT (workspace_id, user_id) DO NOTHING
     RETURNING id`,
    [workspaceId, userId, title]
  );
  return rows[0] || null;
}

async function updateMemberTitle(workspaceId, userId, title) {
  await pool.query("UPDATE workspace_members SET title = $1 WHERE workspace_id = $2 AND user_id = $3", [title, workspaceId, userId]);
}

async function setMemberRole(workspaceId, userId, role) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (role === "lead") {
      // only one lead at a time — demote whoever currently holds it
      await client.query("UPDATE workspace_members SET role = 'member' WHERE workspace_id = $1 AND role = 'lead'", [workspaceId]);
    }
    await client.query("UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId, role]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* ==================== invites ==================== */

async function createInvite({ workspaceId, email, invitedBy }) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_invites (workspace_id, email, invited_by)
     VALUES ($1, lower($2), $3)
     ON CONFLICT (workspace_id, email) DO UPDATE SET invited_by = EXCLUDED.invited_by
     RETURNING id, workspace_id AS "workspaceId", email`,
    [workspaceId, email, invitedBy]
  );
  return rows[0];
}

async function getPendingInvitesForEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id AS "workspaceId", email FROM workspace_invites
     WHERE lower(email) = lower($1) AND accepted_at IS NULL`,
    [email]
  );
  return rows;
}

async function acceptInvite(inviteId, userId) {
  const { rows } = await pool.query(
    `UPDATE workspace_invites SET accepted_at = now() WHERE id = $1 RETURNING workspace_id AS "workspaceId"`,
    [inviteId]
  );
  const invite = rows[0];
  if (invite) {
    const user = await getUserById(userId);
    await addWorkspaceMember({ workspaceId: invite.workspaceId, userId, title: user?.defaultTitle || null });
  }
  return invite;
}

/* ==================== projects ==================== */

async function getProjectsForWorkspace(workspaceId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.description, to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
            to_char(COALESCE(p.start_date, p.created_at::date), 'YYYY-MM-DD') AS "startDate",
            (p.start_date IS NOT NULL) AS "hasExplicitStartDate",
            p.completed_at AS "completedAt", p.completed_by AS "completedBy",
            p.created_by AS "createdBy", p.created_at AS "createdAt",
            p.lead_id AS "leadId", u.name AS "leadName", u.color AS "leadColor", u.initials AS "leadInitials",
            (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS "taskCount",
            (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS "doneCount"
     FROM projects p
     LEFT JOIN users u ON u.id = p.lead_id
     WHERE p.workspace_id = $1 ORDER BY p.created_at ASC`,
    [workspaceId]
  );
  return rows;
}

async function getProjectById(id) {
  const { rows } = await pool.query(
    `SELECT p.id, p.workspace_id AS "workspaceId", p.name, p.description, to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
            to_char(COALESCE(p.start_date, p.created_at::date), 'YYYY-MM-DD') AS "startDate",
            (p.start_date IS NOT NULL) AS "hasExplicitStartDate",
            p.completed_at AS "completedAt", p.completed_by AS "completedBy",
            p.created_by AS "createdBy", p.created_at AS "createdAt",
            p.lead_id AS "leadId", u.name AS "leadName", u.color AS "leadColor", u.initials AS "leadInitials"
     FROM projects p
     LEFT JOIN users u ON u.id = p.lead_id
     WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function setProjectLead(projectId, leadId) {
  const { rows } = await pool.query(
    `UPDATE projects SET lead_id = $2 WHERE id = $1 RETURNING id`,
    [projectId, leadId]
  );
  if (!rows[0]) return null;
  return getProjectById(projectId);
}

async function updateProject(projectId, { name, description, deadline, startDate }) {
  const { rows } = await pool.query(
    `UPDATE projects SET name = $2, description = $3, deadline = $4, start_date = $5 WHERE id = $1 RETURNING id`,
    [projectId, name, description || "", deadline || null, startDate || null]
  );
  if (!rows[0]) return null;
  return getProjectById(projectId);
}

async function createProject({ workspaceId, name, description, deadline, startDate, createdBy, memberIds }) {
  const { rows } = await pool.query(
    `INSERT INTO projects (workspace_id, name, description, deadline, start_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, workspace_id AS "workspaceId", name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline,
               to_char(COALESCE(start_date, created_at::date), 'YYYY-MM-DD') AS "startDate",
               completed_at AS "completedAt", created_by AS "createdBy", created_at AS "createdAt"`,
    [workspaceId, name, description || "", deadline || null, startDate || null, createdBy]
  );
  const project = rows[0];

  // Always include the creator, plus whichever teammates were picked at
  // creation time (deduplicated — ON CONFLICT DO NOTHING covers repeats).
  const ids = new Set([createdBy, ...(memberIds || [])]);
  for (const userId of ids) {
    await pool.query("INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [project.id, userId]);
  }

  return project;
}

// The safe "no specific project" option: a single reusable per-workspace
// project literally named "General". Tasks that don't belong to a real
// project land here instead of needing a nullable FK and new routing
// everywhere. Idempotent — created once, reused forever after. The name is
// matched case-sensitively and exactly, so a user's own project called
// "General Stuff" won't collide with it.
async function getOrCreateGeneralProject(workspaceId, createdBy) {
  const existing = await pool.query(
    `SELECT id FROM projects WHERE workspace_id = $1 AND name = 'General' ORDER BY created_at ASC LIMIT 1`,
    [workspaceId]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const project = await createProject({
    workspaceId, name: "General", description: "Tasks not tied to a specific project.",
    deadline: null, startDate: null, createdBy, memberIds: [],
  });
  return project.id;
}

async function getProjectMembers(projectId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.color, u.initials,
            CASE WHEN u.avatar_path IS NOT NULL THEN '/api/users/' || u.id || '/avatar' ELSE NULL END AS "avatarUrl",
            wm.title, wm.role, pm.added_at AS "addedAt"
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     LEFT JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = (SELECT workspace_id FROM projects WHERE id = $1)
     WHERE pm.project_id = $1
     ORDER BY (wm.role = 'admin') DESC, (wm.role = 'lead') DESC, u.name ASC`,
    [projectId]
  );
  return rows;
}

async function addProjectMember(projectId, userId) {
  await pool.query("INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [projectId, userId]);
  return getProjectMembers(projectId);
}

async function removeProjectMember(projectId, userId) {
  await pool.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  return getProjectMembers(projectId);
}

async function deleteProject(id) {
  await pool.query("DELETE FROM projects WHERE id = $1", [id]); // cascades to tasks/subtasks
}

async function setProjectComplete(id, completedBy, isComplete) {
  const { rows } = await pool.query(
    `UPDATE projects SET completed_at = $2, completed_by = $3 WHERE id = $1
     RETURNING id, workspace_id AS "workspaceId", name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline,
               completed_at AS "completedAt", completed_by AS "completedBy", created_by AS "createdBy", created_at AS "createdAt"`,
    [id, isComplete ? new Date() : null, isComplete ? completedBy : null]
  );
  return rows[0];
}

/* ==================== project milestones (multiple, sequenced, with links) ==================== */

const MILESTONE_LINK_SELECT = `
  SELECT id, milestone_id AS "milestoneId", label, url, position, created_at AS "createdAt"
  FROM milestone_links
`;

// Every project on the workspace's timeline, each with its milestones
// attached — built for the Roadmap view. One query for projects, one
// batched query for every milestone across all of them (not N+1 per
// project), matching the same pattern getMilestones already uses per-project.
async function getRoadmapData(workspaceId) {
  const projects = await getProjectsForWorkspace(workspaceId);
  if (projects.length === 0) return [];
  const projectIds = projects.map((p) => p.id);

  const { rows: milestones } = await pool.query(
    `SELECT id, project_id AS "projectId", title, to_char(target_date, 'YYYY-MM-DD') AS "targetDate", position
     FROM project_milestones WHERE project_id = ANY($1) ORDER BY position ASC`,
    [projectIds]
  );

  return projects.map((p) => ({
    ...p,
    milestones: milestones.filter((m) => m.projectId === p.id),
  }));
}

async function getMilestones(projectId) {
  const { rows } = await pool.query(
    `SELECT id, project_id AS "projectId", title, description, to_char(target_date, 'YYYY-MM-DD') AS "targetDate",
            position, created_by AS "createdBy", updated_at AS "updatedAt"
     FROM project_milestones WHERE project_id = $1 ORDER BY position ASC, updated_at ASC`,
    [projectId]
  );
  const ids = rows.map((r) => r.id);
  const links = await pool.query(`${MILESTONE_LINK_SELECT} WHERE milestone_id = ANY($1) ORDER BY position ASC, created_at ASC`, [ids]);
  const attachments = await pool.query(`${MILESTONE_ATTACHMENT_SELECT} WHERE a.milestone_id = ANY($1) ORDER BY a.created_at ASC`, [ids]);
  return rows.map((m) => ({
    ...m,
    links: links.rows.filter((l) => l.milestoneId === m.id),
    attachments: attachments.rows.filter((a) => a.milestoneId === m.id),
  }));
}

async function getMilestoneById(id) {
  const { rows } = await pool.query(
    `SELECT id, project_id AS "projectId", title, description, to_char(target_date, 'YYYY-MM-DD') AS "targetDate",
            position, created_by AS "createdBy", updated_at AS "updatedAt"
     FROM project_milestones WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function createMilestone({ projectId, title, description, targetDate, createdBy }) {
  const { rows: posRows } = await pool.query("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM project_milestones WHERE project_id = $1", [projectId]);
  const { rows } = await pool.query(
    `INSERT INTO project_milestones (project_id, title, description, target_date, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, project_id AS "projectId", title, description, to_char(target_date, 'YYYY-MM-DD') AS "targetDate", position, created_by AS "createdBy", updated_at AS "updatedAt"`,
    [projectId, title, description || "", targetDate || null, posRows[0].next, createdBy]
  );
  return { ...rows[0], links: [], attachments: [] };
}

async function updateMilestone(id, { title, description, targetDate }) {
  const { rows } = await pool.query(
    `UPDATE project_milestones SET title = $2, description = $3, target_date = $4, updated_at = now()
     WHERE id = $1
     RETURNING id, project_id AS "projectId", title, description, to_char(target_date, 'YYYY-MM-DD') AS "targetDate", position, created_by AS "createdBy", updated_at AS "updatedAt"`,
    [id, title, description || "", targetDate || null]
  );
  return rows[0];
}

async function deleteMilestoneById(id) {
  await pool.query("DELETE FROM project_milestones WHERE id = $1", [id]);
}

// Move a milestone up or down in the sequence by swapping positions with its neighbor.
async function reorderMilestone(id, direction) {
  const milestone = await getMilestoneById(id);
  if (!milestone) return null;
  const cmp = direction === "up" ? "<" : ">";
  const order = direction === "up" ? "DESC" : "ASC";
  const { rows: neighborRows } = await pool.query(
    `SELECT id, position FROM project_milestones WHERE project_id = $1 AND position ${cmp} $2 ORDER BY position ${order} LIMIT 1`,
    [milestone.projectId, milestone.position]
  );
  const neighbor = neighborRows[0];
  if (!neighbor) return getMilestones(milestone.projectId);
  await pool.query("UPDATE project_milestones SET position = $2 WHERE id = $1", [milestone.id, neighbor.position]);
  await pool.query("UPDATE project_milestones SET position = $2 WHERE id = $1", [neighbor.id, milestone.position]);
  return getMilestones(milestone.projectId);
}

async function addMilestoneLink({ milestoneId, label, url, createdBy }) {
  const { rows: posRows } = await pool.query("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM milestone_links WHERE milestone_id = $1", [milestoneId]);
  const { rows } = await pool.query(
    `INSERT INTO milestone_links (milestone_id, label, url, position, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, milestone_id AS "milestoneId", label, url, position, created_at AS "createdAt"`,
    [milestoneId, label, url, posRows[0].next, createdBy]
  );
  return rows[0];
}

async function deleteMilestoneLink(id) {
  await pool.query("DELETE FROM milestone_links WHERE id = $1", [id]);
}

const MILESTONE_ATTACHMENT_SELECT = `
  SELECT a.id, a.milestone_id AS "milestoneId", a.uploaded_by AS "uploadedBy", a.file_name AS "fileName",
         a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes", a.created_at AS "createdAt",
         u.name AS "uploaderName"
  FROM milestone_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
`;

async function getAttachmentsForMilestone(milestoneId) {
  const { rows } = await pool.query(`${MILESTONE_ATTACHMENT_SELECT} WHERE a.milestone_id = $1 ORDER BY a.created_at ASC`, [milestoneId]);
  return rows;
}

async function getMilestoneAttachmentById(id) {
  const { rows } = await pool.query(
    `SELECT id, milestone_id AS "milestoneId", uploaded_by AS "uploadedBy", file_name AS "fileName",
            mime_type AS "mimeType", size_bytes AS "sizeBytes", storage_path AS "storagePath", created_at AS "createdAt"
     FROM milestone_attachments WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function addMilestoneAttachment({ milestoneId, uploadedBy, fileName, mimeType, sizeBytes, storagePath }) {
  const { rows } = await pool.query(
    `INSERT INTO milestone_attachments (milestone_id, uploaded_by, file_name, mime_type, size_bytes, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [milestoneId, uploadedBy, fileName, mimeType, sizeBytes, storagePath]
  );
  const list = await getAttachmentsForMilestone(milestoneId);
  return list.find((a) => a.id === rows[0].id);
}

async function deleteMilestoneAttachment(id) {
  const a = await getMilestoneAttachmentById(id);
  if (!a) return null;
  await pool.query("DELETE FROM milestone_attachments WHERE id = $1", [id]);
  return a;
}

/* ==================== tasks (project-scoped) ==================== */

const TASK_SELECT = `
  SELECT
    t.id, t.title, t.description, t.status, t.priority,
    t.assignee_id AS "assigneeId", t.created_by AS "createdBy",
    t.workspace_id AS "workspaceId", t.project_id AS "projectId", MAX(p.name) AS "projectName",
    to_char(t.due, 'YYYY-MM-DD') AS due,
    to_char(t.due_time, 'HH24:MI') AS "dueTime",
    t.created_at AS "createdAt", t.completed_at AS "completedAt", t.updated_at AS "updatedAt",
    COALESCE(
      json_agg(json_build_object(
        'id', s.id, 'text', s.text, 'done', s.done,
        'startTime', to_char(s.start_time, 'HH24:MI'),
        'endTime', to_char(s.end_time, 'HH24:MI'),
        'description', s.description,
        'attachmentCount', (SELECT count(*)::int FROM subtask_attachments sa WHERE sa.subtask_id = s.id),
        'linkCount', (SELECT count(*)::int FROM subtask_links sl WHERE sl.subtask_id = s.id)
      ) ORDER BY s.position)
      FILTER (WHERE s.id IS NOT NULL), '[]'
    ) AS subtasks,
    (SELECT count(*)::int FROM task_attachments a WHERE a.task_id = t.id) AS "attachmentCount"
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN subtasks s ON s.task_id = t.id
`;

// restrictToUserId: pass a user id to only return tasks assigned to them
// (used for the 'member' role, enforced server-side, not just hidden in the UI).
async function getTasks(projectId, restrictToUserId) {
  const params = [projectId];
  let where = "t.project_id = $1";
  if (restrictToUserId) {
    params.push(restrictToUserId);
    where += ` AND t.assignee_id = $${params.length}`;
  }
  const { rows } = await pool.query(`${TASK_SELECT} WHERE ${where} GROUP BY t.id ORDER BY t.created_at ASC`, params);
  return rows;
}

// Every task across every project in the workspace, in one call — the
// foundation for the Board's project filter and the Dashboard showing
// everything at once, not just the currently-selected project.
async function getAllTasksForWorkspace(workspaceId) {
  const { rows } = await pool.query(
    `${TASK_SELECT} WHERE t.workspace_id = $1 GROUP BY t.id ORDER BY t.created_at ASC`,
    [workspaceId]
  );
  return rows;
}

async function getTaskById(id) {
  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1 GROUP BY t.id`, [id]);
  return rows[0] || null;
}

async function createTask(data) {
  const client = await pool.connect();
  let taskId;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO tasks (title, description, status, priority, assignee_id, created_by, due, due_time, workspace_id, project_id, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $3 = 'done' THEN now() ELSE NULL END)
       RETURNING id`,
      [
        data.title, data.description || "", data.status || "todo", data.priority || "medium",
        data.assigneeId, data.createdBy || null, data.due || null, data.dueTime || null, data.workspaceId, data.projectId,
      ]
    );
    taskId = rows[0].id;
    const subtasks = data.subtasks || [];
    for (let i = 0; i < subtasks.length; i++) {
      const s = subtasks[i];
      await client.query(
        `INSERT INTO subtasks (task_id, text, done, position, start_time, end_time, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [taskId, s.text, !!s.done, i, s.startTime || null, s.endTime || null, s.description || ""]
      );
    }
    const links = data.links || [];
    for (const l of links) {
      if (!l.url) continue;
      await client.query(
        `INSERT INTO task_links (task_id, added_by, label, url) VALUES ($1, $2, $3, $4)`,
        [taskId, data.createdBy || null, l.label || l.url, l.url]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getTaskById(taskId);
}

async function updateTask(id, patch) {
  const before = await getTaskById(id);
  if (!before) return null;

  const fields = [];
  const values = [];
  let i = 1;
  const columnMap = { title: "title", description: "description", status: "status", priority: "priority", assigneeId: "assignee_id", due: "due", dueTime: "due_time", projectId: "project_id" };
  for (const [key, col] of Object.entries(columnMap)) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = $${i++}`);
      values.push(patch[key]);
    }
  }
  if (patch.status && patch.status !== before.status) {
    fields.push(patch.status === "done" ? "completed_at = now()" : "completed_at = NULL");
  }
  if (patch.due !== undefined && patch.due !== before.due) {
    fields.push("due_reminder_sent = false");
  }
  fields.push("updated_at = now()");
  values.push(id);

  await pool.query(`UPDATE tasks SET ${fields.join(", ")} WHERE id = $${i}`, values);
  const task = await getTaskById(id);
  return { task, prevStatus: before.status, prevAssignee: before.assigneeId };
}

async function getSubtaskById(id) {
  const { rows } = await pool.query(`SELECT id, task_id AS "taskId", text FROM subtasks WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Reconciles the subtask list instead of delete-and-recreate: existing
// subtasks (real UUIDs the client already has) get UPDATEd in place so
// their attachments/links (which cascade-delete with the subtask) survive
// routine edits like ticking a checkbox. Only subtasks actually removed by
// the user get deleted; brand-new ones (no id, or a client-side temp id)
// get INSERTed.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function replaceSubtasks(id, subtasks) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query("SELECT id FROM subtasks WHERE task_id = $1", [id]);
    const existingIds = new Set(existing.map((r) => r.id));
    const keepIds = new Set();

    for (let i = 0; i < subtasks.length; i++) {
      const s = subtasks[i];
      const hasRealId = s.id && UUID_RE.test(s.id) && existingIds.has(s.id);
      if (hasRealId) {
        await client.query(
          `UPDATE subtasks SET text = $2, done = $3, position = $4,
             start_time = $5, end_time = $6, description = $7
           WHERE id = $1`,
          [s.id, s.text, !!s.done, i, s.startTime || null, s.endTime || null, s.description || ""]
        );
        keepIds.add(s.id);
      } else {
        await client.query(
          `INSERT INTO subtasks (task_id, text, done, position, start_time, end_time, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, s.text, !!s.done, i, s.startTime || null, s.endTime || null, s.description || ""]
        );
      }
    }

    const toDelete = [...existingIds].filter((eid) => !keepIds.has(eid));
    if (toDelete.length > 0) {
      await client.query("DELETE FROM subtasks WHERE id = ANY($1)", [toDelete]);
    }

    await client.query("UPDATE tasks SET updated_at = now() WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getTaskById(id);
}

async function deleteTask(id) {
  await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
}

/* ==================== task attachments ==================== */

const ATTACHMENT_SELECT = `
  SELECT a.id, a.task_id AS "taskId", a.uploaded_by AS "uploadedBy", a.file_name AS "fileName",
         a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes", a.created_at AS "createdAt",
         u.name AS "uploaderName"
  FROM task_attachments a
  LEFT JOIN users u ON u.id = a.uploaded_by
`;

async function getAttachmentsForTask(taskId) {
  const { rows } = await pool.query(`${ATTACHMENT_SELECT} WHERE a.task_id = $1 ORDER BY a.created_at ASC`, [taskId]);
  return rows;
}

async function getAttachmentById(id) {
  const { rows } = await pool.query(
    `SELECT id, task_id AS "taskId", uploaded_by AS "uploadedBy", file_name AS "fileName",
            mime_type AS "mimeType", size_bytes AS "sizeBytes", storage_path AS "storagePath", created_at AS "createdAt"
     FROM task_attachments WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function addAttachment({ taskId, uploadedBy, fileName, mimeType, sizeBytes, storagePath }) {
  const { rows } = await pool.query(
    `INSERT INTO task_attachments (task_id, uploaded_by, file_name, mime_type, size_bytes, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [taskId, uploadedBy, fileName, mimeType, sizeBytes, storagePath]
  );
  const attachments = await getAttachmentsForTask(taskId);
  return attachments.find((a) => a.id === rows[0].id);
}

async function deleteAttachment(id) {
  const attachment = await getAttachmentById(id);
  if (!attachment) return null;
  await pool.query("DELETE FROM task_attachments WHERE id = $1", [id]);
  return attachment; // caller unlinks the file on disk using storagePath
}

/* ==================== workspace-wide workload (not project-scoped) ==================== */

async function getWorkspaceWorkload(workspaceId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.color,
            count(t.id) FILTER (WHERE t.status != 'done')::int AS active,
            count(t.id) FILTER (WHERE t.status = 'done')::int AS shipped,
            count(t.id)::int AS total
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     LEFT JOIN tasks t ON t.assignee_id = u.id AND t.workspace_id = wm.workspace_id
     WHERE wm.workspace_id = $1
     GROUP BY u.id, u.name, u.color
     ORDER BY u.name`,
    [workspaceId]
  );
  return rows;
}

/* ==================== remove member ==================== */

async function removeMember(workspaceId, userId) {
  await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
}

const NOTIF_SELECT = `SELECT id, user_id AS "userId", type, task_id AS "taskId", task_title AS "taskTitle", workspace_id AS "workspaceId", message, read, created_at AS "createdAt" FROM notifications`;

/* ==================== due-soon reminders ==================== */

// Tasks due in exactly 2 days that haven't been reminded about yet and
// aren't already done. Used by the reminder sweep in index.js.
async function getTasksDueInTwoDays() {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.assignee_id AS "assigneeId", t.workspace_id AS "workspaceId", t.project_id AS "projectId"
     FROM tasks t
     WHERE t.status != 'done' AND t.due_reminder_sent = false
       AND t.due = (current_date + interval '2 days')::date`
  );
  return rows;
}

async function markDueReminderSent(taskId) {
  await pool.query("UPDATE tasks SET due_reminder_sent = true WHERE id = $1", [taskId]);
}

/* ==================== notifications ==================== */

async function getNotificationsForUser(userId) {
  const { rows } = await pool.query(`${NOTIF_SELECT} WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [userId]);
  return rows;
}

async function createNotification({ userId, type, taskId, taskTitle, workspaceId, message }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, task_id, task_title, workspace_id, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id AS "userId", type, task_id AS "taskId", task_title AS "taskTitle", workspace_id AS "workspaceId", message, read, created_at AS "createdAt"`,
    [userId, type, taskId || null, taskTitle || null, workspaceId || null, message]
  );
  return rows[0];
}

async function markNotificationRead(id, userId) {
  const { rows } = await pool.query(
    `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2
     RETURNING id, user_id AS "userId", type, task_id AS "taskId", task_title AS "taskTitle", workspace_id AS "workspaceId", message, read, created_at AS "createdAt"`,
    [id, userId]
  );
  return rows[0] || null;
}

async function markAllRead(userId) {
  await pool.query("UPDATE notifications SET read = true WHERE user_id = $1", [userId]);
}

/* ==================== task comments (flat, chronological) ==================== */

const COMMENT_SELECT = `
  SELECT c.id, c.task_id AS "taskId", c.user_id AS "userId", c.body, c.created_at AS "createdAt",
         u.name AS "userName", u.color AS "userColor", u.initials AS "userInitials",
         CASE WHEN u.avatar_path IS NOT NULL THEN '/api/users/' || u.id || '/avatar' ELSE NULL END AS "userAvatarUrl"
  FROM task_comments c
  LEFT JOIN users u ON u.id = c.user_id
`;

async function getCommentsForTask(taskId) {
  const { rows } = await pool.query(`${COMMENT_SELECT} WHERE c.task_id = $1 ORDER BY c.created_at ASC`, [taskId]);
  return rows;
}

async function addComment({ taskId, userId, body }) {
  const { rows } = await pool.query(
    "INSERT INTO task_comments (task_id, user_id, body) VALUES ($1, $2, $3) RETURNING id",
    [taskId, userId, body]
  );
  const comments = await getCommentsForTask(taskId);
  return comments.find((c) => c.id === rows[0].id);
}

/* ==================== project documents (reference files, not task-specific) ==================== */

const DOCUMENT_SELECT = `
  SELECT d.id, d.project_id AS "projectId", d.uploaded_by AS "uploadedBy", d.file_name AS "fileName",
         d.mime_type AS "mimeType", d.size_bytes AS "sizeBytes", d.created_at AS "createdAt",
         u.name AS "uploaderName"
  FROM project_documents d
  LEFT JOIN users u ON u.id = d.uploaded_by
`;

async function getDocumentsForProject(projectId) {
  const { rows } = await pool.query(`${DOCUMENT_SELECT} WHERE d.project_id = $1 ORDER BY d.created_at DESC`, [projectId]);
  return rows;
}

async function getDocumentById(id) {
  const { rows } = await pool.query(
    `SELECT id, project_id AS "projectId", uploaded_by AS "uploadedBy", file_name AS "fileName",
            mime_type AS "mimeType", size_bytes AS "sizeBytes", storage_path AS "storagePath", created_at AS "createdAt"
     FROM project_documents WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function addDocument({ projectId, uploadedBy, fileName, mimeType, sizeBytes, storagePath }) {
  const { rows } = await pool.query(
    `INSERT INTO project_documents (project_id, uploaded_by, file_name, mime_type, size_bytes, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [projectId, uploadedBy, fileName, mimeType, sizeBytes, storagePath]
  );
  const docs = await getDocumentsForProject(projectId);
  return docs.find((d) => d.id === rows[0].id);
}

async function deleteDocument(id) {
  const doc = await getDocumentById(id);
  if (!doc) return null;
  await pool.query("DELETE FROM project_documents WHERE id = $1", [id]);
  return doc;
}

/* ==================== task links (external URLs) ==================== */

const LINK_SELECT = `
  SELECT l.id, l.task_id AS "taskId", l.added_by AS "addedBy", l.label, l.url, l.created_at AS "createdAt",
         u.name AS "adderName"
  FROM task_links l
  LEFT JOIN users u ON u.id = l.added_by
`;

async function getLinksForTask(taskId) {
  const { rows } = await pool.query(`${LINK_SELECT} WHERE l.task_id = $1 ORDER BY l.created_at ASC`, [taskId]);
  return rows;
}

async function addLink({ taskId, addedBy, label, url }) {
  const { rows } = await pool.query(
    "INSERT INTO task_links (task_id, added_by, label, url) VALUES ($1, $2, $3, $4) RETURNING id",
    [taskId, addedBy, label, url]
  );
  const links = await getLinksForTask(taskId);
  return links.find((l) => l.id === rows[0].id);
}

async function getLinkById(id) {
  const { rows } = await pool.query(`SELECT id, task_id AS "taskId" FROM task_links WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function deleteLink(id) {
  await pool.query("DELETE FROM task_links WHERE id = $1", [id]);
}

/* ==================== subtask attachments ==================== */

const SUBTASK_ATTACHMENT_SELECT = `
  SELECT a.id, a.subtask_id AS "subtaskId", a.uploaded_by AS "uploadedBy", a.file_name AS "fileName",
         a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes", a.created_at AS "createdAt",
         u.name AS "uploaderName"
  FROM subtask_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
`;

async function getAttachmentsForSubtask(subtaskId) {
  const { rows } = await pool.query(`${SUBTASK_ATTACHMENT_SELECT} WHERE a.subtask_id = $1 ORDER BY a.created_at ASC`, [subtaskId]);
  return rows;
}
async function getSubtaskAttachmentById(id) {
  const { rows } = await pool.query(
    `SELECT id, subtask_id AS "subtaskId", uploaded_by AS "uploadedBy", file_name AS "fileName",
            mime_type AS "mimeType", size_bytes AS "sizeBytes", storage_path AS "storagePath", created_at AS "createdAt"
     FROM subtask_attachments WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}
async function addSubtaskAttachment({ subtaskId, uploadedBy, fileName, mimeType, sizeBytes, storagePath }) {
  const { rows } = await pool.query(
    `INSERT INTO subtask_attachments (subtask_id, uploaded_by, file_name, mime_type, size_bytes, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [subtaskId, uploadedBy, fileName, mimeType, sizeBytes, storagePath]
  );
  const list = await getAttachmentsForSubtask(subtaskId);
  return list.find((a) => a.id === rows[0].id);
}
async function deleteSubtaskAttachment(id) {
  const a = await getSubtaskAttachmentById(id);
  if (!a) return null;
  await pool.query("DELETE FROM subtask_attachments WHERE id = $1", [id]);
  return a;
}

/* ==================== subtask links ==================== */

async function getLinksForSubtask(subtaskId) {
  const { rows } = await pool.query(
    `SELECT id, subtask_id AS "subtaskId", label, url, created_at AS "createdAt" FROM subtask_links WHERE subtask_id = $1 ORDER BY created_at ASC`,
    [subtaskId]
  );
  return rows;
}
async function addSubtaskLink({ subtaskId, label, url, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO subtask_links (subtask_id, label, url, created_by) VALUES ($1, $2, $3, $4)
     RETURNING id, subtask_id AS "subtaskId", label, url, created_at AS "createdAt"`,
    [subtaskId, label, url, createdBy]
  );
  return rows[0];
}
async function getSubtaskLinkById(id) {
  const { rows } = await pool.query(`SELECT id, subtask_id AS "subtaskId" FROM subtask_links WHERE id = $1`, [id]);
  return rows[0] || null;
}
async function deleteSubtaskLink(id) {
  await pool.query("DELETE FROM subtask_links WHERE id = $1", [id]);
}

/* ==================== project links ==================== */

async function getLinksForProject(projectId) {
  const { rows } = await pool.query(
    `SELECT pl.id, pl.project_id AS "projectId", pl.label, pl.url, pl.created_at AS "createdAt", u.name AS "creatorName"
     FROM project_links pl LEFT JOIN users u ON u.id = pl.created_by
     WHERE pl.project_id = $1 ORDER BY pl.created_at ASC`,
    [projectId]
  );
  return rows;
}
async function addProjectLink({ projectId, label, url, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO project_links (project_id, label, url, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [projectId, label, url, createdBy]
  );
  const list = await getLinksForProject(projectId);
  return list.find((l) => l.id === rows[0].id);
}
async function getProjectLinkById(id) {
  const { rows } = await pool.query(`SELECT id, project_id AS "projectId" FROM project_links WHERE id = $1`, [id]);
  return rows[0] || null;
}
async function deleteProjectLink(id) {
  await pool.query("DELETE FROM project_links WHERE id = $1", [id]);
}

/* ==================== holidays ==================== */

async function getHolidays(workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id AS "workspaceId", to_char(date, 'YYYY-MM-DD') AS date, name, created_by AS "createdBy", created_at AS "createdAt"
     FROM holidays WHERE workspace_id = $1 ORDER BY date ASC`,
    [workspaceId]
  );
  return rows;
}
async function addHoliday({ workspaceId, date, name, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO holidays (workspace_id, date, name, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, date) DO UPDATE SET name = $3
     RETURNING id, workspace_id AS "workspaceId", to_char(date, 'YYYY-MM-DD') AS date, name, created_by AS "createdBy", created_at AS "createdAt"`,
    [workspaceId, date, name, createdBy]
  );
  return rows[0];
}
async function deleteHoliday(id) {
  await pool.query("DELETE FROM holidays WHERE id = $1", [id]);
}
async function getHolidayById(id) {
  const { rows } = await pool.query(`SELECT id, workspace_id AS "workspaceId" FROM holidays WHERE id = $1`, [id]);
  return rows[0] || null;
}

/* ==================== activity log (one entry per person per day, multiple table blocks each) ==================== */

async function getActivityLogsForUser(userId, workspaceId, { from, to } = {}) {
  const params = [userId, workspaceId];
  let where = "user_id = $1 AND workspace_id = $2";
  if (from) { params.push(from); where += ` AND entry_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND entry_date <= $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", to_char(entry_date, 'YYYY-MM-DD') AS "entryDate",
            content, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM activity_logs WHERE ${where} ORDER BY entry_date DESC`,
    params
  );
  return rows;
}

async function getTeamActivityLogs(workspaceId, { from, to } = {}) {
  const params = [workspaceId];
  let where = "al.workspace_id = $1";
  if (from) { params.push(from); where += ` AND al.entry_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND al.entry_date <= $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT al.id, al.user_id AS "userId", u.name AS "userName", u.color AS "userColor", u.initials AS "userInitials",
            to_char(al.entry_date, 'YYYY-MM-DD') AS "entryDate", al.content, al.updated_at AS "updatedAt",
            (SELECT count(*)::int FROM activity_log_comments c WHERE c.activity_log_id = al.id) AS "commentCount"
     FROM activity_logs al JOIN users u ON u.id = al.user_id
     WHERE ${where} ORDER BY al.entry_date DESC, u.name ASC`,
    params
  );
  return rows;
}

async function upsertActivityLog({ userId, workspaceId, entryDate, content }) {
  const { rows } = await pool.query(
    `INSERT INTO activity_logs (user_id, workspace_id, entry_date, content, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (user_id, workspace_id, entry_date) DO UPDATE SET content = $4::jsonb, updated_at = now()
     RETURNING id, user_id AS "userId", workspace_id AS "workspaceId", to_char(entry_date, 'YYYY-MM-DD') AS "entryDate",
               content, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [userId, workspaceId, entryDate, JSON.stringify(content)]
  );
  return rows[0];
}

async function getActivityLogById(id) {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", to_char(entry_date, 'YYYY-MM-DD') AS "entryDate"
     FROM activity_logs WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getActivityLogByDate(userId, workspaceId, entryDate) {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", to_char(entry_date, 'YYYY-MM-DD') AS "entryDate"
     FROM activity_logs WHERE user_id = $1 AND workspace_id = $2 AND entry_date = $3`,
    [userId, workspaceId, entryDate]
  );
  return rows[0] || null;
}

const ACTIVITY_ATTACHMENT_SELECT = `
  SELECT a.id, a.activity_log_id AS "activityLogId", a.uploaded_by AS "uploadedBy", a.file_name AS "fileName",
         a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes", a.created_at AS "createdAt",
         u.name AS "uploaderName"
  FROM activity_log_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
`;

async function getAttachmentsForActivityLog(activityLogId) {
  const { rows } = await pool.query(`${ACTIVITY_ATTACHMENT_SELECT} WHERE a.activity_log_id = $1 ORDER BY a.created_at ASC`, [activityLogId]);
  return rows;
}

async function getActivityLogAttachmentById(id) {
  const { rows } = await pool.query(
    `SELECT id, activity_log_id AS "activityLogId", uploaded_by AS "uploadedBy", file_name AS "fileName",
            mime_type AS "mimeType", size_bytes AS "sizeBytes", storage_path AS "storagePath", created_at AS "createdAt"
     FROM activity_log_attachments WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function addActivityLogAttachment({ activityLogId, uploadedBy, fileName, mimeType, sizeBytes, storagePath }) {
  const { rows } = await pool.query(
    `INSERT INTO activity_log_attachments (activity_log_id, uploaded_by, file_name, mime_type, size_bytes, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [activityLogId, uploadedBy, fileName, mimeType, sizeBytes, storagePath]
  );
  const list = await getAttachmentsForActivityLog(activityLogId);
  return list.find((a) => a.id === rows[0].id);
}

async function deleteActivityLogAttachment(id) {
  const a = await getActivityLogAttachmentById(id);
  if (!a) return null;
  await pool.query("DELETE FROM activity_log_attachments WHERE id = $1", [id]);
  return a;
}

/* ==================== activity log comments ==================== */

async function getCommentsForActivityLog(activityLogId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.activity_log_id AS "activityLogId", c.author_id AS "authorId",
            u.name AS "authorName", u.color AS "authorColor", u.initials AS "authorInitials",
            c.body, c.created_at AS "createdAt"
     FROM activity_log_comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.activity_log_id = $1 ORDER BY c.created_at ASC`,
    [activityLogId]
  );
  return rows;
}

async function addActivityLogComment({ activityLogId, authorId, body }) {
  const { rows } = await pool.query(
    `INSERT INTO activity_log_comments (activity_log_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
    [activityLogId, authorId, body]
  );
  const all = await getCommentsForActivityLog(activityLogId);
  return all.find((c) => c.id === rows[0].id);
}

async function getActivityLogCommentById(id) {
  const { rows } = await pool.query(
    `SELECT id, activity_log_id AS "activityLogId", author_id AS "authorId", body FROM activity_log_comments WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function deleteActivityLogComment(id) {
  await pool.query("DELETE FROM activity_log_comments WHERE id = $1", [id]);
}

/* ==================== profile ==================== */

async function updateUserProfile(userId, { name }) {
  const { rows } = await pool.query(`UPDATE users SET name = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`, [userId, name]);
  return rows[0];
}

/* ==================== system health ==================== */

// A genuine, timed round-trip to the database — not a simulated number.
// Used by /api/health so "system performance" reflects something real:
// how long the database actually took to answer, measured right here,
// right now, not estimated or assumed.
async function pingDb() {
  const start = Date.now();
  await pool.query("SELECT 1");
  return Date.now() - start;
}

module.exports = {
  getUserById, getUserByEmail, createUser, updateUserPassword, ensurePlatformAdminFromEnv, updateUserAvatar, updateUserProfile,
  pingDb,
  createPasswordReset, getValidPasswordReset, consumePasswordReset,
  getWorkspacesForUser, getWorkspaceById, createWorkspace,
  getMembership, getWorkspaceMembers, countAdmins, addWorkspaceMember, setMemberRole, updateMemberTitle, removeMember,
  getWorkspaceWorkload,
  createInvite, getPendingInvitesForEmail, acceptInvite,
  getProjectsForWorkspace, getProjectById, createProject, getOrCreateGeneralProject, deleteProject, setProjectComplete, setProjectLead, updateProject, getRoadmapData,
  getProjectMembers, addProjectMember, removeProjectMember,
  getMilestones, getMilestoneById, createMilestone, updateMilestone, deleteMilestoneById, reorderMilestone,
  addMilestoneLink, deleteMilestoneLink,
  getAttachmentsForMilestone, getMilestoneAttachmentById, addMilestoneAttachment, deleteMilestoneAttachment,
  getTasks, getAllTasksForWorkspace, getTaskById, createTask, updateTask, replaceSubtasks, deleteTask, getSubtaskById,
  getAttachmentsForTask, getAttachmentById, addAttachment, deleteAttachment,
  getAttachmentsForSubtask, getSubtaskAttachmentById, addSubtaskAttachment, deleteSubtaskAttachment,
  getLinksForSubtask, addSubtaskLink, getSubtaskLinkById, deleteSubtaskLink,
  getCommentsForTask, addComment,
  getLinksForTask, addLink, getLinkById, deleteLink,
  getLinksForProject, addProjectLink, getProjectLinkById, deleteProjectLink,
  getDocumentsForProject, getDocumentById, addDocument, deleteDocument,
  getHolidays, addHoliday, deleteHoliday, getHolidayById,
  getActivityLogsForUser, getTeamActivityLogs, upsertActivityLog, getActivityLogById, getActivityLogByDate,
  getCommentsForActivityLog, addActivityLogComment, getActivityLogCommentById, deleteActivityLogComment,
  getAttachmentsForActivityLog, getActivityLogAttachmentById, addActivityLogAttachment, deleteActivityLogAttachment,
  getTasksDueInTwoDays, markDueReminderSent,
  getNotificationsForUser, createNotification, markNotificationRead, markAllRead,
};