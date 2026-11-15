// Web Storage can throw (private mode, blocked site data, quota), so every access is guarded.

export function safeStorageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unavailable
  }
}

export function safeStorageRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage unavailable
  }
}
