'use client';
import { createAuthClient } from 'better-auth/react';
import { adminClient } from 'better-auth/client/plugins';
/**
 * The admin client plugin exposes `authClient.admin.*`, which the Better Auth UI administration
 * components call (`listUsers`, `setRole`, `banUser`, `removeUser`, session revocation, …).
 */
export const authClient = createAuthClient({ plugins: [adminClient()] });
