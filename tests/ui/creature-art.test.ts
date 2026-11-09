// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CREATURE_COLORS, CREATURE_VARS, creatureSVG } from '../../src/shared/creature-art.js';

const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;

describe('creature art', () => {
  it('draws the glass creature with two eyes and two unpushed dots', () => {
    const svg = parse(creatureSVG({ size: 128 }));
    expect(svg.getAttribute('width')).toBe('128');
    expect(svg.querySelectorAll('.cr-face .cr-eye')).toHaveLength(2);
    expect(svg.querySelectorAll('filter')).toHaveLength(1);
    expect(svg.querySelectorAll(`circle[style*="${CREATURE_COLORS.light.accent}"]`)).toHaveLength(2);
  });

  it('keeps small sizes simple: no filter, bigger eyes, one dot', () => {
    const svg = parse(creatureSVG({ size: 16, detail: 'small' }));
    expect(svg.querySelector('filter')).toBeNull();
    expect(Number(svg.querySelector('.cr-eye')!.getAttribute('width'))).toBeGreaterThan(5);
    expect(svg.querySelectorAll(`circle[style*="${CREATURE_COLORS.light.accent}"]`)).toHaveLength(1);
  });

  it('can follow the page theme through CSS variables', () => {
    const markup = creatureSVG({ colors: CREATURE_VARS });
    expect(markup).toContain('var(--cr-body, #f3f3f6)');
    expect(markup).toContain('var(--cr-ink, #111113)');
  });

  it('gives every drawing its own filter id', () => {
    const a = parse(creatureSVG()).querySelector('filter')!.id;
    const b = parse(creatureSVG()).querySelector('filter')!.id;
    expect(a).not.toBe(b);
  });
});
