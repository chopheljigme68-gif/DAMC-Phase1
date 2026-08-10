const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  getUserByEmail, createUser, getUserById, updateUserPassword, ensurePlatformAdminFromEnv,
  createPasswordReset, getValidPasswordReset, consumePasswordReset,
  getPendingInvitesForEmail, acceptInvite,
} = require("../db");
const { authenticate } = require("../auth");
const { sendPasswordResetEmail } = require("../utils/mailer");

const router = express.Router();

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, color: u.color, initials: u.initials,
  isPlatformAdmin: !!u.isPlatformAdmin, avatarUrl: u.avatarPath ? `/api/users/${u.id}/avatar` : null,
  defaultTitle: u.defaultTitle || null, createdAt: u.createdAt,
});
const sign = (user) => jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, title } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Valid email is required" });
    if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    if (await getUserByEmail(email)) return res.status(409).json({ error: "An account with this email already exists" });

    const passwordHash = bcrypt.hashSync(password, 8);
    let user = await createUser({ name: name.trim(), email: email.toLowerCase(), passwordHash, defaultTitle: title?.trim() || null });
    user = await ensurePlatformAdminFromEnv(user);

    // Auto-accept any pending workspace invites sent to this email before they signed up.
    const invites = await getPendingInvitesForEmail(user.email);
    for (const invite of invites) await acceptInvite(invite.id, user.id);

    res.status(201).json({ token: sign(user), user: publicUser(user), joinedWorkspaces: invites.length });
  } catch (err) { next(err); }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    let user = await getUserByEmail(email || "");
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (!bcrypt.compareSync(password || "", user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    user = await ensurePlatformAdminFromEnv(user);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) { next(err); }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await ensurePlatformAdminFromEnv(req.user);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

// Always responds the same way whether or not the email exists, so this
// endpoint can't be used to enumerate registered accounts.
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body || {};
    const generic = { message: "If that email has an account, a reset link is on its way." };
    if (!email) return res.json(generic);

    const user = await getUserByEmail(email);
    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await createPasswordReset({ userId: user.id, tokenHash: hashToken(rawToken), expiresAt });

      const base = process.env.APP_URL || "http://localhost:5173";
      const resetUrl = `${base}/reset-password?token=${rawToken}`;
      await sendPasswordResetEmail({ to: user.email, resetUrl });
    }
    res.json(generic);
  } catch (err) { next(err); }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token) return res.status(400).json({ error: "Missing reset token" });
    if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const reset = await getValidPasswordReset(hashToken(token));
    if (!reset) return res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });

    const passwordHash = bcrypt.hashSync(password, 8);
    await updateUserPassword(reset.userId, passwordHash);
    await consumePasswordReset(reset.id);

    const user = await getUserById(reset.userId);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) { next(err); }
});

module.exports = router;
