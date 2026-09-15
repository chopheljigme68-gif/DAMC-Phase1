# PMDAMC — full stack project management system

A real, deployable task board with proper hierarchy: **workspaces** contain
**projects**, and every task lives inside a project. Three roles —
**Admin**, **Lead**, **Member** — control who can create work. Every
boundary below is enforced by the server, not just hidden in the UI, and
was tested live before being shipped.

## What's new in this round — comments bug, project management, files

**The reported bug, first:**

- **A member's comment never appeared for anyone else.** The API was always
  correct — every workspace member could read every comment — but the client
  fetched the list *once*, when the task dialog opened, and never again. So
  if you had a task open while a colleague commented on it, you simply never
  saw it. The server was already broadcasting each comment; the dialog now
  listens, scoped to that task. Activity-log comments got the same treatment
  (and the broadcast they were missing).

**Plus:**

- **Rename and delete any project**, from the sidebar. Rename is inline —
  it's one field, it doesn't need a dialog. Delete takes two clicks and spells
  out that tasks, milestones and files go with it; deleting the project you
  were viewing falls back to All projects instead of a blank board.
  - Fixed a latent hazard while wiring this: `PATCH /projects/:id` wrote all
    four fields unconditionally, so a rename-only call would have silently
    blanked the project's description, deadline and start date. It's a real
    partial update now.
- **Files on the Board.** Selecting a project shows its files and links in a
  column beside its tasks, so you can see what's attached without leaving the
  board. Hidden on "All projects", where there's no single set to show.
- **Drag files onto the Files page to upload them** — full-page drop target
  with the destination project named on it, so you can't drop into the wrong
  project by accident.
- **Team Collabs rows can be dragged** into whatever order you want. The
  order is remembered per browser: who you want at the top of your dashboard
  is your own arrangement, not a fact about the workspace, so it needs no
  schema change and no rules about who may reorder whom. New joiners appear
  at the end rather than scrambling your order.

## Previously shipped
## What's new in this round — icon audit

- **Removed "Open in Collaboration Log"** from the dashboard's logged-activity
  popup — the popup already shows everything the entry holds, so the jump was
  a detour out of the dashboard for no gain. Search still routes to a logged
  activity's day in the Collaboration Log.

- **Icon pass across the app.** Three icons were imported but never used
  (dead weight in the bundle) and several picks were semantically weak or
  too informal for a department tool. Swapped, all within the existing
  lucide set so the whole UI stays on one 24×24 grid at one stroke weight:
  - Board: generic columns → an actual kanban board
  - Collaboration Log: an open book → a notebook with a pen (it's written in,
    not read from)
  - Team lead marker: a crown → a verified badge (a crown reads as
    gamification on a government system)
  - Theme menu: a laptop → a monitor for "System", a coffee cup → a sunset
    for "Warm"

## Previously shipped
## What's new in this round — Warm theme and Follow system

- **Four theme choices instead of a two-way toggle**: System, Light, Warm,
  Dark, from a menu on the top bar.
  - **Warm** is a new light theme on a cream ground rather than white —
    easier on the eyes over a long day and under warm office lighting. Its
    status colours are shifted warm to match, not copied across from the
    light theme, where they glared.
  - **System** follows the device and re-paints live when the OS switches at
    sunset, without a reload. The menu says which way it's currently
    resolving ("System · dark now") so it isn't a guess.
  - The choice is remembered per browser, and the button always shows the
    theme actually on screen.

## Previously shipped
## What's new in this round — dates, time ranges, and a chip removed

- **Every date now reads dd/mm/yyyy.** A native date input renders in the
  browser's own locale, so the same field was showing `09/15/2026` to some
  people and `15/09/2026` to others with no way to control it from the
  markup — genuinely risky for a day-first office. All eleven date inputs
  now use one `DateField` component: it displays and accepts dd/mm/yyyy,
  tolerates `5/9/26` and `5-9-2026`, rejects impossible dates like 31/02,
  and keeps the calendar picker behind a button so nobody loses it on
  desktop or mobile.
- **Activities can run from one time to another.** "Time from" and "Time to"
  on the task dialog, replacing the single Time field — people had been
  writing "2–4 PM" into titles for want of an end time. Shows as
  `2:00 PM – 4:30 PM` everywhere a time appears. The end field stays
  disabled until there's a start, and an end that isn't after the start is
  refused by the server as well as flagged in the form. Recurring activities
  inherit the whole range.
