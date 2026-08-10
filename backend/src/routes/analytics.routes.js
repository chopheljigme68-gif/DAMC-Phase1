const express = require("express");
const { pool } = require("../pool");
const { authenticate } = require("../auth");
const { requireWorkspaceMember, requireProjectInWorkspace, requireProjectManager } = require("../middleware/workspace");

const router = express.Router({ mergeParams: true });
router.use(authenticate, requireWorkspaceMember, requireProjectInWorkspace, requireProjectManager);

router.get("/", async (req, res, next) => {
  try {
    const pid = req.params.projectId;
    const [totals, completedByDay, velocityByMember, workload, overdue] = await Promise.all([
      pool.query(
        `SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'todo')::int AS active,
          count(*) FILTER (WHERE status = 'done')::int AS shipped,
          count(*) FILTER (WHERE status != 'done' AND due < current_date)::int AS overdue,
          count(*) FILTER (WHERE completed_at >= now() - interval '7 days')::int AS "shippedThisWeek",
          COALESCE(round(avg(EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400.0) FILTER (WHERE completed_at IS NOT NULL)::numeric, 1), 0) AS "avgCycleTimeDays"
        FROM tasks WHERE project_id = $1`,
        [pid]
      ),
      pool.query(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS date, to_char(d::date, 'Mon DD') AS label, COALESCE(c.count, 0)::int AS count
         FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') d
         LEFT JOIN (
           SELECT completed_at::date AS day, count(*) AS count FROM tasks
           WHERE completed_at IS NOT NULL AND project_id = $1 GROUP BY 1
         ) c ON c.day = d::date
         ORDER BY d`,
        [pid]
      ),
      pool.query(
        `SELECT u.id, split_part(u.name, ' ', 1) AS name, u.color,
                count(t.id) FILTER (WHERE t.completed_at >= now() - interval '7 days')::int AS completed
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         LEFT JOIN tasks t ON t.assignee_id = u.id AND t.project_id = $2
         WHERE wm.workspace_id = $1
         GROUP BY u.id, u.name, u.color ORDER BY u.name`,
        [req.params.workspaceId, pid]
      ),
      pool.query(
        `WITH counts AS (
           SELECT u.id, u.name, u.color,
                  count(t.id) FILTER (WHERE t.status != 'done')::int AS active,
                  count(t.id) FILTER (WHERE t.status = 'done')::int AS shipped
           FROM workspace_members wm
           JOIN users u ON u.id = wm.user_id
           LEFT JOIN tasks t ON t.assignee_id = u.id AND t.project_id = $2
           WHERE wm.workspace_id = $1
           GROUP BY u.id, u.name, u.color
         ), avg_active AS (SELECT avg(active) AS a FROM counts)
         SELECT counts.*, (counts.active > (SELECT a FROM avg_active) * 1.4 AND (SELECT a FROM avg_active) > 0) AS overloaded
         FROM counts ORDER BY name`,
        [req.params.workspaceId, pid]
      ),
      pool.query(
        `SELECT id, title, assignee_id AS "assigneeId", to_char(due, 'YYYY-MM-DD') AS due, priority
         FROM tasks WHERE project_id = $1 AND status != 'done' AND due < current_date
         ORDER BY due ASC`,
        [pid]
      ),
    ]);

    res.json({
      totals: totals.rows[0],
      completedByDay: completedByDay.rows,
      velocityByMember: velocityByMember.rows,
      workload: workload.rows,
      overdue: overdue.rows,
    });
  } catch (err) { next(err); }
});

module.exports = router;
