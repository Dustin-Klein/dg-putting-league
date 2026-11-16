'use client';

import { useSyncExternalStore } from 'react';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from '@/lib/utils/safe-storage';

/** 'tap' picks 0–3 in one tap; 'david' (David scoring) counts putts with − / +. */
export type ScoringMode = 'tap' | 'david';

export const SCORING_MODE_KEY = 'scoring_mode';
const CHANGE_EVENT = 'scoring-mode-change';

// Reading window.localStorage itself throws when site data is blocked.
function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readMode(): ScoringMode {
  const storage = getStorage();
  return storage && safeStorageGet(storage, SCORING_MODE_KEY) === 'david' ? 'david' : 'tap';
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SCORING_MODE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function setScoringMode(mode: ScoringMode): void {
  const storage = getStorage();
  if (storage) {
    if (mode === 'david') safeStorageSet(storage, SCORING_MODE_KEY, 'david');
    else safeStorageRemove(storage, SCORING_MODE_KEY);
  }
  // The storage event only fires in other tabs.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The scoring input this device uses; remembered per device because scorers have no account. */
export function useScoringMode(): [ScoringMode, (mode: ScoringMode) => void] {
  const mode = useSyncExternalStore(subscribe, readMode, () => 'tap' as const);
  return [mode, setScoringMode];
}
