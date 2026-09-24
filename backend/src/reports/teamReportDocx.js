const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
  Header, Footer, PageNumber, PageBreak, ShadingType,
} = require("docx");

// DAMC's own logo, kept in the backend rather than read out of the frontend
// build — the backend is deployed on its own and must not depend on the
// static site's files being anywhere near it.
const LOGO_PATH = path.join(__dirname, "..", "..", "assets", "logo.png");

const BRAND = "1F7D3B";   // DAMC green, the light-theme value — this prints
const INK = "1A1D24";
const MUTED = "63697A";
const LINE = "D8DDE5";
const DONE = "1F7D3B";
const OVERDUE = "B3261E";
const PARTIAL = "9A5A12";  // "done, but late" — neither green nor alarm red

/* ----------------------------- formatting ----------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// dd/mm/yyyy everywhere, matching the app — this office reads day-first and
// a US-ordered date in a printed report is a real source of misreading.
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const fmtLongDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const fmtTimestamp = (value) => {
  if (!value) return "—";
  const dt = new Date(value);
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()} ${hh}:${mm}`;
};
// Times arrive from two places: a TIME column (always "HH:MM") and the free
// JSON of an activity-log block, which has held numbers and junk. A report
// must not die because one entry has 930 where it should have "09:30".
const fmtClock = (hhmm) => {
  if (hhmm === null || hhmm === undefined || hhmm === "") return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(String(hhmm).trim());
  if (!match) return String(hhmm);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
};
const fmtTimeRange = (start, end) => {
  if (!start) return "";
  return end ? `${fmtClock(start)} – ${fmtClock(end)}` : fmtClock(start);
};
const fmtSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
const STATUS_LABEL = { todo: "To do", doing: "In progress", review: "In review", done: "Completed" };
const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "Urgent" };

const todayIso = () => new Date().toISOString().slice(0, 10);
const isOverdue = (task) => task.status !== "done" && task.due && task.due < todayIso();

// Calendar-day arithmetic on 'YYYY-MM-DD' strings via UTC noon — the same
// rule the rest of the app uses. These are dates, not instants, and noon is
// what stops a server timezone from shifting a day.
const dayNumber = (iso) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(Date.UTC(y, m - 1, d, 12) / 86400000);
};
const daysBetween = (fromIso, toIso) => {
  const a = dayNumber(fromIso);
  const b = dayNumber(toIso);
  return a === null || b === null ? null : b - a;
};

// How many days past its date an open activity is. Null when it isn't late.
const overdueDays = (task) => {
  if (!isOverdue(task)) return null;
  return daysBetween(task.due, todayIso());
};
const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? "" : "s"}`;
const overdueLabel = (task) => {
  const days = overdueDays(task);
  return days === null ? "" : `${plural(days, "day")} overdue`;
};

// For something already finished: was it done by its date, and by how much?
// Answers "what was done" with the part people actually ask about next.
const completionTiming = (task) => {
  if (task.status !== "done") return null;
  const doneOn = task.completedAt ? new Date(task.completedAt).toISOString().slice(0, 10) : null;
  if (!doneOn || !task.due) return { doneOn, label: "—", late: null };
  const diff = daysBetween(task.due, doneOn);
  if (diff === null) return { doneOn, label: "—", late: null };
  if (diff > 0) return { doneOn, label: `${plural(diff, "day")} late`, late: diff };
  if (diff < 0) return { doneOn, label: `${plural(-diff, "day")} early`, late: 0 };
  return { doneOn, label: "On the day", late: 0 };
};

// Everything the summary tables need about one person, computed once.
const memberStats = (member, data) => {
  const mine = data.tasks.filter((t) => t.assigneeId === member.id);
  const done = mine.filter((t) => t.status === "done");
  const open = mine.filter((t) => t.status !== "done");
  const late = mine.filter(isOverdue);
  const timings = done.map(completionTiming).filter((t) => t && t.late !== null);
  const onTime = timings.filter((t) => t.late === 0).length;
  const overdueDayList = late.map(overdueDays).filter((n) => n !== null);
  const logs = data.activityLogs.filter((l) => l.userId === member.id);
  const loggedBlocks = logs.reduce((n, l) => n + (Array.isArray(l.content) ? l.content.length : 0), 0);
  return {
    mine, done, open, late, logs, loggedBlocks,
    onTime,
    completedLate: timings.length - onTime,
    worstOverdue: overdueDayList.length ? Math.max(...overdueDayList) : 0,
    totalOverdueDays: overdueDayList.reduce((a, b) => a + b, 0),
    projects: new Set(mine.map((t) => t.projectId)).size,
    completionRate: mine.length ? Math.round((done.length / mine.length) * 100) : 0,
  };
};

/* --------------------------- small builders --------------------------- */

