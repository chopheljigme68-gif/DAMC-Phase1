const { pool } = require("../pool");

/**
 * Everything one report needs, gathered in a fixed number of queries.
 *
 * Deliberately NOT built on the normal getters: those are shaped for the UI
 * (counts instead of contents, only the LAST comment, no file list). A report
 * that quietly drops a comment or a file is worse than no report, so each
 * entity is fetched whole here, then stitched together in JS.
 *
 * Scope:
 *   userId    — one member, or undefined for the whole team
 *   projectId — one project, or undefined for every project in the workspace
 *   from/to   — 'YYYY-MM-DD' bounds applied to a task's DUE date and to an
 *               activity log's entry date. Left open if not given.
 */
async function gatherReportData({ workspaceId, userId = null, projectId = null, from = null, to = null }) {
  const { rows: wsRows } = await pool.query(
    "SELECT id, name FROM workspaces WHERE id = $1",
    [workspaceId]
  );
  const workspace = wsRows[0];
  if (!workspace) return null;

  const { rows: members } = await pool.query(
    `SELECT u.id, u.name, u.email, m.title, m.role
     FROM workspace_members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1 ${userId ? "AND u.id = $2" : ""}
     ORDER BY u.name ASC`,
    userId ? [workspaceId, userId] : [workspaceId]
  );

  const { rows: projects } = await pool.query(
    `SELECT p.id, p.name, p.description, to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
            to_char(p.start_date, 'YYYY-MM-DD') AS "startDate", p.completed_at AS "completedAt",
            l.name AS "leadName"
     FROM projects p LEFT JOIN users l ON l.id = p.lead_id
     WHERE p.workspace_id = $1 ${projectId ? "AND p.id = $2" : ""}
     ORDER BY p.position ASC NULLS LAST, p.created_at ASC`,
    projectId ? [workspaceId, projectId] : [workspaceId]
  );

  // ---- tasks ----
  const taskParams = [workspaceId];
  let taskWhere = "t.workspace_id = $1";
  if (userId) { taskParams.push(userId); taskWhere += ` AND t.assignee_id = $${taskParams.length}`; }
  if (projectId) { taskParams.push(projectId); taskWhere += ` AND t.project_id = $${taskParams.length}`; }
  // An undated task has no due date to fall inside the window; it is kept
  // rather than silently dropped, because "what has this person worked on"
  // includes work nobody put a date against.
  if (from) { taskParams.push(from); taskWhere += ` AND (t.due IS NULL OR t.due >= $${taskParams.length})`; }
  if (to) { taskParams.push(to); taskWhere += ` AND (t.due IS NULL OR t.due <= $${taskParams.length})`; }

  const { rows: tasks } = await pool.query(
    `SELECT t.id, t.title, t.description, t.meeting_notes AS "meetingNotes", t.status, t.priority,
            t.project_id AS "projectId", t.assignee_id AS "assigneeId",
            a.name AS "assigneeName", c.name AS "createdByName",
            to_char(t.due, 'YYYY-MM-DD') AS due,
            to_char(t.due_time, 'HH24:MI') AS "dueTime",
            to_char(t.end_time, 'HH24:MI') AS "endTime",
            t.created_at AS "createdAt", t.completed_at AS "completedAt",
            (t.recurrence IS NOT NULL OR t.recurrence_parent_id IS NOT NULL) AS recurring
     FROM tasks t
     LEFT JOIN users a ON a.id = t.assignee_id
     LEFT JOIN users c ON c.id = t.created_by
     WHERE ${taskWhere}
     ORDER BY t.due ASC NULLS LAST, t.created_at ASC`,
    taskParams
  );

  const taskIds = tasks.map((t) => t.id);
  // A report over an empty scope must still produce a document, so every
  // child query is skipped rather than run with an empty ANY() array.
  const childOf = async (sql) => (taskIds.length ? (await pool.query(sql, [taskIds])).rows : []);

  const [subtasks, comments, files, links] = await Promise.all([
    childOf(`SELECT s.task_id AS "taskId", s.text, s.done, s.description,
                    to_char(s.start_time, 'HH24:MI') AS "startTime", to_char(s.end_time, 'HH24:MI') AS "endTime"
             FROM subtasks s WHERE s.task_id = ANY($1) ORDER BY s.position ASC`),
    childOf(`SELECT tc.task_id AS "taskId", tc.body, tc.created_at AS "createdAt", u.name AS "authorName"
             FROM task_comments tc LEFT JOIN users u ON u.id = tc.user_id
             WHERE tc.task_id = ANY($1) ORDER BY tc.created_at ASC`),
    childOf(`SELECT f.task_id AS "taskId", f.file_name AS "fileName", f.size_bytes AS "sizeBytes",
                    f.created_at AS "createdAt", u.name AS "uploaderName"
             FROM task_attachments f LEFT JOIN users u ON u.id = f.uploaded_by
             WHERE f.task_id = ANY($1) ORDER BY f.created_at ASC`),
    childOf(`SELECT l.task_id AS "taskId", l.label, l.url, u.name AS "adderName"
             FROM task_links l LEFT JOIN users u ON u.id = l.added_by
             WHERE l.task_id = ANY($1) ORDER BY l.created_at ASC`),
  ]);

  const bucket = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.taskId)) map.set(row.taskId, []);
      map.get(row.taskId).push(row);
    }
    return map;
  };
  const subMap = bucket(subtasks);
  const comMap = bucket(comments);
  const fileMap = bucket(files);
  const linkMap = bucket(links);

  const fullTasks = tasks.map((t) => ({
    ...t,
    subtasks: subMap.get(t.id) || [],
    comments: comMap.get(t.id) || [],
    files: fileMap.get(t.id) || [],
    links: linkMap.get(t.id) || [],
  }));

  // ---- logged activities (the day-book entries, separate from tasks) ----
  const logParams = [workspaceId];
  let logWhere = "al.workspace_id = $1";
  if (userId) { logParams.push(userId); logWhere += ` AND al.user_id = $${logParams.length}`; }
  if (from) { logParams.push(from); logWhere += ` AND al.entry_date >= $${logParams.length}`; }
  if (to) { logParams.push(to); logWhere += ` AND al.entry_date <= $${logParams.length}`; }

  const { rows: activityLogs } = await pool.query(
    `SELECT al.id, al.user_id AS "userId", u.name AS "userName",
            to_char(al.entry_date, 'YYYY-MM-DD') AS "entryDate", al.content
     FROM activity_logs al JOIN users u ON u.id = al.user_id
     WHERE ${logWhere}
     ORDER BY al.entry_date ASC, u.name ASC`,
    logParams
  );

  const logIds = activityLogs.map((l) => l.id);
  const { rows: logComments } = logIds.length
    ? await pool.query(
        `SELECT c.activity_log_id AS "logId", c.body, c.created_at AS "createdAt", u.name AS "authorName"
         FROM activity_log_comments c LEFT JOIN users u ON u.id = c.author_id
         WHERE c.activity_log_id = ANY($1) ORDER BY c.created_at ASC`,
        [logIds]
      )
    : { rows: [] };
  const logComMap = new Map();
  for (const c of logComments) {
    if (!logComMap.has(c.logId)) logComMap.set(c.logId, []);
    logComMap.get(c.logId).push(c);
  }

  // ---- project reference material ----
  const projectIds = projects.map((p) => p.id);
  const { rows: documents } = projectIds.length
    ? await pool.query(
        `SELECT d.project_id AS "projectId", d.file_name AS "fileName", d.size_bytes AS "sizeBytes",
                d.created_at AS "createdAt", u.name AS "uploaderName"
         FROM project_documents d LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE d.project_id = ANY($1) ORDER BY d.created_at ASC`,
        [projectIds]
      )
    : { rows: [] };
  const { rows: projectLinks } = projectIds.length
    ? await pool.query(
        `SELECT l.project_id AS "projectId", l.label, l.url, u.name AS "adderName"
         FROM project_links l LEFT JOIN users u ON u.id = l.created_by
         WHERE l.project_id = ANY($1) ORDER BY l.created_at ASC`,
        [projectIds]
      )
    : { rows: [] };

  return {
    workspace,
    members,
    projects,
    tasks: fullTasks,
    activityLogs: activityLogs.map((l) => ({ ...l, comments: logComMap.get(l.id) || [] })),
    documents,
    projectLinks,
    scope: { userId, projectId, from, to },
  };
}

module.exports = { gatherReportData };