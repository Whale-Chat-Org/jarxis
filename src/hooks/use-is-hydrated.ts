'use client';

import { useSyncExternalStore } from 'react';

/** Subscription for client-only values that never change after hydration. */
export const subscribeNoop = () => () => {};

/**
 * Returns `true` once the component is mounted on the client (hydrated) and
 * `false` while rendering on the server, so client-only reads (e.g.
 * `sessionStorage`) stay safe during SSR.
 *
 * @returns Whether the component has hydrated on the client.
 */
export function useIsHydrated() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
