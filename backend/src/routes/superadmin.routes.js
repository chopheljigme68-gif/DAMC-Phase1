const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
  getUserByEmail, getUserById, createUser, updateUserPassword,
  getAllUsersWithMemberships, countSuperAdmins, setSuperAdmin,
  getWorkspacesForUser, getWorkspaceById, getMembership, addWorkspaceMember, setWorkspaceMemberRole,
} = require("../db");
const { authenticate } = require("../auth");
const { requirePlatformAdmin } = require("../middleware/workspace");
const { broadcastMemberAdded } = require("../utils/notify");
const { formatName } = require("../utils/names");
const { publicUser } = require("../utils/publicUser");

/**
 * Super Admin — the system-wide administrator (users.is_platform_admin).
 *
 * A Super Admin can:
 *   - see and enter EVERY workspace as its admin (requireWorkspaceMember),
 *     without being added to it;
 *   - create workspaces (POST /workspaces);
 *   - create accounts, reset anyone's password, add people to workspaces,
 *     set their role there, and grant or remove Super Admin — all here.
 *
 * Every action is written to the server log with who did it.
 */
const router = express.Router();
router.use(authenticate, requirePlatformAdmin);

const ROLES = ["admin", "lead", "member"];
const audit = (req, what) => console.log(`[super-admin] ${req.user.email}: ${what}`);

// Readable but strong: 4 groups of 4 from an alphabet without look-alikes
// (no 0/O, 1/l/I), e.g. "k7Qm-Xp3r-W9fd-2HtB". ~95 bits.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePassword() {
  const bytes = crypto.randomBytes(16);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

const envSuperAdmins = () =>
  (process.env.PLATFORM_ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

// Everything the Super Admin page shows, in one request.
router.get("/overview", async (req, res, next) => {
  try {
    const [workspaces, users] = await Promise.all([
      getWorkspacesForUser(req.user.id, { includeAll: true }),
      getAllUsersWithMemberships(),
    ]);
    const env = envSuperAdmins();
    res.json({
      workspaces,
      users: users.map((u) => ({ ...u, superAdminFromEnv: env.includes(String(u.email).toLowerCase()) })),
    });
  } catch (err) { next(err); }
});

// Create an account directly — for staff who can't receive invite emails,
// or to set people up in bulk. Optionally adds them to a workspace with a role.
// If no password is given a strong one is generated and returned ONCE.
router.post("/users", async (req, res, next) => {
  try {
    const { name, email, password, workspaceId, role, title, superAdmin } = req.body || {};
    const cleanName = formatName(name || "");
    if (!cleanName) return res.status(400).json({ error: "Name is required" });
    if (cleanName.length > 80) return res.status(400).json({ error: "Name is too long" });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
    if (password && String(password).length < 8) return res.status(400).json({ error: "A password you set here must be at least 8 characters" });
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(", ")}` });
    if (await getUserByEmail(email)) return res.status(409).json({ error: "An account with this email already exists" });
    if (workspaceId && !(await getWorkspaceById(workspaceId))) return res.status(400).json({ error: "That workspace doesn't exist" });

    const plain = password ? String(password) : generatePassword();
    const user = await createUser({ name: cleanName, email: String(email).toLowerCase(), passwordHash: bcrypt.hashSync(plain, 10), defaultTitle: title?.trim() || null });
    if (superAdmin) await setSuperAdmin(user.id, true);
    if (workspaceId) {
      await addWorkspaceMember({ workspaceId, userId: user.id, title: title?.trim() || null });
      if (role && role !== "member") await setWorkspaceMemberRole(workspaceId, user.id, role);
      broadcastMemberAdded(workspaceId);
    }
    audit(req, `created account ${user.email}${superAdmin ? " (Super Admin)" : ""}${workspaceId ? ` in workspace ${workspaceId} as ${role || "member"}` : ""}`);
    res.status(201).json({
      user: publicUser(await getUserById(user.id)),
      // Only present when WE made the password up; shown to the Super Admin
      // once and never stored in readable form.
      temporaryPassword: password ? undefined : plain,
    });
  } catch (err) { next(err); }
});

// Reset someone's password. Signs out all their existing sessions (see
// password_changed_at in auth.js). Returns the new password ONCE.
router.post("/users/:userId/reset-password", async (req, res, next) => {
  try {
    const user = await getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: "No such account" });
    if (user.id === req.user.id) return res.status(400).json({ error: "Change your own password from your profile instead" });
    const plain = generatePassword();
    await updateUserPassword(user.id, bcrypt.hashSync(plain, 10));
    audit(req, `reset the password of ${user.email}`);
    res.json({ temporaryPassword: plain, email: user.email });
  } catch (err) { next(err); }
});

// Grant or remove Super Admin.
router.patch("/users/:userId/super-admin", async (req, res, next) => {
  try {
    const value = Boolean(req.body?.superAdmin);
    const user = await getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: "No such account" });
    if (!value) {
      if (user.isPlatformAdmin && (await countSuperAdmins()) <= 1) {
        return res.status(400).json({ error: "This is the only Super Admin. Make someone else Super Admin first." });
      }
      // The env allowlist re-grants it on every sign-in, so removing it here
      // would silently undo itself. Say so instead.
      if (envSuperAdmins().includes(user.email.toLowerCase())) {
        return res.status(400).json({ error: "This person is a Super Admin through PLATFORM_ADMIN_EMAILS on the server. Remove their email there first." });
      }
    }
    await setSuperAdmin(user.id, value);
    audit(req, `${value ? "granted" : "removed"} Super Admin ${value ? "to" : "from"} ${user.email}`);
    res.json({ ok: true, superAdmin: value });
  } catch (err) { next(err); }
});

// Add an existing account to a workspace, or change their role there.
router.put("/workspaces/:workspaceId/members/:userId", async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(", ")}` });
    if (!(await getWorkspaceById(req.params.workspaceId))) return res.status(404).json({ error: "Workspace not found" });
    const user = await getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: "No such account" });
    const existing = await getMembership(req.params.workspaceId, user.id);
    if (!existing) await addWorkspaceMember({ workspaceId: req.params.workspaceId, userId: user.id, title: user.defaultTitle || null });
    if (!existing || existing.role !== role) await setWorkspaceMemberRole(req.params.workspaceId, user.id, role);
    broadcastMemberAdded(req.params.workspaceId);
    audit(req, `${existing ? "set" : "added"} ${user.email} ${existing ? "to" : "as"} ${role} in workspace ${req.params.workspaceId}`);
    res.json({ ok: true, added: !existing });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.generatePassword = generatePassword;
