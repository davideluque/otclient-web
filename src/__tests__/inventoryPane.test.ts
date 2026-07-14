// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createInventoryPane } from '../lib/inventoryPane';

afterEach(() => document.body.replaceChildren());

describe('close button', () => {
  it('renders a \u2715 that fires onClose', () => {
    let closed = 0;
    const pane = createInventoryPane(document.body, { onClose: () => { closed++; } });
    const btn = document.querySelector('.inventory-pane [aria-label="Close inventory"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(closed).toBe(1);
    pane.destroy();
  });
});
