#!/usr/bin/env node
/**
 * Creates the system's Super Admin account, or promotes an existing account.
 *
 *   npm run create-superadmin -- --email chief@damc.gov.bt --name "Sangay Thinley"
 *   npm run create-superadmin -- --email chief@damc.gov.bt --name "Sangay Thinley" --password "…"
 *
 * - New email: creates the account. Without --password a strong password is
 *   generated and printed ONCE; sign in with it and change it.
 * - Existing email: makes that account Super Admin. Its password is left
 *   alone unless --password or --reset-password is given.
 * - Safe to run again: running it twice changes nothing the second time.
 *
 * Works against whatever DATABASE_URL points at (backend/.env locally, or
 * the Render/Supabase environment when run from the Render shell).
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("./pool");
const { getUserByEmail, createUser, updateUserPassword, setSuperAdmin, getWorkspacesForUser } = require("./db");
const { formatName } = require("./utils/names");
const { generatePassword } = require("./routes/superadmin.routes");

function args() {
  const out = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    const key = list[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) out[name] = true;
    else { out[name] = next; i++; }
  }
  return out;
}

async function main() {
  const a = args();
  const email = typeof a.email === "string" ? a.email.trim().toLowerCase() : "";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    console.error('Usage: npm run create-superadmin -- --email you@example.com --name "Your Name" [--password "…"] [--reset-password]');
    process.exit(1);
  }
  if (typeof a.password === "string" && a.password.length < 8) {
    console.error("The password must be at least 8 characters.");
    process.exit(1);
  }

  let user = await getUserByEmail(email);
  let printedPassword = null;

  if (!user) {
    const name = formatName(typeof a.name === "string" ? a.name : "");
    if (!name) {
      console.error('No account with that email yet, so a name is needed: --name "Full Name"');
      process.exit(1);
    }
    const plain = typeof a.password === "string" ? a.password : generatePassword();
    user = await createUser({ name, email, passwordHash: bcrypt.hashSync(plain, 10), defaultTitle: "Super Admin" });
    if (typeof a.password !== "string") printedPassword = plain;
    console.log(`✅ Created account ${email} (${name}).`);
  } else {
    console.log(`ℹ️  ${email} already has an account (${user.name}).`);
    if (typeof a.password === "string" || a["reset-password"]) {
      const plain = typeof a.password === "string" ? a.password : generatePassword();
      await updateUserPassword(user.id, bcrypt.hashSync(plain, 10));
      if (typeof a.password !== "string") printedPassword = plain;
      console.log("🔑 Password changed — any existing sessions for this account are signed out.");
    }
  }

  if (!user.isPlatformAdmin) {
    await setSuperAdmin(user.id, true);
    console.log(`👑 ${email} is now a Super Admin.`);
  } else {
    console.log(`👑 ${email} was already a Super Admin — nothing to change.`);
  }

  const workspaces = await getWorkspacesForUser(user.id, { includeAll: true });
  console.log(`   Access: every workspace (${workspaces.length} today), as admin, plus the Super Admin page.`);
  if (printedPassword) {
    console.log("\n   Sign in with:");
    console.log(`     Email:    ${email}`);
    console.log(`     Password: ${printedPassword}`);
    console.log("\n   This password is shown only now. Change it after signing in (profile → password).");
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("❌ Could not create the Super Admin:", err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
