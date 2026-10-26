const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, TableRow, ImageRun,
  Header, Footer, PageNumber, PageBreak, BorderStyle,
} = require("docx");
const { shared } = require("./teamReportDocx");

const {
  LOGO_PATH, BRAND, INK, MUTED, LINE, DONE, OVERDUE, PARTIAL,
  STATUS_LABEL, PRIORITY_LABEL,
  fmtDate, fmtLongDate, fmtTimestamp, localDateOf, fmtTimeRange, fmtSize,
  todayIso, isOverdue, overdueDays, completionTiming, plural,
  text, spacer, para, heading, cell, table, kv, th, guard,
  activityBlock,
} = shared;

/**
 * Project Activity Report — ONE project, everything that happened on it, in
 * date order.
 *
 * The team report answers "what has each person done" and is organised by
 * person. This one answers "what has happened on Pork Marketing" and is
 * organised by DATE: a reader goes through it like a project diary. It is
 * built from the same gathered data and the same renderers (activityBlock,
 * overdue/completion maths), so an activity reads and counts identically in
 * both documents.
 *
 * Sections:
 *   1. Cover — project, lead, dates, status, period
 *   2. At a glance — the figures, and who worked on it
 *   3. Milestones
 *   4. Timeline — one line per item, oldest first (activities, day-book
 *      entries tagged to this project, milestones)
 *   5. Every activity in full, month by month, day by day
 *   6. Overdue register
 *   7. Project files and links
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Wednesday, 14 Oct 2026". Weekday computed at UTC noon — a calendar date,
// not an instant — so no server timezone can print the wrong day.
const fmtDayHeading = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return fmtLongDate(iso);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return `${weekday}, ${fmtLongDate(iso)}`;
};
const monthKey = (iso) => String(iso).slice(0, 7);
const fmtMonth = (key) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

const people = (task) =>
  task.assignee2Name ? `${task.assigneeName || "Unassigned"} & ${task.assignee2Name}` : (task.assigneeName || "Unassigned");

// One status phrase per activity, the same words everywhere in this document.
const statusOf = (task) => {
  if (task.status === "done") {
    const t = completionTiming(task);
    return {
      label: t && t.label !== "—" ? `Completed · ${t.label.toLowerCase()}` : "Completed",
      color: t && t.late > 0 ? PARTIAL : DONE,
    };
  }
  if (isOverdue(task)) return { label: `Overdue · ${plural(overdueDays(task), "day")}`, color: OVERDUE };
  return { label: STATUS_LABEL[task.status] || "Open", color: INK };
};

/**
 * Every dated thing on the project, as one list: activities, the day-book
 * lines people tagged with this project, and milestones. Sorted oldest first
 * — a project history reads forwards. Undated activities come last.
 */
function buildEntries(data, project) {
  const entries = [];
  const tasks = data.tasks.filter((t) => t.projectId === project.id);
  for (const task of tasks) {
    entries.push({ kind: "task", date: task.due || null, time: task.dueTime || "", task });
  }
  for (const log of data.activityLogs) {
    const blocks = Array.isArray(log.content) ? log.content : [];
    const mine = blocks.filter((b) => b && b.type !== "table" && b.projectId === project.id);
    for (const block of mine) {
      entries.push({ kind: "log", date: log.entryDate, time: typeof block.time === "string" ? block.time : "", log, block });
    }
  }
  const inWindow = (iso) => (!data.scope.from || iso >= data.scope.from) && (!data.scope.to || iso <= data.scope.to);
  for (const m of data.milestones.filter((x) => x.projectId === project.id)) {
    if (m.targetDate && !inWindow(m.targetDate)) continue;
    entries.push({ kind: "milestone", date: m.targetDate || null, time: "", milestone: m });
  }
  const rank = { milestone: 0, task: 1, log: 2 };
  entries.sort((a, b) => {
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // Same day: milestones first, then by time (untimed after timed), then kind.
    if (rank[a.kind] === 0 || rank[b.kind] === 0) return rank[a.kind] - rank[b.kind];
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return rank[a.kind] - rank[b.kind];
  });
  return { entries, tasks };
}

/* ------------------------------ sections ------------------------------ */

