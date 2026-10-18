import { requireOwnerSession } from '@/lib/owner-session';
import 'server-only';

export function requireProviderOwner(
  req: Request,
  permission: 'providers:read' | 'providers:manage',
) {
  // Retain the rate bucket during rolling upgrades and for legacy API aliases.
  return requireOwnerSession(req, permission, 'ml-management');
}
