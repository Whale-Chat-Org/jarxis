import { createAuthPlugin } from '@better-auth-ui/core';
import {
  type AdminPluginOptions,
  adminPlugin as coreAdminPlugin,
} from '@better-auth-ui/core/plugins/admin';

import { StopImpersonating } from '@/components/admin/users/action-panel/shared/stop-impersonating';

export const adminPlugin = createAuthPlugin(
  coreAdminPlugin.id,
  (options: AdminPluginOptions = {}) => ({
    ...coreAdminPlugin(options),
    userMenuItems: [StopImpersonating],
  }),
);
