'use client';

import { useSyncExternalStore } from 'react';

// Viewport height (px) from which each team size fits the large layout without scrolling.
const ROOMY_MIN_HEIGHT = [480, 620, 820, 1000];
// From md up the site nav (h-16 + 1px border) sits above the scoring screen.
const NAV_HEIGHT = 65;

export function roomyLayoutQuery(teamSize: number): string {
  const height = ROOMY_MIN_HEIGHT[Math.min(Math.max(teamSize, 1), ROOMY_MIN_HEIGHT.length) - 1];
  return `(max-width: 767.98px) and (min-height: ${height}px), (min-width: 768px) and (min-height: ${height + NAV_HEIGHT}px)`;
}

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Whether the screen is tall enough for the large frame layout at this team size. */
export function useRoomyLayout(teamSize: number): boolean {
  const query = roomyLayoutQuery(teamSize);
  return useSyncExternalStore(
    (onChange) => {
      if (!hasMatchMedia()) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => hasMatchMedia() && window.matchMedia(query).matches,
    () => false
  );
}
