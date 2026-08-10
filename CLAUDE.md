# PMDAMC — Project Context for Claude Code

Read this fully before making changes. It captures decisions and conventions
that aren't obvious from the code alone.

## What this is

A full-stack project management tool built for DAMC (Department of
Agriculture Marketing and Cooperatives), Bhutan. Multi-workspace,
multi-project task management with realtime updates.

## Tech stack

- **Backend**: Node.js + Express + Socket.IO + Postgres (`pg` pool, raw SQL,
  no ORM), multer for file uploads to local disk
- **Frontend**: React (Vite) + socket.io-client + recharts + lucide-react,
  single `App.jsx` file (~3800 lines) — most components live in this one
  file by established convention, don't split it apart without being asked
- **Database**: Supabase-hosted Postgres in production, plain Postgres
  locally
- **Deploy**: Backend on Render (Web Service), frontend on Render (Static
  Site) or Vercel — both have been used across different sessions

## Critical: schema.sql is append-only and idempotent

`backend/db/schema.sql` is the single migration file — there is no
migrations folder with numbered files. Every change goes at the END of this
file, using `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT
EXISTS`, etc. It must be safe to run against a database at ANY previous
version, including fresh. `npm run migrate` runs it in an explicit
transaction (BEGIN/COMMIT/ROLLBACK on one client) — this was a deliberate
fix after discovering the simple-query-protocol approach wasn't reliably
atomic. Don't revert that.

**A real, previously-hit bug worth knowing about**: any `information_schema`
query MUST filter `table_schema = 'public'` explicitly. Supabase's built-in
`auth.users` table also has columns like `role`, and an unfiltered query can
silently match the wrong table across schemas.

## Permission model (this has changed multiple times — current state matters)

Three workspace-level roles: `admin`, `lead`, `member`. Plus **per-project
leads** (`projects.lead_id`) — a project can have its own lead distinct from
the workspace-wide lead, with manager-level rights scoped to just that
project. The `isManager(req)` helper in `tasks.routes.js` checks: workspace
admin/lead, OR `req.project.leadId === req.user.id`.

**Current rules for a plain member** (not admin, not workspace lead, not
that project's lead):
- Can view every task in a project (not just their own)
- Can create a new task (title, description, subtasks, priority, assignee,
  due date, AND stage files/links to upload immediately after creation)
- Can comment on any task
- CANNOT edit an existing task in any way — not even their own — once it's
  saved (no status change, no reassignment, no checklist toggle)
- CAN add/remove files and links on a task **they personally created**
  (`task.createdBy === req.user.id`) — this is deliberately narrower than
  "assignee," it's tied to who made it, permanently
- CANNOT do any of the above on a task someone else created

Bulk-add (`POST /tasks/bulk`) stays admin/lead/project-lead only — it was
never reopened to members even when single-task creation was.

If asked to change member permissions again, check `tasks.routes.js`
`isManager` and `canTouchTask` first — this is where every boundary lives.
Don't assume; the rules have flip-flopped across sessions based on evolving
client requirements, so verify current state by reading the code, not by
assuming from a past description.

## The "stage now, upload after save" pattern

Files can't go in a JSON body. Established pattern, used in three places
(subtask creation, milestone creation, task creation): the creation form
lets the user stage files/links locally in React state (`pendingFiles`,
`pendingLinks`), the resource is created first via JSON (getting a real
id), then staged links/files upload via real follow-up API calls, matched
back by array position (order is preserved by the backend in both create
and update paths). See `PendingFilesLinks` component and `saveDraft` in
`App.jsx` for the canonical implementation — replicate this pattern, don't
invent a new one.

## Testing convention

Every change in this project has historically been verified against a real
Postgres instance and, for frontend changes, a real Playwright browser
session — not just code review. If Postgres/Playwright aren't already set
up in the environment: `apt-get install postgresql postgresql-contrib`,
`service postgresql start`, `su postgres -c "psql -c \"ALTER USER postgres
PASSWORD 'postgres';\""`. Local DB conventions: `PGSSL=false`,
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<dbname>`.

Background processes (backend/frontend dev servers) do NOT survive between
separate tool calls in some sandboxed environments — start them and run
tests in the same command/session, don't assume a `node src/index.js &`
from one step is still running in the next.

## Demo/seed accounts (backend/src/seed.js)

All seeded into workspace "Product Studio":
- `daniel@flowhub.dev` — Admin, password `admin123` (deliberately different
  from everyone else)
- `priya@flowhub.dev` — Lead, password `password123`
- `leo@flowhub.dev`, `sena@flowhub.dev`, `astrid@flowhub.dev`,
  `ravi@flowhub.dev` — Members, password `password123`

`npm run seed` is idempotent — checks if `daniel@flowhub.dev` already
exists and skips entirely if so, rather than duplicating.

## lucide-react icon imports — watch for JS built-in collisions

Several icon names in `lucide-react` collide with JavaScript built-ins:
`Image`, `Table`, and `Map` are icons AND native JS constructors. This
codebase already aliases the first two (`Image as ImageIcon`, `Table as
TableIcon`) — follow that same pattern for any new icon import before using
it, don't just `import { Map }` directly. A real instance of this shipped
broken and crashed the entire app on load (`Map is not a constructor`,
because it shadowed `new Map()` used elsewhere for actual caching) — caught
only by an actual browser test, not by the build or a syntax check, since
`Map is not a constructor` is a runtime error that only surfaces when that
code path actually executes.

## Branding

App is branded as PMDAMC using DAMC's real logo (a three-circle mark with
green leaf accents — the actual file is `frontend/public/logo.png`, sourced
from the department's real logo, background removed). The color palette
(`frontend/src/styles.css`) was deliberately rebuilt around the logo's
green (`#2FA34F` dark theme / `#1F7D3B` light theme) — priority/status
colors (red/amber/blue/teal) were kept deliberately distinct from the brand
accent for readability, don't collapse them into the same green.

## Deploy checklist reminder

`CORS_ORIGIN` and `APP_URL` on the backend must exactly match the real
frontend URL (no trailing slash, correct protocol) — this has been the
single most common deploy issue across every session. If someone reports a
CORS error after deploying, check these two env vars first before anything
else.

## README.md

Has a running "What's new in this round" changelog at the top of each
major change, moved to "Previously shipped" over time. Keep adding to it in
the same style when you ship something — it's the project's own memory
across sessions, in addition to this file.
