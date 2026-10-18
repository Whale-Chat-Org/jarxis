'use client';

import { isPasswordCompromisedError } from '@better-auth-ui/core';
import { useCallback, useState } from 'react';

/**
 * Tracks a haveIBeenPwned rejection, which belongs against the password field
 * rather than in a toast. `flag` reads a mutation error; `clear` runs on edit.
 */
export function useCompromisedPassword() {
  const [isCompromised, setIsCompromised] = useState(false);
  const flag = useCallback(
    (error: unknown) => setIsCompromised(isPasswordCompromisedError(error)),
    [],
  );
  const clear = useCallback(() => setIsCompromised(false), []);

  return { isCompromised, flag, clear };
}
