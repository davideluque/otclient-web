// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { showActionSheet } from '../lib/actionSheet';

afterEach(() => {
  document.body.replaceChildren();
});

function sheetButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.action-sheet button')]
    .find((b) => b.textContent === label);
  expect(button).toBeDefined();
  return button!;
}

describe('showActionSheet', () => {
  it('renders title + one button per action and fires the tapped action, closing itself', () => {
    const loot = vi.fn();
    const look = vi.fn();
    showActionSheet({ title: '#2853', actions: [
      { label: 'Loot', onSelect: loot },
      { label: 'Look', onSelect: look },
    ] });

    expect(document.querySelector('.action-sheet .title')?.textContent).toBe('#2853');
    sheetButton('Loot').click();
    expect(loot).toHaveBeenCalledTimes(1);
    expect(look).not.toHaveBeenCalled();
    expect(document.querySelector('.action-sheet-backdrop')).toBeNull();
  });

  it('Cancel closes without selecting', () => {
    const onSelect = vi.fn();
    showActionSheet({ actions: [{ label: 'Drop', onSelect }] });
    sheetButton('Cancel').click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('.action-sheet-backdrop')).toBeNull();
  });

  it('a backdrop tap closes; a tap inside the sheet body does not', () => {
    const handle = showActionSheet({ title: 'stay', actions: [{ label: 'A', onSelect: () => {} }] });
    (document.querySelector('.action-sheet .title') as HTMLElement).click();
    expect(document.querySelector('.action-sheet-backdrop')).not.toBeNull();
    (handle.el as HTMLElement).click();
    expect(document.querySelector('.action-sheet-backdrop')).toBeNull();
  });

  it('close() removes it programmatically', () => {
    const handle = showActionSheet({ actions: [] });
    handle.close();
    expect(document.querySelector('.action-sheet-backdrop')).toBeNull();
  });
});
