'use client';

import { useState, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AuthProvider } from '@/components/auth/auth-provider';
import { Toaster } from '@/components/ui/sonner';
import { authClient } from '@/lib/auth-client';
import { adminPlugin } from '@/lib/auth/admin-plugin';
import { themePlugin } from '@/lib/auth/theme-plugin';
import { adminRoles, defaultRole, roleNames } from '@/lib/permissions';

/**
 * Auth providers that need `next-themes` context.
 *
 * Must sit inside `<ThemeProvider>`: the Better Auth UI theme plugin stores the
 * `next-themes` hook itself (not a resolved value), so its slot components read the
 * live theme on every render. The plugin array is intentionally rebuilt each render —
 * memoizing the theme plugin would capture a stale `theme`.
 */
function AuthProviders({ queryClient, children }: PropsWithChildren<{ queryClient: QueryClient }>) {
  const router = useRouter();
  const plugins = [
    themePlugin({ useTheme }),
    // The administration UI plugin: `roles` fills the role picker, `defaultRole` matches the
    // server's deny-by-default role, and impersonation returns the operator to this page.
    adminPlugin({
      roles: roleNames,
      defaultRole,
      adminRoles,
      allowMultipleRoles: false,
      impersonationRedirectTo: '/admin',
    }),
  ];

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        authClient={authClient}
        redirectTo="/admin"
        navigate={({ to, replace }) => (replace ? router.replace(to) : router.push(to))}
        Link={Link}
        plugins={plugins}
        emailAndPassword={{
          requireEmailVerification: true,
          minPasswordLength: 12,
        }}
      >
        {children}
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export function Providers({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProviders queryClient={queryClient}>{children}</AuthProviders>
    </ThemeProvider>
  );
}
