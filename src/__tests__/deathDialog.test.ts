// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { showDeathDialog, type DeathDialogHandle } from '../lib/deathDialog';

let handle: DeathDialogHandle | null = null;

function show(onContinue: () => void = () => {}): DeathDialogHandle {
  handle = showDeathDialog({ onContinue });
  return handle;
}

afterEach(() => {
  // destroy() clears the module-level guard so the next test can show
  // a fresh dialog; safe to call after Continue already removed it.
  handle?.destroy();
  handle = null;
  document.body.replaceChildren();
});

describe('showDeathDialog', () => {
  it('shows the death message and respawn hint', () => {
    show();
    const dialog = document.querySelector('.death-dialog')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('You are dead.');
    expect(dialog.textContent).toContain('Your character will respawn at the temple.');
  });

  it('Continue invokes onContinue and removes the dialog', () => {
    const onContinue = vi.fn();
    show(onContinue);

    const btn = [...document.querySelectorAll('.death-dialog button')]
      .find((b) => b.textContent === 'Continue') as HTMLButtonElement;
    expect(btn).toBeDefined();
    btn.click();

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.death-dialog')).toBeNull();
  });

  it('Escape invokes onContinue and removes the dialog', () => {
    const onContinue = vi.fn();
    show(onContinue);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.death-dialog')).toBeNull();
  });

  it('is idempotent — a second show while open does not stack a second dialog', () => {
    const first = show();
    const second = showDeathDialog({ onContinue: () => {} });

    expect(second).toBe(first);
    expect(document.querySelectorAll('.death-dialog')).toHaveLength(1);
  });

  it('destroy removes the dialog without firing onContinue, and a new one can show after', () => {
    const onContinue = vi.fn();
    show(onContinue).destroy();

    expect(onContinue).not.toHaveBeenCalled();
    expect(document.querySelector('.death-dialog')).toBeNull();

    show();
    expect(document.querySelectorAll('.death-dialog')).toHaveLength(1);
  });
});
