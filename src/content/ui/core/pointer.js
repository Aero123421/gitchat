// Global pointer position (viewport coordinates), shared by every variant.

import { wake } from './spring.js';

export const pointer = { x: -1e4, y: -1e4, active: false };

/** The widgets live on the right edge; a cursor this close can affect them (gaze, light, hover). */
const NEAR = 640;
let wasNear = false;

addEventListener(
  'pointermove',
  (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    // full frame rate only while the cursor is near the widget (and once more as it leaves)
    const near = e.clientX > innerWidth - NEAR;
    if (near || wasNear) wake(700);
    wasNear = near;
  },
  { capture: true, passive: true },
);

// a settled widget draws nothing; a resize must still move it back into view
addEventListener('resize', () => wake(400), { passive: true });

document.documentElement.addEventListener('pointerleave', () => {
  pointer.active = false;
  pointer.x = pointer.y = -1e4;
  wake(700);
});