const text = (value, opts = {}) =>
  new TextRun({
    text: value === null || value === undefined || value === "" ? "—" : String(value),
    font: "Calibri",
    size: opts.size || 20,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || INK,
  });

// Vertical space between blocks. NOT para(text("")) — text() prints an
// em-dash for an empty value (which is right inside a field, wrong here).
const spacer = (after = 120) => new Paragraph({ children: [], spacing: { after } });

const para = (runs, opts = {}) =>
  new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { before: opts.before ?? 0, after: opts.after ?? 60 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    alignment: opts.alignment,
    heading: opts.heading,
    bullet: opts.bullet ? { level: opts.bullet - 1 } : undefined,
    keepNext: opts.keepNext,
    border: opts.border,
  });

const heading = (value, level, color) =>
  new Paragraph({
    children: [new TextRun({ text: value, font: "Calibri", bold: true, color: color || INK, size: level === 1 ? 30 : level === 2 ? 26 : 22 })],
    spacing: { before: level === 1 ? 320 : 220, after: 110 },
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    keepNext: true,
  });

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const thin = { style: BorderStyle.SINGLE, size: 4, color: LINE };

const cell = (children, opts = {}) =>
  new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    columnSpan: opts.span,
    borders: opts.borderless
      ? { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }
      : { top: thin, bottom: thin, left: thin, right: thin },
  });

// A cell's value comes out of free-form JSON, so it can be an object, a
// number or null. Print something readable instead of "[object Object]".
const cellText = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") { try { return JSON.stringify(value); } catch { return String(value); } }
  return String(value);
};

const table = (rows) =>
  new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, layout: "autofit" });

// A label/value row used all through the activity blocks.
const kv = (label, value, valueColor) =>
  new TableRow({
    children: [
      cell(para(text(label, { bold: true, size: 18, color: MUTED })), { width: 22, fill: "F6F8FA" }),
      cell(para(text(value, { size: 20, color: valueColor })), { width: 78 }),
    ],
  });

/* ------------------------------ sections ------------------------------ */

function coverBlock(data, generatedBy) {
  const { workspace, scope, members, projects } = data;
  const children = [];

  if (fs.existsSync(LOGO_PATH)) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            type: "png",
            data: fs.readFileSync(LOGO_PATH),
            transformation: { width: 92, height: 92 },
          }),
        ],
      })
    );
  }

  children.push(
    para(text("DEPARTMENT OF AGRICULTURE MARKETING AND COOPERATIVES", { bold: true, size: 22, color: BRAND }), { alignment: AlignmentType.CENTER, after: 40 }),
    para(text("Ministry of Agriculture and Livestock, Royal Government of Bhutan", { size: 18, color: MUTED }), { alignment: AlignmentType.CENTER, after: 220 }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: "Team Work Report", font: "Calibri", bold: true, size: 40, color: INK })],
    }),
    para(
      text(
        scope.userId
          ? `Individual report — ${members[0]?.name || "member"}`
          : "All team members",
        { size: 22, color: BRAND, bold: true }
      ),
      { alignment: AlignmentType.CENTER, after: 30 }
    ),
    para(
      text(
        scope.projectId
          ? `Project: ${projects[0]?.name || "—"}`
          : `Every project in ${workspace.name}`,
        { size: 20, color: MUTED }
      ),
      { alignment: AlignmentType.CENTER, after: 220 }
    )
  );

  const period =
    scope.from && scope.to ? `${fmtLongDate(scope.from)} – ${fmtLongDate(scope.to)}`
    : scope.from ? `From ${fmtLongDate(scope.from)}`
    : scope.to ? `Up to ${fmtLongDate(scope.to)}`
    : "All time — every record held";

  children.push(
    table([
      kv("Period", period),
      kv("Workspace", workspace.name),
      kv("Members covered", String(members.length)),
      kv("Projects covered", String(projects.length)),
      kv("Generated", `${fmtTimestamp(new Date())} by ${generatedBy}`),
    ])
  );

  return children;
}

