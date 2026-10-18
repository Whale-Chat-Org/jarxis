'use client';

import { useAuth } from '@better-auth-ui/react';

type PluginAuthButtonsProps = {
  view: 'signIn' | 'signUp';
};

/** Extra sign-in methods (passkey, magic link, …) contributed by registered plugins. */
export function PluginAuthButtons({ view }: PluginAuthButtonsProps) {
  const { plugins } = useAuth();

  return plugins.flatMap((plugin) =>
    (plugin.authButtons ?? []).map((AuthButton, index) => (
      <AuthButton key={`${plugin.id}-${index.toString()}`} view={view} />
    )),
  );
}
