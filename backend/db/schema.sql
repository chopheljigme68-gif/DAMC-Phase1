-- Team Flow Hub schema v2 — multi-workspace
-- Safe to run against a fresh database OR the v1 schema (idempotent, backfills
-- existing users/tasks into a "Default Workspace" instead of losing them).
-- Run via `npm run migrate` (see src/migrate.js).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ---------------- users (auth + profile only — no team-specific fields) ---------------- */

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6E9BFF',
  initials TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;

/* ---------------- workspaces ---------------- */

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Team member',
  is_lead BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

-- Only relevant on a genuinely fresh table (is_lead still exists) — on a
-- database that's already been upgraded past v3, this column is gone and
-- the role-based index further down supersedes it. Guarded so `npm run
-- migrate` stays safe to run repeatedly, at any point in a deployment's history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_members' AND column_name = 'is_lead'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS one_lead_per_workspace ON workspace_members (workspace_id) WHERE is_lead = true';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);

/* role: 'admin' (workspace owner) | 'lead' (assigned by admin) | 'member' (default).
   Superseded is_lead below once backfilled — see the v3 migration block. */
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('admin', 'lead', 'member'));

/* ---------------- projects ---------------- */

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(lower(email));

/* ---------------- tasks ---------------- */

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  assignee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  due DATE,
  due_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TIME;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);

/* ---------------- subtasks ---------------- */

CREATE TABLE IF NOT EXISTS subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

/* ---------------- notifications ---------------- */

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  task_title TEXT,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

/* ---------------- password resets ---------------- */

CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);

/* ---------------- task attachments (photos & files) ---------------- */

CREATE TABLE IF NOT EXISTS task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

/* ---------------- task comments (flat, chronological — not threaded) ---------------- */

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at);

/* ---------------- task links (external URLs, alongside files) ---------------- */

CREATE TABLE IF NOT EXISTS task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);

/* ---------------- project-level reference documents (not tied to one task) ---------------- */

CREATE TABLE IF NOT EXISTS project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id);

/* ---------------- backfill: v1 -> v2 (safe no-op on a fresh database) ---------------- */

DO $$
DECLARE
  has_legacy_role BOOLEAN;
  has_wm_is_lead BOOLEAN;
  has_users_is_lead BOOLEAN;
  default_ws_id UUID;
  first_user_id UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
  ) INTO has_legacy_role;

  IF has_legacy_role THEN
    RAISE NOTICE 'Legacy v1 schema detected — migrating existing data into a Default Workspace.';

    SELECT id INTO first_user_id FROM users ORDER BY created_at ASC LIMIT 1;

    IF first_user_id IS NOT NULL THEN
      INSERT INTO workspaces (name, slug, created_by)
      VALUES ('Default Workspace', 'default-workspace-' || substr(gen_random_uuid()::text, 1, 8), first_user_id)
      RETURNING id INTO default_ws_id;

      -- Only reference is_lead on either side if it's actually still there —
      -- a DB that's been migrated before (even partially) may already have
      -- dropped one side of this without the other.
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workspace_members' AND column_name = 'is_lead') INTO has_wm_is_lead;
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_lead') INTO has_users_is_lead;

      -- Dynamic SQL here on purpose: these statements reference users.role /
      -- users.is_lead, columns that don't exist in every deployment's
      -- history, AND workspace_members has its own same-named role column.
      -- A plain embedded statement can get validated against the live
      -- catalog even inside a branch that never executes, and an unqualified
      -- "role" can resolve against the wrong table in that validation. Using
      -- EXECUTE defers parsing to actual runtime, and every column below is
      -- explicitly qualified so there's no ambiguity left to resolve.
      IF has_wm_is_lead AND has_users_is_lead THEN
        EXECUTE format(
          'INSERT INTO workspace_members (workspace_id, user_id, title, is_lead)
           SELECT %L::uuid, u.id, COALESCE(u.role, ''Team member''), COALESCE(u.is_lead, false)
           FROM users u
           ON CONFLICT (workspace_id, user_id) DO NOTHING',
          default_ws_id
        );
      ELSE
        EXECUTE format(
          'INSERT INTO workspace_members (workspace_id, user_id, title)
           SELECT %L::uuid, u.id, COALESCE(u.role, ''Team member'')
           FROM users u
           ON CONFLICT (workspace_id, user_id) DO NOTHING',
          default_ws_id
        );
      END IF;

      UPDATE tasks SET workspace_id = default_ws_id WHERE workspace_id IS NULL;

      UPDATE notifications n SET workspace_id = t.workspace_id
      FROM tasks t WHERE n.task_id = t.id AND n.workspace_id IS NULL;
    END IF;

    ALTER TABLE users DROP COLUMN IF EXISTS role;
    ALTER TABLE users DROP COLUMN IF EXISTS is_lead;
  END IF;
