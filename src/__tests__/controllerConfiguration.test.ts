// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { openBindings } from '../lib/gamepad/editor';
import { loadBindings } from '../lib/gamepad/bindings';
afterEach(() => document.body.replaceChildren());

it('assigns and clears one later-layer slot without changing the others', () => {
  const words = loadBindings();
  const change = vi.fn();
  const editor = openBindings(words,change);
  const pick = (label: string) => Array.from(editor.el.querySelectorAll('button')).find(b => b.textContent === label)!.click();
  editor.el.querySelectorAll('button')[23].click();
  pick('Light Healing · exura');
  expect(words[23]).toBe('exura');
  editor.el.querySelectorAll('button')[23].click();
  pick('Clear slot');
  expect(words[23]).toBe('');
  expect(change).toHaveBeenCalledTimes(2);
  editor.close();
});

it('shows required spell arguments and skips their buttons during navigation', () => {
  const words = loadBindings(), change = vi.fn();
  const editor = openBindings(words,change);
  editor.el.querySelector('button')!.click();
  for (const word of ['exiva','exani hur','exura sio','utevo res','utevo res ina','alana sio']) {
    const choice = Array.from(editor.el.querySelectorAll('button')).find(b => b.textContent.includes(' · ' + word + ' · requires '));
    expect(choice?.disabled,word).toBe(true);
    choice!.click();
  }
  expect(change).not.toHaveBeenCalled();
  editor.close();
});
