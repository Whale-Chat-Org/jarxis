/**
 * Human-readable vocabulary for the access screens.
 *
 * Everything here is derived from `src/lib/permissions.ts` — the single source of truth for roles
 * and grants — so the access directory, the change-role dialog and the role guide can never
 * disagree.
 * Pure functions only: no React, no client state, no network.
 */
import {
  flattenStatements,
  roleCatalog,
  roleNames,
  roleStatements,
  type RoleName,
} from '@/lib/permissions';
import { isBanActive } from '@/lib/user-status';

function isKnownRole(name: string): name is RoleName {
  return (roleNames as readonly string[]).includes(name);
}

/**
 * Split a stored `user.role` value while **keeping** names the application no longer declares.
 *
 * `parseRoles` in permissions.ts drops them on purpose (it resolves grants, and an unknown name
 * grants nothing). The UI still has to show them, so operators see exactly what is stored.
 */
export function splitRoleValue(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export type RoleDescription = {
  id: string;
  label: string;
  description: string;
  known: boolean;
};

const UNRECOGNISED_ROLE_DESCRIPTION =
  'This role is not declared in the application, so it grants no access at all.';

function describeRole(name: string): RoleDescription {
  if (isKnownRole(name)) {
    const entry = roleCatalog[name];
    return { id: name, known: true, label: entry.name, description: entry.description };
  }
  return { id: name, label: name, description: UNRECOGNISED_ROLE_DESCRIPTION, known: false };
}

export function describeRoles(names: readonly string[]): RoleDescription[] {
  return names.map(describeRole);
}

/** Every role the application declares, in escalation order, for pickers and the guide. */
export const roleOptions: readonly RoleDescription[] = roleNames.map((name) => describeRole(name));

/** Permission keys a single role grants. An undeclared name grants nothing (fail closed). */
function roleGrants(name: string): string[] {
  if (!isKnownRole(name)) return [];
  return flattenStatements({ statements: roleStatements[name] });
}

/** Union of the grants held by a set of role names. */
export function grantsForRoles(names: readonly string[]): Set<string> {
  return new Set(names.flatMap((name) => roleGrants(name)));
}

export type GuideCategory = {
  id: string;
  title: string;
  description: string;
  /** Answer for one role, read from that role's live grants rather than a hardcoded matrix. */
  summarise: (grants: ReadonlySet<string>) => string;
};

const NO = 'No';

/**
 * The comparison categories of the role guide. Every answer is read from the role's live grants,
 * so the guide can never drift from `roleStatements`.
 */
export const guideCategories: readonly GuideCategory[] = [
  {
    id: 'viewing',
    title: 'Viewing administration',
    description: 'Reading the overview, user list, role guide, permission catalog and audit log.',
    summarise: (grants) => (grants.has('dashboard:read') ? 'Yes, read-only screens' : NO),
  },
  {
    id: 'accounts',
    title: 'Managing accounts',
    description: 'Creating accounts, editing names and email addresses, banning and unbanning.',
    summarise: (grants) =>
      grants.has('user:update')
        ? 'Yes, including bans and passwords'
        : grants.has('dashboard:read')
          ? 'No, viewing only'
          : NO,
  },
  {
    id: 'sessions',
    title: 'Managing sessions',
    description: 'Listing a person’s sessions and signing them out.',
    summarise: (grants) =>
      grants.has('session:revoke')
        ? 'Yes, list and sign out'
        : grants.has('session:list')
          ? 'List only'
          : NO,
  },
  {
    id: 'assign',
    title: 'Assigning roles',
    description: 'Changing which role a person holds.',
    summarise: (grants) => (grants.has('user:set-role') ? 'Yes' : NO),
  },
  {
    id: 'delete',
    title: 'Deleting users',
    description: 'Permanently removing an account.',
    summarise: (grants) => (grants.has('user:delete') ? 'Yes' : NO),
  },
  {
    id: 'impersonation',
    title: 'Impersonation',
    description: 'Signing in as somebody else to reproduce what they see.',
    summarise: (grants) =>
      grants.has('user:impersonate-admins')
        ? 'Anyone, including administrators'
        : grants.has('user:impersonate')
          ? 'Regular users only'
          : NO,
  },
  {
    id: 'ml-providers',
    title: 'Managing ML providers',
    description: 'Connecting model providers and issuing gateway keys.',
    summarise: (grants) => (grants.has('providers:manage') ? 'Yes' : NO),
  },
];

/**
 * Normalise the admin plugin's ban fields (`banExpires` arrives as a string or a `Date`) and ask
 * {@link isBanActive} whether a ban is in force right now. A lapsed ban reads as not banned, so the
 * owner guard and the "what they can do today" summary agree with the server's active-user rule.
 */
export function isAccountBanned(user: {
  banned?: boolean | null;
  banExpires?: Date | string | null;
}) {
  const banExpires =
    typeof user.banExpires === 'string' ? new Date(user.banExpires) : (user.banExpires ?? null);
  return isBanActive({ banned: user.banned, banExpires });
}

/** The reason an owner assignment is refused up front: owners must be active and verified. */
export function ownerBlockedReason(user: {
  banned?: boolean | null;
  emailVerified?: boolean | null;
  banExpires?: Date | string | null;
}) {
  if (isAccountBanned(user))
    return 'An owner must be an active account, so a banned user cannot be an owner.';
  if (!user.emailVerified)
    return 'An owner must have a verified email address, so this user cannot be an owner yet.';
  return undefined;
}
