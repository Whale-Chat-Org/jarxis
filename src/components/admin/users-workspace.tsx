'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { AccessManager } from './access-manager';
import { AdminUsers } from '@/components/auth/admin/admin-users';

export type UsersWorkspaceProps = {
  /** The signed-in operator; passed through so their own row offers no role change. */
  currentUserId: string;
  /** Owner + `roles:assign`, decided on the server. The access tab still re-checks `user:set-role`. */
  canManageAccess: boolean;
};

/**
 * Two views of the same people, kept on one screen:
 *
 * - **Access** (default) is the project's own directory for reviewing and changing roles.
 * - **Accounts** is the unchanged Better Auth UI `AdminUsers` table, which owns creating
 *   accounts, editing profiles, passwords, bans and sessions.
 *
 * Each control is gated on the server by the signed-in role, so a viewer sees both tabs read-only.
 */
export function UsersWorkspace({ currentUserId, canManageAccess }: UsersWorkspaceProps) {
  return (
    <div className="flex flex-col gap-stack">
      <div className="flex flex-col gap-2xs">
        <h1 className="text-heading font-semibold tracking-tight">Users &amp; access</h1>
        <p className="text-body-sm text-muted-foreground">
          Choose who can view or manage administration.
        </p>
      </div>

      <Tabs defaultValue="access" className="gap-section">
        <TabsList>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="access">
          <AccessManager currentUserId={currentUserId} canManageAccess={canManageAccess} />
        </TabsContent>
        <TabsContent value="accounts">
          <AdminUsers />
        </TabsContent>
      </Tabs>
    </div>
  );
}
