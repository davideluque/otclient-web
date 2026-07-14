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

describe('close button + compact scroll', () => {
  it('renders a ✕ that fires onClose', () => {
    let closed = 0;
    const pane = createSkillPane(document.body, { onClose: () => { closed++; } });
    const btn = document.querySelector('.skill-pane [aria-label="Close skills"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(closed).toBe(1);
    pane.destroy();
  });

  it('scrolls its content inside a capped pane — stats and skills together', () => {
    const pane = createSkillPane(document.body);
    const scroll = document.querySelector('.skill-pane .skill-scroll') as HTMLElement;
    expect(scroll).toBeTruthy();
    // The character block AND the skill rows live inside the scroller.
    expect(scroll.querySelector('[data-role="level"]')).toBeTruthy();
    expect(scroll.querySelectorAll('.skill').length).toBeGreaterThan(4);
    const css = document.getElementById('skill-pane-style')?.textContent ?? '';
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('max-height');
    pane.destroy();
  });

  it('setVisible(true) restores the stylesheet display — inline block broke the flex clip', () => {
    const pane = createSkillPane(document.body);
    pane.setVisible(false);
    expect(pane.el.style.display).toBe('none');
    pane.setVisible(true);
    expect(pane.el.style.display).toBe('');
    pane.destroy();
  });
});