- **The "Logged" chip is gone** from every row it appeared on.

## Previously shipped
## What's new in this round — completion tick in the task dialog

- **Stage is now a tick beside the footer buttons.** It was a "Tasks /
  Completed" dropdown sitting mid-form among the filing fields, which is an
  odd shape for a two-state value and an odd place for it — marking
  something done is the last thing you do before saving, not something you
  set alongside the project. It's now a single **Mark complete / Completed**
  toggle in the footer, left of Cancel, using the same tick control as the
  urgent toggle. Priority takes the full row it used to share.

## Previously shipped
## What's new in this round — files by project

- **A project picker in the Files view.** Files and links are stored per
  project, but the view could only ever show whichever project was selected
  in the sidebar — so getting at another project's documents meant leaving
  the page, switching project, and coming back. There's now a dropdown in
  the Files header: pick a project and its files and links load in place,
  without changing what the rest of the app is pointed at. Completed
  projects stay in the list, since their files are often exactly what
  someone is looking for.
  - Permission is computed for the project you've **picked**, not the one in
    the sidebar — otherwise the Upload button would appear on a project you
    don't lead and the server would then reject the upload. A member viewing
    a project they don't lead now gets an explicit "View only" line rather
    than silently missing controls.
  - The picker still follows the sidebar: switching project there and then
    opening Files shows that project.

## Previously shipped
## What's new in this round — workspace rename

- **The workspace can now be renamed from inside the app.** Admin Panel →
  **Workspace** → edit the name → Save. It updates the sidebar wordmark and
  every screen for everyone in the workspace immediately.

  This existed nowhere before: no route, no API method, no UI. The name was
  set once at creation and could only be changed by editing the database
  directly, which is why "MIRD – DAMC" couldn't be shortened to "DAMC" from
  the product. Admin-only, matching every other workspace-level setting, and
  enforced server-side (`PATCH /workspaces/:id`, `requireRole("admin")`) not
  just hidden in the UI. The slug is deliberately left untouched — it's an
  identifier other rows hang off, and nothing user-facing shows it.

## Previously shipped
## What's new in this round — correction log #8

Two reported bugs, both real, both fixed with a regression test:

- **A repeating activity could not be removed.** Deleting one occurrence did
  nothing lasting: the hourly generator saw a gap in the series and put the
  task straight back, so "Meeting on Pork supply to GMC 108 Project" kept
  reappearing daily. Deleting an occurrence now records that date as an
  exception on the series (`tasks.recurrence_exdates`) and generation skips
  it permanently. Separately, **"Stop repeating" now works from any
  occurrence** — previously the schedule could only be changed from the first
  activity in the series, which is useless when you don't know which one that
  is. The task dialog shows a Stop repeating button on every occurrence, with
  an explicit "will stop when you save" confirmation. Stopping a series never
  deletes the original activity, and never touches occurrences someone has
  already worked on.
- **An activity added for the 24th never appeared under Upcoming Collabs.**
  The card took the first 6 rows and silently dropped the rest — with
  recurring activities in the mix, anything more than a few days out fell off
  the end and looked like it hadn't saved. The card now shows every upcoming
  activity with a count and its own scroll area.

Plus, as requested:

- **Search, top right.** Type part of an activity's name and matching
  activities appear as you type — both tasks and logged activity, ranked so
  the closest names come first, each showing its project or Logged badge,
  date and owner. Tasks are matched from memory so typing stays instant;
  logged activity is fetched once (90 days) on the first search. Arrow keys
  and Enter work, and Ctrl/Cmd+K focuses it from anywhere.
- **Files accepts pasted links.** Google Drive files and folders, Sheets, or
  any other URL now sit alongside uploads in the Files view, using the same
  project-links API already behind milestone links rather than a second
  mechanism.
- **Supervisor comments under a Team Collabs row read in red**, with a red
  rule down the side — they're feedback to act on, not more grey body text.

## Previously shipped
## What's new in this round — correction log #7

