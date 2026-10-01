/**
 * The shape of a user the API hands to THAT user (login, /auth/me, profile
 * and appearance updates). One definition, shared — there used to be two
 * copies, in auth.routes and users.routes, and they drifted: when profile
 * photos moved into the database one copy still looked for the old file path,
 * so /auth/me reported "no photo" for anyone who had uploaded one since.
 *
 * Never use this for OTHER people: it carries the person's private
 * appearance settings. Lists of colleagues come from getWorkspaceMembers.
 */
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  color: u.color,
  initials: u.initials,
  isPlatformAdmin: !!u.isPlatformAdmin,
  // hasAvatar covers both storage generations: bytes in the row (current)
  // and a file on disk (photos uploaded before they moved to the database).
  avatarUrl: u.hasAvatar ? `/api/users/${u.id}/avatar` : null,
  defaultTitle: u.defaultTitle || null,
  createdAt: u.createdAt,
  // null = never chosen. The client tells that apart from an explicit
  // choice so a device's existing theme is adopted on first sign-in rather
  // than overwritten with a default.
  appearance: {
    theme: u.themePreference || null,
    accent: u.accentColor || null,
    tint: u.accentTint || null,
  },
});

module.exports = { publicUser };