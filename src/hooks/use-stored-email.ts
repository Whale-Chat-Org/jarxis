'use client';

import { useSyncExternalStore } from 'react';

import { subscribeNoop } from '@/hooks/use-is-hydrated';

/**
 * Reads an email address a previous auth view stored in `sessionStorage`.
 * Returns `''` on the server and during hydration, so the markup matches.
 */
export function useStoredEmail(key: string) {
  return useSyncExternalStore(
    subscribeNoop,
    () => sessionStorage.getItem(key) ?? '',
    () => '',
  );
}
