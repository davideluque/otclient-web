// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createChangelogPane } from '../lib/changelogPane';
import { CHANGELOG } from '../lib/changelog';

afterEach(() => document.body.replaceChildren());

describe('createChangelogPane', () => {
  it('renders every entry grouped under date headers, newest first', () => {
    const entries = [
      { date: '2026-06-10', text: 'Fixed the thing.' },
      { date: '2026-06-10', text: 'Added the other thing.' },
      { date: '2026-06-09', text: 'Earlier work.' },
    ];
    const pane = createChangelogPane(entries);

    const dates = [...document.querySelectorAll('.changelog-date')].map((d) => d.textContent);
    expect(dates).toEqual(['2026-06-10', '2026-06-09']);
    const items = [...document.querySelectorAll('.changelog-item')].map((i) => i.textContent);
    expect(items).toEqual(['Fixed the thing.', 'Added the other thing.', 'Earlier work.']);

    pane.destroy();
    expect(document.querySelector('.changelog-pane')).toBeNull();
  });

  it('opens, closes via ✕ and backdrop, and toggles', () => {
    const pane = createChangelogPane([{ date: '2026-06-10', text: 'x' }]);
    const el = document.querySelector('.changelog-pane') as HTMLElement;

    expect(el.classList.contains('open')).toBe(false);
    pane.open();
    expect(el.classList.contains('open')).toBe(true);

    (document.querySelector('.changelog-head button') as HTMLButtonElement).click();
    expect(el.classList.contains('open')).toBe(false);

    pane.toggle();
    expect(el.classList.contains('open')).toBe(true);
    // Backdrop click (the pane element itself) closes…
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.classList.contains('open')).toBe(false);
    // …but a click inside the card does not.
    pane.open();
    (document.querySelector('.changelog-card') as HTMLElement).click();
    expect(el.classList.contains('open')).toBe(true);

    pane.destroy();
  });

  it('the shipped changelog data is well-formed', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.text.length).toBeGreaterThan(5);
    }
    // Newest first (dates non-increasing).
    const dates = CHANGELOG.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
