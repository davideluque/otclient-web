// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { calibrate } from '../lib/gamepad/calibration';
import { loadProfile, normalize, saveProfile } from '../lib/gamepad/device';

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

function setup(hat = false) {
  const complete = vi.fn(), cancel = vi.fn();
  const wizard = calibrate(complete, cancel);
  const pad = { id:'test', mapping:'', axes:Array<number>(8).fill(0),
    buttons:Array.from({length:13}, () => ({pressed:false,value:0})) };
  let now = 1;
  const frame = (advance = 20) => wizard.sample(pad, now += advance);
  const click = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!.click();
  const release = () => { frame(); frame(250); };
  const button = (i: number) => { pad.buttons[i].pressed = true; frame(); pad.buttons[i].pressed = false; release(); };
  if (hat) pad.axes[7] = 3;
  frame(); frame(2000);
  return {complete, cancel, pad, frame, release, button, click};
}

it.each(['hat','axes'])('learns %s directions and rebases a trigger resting at -1 after first use', (kind) => {
  const s = setup(kind === 'hat');
  s.button(0); s.button(1);
  for (const [i, value] of [-1,1,-1,1].entries()) {
    const axis = kind === 'hat' ? 7 : i < 2 ? 6 : 7;
    s.pad.axes[axis] = kind === 'hat' ? [-1,.14,.71,-.43][i] : value;
    s.frame();
    s.pad.axes[axis] = kind === 'hat' ? 3 : 0;
    s.release();
  }
  s.button(9); // Options
  s.button(2); s.button(3); s.button(4);
  s.pad.axes[5] = -.8; s.frame();
  s.pad.axes[5] = 1; s.frame(); s.frame(250); s.pad.axes[5] = -1; s.release();
  expect(document.body.textContent).toContain('L1, then release');
  s.pad.axes[4] = 1; s.pad.buttons[5].pressed = true; s.frame();
  s.pad.buttons[5].pressed = false; s.pad.axes[4] = -1; s.release();
  s.click('Skip'); s.click('Finish');
  const profile = s.complete.mock.calls[0][0];
  expect(profile.l2).toBeNull();
  expect(profile.l1).toEqual({button:5});
  expect(profile.r2).toEqual({axis:5,active:1,neutral:-1});
  saveProfile(s.pad.id,profile);
  expect(loadProfile(s.pad)).toEqual(profile);
  expect(normalize(s.pad,profile).pressed.size).toBe(0);
  s.pad.axes[5] = 1;
  expect(normalize(s.pad,profile).pressed.has('r2')).toBe(true);
});

it('offers skip on timeout and allows cancellation without saving', () => {
  const s = setup();
  s.frame(20000);
  expect(document.body.textContent).toMatch(/no input|taking longer/i);
  s.click('Skip'); s.click('Cancel');
  expect(s.cancel).toHaveBeenCalledOnce();
  expect(s.complete).not.toHaveBeenCalled();
});

it('advances past R2 when an untouched zero axis settles permanently at minus one', () => {
  const s = setup();
  const labels = ['✕','○','□','△','R1','D-pad up','D-pad down','D-pad left','D-pad right','Options'];
  let attempts = 0;
  while (!document.body.textContent?.includes('move R2,') && attempts++ < 24) {
    const index = labels.findIndex(label => document.body.textContent?.includes('move ' + label + ','));
    expect(index).toBeGreaterThanOrEqual(0);
    s.button(index);
  }
  s.pad.axes[5] = 1; s.frame(); s.pad.axes[5] = -1; s.release();
  expect(document.body.textContent).toContain('move L1,');
});

it('rejects duplicate controls without advancing', () => {
  const s = setup();
  s.button(0); s.button(0);
  expect(document.body.textContent).toContain('Already assigned');
  expect(document.body.textContent).toContain('2 of 24');
});
