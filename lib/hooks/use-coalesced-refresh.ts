import { useCallback, useEffect, useMemo, useRef } from 'react';

/** Wait this long after a change before refetching, so a burst of row changes is one read. */
export const REFRESH_COALESCE_MS = 150;

export interface CoalescedRefresh {
  /** Refetch soon. Calls within the coalescing window, or during a read, add up to one more read. */
  request: () => void;
  /** Refetch now (e.g. a refresh button), still never alongside another read. */
  refresh: () => void;
  /**
   * Discard the read in flight (its result must not be applied), e.g. because a save
   * returned fresher data. Changes seen during that read still get their follow-up.
   */
  invalidate: () => void;
}

interface RefreshState {
  active: AbortController | null;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  mounted: boolean;
}

/**
 * Coordinates refetches of one resource triggered by realtime changes: at most one
 * read runs at a time; changes that arrive during it cause exactly one follow-up read
 * once it settles; a read whose result is obsolete (invalidated, `key` changed, or
 * unmounted) is aborted. `load` must apply its result only while `signal` is not
 * aborted, and should pass `signal` to `fetch`.
 */
export function useCoalescedRefresh(
  load: (signal: AbortSignal) => Promise<void>,
  key: unknown,
  coalesceMs = REFRESH_COALESCE_MS
): CoalescedRefresh {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const stateRef = useRef<RefreshState>({ active: null, dirty: false, timer: null, mounted: false });

  const start = useCallback(function start() {
    const state = stateRef.current;
    if (!state.mounted) return;
    if (state.active) {
      state.dirty = true;
      return;
    }
    const controller = new AbortController();
    state.active = controller;
    void loadRef.current(controller.signal)
      .catch(() => {})
      .finally(() => {
        if (state.active === controller) state.active = null;
        if (state.active === null && state.dirty && state.mounted) {
          state.dirty = false;
          start();
        }
      });
  }, []);

  const request = useCallback(() => {
    const state = stateRef.current;
    if (!state.mounted || state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      start();
    }, coalesceMs);
  }, [coalesceMs, start]);

  const refresh = useCallback(() => {
    const state = stateRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    start();
  }, [start]);

  const invalidate = useCallback(() => {
    const state = stateRef.current;
    const active = state.active;
    if (!active) return;
    state.active = null;
    active.abort();
    if (state.dirty) {
      state.dirty = false;
      request();
    }
  }, [request]);

  // A new resource (or unmount) abandons everything pending for the previous one.
  useEffect(() => {
    const state = stateRef.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.dirty = false;
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.active?.abort();
      state.active = null;
    };
  }, [key]);

  return useMemo(() => ({ request, refresh, invalidate }), [request, refresh, invalidate]);
}

/** Whether `error` is the abort of a fetch the coordinator cancelled. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
