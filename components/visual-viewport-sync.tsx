'use client';

import { useEffect } from 'react';

const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/**
 * Mirrors the visual viewport (the part not covered by the on-screen keyboard) into
 * `--vvh` / `--vv-top` so fixed overlays can fit the visible area. iOS Safari and Chrome
 * on Android shrink only the visual viewport for the keyboard; `vh`/`dvh` and `fixed`
 * stay sized to the layout viewport, leaving centered dialogs half under the keyboard.
 */
export function VisualViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      // Pinch zoom also shrinks the visual viewport; overlays should not follow it.
      if (vv.scale > 1.01) {
        root.style.removeProperty('--vvh');
        root.style.removeProperty('--vv-top');
        return;
      }
      root.style.setProperty('--vvh', `${vv.height}px`);
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`);

      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches(FIELD_SELECTOR) && active.closest('[data-slot="dialog-content"]')) {
        active.scrollIntoView({ block: 'nearest' });
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vv-top');
    };
  }, []);

  return null;
}