// The numbers the Chief reads first: who did how much, what is still open,
// and how late it is. Two tables — a per-person scoreboard, and a register of
// everything overdue across the whole team, worst first, because "what is
// late and by how long" is the question this report exists to answer.
const th = (label, width) =>
  cell(para(text(label, { bold: true, size: 17, color: "FFFFFF" })), { width, fill: BRAND });

function summaryBlock(data) {
  const { members, tasks } = data;
  const children = [heading("Summary", 1, BRAND)];

  const rows = [
    new TableRow({
      children: [
        th("Team member", 24),
        th("Activities", 10),
        th("Completed", 10),
        th("On time", 9),
        th("Late", 8),
        th("Open", 8),
        th("Overdue", 9),
        th("Worst", 10),
        th("Done", 12),
      ],
      tableHeader: true,
    }),
  ];

  for (const member of members) {
    const st = memberStats(member, data);
    rows.push(
      new TableRow({
        children: [
          cell([
            para(text(member.name, { bold: true, size: 18 }), { after: 0 }),
            para(text(member.title || member.role, { size: 15, color: MUTED }), { after: 0 }),
          ], { width: 24 }),
          cell(para(text(String(st.mine.length), { size: 18 })), { width: 10 }),
          cell(para(text(String(st.done.length), { size: 18, color: DONE })), { width: 10 }),
          cell(para(text(String(st.onTime), { size: 18, color: DONE })), { width: 9 }),
          cell(para(text(String(st.completedLate), { size: 18, color: st.completedLate ? PARTIAL : INK })), { width: 8 }),
          cell(para(text(String(st.open.length), { size: 18 })), { width: 8 }),
          cell(para(text(String(st.late.length), { size: 18, color: st.late.length ? OVERDUE : INK })), { width: 9 }),
          cell(para(text(st.worstOverdue ? `${st.worstOverdue}d` : "—", { size: 18, color: st.worstOverdue ? OVERDUE : MUTED })), { width: 10 }),
          cell(para(text(`${st.completionRate}%`, { size: 18, bold: true })), { width: 12 }),
        ],
      })
    );
  }

  const allLate = tasks.filter(isOverdue);
  const allDone = tasks.filter((t) => t.status === "done");
  const allTimings = allDone.map(completionTiming).filter((t) => t && t.late !== null);
  const totalOnTime = allTimings.filter((t) => t.late === 0).length;
  const worst = allLate.map(overdueDays).filter((n) => n !== null);
  rows.push(
    new TableRow({
      children: [
        cell(para(text("Whole team", { bold: true, size: 18 })), { width: 24, fill: "F0F3F7" }),
        cell(para(text(String(tasks.length), { bold: true, size: 18 })), { width: 10, fill: "F0F3F7" }),
        cell(para(text(String(allDone.length), { bold: true, size: 18, color: DONE })), { width: 10, fill: "F0F3F7" }),
        cell(para(text(String(totalOnTime), { bold: true, size: 18, color: DONE })), { width: 9, fill: "F0F3F7" }),
        cell(para(text(String(allTimings.length - totalOnTime), { bold: true, size: 18 })), { width: 8, fill: "F0F3F7" }),
        cell(para(text(String(tasks.length - allDone.length), { bold: true, size: 18 })), { width: 8, fill: "F0F3F7" }),
        cell(para(text(String(allLate.length), { bold: true, size: 18, color: allLate.length ? OVERDUE : INK })), { width: 9, fill: "F0F3F7" }),
        cell(para(text(worst.length ? `${Math.max(...worst)}d` : "—", { bold: true, size: 18, color: worst.length ? OVERDUE : MUTED })), { width: 10, fill: "F0F3F7" }),
        cell(para(text(`${tasks.length ? Math.round((allDone.length / tasks.length) * 100) : 0}%`, { bold: true, size: 18 })), { width: 12, fill: "F0F3F7" }),
      ],
    })
  );

  children.push(table(rows));
  children.push(
    para(
      text(
        'Every activity in scope is counted, including those with no date set. "Overdue" is an activity still open past its date; "Worst" is the longest any one of them has been late. "On time" counts activities completed on or before their date.',
        { size: 15, italics: true, color: MUTED }
      ),
      { before: 90, after: 160 }
    )
  );

  children.push(...overdueRegister(data));
  return children;
}

