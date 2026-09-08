const express = require("express");
const fs = require("fs");
const { getUserById, updateUserAvatar, updateUserProfile } = require("../db");
const { authenticate } = require("../auth");
const { avatarUpload } = require("../utils/upload");
const { formatName } = require("../utils/names");

const router = express.Router();

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, color: u.color, initials: u.initials,
  isPlatformAdmin: !!u.isPlatformAdmin, avatarUrl: u.avatarPath ? `/api/users/${u.id}/avatar` : null,
  defaultTitle: u.defaultTitle || null, createdAt: u.createdAt,
});

// Any logged-in user can view another user's avatar — profile photos are
// low-sensitivity and this keeps <img> tags simple across the app (avatars
// show up in places the viewer may not share a workspace with the photo's
// owner, e.g. old notifications, so we don't gate this behind membership).
router.get("/:userId/avatar", authenticate, async (req, res, next) => {
  try {
    const user = await getUserById(req.params.userId);
    if (!user || !user.avatarPath || !fs.existsSync(user.avatarPath)) {
      return res.status(404).json({ error: "No avatar set" });
    }
    res.setHeader("Content-Type", "image/*");
    fs.createReadStream(user.avatarPath).pipe(res);
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
    const user = await updateUserAvatar(req.user.id, req.file.path);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

module.exports = router;