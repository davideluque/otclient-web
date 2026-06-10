// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createSettingsPane } from '../lib/settingsPane';

afterEach(() => document.body.replaceChildren());

function sw(label: string): HTMLButtonElement {
  return document.querySelector(`.settings-switch[aria-label="${label}"]`) as HTMLButtonElement;
}

describe('createSettingsPane', () => {
  it('clicking a switch writes through set() and re-reads get()', () => {
    let on = false;
    const pane = createSettingsPane([
      { label: 'Auto-attack', get: () => on, set: (v) => { on = v; } },
    ]);
    pane.open();
    expect(sw('Auto-attack').getAttribute('aria-checked')).toBe('false');

    sw('Auto-attack').click();
    expect(on).toBe(true);
    expect(sw('Auto-attack').getAttribute('aria-checked')).toBe('true');
    pane.destroy();
  });

  it('a set() that refuses keeps the switch honest', () => {
    const pane = createSettingsPane([
      { label: 'Stubborn', get: () => false, set: () => { /* refuses */ } },
    ]);
    pane.open();
    sw('Stubborn').click();
    // set() didn't take — the switch must show the real state, not the wish.
    expect(sw('Stubborn').getAttribute('aria-checked')).toBe('false');
    pane.destroy();
  });

  it('re-syncs from live state on every open (external ⚔ flips)', () => {
    let on = false;
    const pane = createSettingsPane([
      { label: 'Auto-attack', get: () => on, set: (v) => { on = v; } },
    ]);
    pane.open();
    expect(sw('Auto-attack').getAttribute('aria-checked')).toBe('false');
    pane.close();

    on = true; // flipped from the combat bar while the pane was closed
    pane.open();
    expect(sw('Auto-attack').getAttribute('aria-checked')).toBe('true');
    pane.destroy();
  });

  it('closes via ✕ and backdrop, and destroy removes the DOM', () => {
    const pane = createSettingsPane([
      { label: 'X', get: () => false, set: () => {} },
    ]);
    const el = document.querySelector('.settings-pane') as HTMLElement;
    pane.open();
    (document.querySelector('.settings-head button') as HTMLButtonElement).click();
    expect(el.classList.contains('open')).toBe(false);

    pane.open();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.classList.contains('open')).toBe(false);

    pane.destroy();
    expect(document.querySelector('.settings-pane')).toBeNull();
  });
});
