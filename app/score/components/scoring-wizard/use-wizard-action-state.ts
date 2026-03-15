'use client';

import { useCallback, useState } from 'react';

interface ActionHandlers {
  isSaving: boolean;
  runAction: (action: () => Promise<void>) => Promise<void>;
}

export function useWizardActionState(): ActionHandlers {
  const [isSaving, setIsSaving] = useState(false);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setIsSaving(true);

    try {
      await action();
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    isSaving,
    runAction,
  };
}
