import { expect, it, vi } from 'vitest';
import { captureSource, createDevice, normalize, standardProfile } from '../lib/gamepad/device';

it('re-reads snapshots on animation frames across user activation and disconnect', () => {
  let cb: FrameRequestCallback;
  const pad = { id: 'first', index: 0, connected: true, buttons:[{pressed:true,value:1}] } as unknown as Gamepad;
  const next = {...pad};
  const replacement = {...pad, id: 'second'};
  const read = vi.fn<() => (Gamepad | null)[]>().mockReturnValueOnce([]).mockReturnValueOnce([pad])
    .mockReturnValueOnce([next]).mockReturnValueOnce([replacement]).mockReturnValueOnce([replacement]).mockReturnValueOnce([null]);
  const output = vi.fn();
  const cancel = vi.fn();
  const device = createDevice(output, read, (fn) => { cb = fn; return 9; }, cancel);
  for (let i = 0; i < 6; i++) cb!(i);
  expect(output.mock.calls.map(([p]) => p)).toEqual([null, pad, next, null, replacement, null]);
  expect(output.mock.calls[2][0]).toBe(next);
  device.destroy();
  expect(cancel).toHaveBeenCalledWith(9);
});

it('learns a hat, axis trigger and remapped button from neutral', () => {
  const profile = standardProfile();
  const neutral = [0, 0, -1, 3.28];
  const pad = { id: 'test', mapping: '', axes: [...neutral], buttons: Array.from({length: 16}, () => ({ pressed: false, value: 0 })) };
  for (const [name, active] of [['up', -1], ['right', -.43], ['down', .14], ['left', .71]] as const) {
    pad.axes[3] = active;
    profile[name] = captureSource(pad, neutral)!;
  }
  pad.axes[3] = neutral[3];
  pad.axes[2] = 1;
  profile.l2 = captureSource(pad, neutral)!;
  pad.buttons[7].pressed = true;
  profile.cross = captureSource(pad, neutral)!;
  pad.axes[3] = -.43;
  const pressed = normalize(pad, profile).pressed;
  expect([...pressed]).toEqual(expect.arrayContaining(['right','l2','cross']));
  expect([...pressed].filter((b) => ['up','left','down'].includes(b))).toEqual([]);
});

it('ignores silent devices and selects the newest press, including a second pad with the same id', () => {
  const make = (index: number) => ({id:'Twin',index,connected:true, buttons:[{pressed:false,value:0}]});
  const a = make(0), b = make(1);
  let frame: FrameRequestCallback;
  const output = vi.fn();
  const device = createDevice(output, () => [a,b] as unknown as Gamepad[], cb => { frame = cb; return 1; },vi.fn());
  const read = () => { frame!(0); return output.mock.lastCall![0]; };
  expect(read()).toBeNull();
  b.buttons[0].pressed = true;
  expect(read()).toBe(b);
  a.buttons[0].pressed = true;
  expect(read()).toBeNull();
  expect(read()).toBe(a);
  expect(read()).toBe(a); // A held button on b never steals ownership.
  b.buttons[0].pressed = false; read(); b.buttons[0].pressed = true;
  expect(read()).toBeNull(); expect(read()).toBe(b);
  b.connected = false;
  expect(read()).toBeNull(); expect(read()).toBe(a);
  device.destroy();
});