- **The account block moved to the top right, as a proper menu.** It used
  to be a panel pinned to the bottom of the sidebar, where a long name was
  ellipsised down to "Sangay Thi…" and Sign out sat one mis-click away from
  the profile button. It's now an avatar pill in the top bar beside Quick
  add / notifications / theme, opening a menu with the **full name**, job
  title, email and role badge, then Edit profile and Sign out as distinct
  rows (Sign out in the priority red, so it reads as the destructive one).
  Closes on outside-click or Escape, same mechanics as the notification
  bell so the two popovers in that bar behave identically. On narrow
  screens the name drops away and the avatar alone is the control.

- **Complete and Pending no longer leave the dashboard.** They were buttons
  in the "My Today's Collabs" header that navigated to the Board
  pre-filtered. The three cards (Today / Upcoming / Pending) stay exactly as
  they were; the buttons are now a compact **Today · Past · Complete ·
  Pending** strip that swaps the top card's list in place, with the card
  title following the selection. The overdue count rides on the Pending pill.
  - "Past" is the diary — finished tasks *and* logged activity from before
    today. "Complete" is tasks only, today's included, which is what the old
    Complete button showed on the Board. Different questions, so both stay.
  - Dates are coloured for what the list means: overdue in the priority red,
    completed in the done colour, everything else in the scheduled blue.
  - Rows in all three cards now have the same hover, keyboard focus and
    Enter/Space handling, and keep their behaviour from the previous round —
    tasks open the task dialog, logged activities open their detail popup.

## Previously shipped
## What's new in this round — correction log #6

- **Recurring activities.** A task can now repeat: daily, every weekday,
  weekly on any set of days (every Thursday, Tue+Thu, every 2 weeks…), or
  monthly on the same date, with an optional end date. Occurrences are real
  task rows, not virtual entries, so each one can be completed, commented
  on, reassigned and attached to like any other task, and the board,
  calendar and reminders needed no changes to handle them. The rule lives
  on the first task of the series; occurrences are generated up to 60 days
  ahead, immediately on save and again on an hourly sweep. Changing a rule
  clears future occurrences nobody has touched yet and rebuilds them —
  occurrences that already have comments, files or ticked subtasks are left
  alone. Deleting the first activity hands the rule to the next one instead
  of taking the series with it.
- **"All Teams Collabs Today"** — one button on Team Collabs that swaps the
  per-person blocks for a single time-ordered list of everything the whole
  team did on one day, each row showing who it belongs to. The day is a
  picker with prev/next, so it answers the same question for any past day,
  not only today.
- **Logged activities are clickable.** A "Logged" row on Today's Collabs now
  opens its full detail — time, what was worked on, notes, project and any
  links — plus a jump straight to that day in the Collaboration Log. Rows
  also have a real hover and keyboard focus state, so it's visible that
  they do something.
- **Activity dates are legible again.** Dates on Upcoming/Pending/Past rows
  were plain faint grey and read as disabled; they now have their own
  colour token (`--date-scheduled`, defined per theme) and a little weight,
  kept distinct from the green used for clock times.
- **New task dialog reordered** — Assignee, Due date and Time now sit
  directly under "Add subtask", above the filing details (project, stage,
  priority) people change far less often.
- **Sidebar project list is collapsed by default.** "All projects" stays
  visible with a count; clicking it opens the list (and selects the
  all-projects filter), and the chevron opens/closes it without changing
  what you're looking at. Your choice is remembered per browser.

## Previously shipped
## What's new in this round — pre-deployment QA pass

- **Found and fixed a real, launch-blocking bug**: the task dialog's footer
  buttons still gated on the old manager-only permission, so a plain member
  could fill in every field of a new task but had no "Create task" button
  to actually submit it — only "Close." The fields and the buttons had
  fallen out of sync during an earlier round. Caught by an actual
  end-to-end browser test logged in as a real member, not a code review —
  fixed, then re-ran the identical test to confirm.
- **Save errors are no longer silent.** The task save flow had no error
  handling at all — any failure just quietly re-enabled the button with no
  explanation. Now shows a real message, and a failed file upload (e.g. one
  bad file among several) no longer hides the fact that the task and
  everything else saved fine — only the genuine failure is called out,
  by name.
- **Oversized files are now rejected instantly, client-side**, with a clear
  message — before, they'd only fail after a slow, doomed upload attempt.
  Matches the server's real 20MB limit, which was verified independently
  with an actual 25MB upload (clean rejection, no crash, connection fine
  right after).
