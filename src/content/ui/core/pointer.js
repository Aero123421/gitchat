// Global pointer position (viewport coordinates), shared by every variant.

export const pointer = { x: -1e4, y: -1e4, active: false };

addEventListener(
  'pointermove',
  (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  },
  { capture: true, passive: true },
);

document.documentElement.addEventListener('pointerleave', () => {
  pointer.active = false;
  pointer.x = pointer.y = -1e4;
});
