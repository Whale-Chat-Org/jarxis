import { betterAuth, APIError } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { admin } from 'better-auth/plugins/admin';
import { openAPI } from 'better-auth/plugins';
import { db } from '@/db';
import { env } from './env';
import { sendMail } from './mailer';
import { ac, adminRoles, defaultRole } from './permissions';
import { liveAdminRoles } from './custom-roles';
import { isActiveUser } from './user-status';
import { adminAuditHook, adminMutationGuard, userStatusHooks } from './auth/admin-guards';
let instance: ReturnType<typeof makeAuth> | undefined;
function makeAuth() {
  const e = env();
  const send = (to: string, subject: string, url: string) =>
    sendMail({
      to,
      subject,
      text: `${subject}\n\n${url}\n\nIf you did not request this, you can ignore this message.`,
    });
  return betterAuth({
    appName: 'Jarxis',
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    disabledPaths: [
      '/sign-in/social',
      '/link-social',
      '/unlink-account',
      '/get-access-token',
      '/refresh-token',
      '/account-info',
    ],
    trustedOrigins: [new URL(e.BETTER_AUTH_URL).origin],
    database: prismaAdapter(db, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        send(user.email, 'Reset your Jarxis password', url),
      onPasswordReset: async ({ user }) => {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${user.id} FOR UPDATE`;
          await tx.tokenFamily.updateMany({
            where: { userId: user.id },
            data: { revokedAt: new Date() },
          });
          await tx.session.deleteMany({ where: { userId: user.id } });
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) =>
        send(user.email, 'Verify your Jarxis email', url),
    },
    // Account status is owned by the admin plugin (role/banned/banReason/banExpires).
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    hooks: {
      // Owner protection and the last-owner rule run before any admin mutation.
      before: adminMutationGuard,
      // Audit records are written once the mutation has committed.
      after: adminAuditHook,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (s) => {
            const u = await db.user.findUnique({ where: { id: s.userId } });
            if (!u || !isActiveUser(u))
              throw new APIError('FORBIDDEN', { message: 'Account unavailable' });
            return { data: s };
          },
        },
      },
      user: userStatusHooks,
    },
    advanced: {
      useSecureCookies: e.NODE_ENV === 'production',
      ipAddress: { ipAddressHeaders: e.TRUST_PROXY ? ['x-real-ip'] : [] },
    },
    // Atomic Redis limits are enforced by the HTTP wrapper and token login endpoint.
    rateLimit: { enabled: false },
    plugins: [
      openAPI({ disableDefaultReference: true }),
      admin({
        ac,
        roles: liveAdminRoles,
        defaultRole,
        adminRoles,
        impersonationSessionDuration: 60 * 60,
      }),
    ],
  });
}
export function getAuth() {
  return (instance ??= makeAuth());
}