- **Full system verified end-to-end** across every feature area — see the
  project's delivery notes for the complete checklist of what was actually
  tested, not just written.

## Previously shipped
## What's new in this round — motion & interactivity

Every animation added here signals something real (a value changed, a
notification arrived, this dialog is now open) rather than moving for its
own sake — deliberately kept restrained given this is a government
department's working tool, not a consumer app. All respect
`prefers-reduced-motion`.

- Dialogs (task, bulk-add, edit profile) now pop in with a subtle scale
  instead of a flat appear
- Checking off a subtask gives a small overshoot-and-settle pop
- Buttons get real tactile press feedback (scale down on click), not just
  a hover state
- The sidebar's active view has a sliding accent indicator instead of an
  instant background swap
- The notification bell rings briefly when a *new* notification actually
  arrives — tracked against the previous count, not just re-triggered on
  every render
- Dashboard stat numbers pop when their value changes
- Board cards stagger in instead of all appearing at once; dragging a card
  gives it a lift-and-tilt, and the drop target pulses while you hover it
- **Roadmap bars grow in from the left on load** — render at zero width,
  then animate to their real size next frame, so the timeline visibly
  fills in rather than appearing fully drawn; milestone flags fade in a
  beat after

Verified with a real browser test after building, not just visual
inspection — confirmed zero page errors, the modal/checkbox/roadmap
animation classes actually apply at the right moments, and the roadmap bar
settles to its correct real width (not stuck at zero or broken).

## Previously shipped
## What's new in this round — Roadmap view

- **New Roadmap nav item** — every project on one timeline, positioned by
  real dates (hand-built, no charting library, matching how the rest of
  this app is built), with milestone flags marked on each project's bar,
  a "today" line, and color coding for on-track / overdue / completed.
  Click any project to jump straight into it.
- **Built on what actually exists, not invented fields** — projects never
  had a "start date" separate from when the row was created, so the
  roadmap uses `created_at` as a sensible default rather than forcing a
  backfill. A genuinely new, optional `start_date` field was added
  alongside that so future projects can be planned more precisely without
  disturbing existing data.
- **One query, not N+1** — the roadmap's backend endpoint fetches every
  project's milestones in a single batched query, not one call per project.
- **A real bug caught in testing, not just written and shipped**: the
  `Map` icon import collided with JavaScript's own built-in `Map` class,
  which the app already uses elsewhere — this crashed the entire app on
  load (`Map is not a constructor`) until caught by an actual browser test
  and fixed the same way this codebase already handles that exact
  collision pattern (`Image as ImageIcon`, `Table as TableIcon`).

## Previously shipped
## What's new in this round — members are now view + comment only