// Everything late, across the whole team, worst first. The one table to read
// if you only read one.
function overdueRegister(data) {
  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const late = data.tasks
    .filter(isOverdue)
    .map((t) => ({ task: t, days: overdueDays(t) }))
    .sort((a, b) => b.days - a.days);

  const children = [heading("Overdue register — every activity past its date", 2)];
  if (!late.length) {
    children.push(para(text("Nothing is overdue. Everything open is still within its date.", { italics: true, color: DONE })));
    return children;
  }

  const rows = [
    new TableRow({
      children: [th("Days late", 10), th("Activity", 40), th("Person", 17), th("Project", 19), th("Was due", 14)],
      tableHeader: true,
    }),
  ];
  for (const { task, days } of late) {
    rows.push(
      new TableRow({
        children: [
          cell(para(text(String(days), { bold: true, size: 19, color: OVERDUE })), { width: 10 }),
          cell([
            para(text(task.title, { size: 18 }), { after: 0 }),
            para(text(`${STATUS_LABEL[task.status] || task.status} · ${PRIORITY_LABEL[task.priority] || task.priority || "—"}`, { size: 15, color: MUTED }), { after: 0 }),
          ], { width: 40 }),
          cell(para(text(task.assigneeName || "Unassigned", { size: 17 })), { width: 17 }),
          cell(para(text(projectsById.get(task.projectId)?.name || "—", { size: 17 })), { width: 19 }),
          cell(para(text(`${fmtDate(task.due)}${task.dueTime ? ` ${fmtClock(task.dueTime)}` : ""}`, { size: 17 })), { width: 14 }),
        ],
      })
    );
  }
  children.push(table(rows));
  children.push(
    para(
      text(`${plural(late.length, "activity").replace("activitys", "activities")} overdue, ${plural(late.reduce((n, l) => n + l.days, 0), "day")} late in total.`, { size: 16, bold: true, color: OVERDUE }),
      { before: 80 }
    )
  );
  return children;
}


