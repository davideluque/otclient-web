// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { calibrate } from '../lib/gamepad/calibration';
import { controls } from '../lib/gamepad/device';
import { openBindings } from '../lib/gamepad/editor';
import { loadBindings } from '../lib/gamepad/bindings';
afterEach(() => document.body.replaceChildren());

it.each([true,false])('captures neutral, rejects duplicates and supports optional right stick (%s)', (skipRight) => {
  const complete = vi.fn();
  const wizard = calibrate(complete, vi.fn());
  const pad = { id: 'arbitrary', mapping: '', axes:[], buttons:controls.map(() => ({pressed:false as boolean,value:0})) };
  let time = 1;
  wizard.sample(pad,time);
  wizard.sample(pad,time += 2000);
  for (const [i] of controls.entries()) {
    if (i === 1) {
      pad.buttons[0].pressed = true;
      wizard.sample(pad,++time);
      pad.buttons[0].pressed = false;
      wizard.sample(pad,++time);
      expect(document.body.textContent).toContain('Already assigned');
    }
    const button = controls[i] === 'rightX+' && skipRight ? 0 : i;
    pad.buttons[button].pressed = true;
    wizard.sample(pad,++time);
    expect(complete).not.toHaveBeenCalled();
    pad.buttons[button].pressed = false;
    wizard.sample(pad,++time);
    if (button !== i) break;
  }
  if (skipRight) expect(complete.mock.calls[0][0]['rightX+']).toBeNull();
  expect(complete.mock.calls[0][0].cross).toEqual({button:0});
  wizard.close();
});
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