A regular member (not admin, not workspace lead, not that specific
project's lead) can now only **view** tasks and **comment** on them —
nothing else. This deliberately replaces the earlier "anyone can create
tasks" / "you can update your own task's status" behavior from a couple of
rounds ago, since those can't coexist with "don't let them change
anything." Specifically, for non-managers:

- Cannot create tasks (New task, Bulk add, and the per-column "+" are
  hidden; the server rejects it even if attempted directly)
- Cannot edit any field on a task — including their **own** assigned
  task's status, which used to be allowed and no longer is
  - The Stage dropdown was actually never disabled before this round for
    anyone — caught and fixed that gap while making this change
- Cannot drag-and-drop a card between columns
- Cannot check off a checklist item, or add/remove files or links —
  task-level or subtask-level, own task or not
- **Can** still view every task, its files, its links, and the full team
  roster, and **can** still comment on anything

Tested directly against a live server as an actual plain-member account,
specifically targeting their *own* assigned task (the case most likely to
have a leftover exception) — confirmed blocked on status, assignee,
checklist, and links, while still able to comment. Also caught and fixed 8
leftover error messages that still referenced the old "your own task"
exception even though the rule no longer has one.

## Previously shipped
## What's new in this round

- **Editable project deadline & description** — previously set-once at
  creation, now editable anytime from the Milestones page by the workspace
  admin/lead or that project's own lead. Verified a plain member gets a
  clean 403 trying it.
- **Milestone creation now includes files and links upfront** — same
  pattern as subtask creation: stage links and files right in the "Add
  milestone" form, uploaded automatically the moment the milestone is
  saved. (The backend for milestone file attachments already existed from
  an earlier round but had no UI — added the missing frontend piece and
  wired it in properly, tested end-to-end with a real link + real file
  landing on the same milestone together.)
- **UI colors now follow the actual DAMC logo** — sampled the real logo
  file's colors directly (came out to essentially `#008300` green) and
  rebuilt the accent palette around it for both dark and light themes.
  Priority/status colors (red/amber/blue/teal) stay deliberately distinct
  from the brand color so they're still readable at a glance.

## Previously shipped
## What's new in this round

- **Per-project leads.** Different projects can now have different leads —
  distinct from the one workspace-wide Lead. Admin assigns them from the
  Milestones page; that person then gets manager-level rights (edit any
  task, manage milestones/files/links, see analytics) scoped to just their
  project. Verified live: a project lead could fully edit tasks in their
  own project but got a clean 403 trying the same in a different project
  they don't lead.
- **Fixed: refreshing the page reset your project and view.** Project
  selection had zero persistence — every refresh silently switched you back
  to whichever project was first, and the current tab always reset to
  Dashboard. Fixed by persisting both, the same way workspace selection
  already was. Also made sure logout properly clears all of this so
  switching between different accounts on the same browser can't leak
  the previous person's selection.
- **Real error handling instead of generic failures.** Found and fixed a
  genuine case where a malformed request triggered a bare "Internal server
  error" — the backend's error handler now tells apart bad input, oversized
  files, and duplicate-entry conflicts, each with its own clear message.
  Also hardened the frontend against network-level failures (server
  unreachable, CORS issues) so those show a plain "can't reach the server"
  message instead of a raw, confusing exception.

## Previously shipped
## What's new in this round — opened-up visibility, restricted editing

- **Everyone can now see every task in a project**, not just their own —
  tested live: a plain member's task list now includes tasks assigned to
  other people too.
- **Anyone can create a task now**, not just admin/lead — tested by
  actually creating a task through the real UI logged in as a plain member.
- **Editing an existing task you don't own is still blocked** — a member
  can view any task, comment on it, and see its files/links, but can't
  change its fields or upload to it unless it's assigned to them or they're
  admin/lead. Verified: a member's attempt to edit someone else's task
  still gets a clean 403; their attempt to comment on it still succeeds.
- **New: Admin Panel.** A consolidated, admin/lead-only nav item combining
  **Analytics** and **Team Management** in one place with a tab switcher.
  The standalone Team page still exists for everyone (roster/workload
  viewing), this is specifically the oversight-focused combined view.

## Previously shipped

- **Fixed: inviting a teammate needed a page refresh to show up.** The
  invite call was firing correctly but never updating the on-screen member
  list — fixed to reflect immediately.
- **Fixed: a completed task could still show "X days overdue."** The overdue
  calculation didn't check status in one spot (the task card). Fixed at the
  source so it's covered everywhere, automatically.
- **Edit profile** — name, photo, and post/designation, all in one place
  from the sidebar (click your name).
- **Activity log** — a daily log per person, made of text notes and/or
  tables — add as many tables as you need in a single entry. Admin/lead can
  also see the whole team's log, grouped by day.
- **Multiple milestones per project**, shown in sequence with up/down
  reordering, each with its own set of reference links.
- **Holidays** — admin/lead can mark a date as a holiday; shown on
  everyone's calendar.
- **Project-level reference links**, alongside the deadline, description,
  and files that were already there.
- **Richer subtasks** — each checklist item can now have its own time range
  (e.g. 9:00–10:00), description, files, and links. Fixed a real data-loss
  bug in the process: subtasks used to be deleted and recreated on every
  save, which would have wiped out their attachments the moment someone
  just ticked a checkbox — now existing subtasks are updated in place, so
  their files/links survive routine edits and only truly get removed when
  the subtask itself is deleted.

## Previously shipped

- **Fixed the real session bug behind several reports** — "admin can't
  assign team lead," "refreshing sends me to a check-again page," and
  "analytics isn't working" all traced back to the same root cause: on
  page refresh, the workspace/project contexts were briefly resolving to
  "nothing here" *before* the login session had actually finished loading,
  because they used a bare `!user` check instead of also waiting on auth's
  own loading state. Fixed in both `WorkspaceContext` and `ProjectContext`.
- **Milestone tab** — exactly one per project (a real DB unique constraint,
  not just app logic), editable by admin/lead, viewable by everyone.
- **Project deadline** at creation, and **mark project complete** (admin/lead) —
  moves it to Project History in the switcher. Nothing is deleted; tasks,
  files, comments, and the milestone all stay exactly where they are.
- **Bulk add got smarter**: paste lines like `Leo: 9:00 AM - Meeting with
  Director` and it's assigned to Leo automatically (matched by name or
  initials); indent a line underneath to make it a checklist item instead
  of a new task — matches how the source activity logs are actually
  structured. A live preview shows exactly what will be created before
  you confirm.
