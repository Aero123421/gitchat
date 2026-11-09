// The gitchat creature as a still picture: the same frosted-glass bead as the on-page widget, with its
// eyes and two blue "unpushed" dots. Used by the settings page and the popup (createMark) and by
// scripts/icons.mjs for the extension icons. Returns SVG markup; no DOM needed.
//
// Two levels of detail:
// - 'full': the widget's own glass filter (shadow, edge, rim light, specular highlight). 48 px and up.
// - 'small': flat shapes tuned for 16–32 px, where the filter turns to mush: a tighter frame, bigger
//   eyes, one dot and a firmer edge.
//
// Colours are written as inline styles, so they can be concrete values (icons) or CSS variables
// (pages that follow the light/dark theme).

/** @typedef {{ body: string, edge: string, rim: string, shadow: string, ink: string, accent: string, hi?: string, lo?: string }} CreatureColors */

/** @type {Record<'light' | 'dark', CreatureColors>} */
export const CREATURE_COLORS = {
  light: { body: '#f3f3f6', edge: 'rgba(0,0,0,.17)', rim: 'rgba(255,255,255,.9)', shadow: 'rgba(0,0,0,.13)', ink: '#111113', accent: '#0a84ff', hi: '#ffffff', lo: '#e2e2e7' },
  dark: { body: '#3d3d43', edge: 'rgba(0,0,0,.55)', rim: 'rgba(255,255,255,.28)', shadow: 'rgba(0,0,0,.5)', ink: '#ececee', accent: '#0a84ff', hi: '#55555c', lo: '#303035' },
};

/** Colours that follow `--cr-*` CSS variables (set per theme by the page), falling back to light. */
export const CREATURE_VARS = /** @type {CreatureColors} */ (
  Object.fromEntries(Object.entries(CREATURE_COLORS.light).map(([k, v]) => [k, `var(--cr-${k}, ${v})`]))
);

let uid = 0;

/**
 * @param {{ colors?: CreatureColors, detail?: 'full' | 'small', size?: number, className?: string }} [opts]
 * @returns {string} an `<svg>` element. Its eyes are `.cr-face` (moved to look around) holding two
 *   `.cr-eye` rects (shortened to blink).
 */
export function creatureSVG(opts = {}) {
  const c = opts.colors ?? CREATURE_COLORS.light;
  const detail = opts.detail ?? 'full';
  const size = opts.size ?? 64;
  const id = `cr${++uid}`;
  const cls = opts.className ? ` class="${opts.className}"` : '';
  const face = (w, h, dx) =>
    `<g class="cr-face" transform="translate(32 27)">` +
    `<rect class="cr-eye" x="${-dx - w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${w / 2}" style="fill:${c.ink}"/>` +
    `<rect class="cr-eye" x="${dx - w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${w / 2}" style="fill:${c.ink}"/></g>`;
  const dot = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:${c.accent}"/>`;

  if (detail === 'small') {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg"${cls} viewBox="7 7 50 50" width="${size}" height="${size}" aria-hidden="true">` +
      `<defs><radialGradient id="${id}" cx=".34" cy=".26" r=".85">` +
      `<stop offset="0" style="stop-color:${c.hi ?? c.body}"/><stop offset=".6" style="stop-color:${c.body}"/><stop offset="1" style="stop-color:${c.lo ?? c.body}"/>` +
      `</radialGradient></defs>` +
      `<circle cx="32" cy="32" r="23.6" style="fill:url(#${id});stroke:${c.ink};stroke-opacity:.42;stroke-width:2.4"/>` +
      face(5.6, 12.5, 8.6) +
      dot(43, 44, 3.9) +
      `</svg>`
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${cls} viewBox="3 4 58 58" width="${size}" height="${size}" aria-hidden="true">` +
    `<defs><filter id="${id}" x="-28" y="-28" width="120" height="120" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="4.2" result="b"/>` +
    `<feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -8.5" result="g"/>` +
    `<feGaussianBlur in="g" stdDeviation="3" result="sh0"/><feOffset in="sh0" dy="3" result="sh1"/>` +
    `<feFlood style="flood-color:${c.shadow}"/><feComposite in2="sh1" operator="in" result="shadow"/>` +
    `<feComponentTransfer in="g" result="bodyA"><feFuncA type="linear" slope=".76"/></feComponentTransfer>` +
    `<feMorphology in="g" operator="dilate" radius=".7" result="dil"/><feComposite in="dil" in2="g" operator="out" result="edge"/>` +
    `<feFlood style="flood-color:${c.edge}"/><feComposite in2="edge" operator="in" result="edgeC"/>` +
    `<feMorphology in="g" operator="erode" radius="1.1" result="er"/><feComposite in="g" in2="er" operator="out" result="rim"/>` +
    `<feFlood style="flood-color:${c.rim}"/><feComposite in2="rim" operator="in" result="rimC"/>` +
    `<feGaussianBlur in="g" stdDeviation="2.4" result="gb"/>` +
    `<feSpecularLighting in="gb" surfaceScale="3.5" specularConstant=".85" specularExponent="32" lighting-color="#ffffff" result="sp"><fePointLight x="2" y="-46" z="140"/></feSpecularLighting>` +
    `<feComposite in="sp" in2="g" operator="in" result="spIn"/>` +
    `<feMerge><feMergeNode in="shadow"/><feMergeNode in="bodyA"/><feMergeNode in="edgeC"/><feMergeNode in="rimC"/><feMergeNode in="spIn"/></feMerge>` +
    `</filter></defs>` +
    `<g filter="url(#${id})"><ellipse cx="32" cy="32" rx="22.7" ry="23.3" style="fill:${c.body}"/></g>` +
    dot(38.6, 47.2, 1.85) +
    dot(42.6, 44.4, 1.85) +
    face(3.2, 7.6, 7.5) +
    `</svg>`
  );
}