// One activity, in full. Nothing held back: description, meeting notes,
// every subtask, every comment, every file and link.
function activityBlock(task) {
  const rows = [
    new TableRow({
      children: [
        cell(
          [
            para(text(task.title, { bold: true, size: 22 }), { after: 20 }),
            para(
              text(
                [
                  STATUS_LABEL[task.status] || task.status,
                  PRIORITY_LABEL[task.priority] || task.priority,
                  task.recurring ? "Recurring" : null,
                  isOverdue(task) ? `OVERDUE BY ${plural(overdueDays(task), "day").toUpperCase()}` : null,
                  task.status === "done" && completionTiming(task)?.late > 0
                    ? `COMPLETED ${completionTiming(task).label.toUpperCase()}`
                    : null,
                ].filter(Boolean).join("  ·  "),
                { size: 17, color: isOverdue(task) ? OVERDUE : MUTED, bold: isOverdue(task) }
              ),
              { after: 0 }
            ),
          ],
          { span: 2, fill: "F6F8FA" }
        ),
      ],
    }),
    // The date on its own is half the story; how far past it we are is the
    // half people act on.
    kv(
      "Date",
      isOverdue(task) ? `${fmtDate(task.due)}   (${overdueLabel(task)})` : fmtDate(task.due),
      isOverdue(task) ? OVERDUE : undefined
    ),
  ];

  if (task.dueTime) rows.push(kv("Time", fmtTimeRange(task.dueTime, task.endTime)));
  rows.push(kv("Assigned to", task.assigneeName || "Unassigned"));
  // Reads "Assigned by" when someone else handed this over, "Created by"
  // when it is the person's own entry — the same distinction the dashboard
  // makes, so the document and the screen say the same thing.
  rows.push(kv(
    task.createdByName && task.createdByName !== task.assigneeName ? "Assigned by" : "Created by",
    `${task.createdByName || "—"} on ${fmtTimestamp(task.createdAt)}`
  ));
  if (task.completedAt) {
    const timing = completionTiming(task);
    rows.push(kv(
      "Completed",
      timing && timing.label !== "—"
        ? `${fmtTimestamp(task.completedAt)}   (${timing.label})`
        : fmtTimestamp(task.completedAt),
      timing && timing.late > 0 ? PARTIAL : DONE
    ));
  }
  if (task.description) rows.push(kv("Description", task.description));
  if (task.meetingNotes) rows.push(kv("Notes from meeting / discussion", task.meetingNotes));

  if (task.subtasks.length) {
    rows.push(
      new TableRow({
        children: [
          cell(para(text(`Subtasks (${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length})`, { bold: true, size: 18, color: MUTED })), { width: 22, fill: "F6F8FA" }),
          cell(
            task.subtasks.map((s) =>
              para(
                [
                  text(s.done ? "[x] " : "[ ] ", { size: 20, color: s.done ? DONE : MUTED }),
                  text(s.text, { size: 20, color: s.done ? MUTED : INK }),
                  ...(s.startTime ? [text(`  (${fmtTimeRange(s.startTime, s.endTime)})`, { size: 17, color: MUTED })] : []),
                  ...(s.description ? [text(` — ${s.description}`, { size: 17, color: MUTED, italics: true })] : []),
                ],
                { after: 20 }
              )
            ),
            { width: 78 }
          ),
        ],
      })
    );
  }

  if (task.comments.length) {
    rows.push(
      new TableRow({
        children: [
          cell(para(text(`Comments (${task.comments.length})`, { bold: true, size: 18, color: MUTED })), { width: 22, fill: "F6F8FA" }),
          cell(
            task.comments.map((c) =>
              para(
                [
                  text(`${c.authorName || "Unknown"} `, { bold: true, size: 18 }),
                  text(`· ${fmtTimestamp(c.createdAt)}`, { size: 16, color: MUTED }),
                  new TextRun({ break: 1 }),
                  text(c.body, { size: 19 }),
                ],
                { after: 60 }
              )
            ),
            { width: 78 }
          ),
        ],
      })
    );
  }

  if (task.files.length) {
    rows.push(
      new TableRow({
        children: [
          cell(para(text(`Files (${task.files.length})`, { bold: true, size: 18, color: MUTED })), { width: 22, fill: "F6F8FA" }),
          cell(
            task.files.map((f) =>
              para(text(`${f.fileName}  (${fmtSize(f.sizeBytes)}, ${f.uploaderName || "unknown"}, ${fmtTimestamp(f.createdAt)})`, { size: 18 }), { after: 20 })
            ),
            { width: 78 }
          ),
        ],
      })
    );
  }

  if (task.links.length) {
    rows.push(
      new TableRow({
        children: [
          cell(para(text(`Links (${task.links.length})`, { bold: true, size: 18, color: MUTED })), { width: 22, fill: "F6F8FA" }),
          cell(
            task.links.map((l) =>
              para([
                text(`${l.label || "Link"}: `, { size: 18, bold: true }),
                text(l.url, { size: 17, color: BRAND }),
              ], { after: 20 })
            ),
            { width: 78 }
          ),
        ],
      })
    );
  }

  return [table(rows), spacer(120)];
}

