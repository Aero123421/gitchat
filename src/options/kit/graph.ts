// Compact commit graph for the popup: same reading order as the chat and the widgets —
// oldest at the top, newest at the bottom, the uncommitted ring last, and a dotted "origin" hairline
// (everything above it is on GitHub).

import type { ChatStatus } from '../../shared/types';
import { fmtAgo } from '../../content/ui/core/format.js';
import { s } from './dom';

const ROW = 22;
const X = 9;
const MAX = 5;

export function renderGraph(status: ChatStatus, width: number): SVGSVGElement {
  const newestFirst = status.commits.slice(0, MAX);
  const visible = [...newestFirst].reverse();
  const hasTail = status.commits.length > MAX;
  type Row = { kind: 'commit'; n: number; t: number; pushed: boolean } | { kind: 'work'; n: number };
  const rows: Row[] = visible.map((c) => ({ kind: 'commit', n: c.n, t: c.t, pushed: c.pushed }));
  if (status.tracked) rows.push({ kind: 'work', n: status.staged.length });

  const top = hasTail ? 18 : 9;
  const y = (i: number) => top + i * ROW;
  const height = rows.length ? y(rows.length - 1) + 10 : 20;
  const svg = s('svg', {
    class: `graph${status.phase === 'pushing' ? ' sending' : ''}${status.phase === 'error' ? ' err' : ''}`,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
  });

  const commitIdx = rows.map((r, i) => (r.kind === 'commit' ? i : -1)).filter((i) => i >= 0);
  const first = commitIdx[0];
  const last = commitIdx[commitIdx.length - 1];
  const firstAhead = rows.findIndex((r) => r.kind === 'commit' && !r.pushed);
  const anyPushed = status.commits.some((c) => c.pushed);
  const originRow = firstAhead === -1 ? rows.length - (status.tracked ? 1 : 0) : firstAhead;
  const oy = y(originRow - 0.5);

  if (first !== undefined && last !== undefined) {
    const fy = y(first);
    const ly = y(last);
    if (hasTail) svg.append(s('path', { class: 'ln tail', d: `M${X} ${fy - 15}V${fy - 6}` }));
    const pEnd = anyPushed ? Math.min(oy, ly) : fy;
    if (pEnd > fy) svg.append(s('path', { class: 'ln pushed', d: `M${X} ${fy}V${pEnd}` }));
    const aStart = anyPushed ? Math.max(oy, fy) : fy;
    if (ly > aStart) svg.append(s('path', { class: 'ln ahead', d: `M${X} ${aStart}V${ly}` }));
    if (status.tracked) svg.append(s('path', { class: 'ln work', d: `M${X} ${ly + 3.5}V${y(rows.length - 1) - 5}` }));
  }
  if (anyPushed && rows.length) svg.append(s('line', { class: 'origin', x1: 0, x2: width, y1: oy, y2: oy }));

  rows.forEach((r, i) => {
    const g = s('g', { class: `row ${r.kind}${r.kind === 'commit' && !r.pushed ? ' ahead' : ''}`, transform: `translate(0 ${y(i)})` });
    g.style.animationDelay = `${i * 35}ms`;
    if (r.kind === 'work') {
      g.append(s('circle', { class: `wk${r.n ? '' : ' empty'}`, cx: X, r: 4.2 }));
      if (r.n) g.append(text(`+${r.n}`, X + 14, 'lab'));
    } else {
      g.append(s('circle', { class: 'dot', cx: X, r: 3.1 }));
      g.append(text(`+${r.n}`, X + 14, 'lab'));
      const ago = text(fmtAgo(r.t), width - 2, 'ago');
      g.append(ago);
    }
    svg.append(g);
  });
  return svg;
}

function text(str: string, x: number, cls: string): SVGTextElement {
  const el = s('text', { class: cls, x, y: 4 });
  el.textContent = str;
  return el;
}

/** Styles for the graph (inserted by the popup). */
export const graphCSS = `
.graph { display: block; overflow: visible; }
.graph .ln { fill: none; stroke-width: 1; }
.graph .ln.pushed { stroke: var(--ink-4); }
.graph .ln.ahead { stroke: var(--accent); }
.graph .ln.work, .graph .ln.tail { stroke: var(--ink-3); stroke-dasharray: 1.5 2.5; }
.graph .origin { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 1 2.5; }
.graph.sending .origin { stroke: var(--accent); }
.graph.err .origin { stroke: var(--err); }
.graph .row { animation: kit-fade .3s ease-out both; }
.graph .dot { fill: var(--dot); }
.graph .row.ahead .dot { fill: var(--accent); }
.graph .wk { fill: none; stroke: var(--ink); stroke-width: 1.2; }
.graph .wk.empty { stroke: var(--ink-3); }
.graph text { font: 500 11px/1 var(--mono); font-variant-numeric: tabular-nums; }
.graph .lab { fill: var(--ink); }
.graph .row:not(.ahead):not(.work) .lab { fill: var(--ink-2); }
.graph .ago { fill: var(--ink-3); text-anchor: end; }
`;
