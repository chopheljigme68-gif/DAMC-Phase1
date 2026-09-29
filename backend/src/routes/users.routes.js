const express = require("express");
const fs = require("fs");
const path = require("path");
const { getUserById, updateUserAvatar, getUserAvatar, updateUserProfile } = require("../db");
const { authenticate } = require("../auth");
const { avatarUpload } = require("../utils/upload");
const { formatName } = require("../utils/names");

const router = express.Router();

// multer records the browser's declared type, but a file migrated off disk
// has only its name to go on.
const MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const mimeForPath = (p) => MIME_BY_EXT[path.extname(String(p)).toLowerCase()] || "image/png";

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, color: u.color, initials: u.initials,
  // hasAvatar covers both storage generations: bytes in the row (current) and
  // a file on disk (rows uploaded before photos moved into the database).
  isPlatformAdmin: !!u.isPlatformAdmin, avatarUrl: u.hasAvatar ? `/api/users/${u.id}/avatar` : null,
  defaultTitle: u.defaultTitle || null, createdAt: u.createdAt,
});

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

module.exports = router;