- **"2 days left" reminders** — a scheduler checks hourly for tasks due in
  exactly 2 days and pushes a realtime notification to the assignee, once
  per task (tracked so it never repeats, and resets if the due date changes).
- **Post/designation captured at signup** (e.g. "Product Designer") and
  used as your starting title when you're added to the workspace, instead
  of a generic "Team member" default — still editable afterwards.
- **Multiple links at once** — a "Paste multiple" toggle on the Links
  section accepts one per line (`Label | https://...` or a bare URL).
- **Removed workspace creation from the UI** — there's one workspace;
  the switcher no longer offers to add more.
- **Team Lead is now impossible to miss** — a dedicated banner at the top
  of the Team page names the current Admin and Lead, not just a small
  crown icon on an avatar.
- **Profile photo upload is now visibly discoverable** — a persistent small
  pencil badge on your avatar in the sidebar, not just a hover-only overlay.

- **Optional time-of-day on tasks.** Built to match real activity-log
  formats where entries are like "9:00 AM — Meeting with Director," not
  just a due date. Shows as a chip on task cards, sorts the board and
  calendar chronologically within a day.
- **Bulk add.** A "Bulk add" button next to "New task" (admin/lead only)
  opens a paste-a-list box — one line per task, same assignee/due date for
  all of them. A leading time like `9:00 AM -` or `2:30 PM` on any line is
  automatically pulled into that task's time field and stripped from the
  title. Built for pasting a whole day's worth of a written log in one go
  instead of opening the task dialog once per line.

- **Comments, with replies.** A flat, chronological thread on every task —
  the admin/lead writes an instruction, the assignee replies in the same
  thread. No nested reply UI to learn; it reads like a chat. Same access
  rule as everything else: a member can only comment on their own tasks.
  Posting one fires a realtime notification to "the other side" of the
  conversation.
- **Links, alongside file attachments.** Add a labeled URL to any task you
  can already edit — a Google Doc, a GitHub PR, a reference page — without
  needing to upload anything. Validated server-side (must be a real
  `http(s)://` URL; `javascript:` and other unsafe schemes are rejected).
- **Post/designation, separate from role.** Each person's **post** (e.g.
  "Chief Program Officer") is independent of their **role**
  (Admin/Lead/Member) and editable by the person themselves or by the
  admin, with common job-title suggestions via autocomplete.
- **New accounts no longer create a workspace.** Registering just creates
  an account; a "platform admin" concept (set via an env var, no manual DB
  work) is the only one who can stand up a new workspace. Everyone else
  waits to be invited, with a clear "you're not on a workspace yet" screen
  instead of a confusing self-service setup step.
- **Profile photos.** Real faces instead of colored initials, everywhere —
  task cards, comments, the team roster. Click your own avatar in the
  sidebar to change it.
- **Project-level Files.** Beyond per-task attachments (already there),
  there's now a dedicated Files area per project for shared reference
  material — visible to everyone on the project, uploaded only by admin/lead.

*(An earlier pass explored ministry-specific naming/suggestions for a
civil-service deployment; that's been reverted back to plain, generic
"workspace" language per feedback — the app makes no assumptions about the
kind of organization using it.)*

## Previously shipped

- **Admin can remove someone from the team.** Their task history is kept
  (nothing silently deletes), but they lose access to the workspace
  immediately and get a realtime notification. Blocked from removing
  yourself, and blocked from removing the workspace's last remaining admin.
- **Photos and files on tasks.** Upload images or documents (20MB limit,
  common types only) to any task you can already edit. Members can attach
  files to their own tasks; admin/lead to any task. Access to view/download
  a file follows the exact same rule as the task itself — a member can't
  fetch a file from a teammate's task even with a direct link.
