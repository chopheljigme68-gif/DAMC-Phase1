const jwt = require("jsonwebtoken");
const { getUserById } = require("./db");

// The one way a session token is made. `iatMs` is the issue time in
// MILLISECONDS: a JWT's own iat is whole seconds, so a session signed in
// during the same second as a password reset used to survive it.
const signToken = (user) => jwt.sign({ id: user.id, iatMs: Date.now() }, process.env.JWT_SECRET, { expiresIn: "30d" });

// A token issued before the password last changed is refused. Tokens from
// before iatMs existed fall back to second precision.
const isStale = (payload, user) => {
  if (!user.passwordChangedAt) return false;
  const changed = new Date(user.passwordChangedAt).getTime();
  return typeof payload.iatMs === "number" ? payload.iatMs < changed : payload.iat < Math.floor(changed / 1000);
};

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUserById(payload.id);
    if (!user) return res.status(401).json({ error: "User no longer exists" });
    // A token issued before the password last changed is no longer valid —
    // resetting someone's password must actually sign out the old sessions.
    if (isStale(payload, user)) return res.status(401).json({ error: "Your password was changed. Please sign in again." });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { authenticate, isStale, signToken };
