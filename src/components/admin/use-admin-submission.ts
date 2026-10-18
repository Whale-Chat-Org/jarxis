'use client';

import { useRef, useState } from 'react';

export function useAdminSubmission() {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  async function run<T>(
    action: () => Promise<T>,
    onError: (error: unknown) => void,
  ): Promise<T | undefined> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      return await action();
    } catch (error) {
      onError(error);
      return undefined;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return { pending, pendingRef, run };
}