- **"Active workload" on the Team page now actually reflects reality.** It
  used to only count tasks in whichever project you had open, which made it
  look broken the moment a team had more than one project. It's now a
  dedicated, admin/lead-only endpoint that sums a person's workload across
  every project in the workspace.
- **Removed the Dashboard's "Team lead alerts" panel** per request. The
  Analytics page's own overdue list and workload-balance view are untouched
  — those are a separate, project-scoped feature.

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything. Assigns the Lead, promotes/demotes/removes anyone, creates projects, creates/assigns/edits/deletes tasks, sees all analytics. Exactly one admin minimum per workspace. |
| **Lead** | Same task/project powers as Admin (create projects, create and assign tasks, see analytics, upload files to any task) but can't change anyone's role or remove them. Only one Lead per workspace at a time. |
| **Member** | Sees **only tasks assigned to them**, enforced in the SQL query. Can drag their own cards, tick their own checklist, and attach photos/files to their own tasks. Cannot create tasks, reassign anything, edit task details, remove teammates, or see analytics/workload. |

## What's real here — verified, not assumed

- **File upload**: uploaded a real PNG as a Member to their own task, downloaded
  it back, diffed the bytes — identical. A different Member was blocked
  (`403`) from even listing that task's attachments; the Lead could see and
  download it without restriction.
- **Member removal**: a non-admin got `403` trying to remove someone. The
  admin got blocked trying to remove themselves, and again trying to remove
  the last admin. A real removal succeeded, the removed person's workspace
  list went to empty immediately, and they received a realtime notification.
- **Workload endpoint**: confirmed the numbers returned match a hand-count
  of that person's tasks across both seeded projects combined, and that a
  Member gets `403` requesting it.
- **Migration**: simulated an existing pre-projects, pre-roles database, ran
  today's schema on top of it, and confirmed roles and a "General" project
  backfilled correctly — nothing is lost when you upgrade.
- **Comments**: a Lead's comment and the assignee's reply both landed in the
  same thread; a different Member got `403` trying to comment on a task
  that wasn't theirs; both sides received a realtime notification.
- **Post/designation editing**: a Member editing their own post succeeded; a
  different Member editing *someone else's* post got `403`; the admin
  editing anyone's succeeded.
- **New-user experience**: registered a fresh account with `PLATFORM_ADMIN_EMAILS`
  unset for it — confirmed `isPlatformAdmin: false` and an empty workspace
  list, which is exactly the state the frontend's "you're not on a
  workspace yet" screen (no create option) is built to handle.
- **Project documents**: a Member was blocked (`403`) from uploading, but
  could view and byte-for-byte download a document an admin uploaded —
  confirmed reference material is visible to the whole team, not gated
  like task attachments are.
- **Avatars**: uploaded a real JPEG, fetched it back as a different user,
  diffed the bytes — identical.

## Logo

The uploaded Bhutanese Kitchen Initiative mark has been background-removed
(transparent PNG) and is used as the real app icon — sidebar, all auth
screens, and the browser favicon. Source files: `frontend/public/logo.png`
and `favicon.png`.

## Requirements

- Node.js 18+
- A Postgres database (Supabase or local)

## Quick start (Supabase)