// A member's day-book entries — these are not tasks and have no other home
// in the report, so they get their own section rather than being dropped.
function loggedActivitiesBlock(logs, projectsById) {
  const children = [heading("Logged activities (day book)", 2)];
  if (!logs.length) {
    children.push(para(text("No logged activities in this period.", { italics: true, color: MUTED })));
    return children;
  }

  for (const log of logs) {
    children.push(heading(fmtLongDate(log.entryDate), 3, BRAND));
    const blocks = Array.isArray(log.content) ? log.content : [];
    if (!blocks.length) children.push(para(text("(empty entry)", { italics: true, color: MUTED })));

    for (const block of blocks) {
      if (block?.type === "table") {
        // docx throws on a Table with no rows, and on a row with no cells —
        // and an activity with an empty table in it is perfectly normal
        // (someone added one and never filled it). Drop those rather than
        // failing the whole report.
        const rows = (Array.isArray(block.rows) ? block.rows : [])
          .map((row) => (Array.isArray(row) ? row : [row]))
          .filter((row) => row.length > 0);
        if (rows.length) {
          children.push(
            table(
              rows.map((row, ri) =>
                new TableRow({
                  children: row.map((value) =>
                    cell(para(text(cellText(value), { size: 18, bold: ri === 0 })), { fill: ri === 0 ? "F6F8FA" : undefined })
                  ),
                })
              )
            )
          );
          children.push(spacer(80));
        }
        continue;
      }

      const bits = [];
      if (block?.time) bits.push(text(`${fmtTimeRange(block.time, block.endTime)}  `, { size: 18, color: BRAND, bold: true }));
      bits.push(text(block?.text || "(no text)", { size: 20 }));
      if (block?.status) bits.push(text(`   [${block.status === "done" ? "Complete" : "Pending"}]`, { size: 17, color: block.status === "done" ? DONE : MUTED, bold: true }));
      if (block?.projectId && projectsById.get(block.projectId)) {
        bits.push(text(`   (${projectsById.get(block.projectId).name})`, { size: 17, color: MUTED }));
      }
      children.push(para(bits, { bullet: 1, after: 30 }));

      if (block?.notes) children.push(para(text(block.notes, { size: 18, italics: true, color: MUTED }), { indent: 720, after: 30 }));
      for (const link of block?.links || []) {
        children.push(para([
          text(`${link.label || "Link"}: `, { size: 17, bold: true }),
          text(link.url, { size: 17, color: BRAND }),
        ], { indent: 720, after: 20 }));
      }
    }

    for (const c of log.comments) {
      children.push(
        para([
          text(`${c.authorName || "Unknown"} `, { bold: true, size: 17 }),
          text(`· ${fmtTimestamp(c.createdAt)}: `, { size: 16, color: MUTED }),
          text(c.body, { size: 18 }),
        ], { indent: 720, after: 30 })
      );
    }
  }
  return children;
}

// What this person completed, as a list rather than a number — the answer to
// "what has actually been done", with when it was due, when it was finished,
// and whether that was on time.
function completedRegister(member, st, projectsById) {
  const children = [heading("What has been completed", 2)];
  if (!st.done.length) {
    children.push(para(text("Nothing completed in this period.", { italics: true, color: MUTED })));
    return children;
  }

  const done = [...st.done].sort((a, b) => {
    const av = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bv = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bv - av; // most recently finished first
  });

  const rows = [
    new TableRow({
      children: [th("#", 6), th("Activity", 42), th("Project", 20), th("Was due", 13), th("Completed", 13), th("Timing", 16)],
      tableHeader: true,
    }),
  ];
  done.forEach((task, i) => {
    const timing = completionTiming(task);
    rows.push(
      new TableRow({
        children: [
          cell(para(text(String(i + 1), { size: 17, color: MUTED })), { width: 6 }),
          cell([
            para(text(task.title, { size: 18 }), { after: 0 }),
            ...(task.subtasks.length
              ? [para(text(`${task.subtasks.filter((x) => x.done).length}/${task.subtasks.length} subtasks ticked`, { size: 15, color: MUTED }), { after: 0 })]
              : []),
          ], { width: 42 }),
          cell(para(text(projectsById.get(task.projectId)?.name || "—", { size: 17 })), { width: 20 }),
          cell(para(text(fmtDate(task.due), { size: 17 })), { width: 13 }),
          cell(para(text(timing?.doneOn ? fmtDate(timing.doneOn) : "—", { size: 17 })), { width: 13 }),
          cell(para(text(timing?.label || "—", { size: 17, color: timing && timing.late > 0 ? PARTIAL : DONE })), { width: 16 }),
        ],
      })
    );
  });
  children.push(table(rows));
  children.push(para(
    text(`${st.done.length} completed — ${st.onTime} on or before the date, ${st.completedLate} late.`, { size: 16, bold: true }),
    { before: 70, after: 140 }
  ));
  return children;
}

