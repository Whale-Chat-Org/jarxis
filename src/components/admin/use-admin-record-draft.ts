'use client';

import { useState } from 'react';

export function useAdminRecordDraft<T>(initial: T) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  function initialize(value: T) {
    setBaseline(value);
    setDraft(value);
  }
  return {
    draft,
    setDraft,
    initialize,
    dirty: JSON.stringify(draft) !== JSON.stringify(baseline),
    reset: () => setDraft(baseline),
  };
}
