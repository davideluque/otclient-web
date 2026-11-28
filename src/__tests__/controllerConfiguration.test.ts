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