function coverBlock(data, project, generatedBy, tasks) {
  const { workspace, scope } = data;
  const children = [];
  if (fs.existsSync(LOGO_PATH)) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new ImageRun({ type: "png", data: fs.readFileSync(LOGO_PATH), transformation: { width: 92, height: 92 } })],
    }));
  }
  children.push(
    para(text("DEPARTMENT OF AGRICULTURE MARKETING AND COOPERATIVES", { bold: true, size: 22, color: BRAND }), { alignment: AlignmentType.CENTER, after: 40 }),
    para(text("Ministry of Agriculture and Livestock, Royal Government of Bhutan", { size: 18, color: MUTED }), { alignment: AlignmentType.CENTER, after: 220 }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: "Project Activity Report", font: "Calibri", bold: true, size: 40, color: INK })],
    }),
    para(text(project.name, { size: 28, bold: true, color: BRAND }), { alignment: AlignmentType.CENTER, after: 220 }),
  );

  const period =
    scope.from && scope.to ? `${fmtLongDate(scope.from)} – ${fmtLongDate(scope.to)}`
    : scope.from ? `From ${fmtLongDate(scope.from)}`
    : scope.to ? `Up to ${fmtLongDate(scope.to)}`
    : "All time — every record held";

  let deadline = project.deadline ? fmtDate(project.deadline) : "Not set";
  if (project.deadline && !project.completedAt) {
    const today = todayIso();
    const [y, m, d] = project.deadline.split("-").map(Number);
    const [ty, tm, td] = today.split("-").map(Number);
    const diff = Math.round((Date.UTC(y, m - 1, d, 12) - Date.UTC(ty, tm - 1, td, 12)) / 86400000);
    deadline += diff > 0 ? `   (${plural(diff, "day")} to go)` : diff < 0 ? `   (passed ${plural(-diff, "day")} ago)` : "   (today)";
  }

  children.push(table([
    kv("Project", project.name),
    kv("Status", project.completedAt ? `Completed on ${fmtDate(localDateOf(project.completedAt))}` : "Active", project.completedAt ? DONE : undefined),
    kv("Project lead", project.leadName || "Not assigned"),
    kv("Start date", project.startDate ? fmtDate(project.startDate) : "From creation"),
    kv("Deadline", deadline),
    kv("Period covered", period),
    kv("Activities in this report", String(tasks.length)),
    kv("Workspace", workspace.name),
    kv("Generated", `${fmtTimestamp(new Date())} by ${generatedBy}`),
  ]));
  return children;
}

