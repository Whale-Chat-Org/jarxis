/**
 * Account status helpers shared by the session, token and page guards.
 *
 * The Better Auth admin plugin owns account status through the ban fields, so every place that
 * used to ask "is this account disabled?" now asks whether a ban is in force.
 */

/** A ban is in force until `banExpires` passes; a null `banExpires` is a permanent ban. */
export function isBanActive(
  user: { banned?: boolean | null; banExpires?: Date | null },
  now: Date = new Date(),
) {
  if (!user.banned) return false;
  return !user.banExpires || user.banExpires > now;
}

/** An account may act only when its email is verified and no ban is in force. */
export function isActiveUser(
  user: {
    banned?: boolean | null;
    banExpires?: Date | null;
    emailVerified?: boolean | null;
  },
  now: Date = new Date(),
) {
  return user.emailVerified === true && !isBanActive(user, now);
}
