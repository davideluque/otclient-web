// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { openBindings } from '../lib/gamepad/editor';
import { loadBindings, loadRepeatSlots, saveRepeatSlots } from '../lib/gamepad/bindings';
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

it('disables picker buttons for spells with required arguments', () => {
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

it('persists repeat for one slot and leaves the other 23 off', () => {
  localStorage.clear();
  const repeat = loadRepeatSlots();
  expect(repeat).toEqual(Array(24).fill(false));
  const editor = openBindings(loadBindings(),() => saveRepeatSlots(repeat),false,repeat);
  editor.el.querySelectorAll('button')[12].click();
  const toggle = editor.el.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  toggle.click();
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(loadRepeatSlots().map((on,i) => on ? i : -1).filter(i => i >= 0)).toEqual([12]);
  editor.close();
  localStorage.clear();
});