END $$;

-- Once every task has a workspace, enforce it going forward.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tasks WHERE workspace_id IS NULL) THEN
    ALTER TABLE tasks ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
END $$;

/* ---------------- backfill: v2 -> v3 (roles + projects) ---------------- */

DO $$
DECLARE
  has_is_lead BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_members' AND column_name = 'is_lead'
  ) INTO has_is_lead;

  IF has_is_lead THEN
    RAISE NOTICE 'Deriving admin/lead/member roles from legacy is_lead + workspace ownership.';

    -- The workspace creator becomes admin.
    UPDATE workspace_members wm
    SET role = 'admin'
    FROM workspaces w
    WHERE w.id = wm.workspace_id AND w.created_by = wm.user_id;

    -- Whoever was flagged is_lead (and isn't already admin) becomes lead.
    UPDATE workspace_members
    SET role = 'lead'
    WHERE is_lead = true AND role <> 'admin';

    -- Workspaces with no admin row yet (creator no longer a member, edge case)
    -- promote the earliest-joined member instead so every workspace has an owner.
    UPDATE workspace_members wm
    SET role = 'admin'
    WHERE wm.id = (
      SELECT id FROM workspace_members wm2
      WHERE wm2.workspace_id = wm.workspace_id
      ORDER BY joined_at ASC LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM workspace_members wm3
      WHERE wm3.workspace_id = wm.workspace_id AND wm3.role = 'admin'
    );

    ALTER TABLE workspace_members DROP COLUMN IF EXISTS is_lead;
    DROP INDEX IF EXISTS one_lead_per_workspace;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS one_lead_per_workspace
  ON workspace_members (workspace_id) WHERE role = 'lead';

-- Every workspace needs at least one admin — belt-and-suspenders for fresh
-- workspaces created before this migration ran (createWorkspace already
-- sets role='admin' for new ones, this only matters for edge cases).
UPDATE workspace_members wm
SET role = 'admin'
WHERE NOT EXISTS (SELECT 1 FROM workspace_members wm2 WHERE wm2.workspace_id = wm.workspace_id AND wm2.role = 'admin')
  AND wm.id = (SELECT id FROM workspace_members wm3 WHERE wm3.workspace_id = wm.workspace_id ORDER BY joined_at ASC LIMIT 1);

-- Bucket any pre-existing tasks (created before "projects" existed) into a
-- single "General" project per workspace so nothing is orphaned.
DO $$
DECLARE
  ws RECORD;
  new_project_id UUID;
  owner_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM tasks WHERE project_id IS NULL) THEN
    FOR ws IN SELECT DISTINCT workspace_id FROM tasks WHERE project_id IS NULL LOOP
      SELECT user_id INTO owner_id FROM workspace_members WHERE workspace_id = ws.workspace_id AND role = 'admin' LIMIT 1;

      INSERT INTO projects (workspace_id, name, description, created_by)
      VALUES (ws.workspace_id, 'General', 'Everything that existed before projects were introduced.', owner_id)
      RETURNING id INTO new_project_id;

      UPDATE tasks SET project_id = new_project_id
      WHERE workspace_id = ws.workspace_id AND project_id IS NULL;
    END LOOP;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tasks WHERE project_id IS NULL) THEN
    ALTER TABLE tasks ALTER COLUMN project_id SET NOT NULL;
  END IF;
END $$;