// What this person is late on, worst first.
function memberOverdueRegister(st, projectsById) {
  const children = [heading("What is overdue", 2)];
  if (!st.late.length) {
    children.push(para(text("Nothing overdue — everything open is still within its date.", { italics: true, color: DONE }), { after: 140 }));
    return children;
  }
  const late = st.late
    .map((t) => ({ task: t, days: overdueDays(t) }))
    .sort((a, b) => b.days - a.days);

  const rows = [
    new TableRow({
      children: [th("Days late", 12), th("Activity", 48), th("Project", 22), th("Was due", 18)],
      tableHeader: true,
    }),
  ];
  for (const { task, days } of late) {
    rows.push(
      new TableRow({
        children: [
          cell(para(text(String(days), { bold: true, size: 19, color: OVERDUE })), { width: 12 }),
          cell([
            para(text(task.title, { size: 18 }), { after: 0 }),
            para(text(`${STATUS_LABEL[task.status] || task.status} · ${PRIORITY_LABEL[task.priority] || task.priority || "—"}`, { size: 15, color: MUTED }), { after: 0 }),
          ], { width: 48 }),
          cell(para(text(projectsById.get(task.projectId)?.name || "—", { size: 17 })), { width: 22 }),
          cell(para(text(fmtDate(task.due), { size: 17 })), { width: 18 }),
        ],
      })
    );
  }
  children.push(table(rows));
  children.push(para(
    text(`${st.late.length} overdue, ${plural(st.totalOverdueDays, "day")} late in total. Longest: ${plural(st.worstOverdue, "day")}.`, { size: 16, bold: true, color: OVERDUE }),
    { before: 70, after: 140 }
  ));
  return children;
}

function memberSection(member, data) {
  const { projects, activityLogs } = data;
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const st = memberStats(member, data);
  const mine = st.mine;
  const children = [
    new Paragraph({ children: [new PageBreak()] }),
    heading(member.name, 1, BRAND),
    para(
      text(
        `${member.title || ""}${member.title ? " · " : ""}${member.role} · ${member.email}`,
        { size: 18, color: MUTED }
      ),
      { after: 60 }
    ),
  ];

  // A scorecard rather than a sentence: the same figures the summary table
  // holds, repeated here so a single person's section stands on its own when
  // it is printed or forwarded by itself.
  const scoreRow = (label, value, color) =>
    new TableRow({
      children: [
        cell(para(text(label, { size: 16, color: MUTED }), { after: 0 }), { width: 50, fill: "F6F8FA" }),
        cell(para(text(value, { size: 18, bold: true, color }), { after: 0 }), { width: 50 }),
      ],
    });
  children.push(table([
    scoreRow("Activities in scope", String(mine.length)),
    scoreRow("Completed", `${st.done.length}  (${st.completionRate}%)`, DONE),
    scoreRow("Completed on or before the date", String(st.onTime), DONE),
    scoreRow("Completed late", String(st.completedLate), st.completedLate ? PARTIAL : INK),
    scoreRow("Still open", String(st.open.length)),
    scoreRow("Overdue", String(st.late.length), st.late.length ? OVERDUE : INK),
    scoreRow("Longest overdue", st.worstOverdue ? plural(st.worstOverdue, "day") : "—", st.worstOverdue ? OVERDUE : MUTED),
    scoreRow("Total days overdue across all activities", st.totalOverdueDays ? plural(st.totalOverdueDays, "day") : "—", st.totalOverdueDays ? OVERDUE : MUTED),
    scoreRow("Projects involved in", String(st.projects)),
    scoreRow("Day-book entries", `${st.logs.length} days, ${plural(st.loggedBlocks, "entry").replace("entrys", "entries")}`),
  ]));
  children.push(spacer(160));

  children.push(...completedRegister(member, st, projectsById));
  children.push(...memberOverdueRegister(st, projectsById));
  children.push(heading("Every activity in full, project by project", 2));

  // Project-wise, which is how the department reads its own work. Projects
  // this member has nothing in are skipped rather than printed empty.
  for (const project of projects) {
    const inProject = mine.filter((t) => t.projectId === project.id);
    if (!inProject.length) continue;
    children.push(heading(`Project: ${project.name}`, 2));
    const meta = [
      project.leadName ? `Lead: ${project.leadName}` : null,
      project.startDate ? `Start: ${fmtDate(project.startDate)}` : null,
      project.deadline ? `Deadline: ${fmtDate(project.deadline)}` : null,
      project.completedAt ? "Project completed" : null,
      `${inProject.length} activities`,
    ].filter(Boolean).join("  ·  ");
    children.push(para(text(meta, { size: 17, color: MUTED }), { after: 120 }));
    if (project.description) children.push(para(text(project.description, { size: 18, italics: true, color: MUTED }), { after: 120 }));
    for (const task of inProject) children.push(...activityBlock(task));
  }

  // An activity whose project has since been deleted still belongs in the
  // record — without this it would silently vanish from the report.
  const orphans = mine.filter((t) => !projectsById.has(t.projectId));
  if (orphans.length) {
    children.push(heading("Activities outside the projects listed", 2));
    for (const task of orphans) children.push(...activityBlock(task));
  }

  if (!mine.length) children.push(para(text("No activities recorded in this period.", { italics: true, color: MUTED })));

  children.push(...loggedActivitiesBlock(activityLogs.filter((l) => l.userId === member.id), projectsById));
  return children;
}