1. Connection string: **Project Settings → Database → Connection string**.
   If the direct connection times out (common — it's IPv6-only), use the
   **Session pooler** string instead.
2. Backend:
   ```bash
   cd backend
   cp .env.example .env
   # paste DATABASE_URL, set PGSSL=true, set a real JWT_SECRET,
   # set PLATFORM_ADMIN_EMAILS to your own email (comma-separated for more than one)
   npm install
   npm run migrate   # idempotent — safe on a fresh DB or an existing one
   npm run seed        # demo workspace + 2 projects + roles (no-ops if data exists)
   npm run dev
   ```
3. Frontend:
   ```bash
   cd frontend
   cp .env.example .env
   npm install
   npm run dev
   ```
4. Open `http://localhost:5173`.

## Quick start (local Postgres)

```bash
createdb team_flow_hub
cd backend
cp .env.example .env
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/team_flow_hub, PGSSL=false
npm install && npm run migrate && npm run seed && npm run dev
```

### Demo logins

Workspace **Product Studio**, password `password123` for everyone:

| Email | Name | Post | Role |
|---|---|---|---|
| daniel@flowhub.dev | Daniel Cho | Founder | **Admin** (also `PLATFORM_ADMIN_EMAILS` default) |
| priya@flowhub.dev | Priya Nair | Product Designer | **Lead** |
| leo@flowhub.dev | Leo Marchetti | Frontend Engineer | Member |
| sena@flowhub.dev | Sena Osei | Backend Engineer | Member |
| astrid@flowhub.dev | Astrid Voss | QA Engineer | Member |
| ravi@flowhub.dev | Ravi Kapoor | Founding Engineer | Member |

Two seeded projects: **Website Relaunch** and **Mobile App v2**.

### Trying the new features yourself

1. Register a brand-new account (an email *not* in `PLATFORM_ADMIN_EMAILS`) —
   you'll land on "you're not on a workspace yet" with no create option.
2. Log in as `daniel@flowhub.dev` (the platform admin) and create a second
   workspace from the switcher.
3. Open any task and try the Comments box as the assignee vs. as the lead —
   post as one, watch the notification bell light up for the other.
4. On the same task, add a **Link** (any `https://` URL) — try it as a
   Member on their own task vs. someone else's.
5. On the Team page, click the pencil next to your own post/designation and
   change it — then try editing someone else's (blocked unless you're admin).
6. Click your own avatar in the sidebar to upload a real photo — watch it
   replace your initials everywhere, including on task cards.
7. Open the new **Files** tab for a project and upload a document as admin —
   then log in as a Member and confirm you can view/download it but not
   delete it.
8. Still on Files, try a task's own **attachments** (in the task dialog) as
   a Member on their own task vs. someone else's — the "Add photo or file"
   button only appears where you're allowed to use it.
9. With more than one project in a workspace, check the Team page's "Active
   workload" chart — it totals correctly across all of them, not just
   whichever project happens to be open.

## Project layout

```
backend/
  db/schema.sql             workspaces, roles, projects, tasks, attachments,
                              comments, project documents, platform admin,
                              notifications, password resets (+ backfill logic)
  uploads/                  uploaded files live here on disk (gitignored):
                              tasks/, projects/, avatars/ subfolders
  src/
    db.js                      every query — attachment/comment/document CRUD,
                                 workspace-wide workload, member removal, and
                                 the PLATFORM_ADMIN_EMAILS bootstrap all live here
    utils/upload.js              multer config: task/project/avatar uploaders,
                                   size limits + extension whitelist per type
    middleware/workspace.js      requireWorkspaceMember, requireRole,
                                   requireProjectInWorkspace, requirePlatformAdmin
    routes/
      auth.routes.js               register/login/me (+ platform admin bootstrap)
      users.routes.js               avatar upload/serving
      workspaces.routes.js         members/invite/role/title/removal/workload,
                                     workspace creation gated to platform admins
      projects.routes.js            list/create/delete + project-level documents
      tasks.routes.js                 tasks + nested attachments and comments,
                                        all permission-checked per request
      analytics.routes.js             project-scoped, admin/lead only
frontend/
  public/logo.png, favicon.png   background-removed logo
  src/
    context/  Auth, Theme, Workspace, Project
    App.jsx     dashboard/board/team/files/calendar/analytics, workspace +
                 project switchers, comments, avatar uploader, editable posts,
                 role-aware controls throughout
```

## Deploying

Set in production: `DATABASE_URL` / `PGSSL=true`, `JWT_SECRET`,
`CORS_ORIGIN`, `APP_URL`, `PLATFORM_ADMIN_EMAILS`, and SMTP vars for real
password-reset email delivery. Run `npm run migrate && npm run seed` once
against production. `backend/uploads/` needs to persist across
deploys/restarts — if you deploy somewhere with an ephemeral filesystem
(e.g. most serverless hosts), mount a persistent volume there or swap
`utils/upload.js` for S3/R2 storage.

## ⚠️ Still open: enable Row Level Security on Supabase

Unrelated to this update but still outstanding — Supabase exposes every
`public` table via its auto-generated REST API to anyone with the project's
anon key, regardless of this app's own auth. Since this backend connects as
the Postgres owner (which bypasses RLS), turning RLS on with no permissive
policies closes that hole without breaking anything here:

```sql
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
```