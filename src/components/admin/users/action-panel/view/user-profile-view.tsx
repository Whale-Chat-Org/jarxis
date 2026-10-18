'use client';
import { UserAccountInformation } from '@/components/admin/users/action-panel/view/user-account-information';
import { UserSecurityActions } from '@/components/admin/users/action-panel/view/user-security-actions';
import { Separator } from '@/components/ui/separator';
import type { UserInspectorState } from '@/types/admin-users';

import { UserProfileForm } from '../edit/user-profile-form';
export function UserProfileView({
  state,
  formId,
}: {
  state: UserInspectorState['profile'];
  formId: string;
}) {
  if (!state.account.user) return null;
  return (
    <div className="flex flex-col gap-xl">
      <UserProfileForm state={state.fields} formId={formId} />
      <Separator />
      <UserAccountInformation state={state.account} />
      <Separator />
      <UserSecurityActions state={state.security} />
    </div>
  );
}