function referenceBlock(data) {
  const { projects, documents, projectLinks } = data;
  if (!documents.length && !projectLinks.length) return [];
  const children = [new Paragraph({ children: [new PageBreak()] }), heading("Project reference material", 1, BRAND)];
  for (const project of projects) {
    const docs = documents.filter((d) => d.projectId === project.id);
    const links = projectLinks.filter((l) => l.projectId === project.id);
    if (!docs.length && !links.length) continue;
    children.push(heading(project.name, 2));
    for (const d of docs) {
      children.push(para(text(`${d.fileName} (${fmtSize(d.sizeBytes)}) — ${d.uploaderName || "unknown"}, ${fmtTimestamp(d.createdAt)}`, { size: 18 }), { bullet: 1, after: 20 }));
    }
    for (const l of links) {
      children.push(para([
        text(`${l.label || "Link"}: `, { size: 18, bold: true }),
        text(l.url, { size: 17, color: BRAND }),
        text(`  — ${l.adderName || "unknown"}`, { size: 16, color: MUTED }),
      ], { bullet: 1, after: 20 }));
    }
  }
  return children;
}

/* ------------------------------- document ------------------------------- */

// One malformed record must never cost the whole report. Each section is
// rendered inside this guard: if it throws, the document says so in place,
// names the person, and carries on — an 80-page record with one visible gap
// beats a 500 and nothing at all, and the gap tells us exactly where to look.
function guard(label, build) {
  try {
    return build();
  } catch (err) {
    console.error(`[report] failed to render ${label}:`, err);
    return [
      heading(label, 2),
      para(text(`This section could not be rendered (${err.message}). Everything else in this report is complete.`, { italics: true, color: OVERDUE })),
    ];
  }
}

async function buildTeamReportDocx(data, generatedBy) {
  const children = [
    ...guard("Cover", () => coverBlock(data, generatedBy)),
    ...guard("Summary", () => summaryBlock(data)),
  ];
  for (const member of data.members) {
    children.push(...guard(member.name || "Team member", () => memberSection(member, data)));
  }
  children.push(...guard("Project reference material", () => referenceBlock(data)));

  const logoRun = fs.existsSync(LOGO_PATH)
    ? new ImageRun({ type: "png", data: fs.readFileSync(LOGO_PATH), transformation: { width: 18, height: 18 } })
    : null;

  const doc = new Document({
    creator: "PMDAMC",
    title: "DAMC Team Work Report",
    description: "Generated from PMDAMC",
    styles: { default: { document: { run: { font: "Calibri", size: 20, color: INK } } } },
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  ...(logoRun ? [logoRun, new TextRun({ text: "  " })] : []),
                  new TextRun({ text: "DAMC · Team Work Report", font: "Calibri", size: 16, color: MUTED }),
                ],
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", font: "Calibri", size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 16, color: MUTED }),
                  new TextRun({ text: " of ", font: "Calibri", size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// Safe for a Content-Disposition header and for Windows filenames.
function reportFileName(data) {
  const who = data.scope.userId ? (data.members[0]?.name || "member") : "All-team";
  const what = data.scope.projectId ? (data.projects[0]?.name || "project") : "All-projects";
  const slug = (value) => String(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `DAMC-Report_${slug(who)}_${slug(what)}_${todayIso()}.docx`;
}

module.exports = { buildTeamReportDocx, reportFileName };