const express = require("express");
const fs = require("fs");
const path = require("path");
const { getUserById, updateUserAvatar, getUserAvatar, updateUserProfile, updateUserAppearance } = require("../db");
const { getIO } = require("../socket");
const { authenticate } = require("../auth");
const { avatarUpload } = require("../utils/upload");
const { formatName } = require("../utils/names");

const router = express.Router();

// multer records the browser's declared type, but a file migrated off disk
// has only its name to go on.
const MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const mimeForPath = (p) => MIME_BY_EXT[path.extname(String(p)).toLowerCase()] || "image/png";

const { publicUser } = require("../utils/publicUser");

// Any logged-in user can view another user's avatar — profile photos are
// low-sensitivity and this keeps <img> tags simple across the app (avatars
// show up in places the viewer may not share a workspace with the photo's
// owner, e.g. old notifications, so we don't gate this behind membership).
router.get("/:userId/avatar", authenticate, async (req, res, next) => {
  try {
    const avatar = await getUserAvatar(req.params.userId);
    if (!avatar) return res.status(404).json({ error: "User not found" });

    // Bytes held in the database — the normal case, and the one that
    // survives a redeploy.
    if (avatar.data) {
      res.setHeader("Content-Type", avatar.mime || "image/png");
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.end(avatar.data);
    }

    // Fallback for a photo uploaded before this moved into the database. If
    // the file is still there it is migrated into the row on the way past,
    // so the next restart can't lose it.
    if (avatar.path && fs.existsSync(avatar.path)) {
      try {
        const bytes = fs.readFileSync(avatar.path);
        await updateUserAvatar(req.params.userId, bytes, mimeForPath(avatar.path));
        res.setHeader("Content-Type", mimeForPath(avatar.path));
        return res.end(bytes);
      } catch (err) {
        console.error("[avatar] could not migrate", avatar.path, err.message);
      }
    }
    // "This person has no photo" is a normal answer, not a failure — 204,
    // not 404. A 404 here made the browser log a red console error for every
    // avatar on the page, which buried real errors.
    return res.status(204).end();
  } catch (err) { next(err); }
});

router.patch("/me", authenticate, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const cleanName = formatName(name || "");
    if (!cleanName) return res.status(400).json({ error: "Name is required" });
    if (cleanName.length > 120) return res.status(400).json({ error: "Keep the name under 120 characters" });
    const user = await updateUserProfile(req.user.id, { name: cleanName });
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

router.post("/me/avatar", authenticate, (req, res, next) => {
  avatarUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image was uploaded" });
    // Read the bytes straight back off the temporary upload and store them in
    // the row, then drop the file. Nothing on disk means nothing to lose when
    // the host wipes it.
    const bytes = fs.readFileSync(req.file.path);
    const user = await updateUserAvatar(req.user.id, bytes, req.file.mimetype || mimeForPath(req.file.path));
    fs.unlink(req.file.path, () => {});
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

// ---------------- personal appearance ----------------
// Theme and accent colour, per person. Lives on the account so it follows
// them to another computer and survives signing out; only ever read back by
// that same person.
const THEMES = ["system", "light", "warm", "dark"];
const ACCENT_PRESETS = ["damc", "blue", "indigo", "purple", "pink", "red", "orange", "yellow", "teal", "graphite"];
const isAccent = (v) => ACCENT_PRESETS.includes(v) || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v));
const TINTS = ["off", "subtle", "rich"];

router.patch("/me/appearance", authenticate, async (req, res, next) => {
  try {
    const { theme, accent, tint } = req.body || {};
    // undefined = leave it alone, null = back to "not chosen", anything else
    // must be a value we know how to paint. Custom colours are normalised to
    // lower case so the same colour never looks like two different choices.
    if (theme !== undefined && theme !== null && !THEMES.includes(theme)) {
      return res.status(400).json({ error: `Theme must be one of: ${THEMES.join(", ")}` });
    }
    if (accent !== undefined && accent !== null && !isAccent(accent)) {
      return res.status(400).json({ error: "Accent must be a preset colour or a #rrggbb value" });
    }
    if (tint !== undefined && tint !== null && !TINTS.includes(tint)) {
      return res.status(400).json({ error: `Tint must be one of: ${TINTS.join(", ")}` });
    }
    const user = await updateUserAppearance(req.user.id, {
      theme,
      accent: typeof accent === "string" && accent.startsWith("#") ? accent.toLowerCase() : accent,
      tint,
    });
    const body = publicUser(user);

    // Every OTHER open session of this person — another tab, the laptop at
    // home — repaints at once instead of on its next reload. Scoped to their
    // own user room, so nobody else ever receives it. The originating tab
    // names itself so it can ignore its own echo.
    try {
      getIO().to(`user:${req.user.id}`).emit("appearance:changed", {
        appearance: body.appearance,
        origin: typeof req.get("X-Client-Id") === "string" ? req.get("X-Client-Id").slice(0, 64) : null,
      });
    } catch {
      /* socket layer not up (tests) — the saved value is what matters */
    }
    res.json({ user: body });
  } catch (err) { next(err); }
});

module.exports = router;