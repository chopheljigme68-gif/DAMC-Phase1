const express = require("express");
const { getNotificationsForUser, markNotificationRead, markAllRead } = require("../db");
const { authenticate } = require("../auth");

const router = express.Router();

router.get("/", authenticate, async (req, res, next) => {
  try {
    res.json({ notifications: await getNotificationsForUser(req.user.id) });
  } catch (err) { next(err); }
});

router.patch("/:id/read", authenticate, async (req, res, next) => {
  try {
    const n = await markNotificationRead(req.params.id, req.user.id);
    if (!n) return res.status(404).json({ error: "Notification not found" });
    res.json({ notification: n });
  } catch (err) { next(err); }
});

router.patch("/read-all", authenticate, async (req, res, next) => {
  try {
    await markAllRead(req.user.id);
    res.json({ notifications: await getNotificationsForUser(req.user.id) });
  } catch (err) { next(err); }
});

module.exports = router;
