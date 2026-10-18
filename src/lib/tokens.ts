import { db, type Transaction } from '@/db';
import type { TokenFamily } from '@prisma/client';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import 'server-only';
import { env } from './env';
import { HttpError } from './errors';
import { isActiveUser } from './user-status';
const invalid = () => new HttpError(401, 'INVALID_TOKEN', 'Token is invalid or expired');
export const tokenHash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const secret = () => new TextEncoder().encode(env().JWT_SECRET);
async function signAccessToken(userId: string, sessionId: string, familyId: string) {
  return new SignJWT({ sid: sessionId, fid: familyId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(env().BETTER_AUTH_URL)
    .setAudience('jarxis-api')
    .setIssuedAt()
    .setExpirationTime('10m')
    .setJti(randomUUID())
    .sign(secret());
}
async function persistTokenPair(tx: Transaction, family: TokenFamily) {
  const raw = randomBytes(48).toString('base64url');
  await tx.refreshToken.create({ data: { hash: tokenHash(raw), familyId: family.id } });
  return {
    accessToken: await signAccessToken(family.userId, family.sessionId, family.id),
    refreshToken: raw,
    tokenType: 'Bearer' as const,
    expiresIn: 600,
    refreshExpiresAt: family.expiresAt.toISOString(),
  };
}
export async function issueTokens(userId: string, sessionToken: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !isActiveUser(user)) throw invalid();
    const session = await tx.session.findFirst({
      where: { userId, token: sessionToken, expiresAt: { gt: new Date() } },
    });
    if (!session) throw invalid();
    const family = await tx.tokenFamily.create({
      data: {
        id: randomUUID(),
        userId,
        sessionId: session.id,
        expiresAt: new Date(Math.min(session.expiresAt.getTime(), Date.now() + 30 * 86400000)),
      },
    });
    return persistTokenPair(tx, family);
  });
}
export async function rotateTokens(raw: string) {
  // Resolve immutable ownership first; lock order is user -> family -> token everywhere.
  const known = await db.refreshToken.findUnique({
    where: { hash: tokenHash(raw) },
    include: { family: true },
  });
  if (!known) throw invalid();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${known.family.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: known.family.userId } });
    await tx.$queryRaw`SELECT id FROM token_families WHERE id = ${known.family.id} FOR UPDATE`;
    const family = await tx.tokenFamily.findUnique({ where: { id: known.family.id } });
    await tx.$queryRaw`SELECT hash FROM refresh_tokens WHERE hash = ${tokenHash(raw)} FOR UPDATE`;
    const token = await tx.refreshToken.findUnique({ where: { hash: tokenHash(raw) } });
    if (
      !family ||
      !token ||
      !user ||
      !isActiveUser(user) ||
      family.revokedAt ||
      family.expiresAt <= new Date()
    )
      return null;
    if (token.consumedAt) {
      await tx.tokenFamily.update({ where: { id: family.id }, data: { revokedAt: new Date() } });
      await tx.session.deleteMany({ where: { id: family.sessionId } });
      return null;
    }
    const session = await tx.session.findFirst({
      where: { id: family.sessionId, expiresAt: { gt: new Date() } },
    });
    if (!session) return null;
    await tx.refreshToken.update({ where: { hash: token.hash }, data: { consumedAt: new Date() } });
    return persistTokenPair(tx, family);
  });
  // Throw outside the transaction, so replay revocation is committed.
  if (!result) throw invalid();
  return result;
}
export async function verifyAccess(raw: string) {
  let payload;
  try {
    ({ payload } = await jwtVerify(raw, secret(), {
      algorithms: ['HS256'],
      issuer: env().BETTER_AUTH_URL,
      audience: 'jarxis-api',
      typ: 'JWT',
    }));
  } catch {
    throw invalid();
  }
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.sid !== 'string' ||
    typeof payload.fid !== 'string'
  )
    throw invalid();
  const family = await db.tokenFamily.findFirst({
    where: { id: payload.fid, userId: payload.sub, sessionId: payload.sid },
    include: { user: true },
  });
  const session = await db.session.findFirst({ where: { id: payload.sid, userId: payload.sub } });
  if (
    !family ||
    !session ||
    !isActiveUser(family.user) ||
    family.revokedAt ||
    family.expiresAt <= new Date() ||
    session.expiresAt <= new Date()
  )
    throw invalid();
  return { userId: family.user.id, sessionId: session.id, familyId: family.id };
}
export async function revokeFamily(userId: string, familyId: string) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM token_families WHERE id = ${familyId} AND user_id = ${userId} FOR UPDATE`;
    const family = await tx.tokenFamily.findFirst({ where: { id: familyId, userId } });
    if (!family) return;
    await tx.tokenFamily.update({ where: { id: family.id }, data: { revokedAt: new Date() } });
    await tx.session.deleteMany({ where: { id: family.sessionId } });
  });
}
