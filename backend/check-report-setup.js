#!/usr/bin/env node
/**
 * PMDAMC — Word report diagnostics.
 *
 *   node check-report-setup.js
 *       Static check: are the files, the package and the route mount in place?
 *
 *   node check-report-setup.js --live you@example.com yourpassword
 *       The one that actually matters: logs in to the RUNNING server exactly
 *       as the browser does, calls the report endpoint for every member, and
 *       prints the real status and the real response body for each.
 *
 * A 404 in the browser can mean four different things and the browser shows
 * none of them. This prints the server's own answer, so there is nothing left
 * to guess at.
 *
 * It only reads. It creates nothing and changes nothing.
 */
const fs = require("fs");
const path = require("path");

const here = __dirname;
const args = process.argv.slice(2);
const liveIndex = args.indexOf("--live");
const LIVE = liveIndex !== -1;
const EMAIL = LIVE ? args[liveIndex + 1] : null;
const PASSWORD = LIVE ? args[liveIndex + 2] : null;
const BASE = process.env.API_URL || "http://localhost:4000";

/* ----------------------------- static check ----------------------------- */

function staticCheck() {
  const problems = [];
  const ok = [];
  const check = (label, condition, fix) => (condition ? ok.push(label) : problems.push({ label, fix }));

  for (const rel of [
    "src/routes/reports.routes.js",
    "src/reports/reportData.js",
    "src/reports/teamReportDocx.js",
  ]) {
    check(rel, fs.existsSync(path.join(here, rel)), `Missing. Paste the file at backend/${rel} (create the folder if needed)`);
  }

  check(
    "assets/logo.png",
    fs.existsSync(path.join(here, "assets", "logo.png")),
    "Missing. Copy frontend/public/logo.png to backend/assets/logo.png (the report still builds, just without the logo)"
  );

  let docxInstalled = false;
  try { require.resolve("docx"); docxInstalled = true; } catch { /* not installed */ }
  check("docx package installed", docxInstalled, "Run: npm install   (in the backend folder)");

  const indexPath = path.join(here, "src", "index.js");
  const indexSrc = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  check(
    'src/index.js requires "./routes/reports.routes"',
    /require\(["']\.\/routes\/reports\.routes["']\)/.test(indexSrc),
    'Add near the other route requires:\n     const reportsRoutes = require("./routes/reports.routes");'
  );
  check(
    "src/index.js mounts /api/workspaces/:workspaceId/reports",
    /app\.use\(\s*["']\/api\/workspaces\/:workspaceId\/reports["']/.test(indexSrc),
    'Add next to the other app.use lines:\n     app.use("/api/workspaces/:workspaceId/reports", reportsRoutes);'
  );
  check(
    "cors() exposes Content-Disposition",
    /exposedHeaders/.test(indexSrc),
    'Change the cors(...) call to:\n     app.use(cors({ origin: CORS_ORIGIN, credentials: true, exposedHeaders: ["Content-Disposition"] }));\n     (Only affects the downloaded filename — it does not cause a 404.)'
  );

  console.log("\nPMDAMC — Word report setup check");
  console.log("=".repeat(64));
  for (const line of ok) console.log(`  OK      ${line}`);
  for (const p of problems) console.log(`  MISSING ${p.label}`);
  console.log("=".repeat(64));

  if (problems.length) {
    console.log("\nFix each item above:\n");
    for (const p of problems) console.log(`  ${p.label}\n     ${p.fix}\n`);
    console.log("Then restart the backend — a new route file is not picked up by a");
    console.log("running server, even under nodemon.\n");
  } else {
    console.log("\nAll files are in place on disk.");
  }
  return problems.length === 0;
}

/* ------------------------------ live check ------------------------------ */

async function readBody(res) {
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try { return JSON.stringify(await res.json()); } catch { return "(unreadable JSON)"; }
  }
  const text = await res.text();
  return text.slice(0, 300).replace(/\s+/g, " ");
}

async function liveCheck() {
  console.log("\nLive check against " + BASE);
  console.log("=".repeat(64));

  // 1. which build is answering
  let health;
  try {
    const res = await fetch(`${BASE}/api/health`);
    health = await res.json();
  } catch (err) {
    console.log(`  Cannot reach ${BASE} — is the backend running?  (${err.message})\n`);
    return false;
  }
  console.log(`  health            ${JSON.stringify(health)}`);
  if (!health.reports) {
    console.log("\n  This server does NOT have the report code. It is an older process.");
    console.log("  Windows:  taskkill /F /IM node.exe    then    npm run dev\n");
    return false;
  }

  // 2. does the route exist at all, before auth is even considered?
  const probe = await fetch(`${BASE}/api/workspaces/probe/reports/team.docx`);
  console.log(`  route probe       ${probe.status} ${probe.status === 404 ? "<-- route NOT mounted" : "(route exists)"}`);

  if (!EMAIL || !PASSWORD) {
    console.log("\n  Add your login to test a real report:");
    console.log("     node check-report-setup.js --live you@example.com yourpassword\n");
    return true;
  }

  // 3. log in exactly as the browser does
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    console.log(`  login             ${loginRes.status} ${await readBody(loginRes)}`);
    return false;
  }
  const { token, user } = await loginRes.json();
  console.log(`  login             OK as ${user?.name || EMAIL}`);
  const auth = { Authorization: `Bearer ${token}` };

  const { workspaces } = await (await fetch(`${BASE}/api/workspaces`, { headers: auth })).json();
  if (!workspaces?.length) { console.log("  No workspaces for this account."); return false; }
  const ws = workspaces[0];
  console.log(`  workspace         ${ws.name}  (${ws.id})`);

  const { members } = await (await fetch(`${BASE}/api/workspaces/${ws.id}/members`, { headers: auth })).json();
  console.log(`  members           ${members.length}`);

  // 4. the whole-team report
  console.log("\n  Report requests — status, size, and the server's own words:");
  const teamRes = await fetch(`${BASE}/api/workspaces/${ws.id}/reports/team.docx`, { headers: auth });
  console.log(`    all team        ${teamRes.status} ${teamRes.ok ? `${(await teamRes.arrayBuffer()).byteLength} bytes` : await readBody(teamRes)}`);

  // 5. one request per member — this is what finds a member the report
  //    cannot resolve while the Team page happily lists them
  for (const m of members) {
    const res = await fetch(`${BASE}/api/workspaces/${ws.id}/reports/team.docx?userId=${m.id}`, { headers: auth });
    const detail = res.ok ? `${(await res.arrayBuffer()).byteLength} bytes` : await readBody(res);
    console.log(`    ${String(m.name).padEnd(15).slice(0, 15)} ${res.status} ${detail}`);
  }

  console.log("\n" + "=".repeat(64));
  console.log("Send me these lines exactly as printed and I can fix the cause.\n");
  return true;
}

(async () => {
  const filesOk = staticCheck();
  if (LIVE) {
    await liveCheck();
  } else if (filesOk) {
    console.log("\nNow test the running server — this is the part that finds the real");
    console.log("problem:\n");
    console.log("   node check-report-setup.js --live you@example.com yourpassword\n");
  }
})();