/* ---------------- backfill: v3 -> v4 (platform admin) ---------------- */

-- Grandfather in anyone who has ever created a workspace as a platform admin,
-- so gating workspace creation to platform admins doesn't lock existing
-- deployments out of ever creating another one. Only runs once — if a
-- platform admin already exists (e.g. set via PLATFORM_ADMIN_EMAILS), this
-- is skipped entirely so it never overrides a deliberate setup.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE is_platform_admin = true) THEN
    UPDATE users SET is_platform_admin = true
    WHERE id IN (SELECT DISTINCT created_by FROM workspaces WHERE created_by IS NOT NULL);
  END IF;
END $$;

/* ---------------- backfill: v4 -> v5 (collapse board to Tasks / Completed) ---------------- */

-- Old boards had 4 stages (backlog/progress/review/done). Simplified down to
-- just 2: 'todo' and 'done'. Constraint must be dropped BEFORE remapping
-- data, since the old constraint doesn't allow 'todo' as a value yet.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
UPDATE tasks SET status = 'todo' WHERE status IN ('backlog', 'progress', 'review');
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'todo';
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'done'));

/* ---------------- v6: due-soon reminders, post at signup, project deadline/completion, milestones ---------------- */

-- Tracks whether the "2 days left" reminder has already been sent for a
-- task, so the reminder sweep doesn't re-notify every time it runs. Reset
-- whenever the due date changes (handled in application code).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_reminder_sent BOOLEAN NOT NULL DEFAULT false;

-- Captured at registration ("Product Designer" etc.) and used as the
-- starting post/designation when this person is added to a workspace,
-- instead of a generic "Team member" default. Still editable per-workspace
-- afterwards via the Team page.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_title TEXT;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- v7 update: client now wants MULTIPLE milestones per project, shown in
-- sequence — this replaces the original "exactly one" design. The UNIQUE
-- constraint below only fires on a genuinely fresh install; existing
-- databases have theirs dropped further down in the v7 backfill section.
CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_date DATE,
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id, position);

/* ---------------- v7: multiple milestones, holidays, project links, richer subtasks, activity log ---------------- */

-- Drop the old "exactly one milestone" constraint if this database was
-- created before multiple-milestones was requested. Safe no-op otherwise.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'project_milestones'
      AND constraint_type = 'UNIQUE' AND constraint_name = 'project_milestones_project_id_key'
  ) THEN
    ALTER TABLE project_milestones DROP CONSTRAINT project_milestones_project_id_key;
  END IF;
END $$;

-- Links attached to a milestone, shown in sequence alongside it.
CREATE TABLE IF NOT EXISTS milestone_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_milestone_links_milestone ON milestone_links(milestone_id, position);

-- Workspace-wide holidays, shown on the calendar.
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, date)
);
CREATE INDEX IF NOT EXISTS idx_holidays_workspace ON holidays(workspace_id, date);

-- Project-level reference links (alongside the existing project documents).
CREATE TABLE IF NOT EXISTS project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_links_project ON project_links(project_id);

-- Subtasks become richer: an optional time range, a description, and their
-- own files/links — effectively small tasks-within-a-task.
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS subtask_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtask_id UUID NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subtask_attachments_subtask ON subtask_attachments(subtask_id);

CREATE TABLE IF NOT EXISTS subtask_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtask_id UUID NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subtask_links_subtask ON subtask_links(subtask_id);

-- Personal activity log. `content` is a JSON array of blocks — either
-- {type: "text", text: "..."} or {type: "table", rows: [["a","b"], ...]} —
-- so a single entry can contain any number of tables, added one at a time.
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  content JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_workspace ON activity_logs(workspace_id, entry_date DESC);

/* ---------------- v8: milestone files, project team membership ---------------- */

-- Files attached to a milestone, alongside its links. Same pattern as
-- task_attachments/project_documents.
CREATE TABLE IF NOT EXISTS milestone_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_milestone_attachments_milestone ON milestone_attachments(milestone_id);

-- Explicit "who's on this project" membership — separate from task
-- assignment (you can still assign a task to anyone in the workspace;
-- this is just the organizational team list shown on the project).
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);

