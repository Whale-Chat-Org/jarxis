'use client';
import { Monitor, ShieldAlertIcon, UserRound } from 'lucide-react';
import { useId, useState } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { AdminState } from '@/components/admin/admin-state';
import {
  useUserInspector,
  type UserInspectorProps,
} from '@/components/admin/users/action-panel/shared/user-inspector-state';
import { UserAvatar } from '@/components/header/user/user-avatar';
import { userProfileActions } from '@/lib/admin-user-panel-actions';
import { getAdminErrorMessage } from '@/lib/admin-user-utils';

import { UserDangerConfirmation } from '../confirm/user-danger-confirmation';
import { PasswordDialog } from '../edit/user-password-dialog';
import { UserInspectorActions } from '../view/user-inspector-actions';
import { UserProfileView } from '../view/user-profile-view';
import { UserSessionsView } from '../view/user-sessions-view';
export function UserInspector(props: UserInspectorProps) {
  const flow = useUserInspector(props);
  const {
    isSavingProfile,
    profileInFlight,
    open,
    onOpenChange,
    user,
    detail,
    config,
    sessionsPermission,
    contributedTabs,
  } = flow.panel;
  const { profileForm, updateUser, setRoleMutation } = flow.profile.fields;
  const [tab, setTab] = useState('overview');
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setTab('overview');
  }
  const formId = useId();
  return (
    <>
      <profileForm.AppForm>
        <profileForm.Subscribe
          selector={(value) => ({
            name: value.values.name,
            email: value.values.email,
            canSubmit: value.canSubmit,
            isSubmitting: value.isSubmitting,
          })}
        >
          {(value) => (
            <AdminActionPanel
              open={open}
              onOpenChange={onOpenChange}
              header={{
                title: user?.name ?? config.localization.userDetails,
                description: user?.email ?? config.localization.usersDescription,
                leading: user ? (
                  <UserAvatar className="size-4xl shrink-0" user={user} />
                ) : undefined,
                trailing: <UserInspectorActions state={flow.header} />,
              }}
              state={{
                loading: detail.isPending,
                pending: isSavingProfile || value.isSubmitting,
                pendingRef: profileInFlight,
                error:
                  tab === 'overview'
                    ? (getAdminErrorMessage(updateUser.error) ??
                      getAdminErrorMessage(setRoleMutation.error))
                    : undefined,
              }}
              actions={
                user && tab === 'overview'
                  ? userProfileActions(
                      flow.profile.footer,
                      formId,
                      value.name,
                      value.email,
                      value.canSubmit,
                    )
                  : [
                      {
                        id: 'close',
                        label: config.localization.cancel,
                        variant: 'outline',
                        onClick: () => onOpenChange(false),
                      },
                    ]
              }
              tabs={
                user
                  ? {
                      value: tab,
                      onValueChange: setTab,
                      items: [
                        {
                          value: 'overview',
                          label: config.localization.overview,
                          icon: <UserRound aria-hidden />,
                          content: <UserProfileView state={flow.profile} formId={formId} />,
                        },
                        {
                          value: 'sessions',
                          label: config.localization.sessions,
                          icon: <Monitor aria-hidden />,
                          disabled:
                            sessionsPermission.isPending || !sessionsPermission.data?.success,
                          content: <UserSessionsView state={flow.sessions} />,
                        },
                        ...contributedTabs.map((item) => {
                          const Component = item.component;
                          return {
                            value: item.value,
                            label: item.label,
                            content: <Component userId={user.id} />,
                          };
                        }),
                      ],
                    }
                  : undefined
              }
            >
              {!user && (
                <AdminState
                  icon={<ShieldAlertIcon />}
                  title={config.localization.loadUsersError}
                  description={config.localization.loadUsersErrorDescription}
                />
              )}
            </AdminActionPanel>
          )}
        </profileForm.Subscribe>
      </profileForm.AppForm>
      <PasswordDialog
        open={flow.password.passwordOpen}
        onOpenChange={flow.password.setPasswordOpen}
        userId={user?.id}
      />
      <UserDangerConfirmation state={flow.danger} />
    </>
  );
}
