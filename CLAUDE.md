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

## Recurring activities — occurrences are real rows, not virtual

`tasks.recurrence` (JSONB) holds the repeat rule and lives ONLY on the first
task of a series ("the head", `recurrence_parent_id IS NULL`). Every later
occurrence is an ordinary task row pointing back at the head via
`recurrence_parent_id`. This was chosen deliberately over computing
occurrences on read: they have to be individually completable, assignable,
commentable and attachable, and this way the board, calendar, dashboard and
the due-soon reminder sweep all handle them with zero changes.

- Rule shape and expansion: `backend/src/utils/recurrence.js`. All date
  maths is on `'YYYY-MM-DD'` strings via **UTC noon** Date objects — these
  are calendar dates, not instants, and noon is what stops a server
  timezone from shifting a date by a day. Monthly anchors on the ORIGINAL
  day-of-month, so a series starting on the 31st doesn't degrade to the
  28th permanently after one February.
- Generation: `backend/src/utils/recurrenceRunner.js`, 60-day horizon, run
  inline after a save AND on an hourly sweep (same pattern as
  `reminders.js`). It is idempotent, backed by the partial unique index
  `uq_tasks_recurrence_occurrence (recurrence_parent_id, due)` — two
  overlapping sweeps cannot race a duplicate through.
- Editing a rule deletes only **untouched** future occurrences
  (`deleteUntouchedFutureOccurrences`: still `todo`, no comments, no
  attachments, no ticked subtasks) and regenerates. Never widen that filter
  to "all future occurrences" — it would silently destroy work someone has
  already done.
- Deleting a series head calls `promoteNextSeriesHead` FIRST, because
  `recurrence_parent_id` cascades — without the promotion, deleting the
  first activity would take the whole series with it.
- **Exception dates are what make deletion stick.** `tasks.recurrence_exdates`
  (DATE[], on the head) lists dates the generator must never recreate.
  Deleting an occurrence records its date there. Without this the sweep saw
  a "missing" date in the series and refilled it, so a deleted activity came
  straight back and the whole series looked impossible to remove — a real
  bug reported from production. Never generate without filtering `exDates`,
  and carry the array across in `promoteNextSeriesHead`.
- `PATCH` with a `recurrence` OBJECT on a non-head task is rejected (400):
  a schedule needs the series' own start date as its anchor. But
  `recurrence: null` from an occurrence IS accepted and stops the series via
  its head — "Stop repeating" has to work from whichever occurrence the user
  happens to be looking at, because they don't know which one is first.

## Dates are always dd/mm/yyyy — never use a bare `<input type="date">`

A native date input renders in the BROWSER's locale, so the same field shows
`09/15/2026` to one person and `15/09/2026` to another and the markup can't
control it. This office reads day-first, and the US order was a real source
of misreading. Every date input in the app therefore uses the `DateField`
component in `App.jsx`: a text input we format ourselves (always
dd/mm/yyyy, tolerant of `5/9/26` and `5-9-2026` on input, rejects
impossible dates like 31/02), plus a calendar button that opens the native
picker via `showPicker()` with a `.click()` fallback. The native input is
still in the DOM but is 1px and transparent — it drives the picker and
never renders the value.

If you add a date field, use `DateField`. A raw `type="date"` will silently
be US-formatted for some users. The only legitimate `type="date"` in the
codebase is the hidden one inside `DateField` itself.

## Tasks have a time RANGE

`due_time` is the START time and `end_time` is the optional end — added
after people took to writing "2–4 PM" into activity titles. Render both
through `formatTimeRange(start, end)` so every surface shows a range
identically. An end time with no start, or one that isn't strictly after
the start, is rejected server-side in `tasks.routes.js` (`validateTimeRange`),
and the PATCH path validates the range as it will BE after the patch —
changing only the start can invalidate an end time that's already stored.
Recurring occurrences inherit both times; `generateForTask` builds its head
object by hand, so any new task field has to be added there too or it
silently won't be copied onto occurrences.

## Activity-log blocks: two getters, only one has `content`

`getActivityLogById` deliberately selects everything EXCEPT `content` (it's
used for ownership checks). Anything that reads or rewrites the blocks must
use `getActivityLogWithContent` — reaching for the wrong one gives you
`content === undefined` and a confusing "that activity is no longer there"
rather than a crash. Hit during the complete/pending work.

Block status (`block.status`: "done" | "pending" | absent) is changed through
`PATCH /activity-log/:date/blocks/:index/status`, which mutates one block
server-side. Don't replace it with a client-side read-modify-write of the
whole entry — that races with a concurrent edit in another tab.

## Live data: fetch-once lists are a bug waiting to happen

`broadcastTaskChange` already fires on every task change including comments,
and the workspace socket room reaches everyone. Any list that renders
other people's contributions must SUBSCRIBE, not just fetch on mount — task
comments shipped fetch-once and produced a "member comments are invisible to
everyone else" report that looked like a permissions bug and wasn't. The
pattern to copy is in `Comments`: `socket.on("task:changed", …)` filtered by
`reason` and `taskId`, cleaned up on unmount. `ActivityComments` does the
same with `activity:comment`.

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

**Three themes, four choices.** `data-theme` is `dark`, `light` or `warm`;
the user's stored *preference* adds `system`, which resolves via
`prefers-color-scheme` and re-resolves when the OS flips. Preference and
painted theme are separate values in `ThemeContext` on purpose — collapsing
them loses the user's choice the moment the OS changes. Warm is a light
scheme on a cream ground: its status colours are shifted warm (deeper red,
ochre amber) rather than copied from the light theme, which glares against
cream. Any new colour needs a value in all three blocks, or that theme
silently falls back to whatever was last set.

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