/* ---------------- per-project lead — separate from the workspace-wide lead ---------------- */
-- A project can have its own lead (any workspace member, chosen by the
-- workspace admin), distinct from the one workspace-wide Lead role. That
-- person gets manager-level rights (edit any task, manage milestones, mark
-- the project complete) scoped to just this project.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES users(id) ON DELETE SET NULL;

/* ---------------- optional project start date, for the roadmap view ---------------- */
-- Nullable on purpose: existing projects have no reliable "planned start"
-- separate from when the row was created, and backfilling one would just be
-- a guess. The roadmap falls back to created_at when this is absent — new
-- projects can set a real one going forward for a more accurate timeline.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;
-- Manual sort order for drag-to-reorder in the sidebar. Nullable: existing
-- rows stay null and fall back to name ordering until first reordered.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS position INTEGER;

/* ---------------- activity log attachments — files attached to a day's entry ---------------- */
-- Time and links live inline in each text block's own JSON (content is
-- already flexible JSONB, no migration needed for those) — but real files
-- need actual storage, so they get their own table, same pattern as every
-- other attachment table in this schema.
CREATE TABLE IF NOT EXISTS activity_log_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_log_id UUID NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_attachments_log ON activity_log_attachments(activity_log_id);

/* Comments on a day's activity-log entry — so a supervisor or teammate can
   respond to what someone logged, shown right under that person's entry in
   the Team Log rather than buried out of sight. */
CREATE TABLE IF NOT EXISTS activity_log_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_log_id UUID NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_comments_log ON activity_log_comments(activity_log_id, created_at ASC);
/* ---------------- recurring activities ---------------- */
-- A task can define a repeat rule; the rule lives on the FIRST task of the
-- series ("the series head") and every later occurrence is a real, ordinary
-- task row pointing back at it via recurrence_parent_id. Deliberately not a
-- virtual/computed occurrence: occurrences must be individually
-- completable, assignable, commentable and attachable, exactly like any
-- other task, and every existing query (board, dashboard, calendar,
-- reminders) then works on them with no change at all.
--
-- recurrence shape (validated in backend/src/utils/recurrence.js):
--   { freq: 'daily' | 'weekly' | 'monthly',
--     interval: <int >= 1>,
--     byWeekday: [0..6]        -- weekly only, 0 = Sunday
--     until: 'YYYY-MM-DD' | null }
-- "Every weekday" is just weekly with byWeekday [1,2,3,4,5] — one less
-- concept in the data model, same result.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
-- Makes occurrence generation idempotent at the database level: the sweep
-- can run as often as it likes and re-inserting a date that already exists
-- is a no-op rather than a duplicate. This is the safety net — the
-- generator also checks first, but two overlapping sweeps must not be able
-- to race a double insert through.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_recurrence_occurrence
  ON tasks(recurrence_parent_id, due)
  WHERE recurrence_parent_id IS NOT NULL;

/* ---------------- recurring activities: exception dates ---------------- */
-- Dates the generator must NOT recreate. Without this, deleting a single
-- occurrence was pointless: the next hourly sweep saw a "missing" date in
-- the series and helpfully put it back, so the activity appeared to repeat
-- forever and could not be removed. Deleting an occurrence now records its
-- date here, on the series head, and generation skips it.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_exdates DATE[] NOT NULL DEFAULT '{}';

/* ---------------- activities that run from one time to another ---------------- */
-- `due_time` has always been the START time. Meetings and site visits have an
-- end too, and people were writing "2–4 PM" into the title to express it.
-- Nullable on purpose: plenty of activities are a single moment (or all-day)
-- and forcing an end time on those would be noise. Subtasks already had
-- start_time/end_time — this brings tasks in line with them.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_time TIME;

/* ---------------- meeting / discussion notes on a task ---------------- */
-- Separate from `description`: description is what the activity IS, these
-- are the minutes of what was SAID when it happened. Keeping them apart
-- means the brief stays readable after a long meeting is written up, and
-- the notes can be surfaced on their own.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meeting_notes TEXT NOT NULL DEFAULT '';