function glanceBlock(data, project, tasks, entries) {
  const children = [new Paragraph({ children: [new PageBreak()] }), heading("At a glance", 1, BRAND)];
  if (project.description) {
    children.push(para(text(project.description, { size: 20, italics: true, color: MUTED }), { after: 160 }));
  }

  const done = tasks.filter((t) => t.status === "done");
  const timings = done.map(completionTiming).filter((t) => t && t.late !== null);
  const onTime = timings.filter((t) => t.late === 0).length;
  const late = tasks.filter(isOverdue);
  const lateDays = late.map(overdueDays).filter((n) => n !== null);
  const dated = entries.filter((e) => e.date).map((e) => e.date);
  const logLines = entries.filter((e) => e.kind === "log").length;
  const milestones = entries.filter((e) => e.kind === "milestone").length;

  const row = (label, value, color) =>
    new TableRow({
      children: [
        cell(para(text(label, { size: 17, color: MUTED }), { after: 0 }), { width: 50, fill: "F6F8FA" }),
        cell(para(text(value, { size: 19, bold: true, color }), { after: 0 }), { width: 50 }),
      ],
    });
  children.push(table([
    row("Activities", String(tasks.length)),
    row("Completed", `${done.length}  (${tasks.length ? Math.round((done.length / tasks.length) * 100) : 0}%)`, DONE),
    row("Completed on or before the date", String(onTime), DONE),
    row("Completed late", String(timings.length - onTime), timings.length - onTime ? PARTIAL : INK),
    row("Still open", String(tasks.length - done.length)),
    row("Overdue", String(late.length), late.length ? OVERDUE : INK),
    row("Longest overdue", lateDays.length ? plural(Math.max(...lateDays), "day") : "—", lateDays.length ? OVERDUE : MUTED),
    row("Day-book entries tagged to this project", String(logLines)),
    row("Milestones", String(milestones)),
    row("First and last recorded date", dated.length ? `${fmtDate(dated[0])} – ${fmtDate(dated[dated.length - 1])}` : "—"),
  ]));
  children.push(spacer(160));

  // Who worked on it. Everyone who appears in the project — as an assignee
  // (either slot) or through a day-book line — not just current members.
  const byPerson = new Map();
  const touch = (id, name) => {
    if (!id) return null;
    if (!byPerson.has(id)) byPerson.set(id, { id, name: name || "Unknown", total: 0, done: 0, open: 0, late: 0, logs: 0 });
    return byPerson.get(id);
  };
  for (const t of tasks) {
    for (const [id, name] of [[t.assigneeId, t.assigneeName], [t.assignee2Id, t.assignee2Name]]) {
      const p = touch(id, name);
      if (!p) continue;
      p.total += 1;
      if (t.status === "done") p.done += 1; else p.open += 1;
      if (isOverdue(t)) p.late += 1;
    }
  }
  for (const e of entries) if (e.kind === "log") { const p = touch(e.log.userId, e.log.userName); if (p) p.logs += 1; }

  children.push(heading("Who worked on it", 2));
  const list = [...byPerson.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  if (!list.length) {
    children.push(para(text("Nobody has activities on this project in this period.", { italics: true, color: MUTED })));
    return children;
  }
  const rows = [new TableRow({
    children: [th("Person", 34), th("Activities", 13), th("Completed", 13), th("Open", 12), th("Overdue", 13), th("Day book", 15)],
    tableHeader: true,
  })];
  for (const p of list) {
    rows.push(new TableRow({
      children: [
        cell(para(text(p.name, { size: 18, bold: true })), { width: 34 }),
        cell(para(text(String(p.total), { size: 18 })), { width: 13 }),
        cell(para(text(String(p.done), { size: 18, color: DONE })), { width: 13 }),
        cell(para(text(String(p.open), { size: 18 })), { width: 12 }),
        cell(para(text(String(p.late), { size: 18, color: p.late ? OVERDUE : INK })), { width: 13 }),
        cell(para(text(String(p.logs), { size: 18 })), { width: 15 }),
      ],
    }));
  }
  children.push(table(rows));
  children.push(para(
    text("An activity shared by two people counts for both of them, so the per-person figures can add up to more than the project total.", { size: 15, italics: true, color: MUTED }),
    { before: 80 }
  ));
  return children;
}

function milestonesBlock(entries) {
  const ms = entries.filter((e) => e.kind === "milestone").map((e) => e.milestone);
  const children = [heading("Milestones", 1, BRAND)];
  if (!ms.length) {
    children.push(para(text("No milestones recorded for this project in this period.", { italics: true, color: MUTED })));
    return children;
  }
  const today = todayIso();
  const rows = [new TableRow({ children: [th("Date", 16), th("Milestone", 30), th("Details", 32), th("Link to file", 22)], tableHeader: true })];
  for (const m of ms) {
    const reached = m.targetDate && m.targetDate <= today;
    rows.push(new TableRow({
      children: [
        cell([
          para(text(m.targetDate ? fmtDate(m.targetDate) : "No date", { size: 18, bold: true }), { after: 0 }),
          para(text(m.targetDate ? (reached ? "Reached" : "Upcoming") : "", { size: 15, color: reached ? DONE : MUTED }), { after: 0 }),
        ], { width: 16 }),
        cell(para(text(m.title, { size: 18, bold: true })), { width: 30 }),
        cell(para(text(m.description || "—", { size: 17, color: m.description ? INK : MUTED })), { width: 32 }),
        cell(
          m.links.length
            ? m.links.map((l) => para([text(`${l.label || "Link"}: `, { size: 16, bold: true }), text(l.url, { size: 15, color: BRAND })], { after: 20 }))
            : [para(text("—", { size: 16, color: MUTED }))],
          { width: 22 }
        ),
      ],
    }));
  }
  children.push(table(rows));
  return children;
}

// The one-page view: one line per thing that happened, oldest first.
function timelineBlock(entries) {
  const children = [new Paragraph({ children: [new PageBreak()] }), heading("Timeline — everything in date order", 1, BRAND)];
  if (!entries.length) {
    children.push(para(text("Nothing has been recorded on this project in this period.", { italics: true, color: MUTED })));
    return children;
  }
  children.push(para(
    text("Oldest first. Activities, day-book entries tagged to this project, and milestones. Each is set out in full in the next section.", { size: 16, italics: true, color: MUTED }),
    { after: 120 }
  ));
  const rows = [new TableRow({
    children: [th("Date", 13), th("Time", 13), th("What", 40), th("Who", 17), th("Status", 17)],
    tableHeader: true,
  })];
  for (const e of entries) {
    let what, who, status, timeLabel = "";
    if (e.kind === "task") {
      const st = statusOf(e.task);
      timeLabel = fmtTimeRange(e.task.dueTime, e.task.endTime);
      what = [
        para(text(e.task.title, { size: 18 }), { after: 0 }),
        ...(e.task.priority === "high" ? [para(text("Urgent", { size: 14, color: OVERDUE, bold: true }), { after: 0 })] : []),
      ];
      who = people(e.task);
      status = para(text(st.label, { size: 16, color: st.color, bold: st.color === OVERDUE }));
    } else if (e.kind === "log") {
      timeLabel = e.block.time ? fmtTimeRange(e.block.time, e.block.endTime) : "";
      what = [
        para(text(e.block.text || "(no text)", { size: 18 }), { after: 0 }),
        para(text("Day book", { size: 14, color: MUTED }), { after: 0 }),
      ];
      who = e.log.userName;
      const label = e.block.status === "done" ? "Complete" : e.block.status === "pending" ? "Pending" : "Logged";
      status = para(text(label, { size: 16, color: e.block.status === "done" ? DONE : MUTED }));
    } else {
      what = [para(text(`◆  Milestone: ${e.milestone.title}`, { size: 18, bold: true, color: BRAND }), { after: 0 })];
      who = "";
      status = para(text(e.date && e.date <= todayIso() ? "Reached" : "Upcoming", { size: 16, color: e.date && e.date <= todayIso() ? DONE : MUTED }));
    }
    rows.push(new TableRow({
      children: [
        cell(para(text(e.date ? fmtDate(e.date) : "No date", { size: 17, bold: true, color: e.date ? INK : MUTED })), { width: 13, fill: e.kind === "milestone" ? "EEF6F0" : undefined }),
        cell(para(text(timeLabel || "—", { size: 16, color: timeLabel ? INK : MUTED })), { width: 13, fill: e.kind === "milestone" ? "EEF6F0" : undefined }),
        cell(what, { width: 40, fill: e.kind === "milestone" ? "EEF6F0" : undefined }),
        cell(para(text(who || "—", { size: 16 })), { width: 17, fill: e.kind === "milestone" ? "EEF6F0" : undefined }),
        cell(status, { width: 17, fill: e.kind === "milestone" ? "EEF6F0" : undefined }),
      ],
    }));
  }
  children.push(table(rows));
  return children;
}

function logLineBlock(e) {
  const out = [];
  const bits = [];
  if (e.block.time) bits.push(text(`${fmtTimeRange(e.block.time, e.block.endTime)}  `, { size: 18, color: BRAND, bold: true }));
  bits.push(text(e.block.text || "(no text)", { size: 20 }));
  if (e.block.status) bits.push(text(`   [${e.block.status === "done" ? "Complete" : "Pending"}]`, { size: 17, color: e.block.status === "done" ? DONE : MUTED, bold: true }));
  bits.push(text(`   — day book of ${e.log.userName}`, { size: 16, color: MUTED }));
  out.push(para(bits, { bullet: 1, after: 30 }));
  if (e.block.notes) out.push(para(text(e.block.notes, { size: 18, italics: true, color: MUTED }), { indent: 720, after: 30 }));
  for (const link of Array.isArray(e.block.links) ? e.block.links : []) {
    out.push(para([text(`${link.label || "Link"}: `, { size: 17, bold: true }), text(link.url, { size: 17, color: BRAND })], { indent: 720, after: 20 }));
  }
  return out;
}

// Everything in full, as a diary: month headings, day headings, then each
// activity exactly as the team report prints it.
function detailBlock(entries) {
  const children = [new Paragraph({ children: [new PageBreak()] }), heading("Every activity in full, by date", 1, BRAND)];
  if (!entries.length) {
    children.push(para(text("Nothing to show.", { italics: true, color: MUTED })));
    return children;
  }
  let month = null;
  let day = undefined;
  const logCommentsShown = new Set();
  for (const e of entries) {
    if (e.date) {
      if (monthKey(e.date) !== month) {
        month = monthKey(e.date);
        children.push(heading(fmtMonth(month), 2, BRAND));
      }
      if (e.date !== day) {
        day = e.date;
        children.push(heading(fmtDayHeading(e.date), 3));
      }
    } else if (day !== null) {
      day = null;
      children.push(heading("No date set", 2, BRAND));
    }

    if (e.kind === "task") {
      children.push(...activityBlock(e.task));
    } else if (e.kind === "milestone") {
      const m = e.milestone;
      children.push(para([
        text("◆  MILESTONE  ", { size: 18, bold: true, color: BRAND }),
        text(m.title, { size: 21, bold: true }),
      ], { after: 30, border: { left: { style: BorderStyle.SINGLE, size: 18, color: BRAND, space: 8 } } }));
      if (m.description) children.push(para(text(m.description, { size: 18, color: MUTED }), { indent: 300, after: 30 }));
      for (const l of m.links) {
        children.push(para([text(`${l.label || "Link"}: `, { size: 17, bold: true }), text(l.url, { size: 17, color: BRAND })], { indent: 300, after: 20 }));
      }
      children.push(spacer(100));
    } else {
      children.push(...logLineBlock(e));
      // Comments on that person's day-book page for the day: printed once,
      // under the first line of theirs that belongs to this project.
      if (!logCommentsShown.has(e.log.id) && e.log.comments.length) {
        logCommentsShown.add(e.log.id);
        for (const c of e.log.comments) {
          children.push(para([
            text(`${c.authorName || "Unknown"} `, { bold: true, size: 17 }),
            text(`· ${fmtTimestamp(c.createdAt)}: `, { size: 16, color: MUTED }),
            text(c.body, { size: 18 }),
          ], { indent: 720, after: 30 }));
        }
      }
      children.push(spacer(60));
    }
  }
  return children;
}

function overdueBlock(tasks) {
  const late = tasks.filter(isOverdue).map((t) => ({ task: t, days: overdueDays(t) })).sort((a, b) => b.days - a.days);
  const children = [new Paragraph({ children: [new PageBreak()] }), heading("Overdue on this project", 1, BRAND)];
  if (!late.length) {
    children.push(para(text("Nothing is overdue. Everything open is still within its date.", { italics: true, color: DONE })));
    return children;
  }
  const rows = [new TableRow({ children: [th("Days late", 12), th("Activity", 46), th("Who", 24), th("Was due", 18)], tableHeader: true })];
  for (const { task, days } of late) {
    rows.push(new TableRow({
      children: [
        cell(para(text(String(days), { bold: true, size: 19, color: OVERDUE })), { width: 12 }),
        cell([
          para(text(task.title, { size: 18 }), { after: 0 }),
          para(text(`${STATUS_LABEL[task.status] || task.status} · ${PRIORITY_LABEL[task.priority] || task.priority || "—"}`, { size: 15, color: MUTED }), { after: 0 }),
        ], { width: 46 }),
        cell(para(text(people(task), { size: 17 })), { width: 24 }),
        cell(para(text(fmtDate(task.due), { size: 17 })), { width: 18 }),
      ],
    }));
  }
  children.push(table(rows));
  children.push(para(
    text(`${late.length} overdue, ${plural(late.reduce((n, l) => n + l.days, 0), "day")} late in total.`, { size: 16, bold: true, color: OVERDUE }),
    { before: 80 }
  ));
  return children;
}

function referenceBlock(data, project, tasks) {
  const links = data.projectLinks.filter((l) => l.projectId === project.id);
  const docs = data.documents.filter((d) => d.projectId === project.id);
  const taskLinks = tasks.flatMap((t) => t.links.map((l) => ({ ...l, from: t.title })));
  const taskFiles = tasks.flatMap((t) => t.files.map((f) => ({ ...f, from: t.title })));
  const children = [heading("Project files and links", 1, BRAND)];
  if (!links.length && !docs.length && !taskLinks.length && !taskFiles.length) {
    children.push(para(text("No files or links have been added to this project.", { italics: true, color: MUTED })));
    return children;
  }
  if (links.length || docs.length) {
    children.push(heading("Project files", 2));
    for (const l of links) {
      children.push(para([
        text(`${l.label || "Link"}: `, { size: 18, bold: true }),
        text(l.url, { size: 17, color: BRAND }),
        text(`  — added by ${l.adderName || "unknown"}`, { size: 16, color: MUTED }),
      ], { bullet: 1, after: 20 }));
    }
    for (const d of docs) {
      children.push(para(text(`${d.fileName} (${fmtSize(d.sizeBytes)}) — uploaded by ${d.uploaderName || "unknown"}, ${fmtTimestamp(d.createdAt)}`, { size: 18 }), { bullet: 1, after: 20 }));
    }
  }
  if (taskLinks.length || taskFiles.length) {
    children.push(heading("From activities", 2));
    for (const l of taskLinks) {
      children.push(para([
        text(`${l.label || "Link"}: `, { size: 18, bold: true }),
        text(l.url, { size: 17, color: BRAND }),
        text(`  — on “${l.from}”`, { size: 16, color: MUTED }),
      ], { bullet: 1, after: 20 }));
    }
    for (const f of taskFiles) {
      children.push(para(text(`${f.fileName} (${fmtSize(f.sizeBytes)}) — on “${f.from}”, ${f.uploaderName || "unknown"}`, { size: 18 }), { bullet: 1, after: 20 }));
    }
  }
  return children;
}

/* ------------------------------- document ------------------------------- */

async function buildProjectReportDocx(data, generatedBy) {
  const project = data.projects[0];
  const { entries, tasks } = buildEntries(data, project);

  const children = [
    ...guard("Cover", () => coverBlock(data, project, generatedBy, tasks)),
    ...guard("At a glance", () => glanceBlock(data, project, tasks, entries)),
    ...guard("Milestones", () => milestonesBlock(entries)),
    ...guard("Timeline", () => timelineBlock(entries)),
    ...guard("Every activity in full", () => detailBlock(entries)),
    ...guard("Overdue", () => overdueBlock(tasks)),
    ...guard("Project files and links", () => referenceBlock(data, project, tasks)),
  ];

  const logoRun = fs.existsSync(LOGO_PATH)
    ? new ImageRun({ type: "png", data: fs.readFileSync(LOGO_PATH), transformation: { width: 18, height: 18 } })
    : null;

  const doc = new Document({
    creator: "PMDAMC",
    title: `Project Activity Report — ${project.name}`,
    description: "Generated from PMDAMC",
    styles: { default: { document: { run: { font: "Calibri", size: 20, color: INK } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              ...(logoRun ? [logoRun, new TextRun({ text: "  " })] : []),
              new TextRun({ text: `DAMC · Project Activity Report · ${project.name}`, font: "Calibri", size: 16, color: MUTED }),
            ],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", font: "Calibri", size: 16, color: MUTED }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 16, color: MUTED }),
              new TextRun({ text: " of ", font: "Calibri", size: 16, color: MUTED }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 16, color: MUTED }),
            ],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

function projectReportFileName(data) {
  const slug = (value) => String(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  const range = data.scope.from || data.scope.to ? `_${data.scope.from || "start"}_to_${data.scope.to || todayIso()}` : "";
  return `DAMC-Project-Report_${slug(data.projects[0]?.name || "project")}${range}_${todayIso()}.docx`;
}

// Exported for tests: the ordering is the part people rely on.
module.exports = { buildProjectReportDocx, projectReportFileName, buildEntries };
