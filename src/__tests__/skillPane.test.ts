// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createSkillPane } from '../lib/skillPane';

afterEach(() => document.body.replaceChildren());

describe('setStats — the character block', () => {
  it('renders level with the RED bar, xp, magic, capacity, soul', () => {
    const pane = createSkillPane(document.body);
    pane.setStats({
      level: 80, levelPercent: 35, experience: 85_316_000,
      magicLevel: 22, magicLevelPercent: 60, capacity: 2000, soul: 100,
    });
    const levelRow = document.querySelector('[data-role="level"]') as HTMLElement;
    expect(levelRow.querySelector('.lvl')?.textContent).toBe('80');
    const fill = levelRow.querySelector('.fill') as HTMLElement;
    expect(fill.classList.contains('level')).toBe(true); // the red bar
    expect(fill.style.width).toBe('35%');
    expect((document.querySelector('[data-role="exp"]') as HTMLElement).textContent)
      .toBe((85_316_000).toLocaleString());
    expect((document.querySelector('[data-role="cap"]') as HTMLElement).textContent).toBe('2000');
    expect((document.querySelector('[data-role="soul"]') as HTMLElement).textContent).toBe('100');
    pane.destroy();
  });

  it('still renders the seven skills below the divider', () => {
    const pane = createSkillPane(document.body);
    pane.setSkill('Sword', 45, 80);
    const rows = [...document.querySelectorAll('.skill-pane .skill .row span:first-child')]
      .map((s) => s.textContent);
    expect(rows).toContain('Sword');
    expect(rows).toContain('Level');
    pane.destroy();
  });
});
