import { buttons, type Button, type Snapshot } from './mapping';

export const controls = [...buttons, 'leftX+', 'leftX-', 'leftY+', 'leftY-', 'rightX+', 'rightX-', 'rightY+', 'rightY-'] as const;
export type Control = typeof controls[number];
export type Source = { button: number } | { axis: number; neutral: number; active: number };
export type Profile = Record<Control, Source | null>;
export interface RawPad {
  id: string;
  mapping: string;
  buttons: readonly { value: number; pressed: boolean }[];
  axes: readonly number[];
}
const standardOrder: Button[] = ['cross','circle','square','triangle','l1','r1','l2','r2','create','options','l3','r3','up','down','left','right'];
export function standardProfile(): Profile {
  const profile = {} as Profile;
  standardOrder.forEach((name, button) => { profile[name] = { button }; });
  controls.slice(buttons.length).forEach((name, i) => {
    profile[name] = { axis: Math.floor(i / 2), neutral: 0, active: i % 2 === 0 ? 1 : -1 };
  });
  return profile;
}

export function normalize(pad: RawPad, profile: Profile): Snapshot {
  function value(control: Control): number {
    const src = profile[control];
    if (!src) return 0;
    if ('button' in src) {
      const b = pad.buttons[src.button];
      return b?.pressed ? 1 : b?.value ?? 0;
    }
    const raw = pad.axes[src.axis] ?? src.neutral;
    // A hat encodes positions on ONE axis. Two cardinal positions on the
    // same side of neutral cannot be distinguished by signed magnitude.
    if (['up','down','left','right'].includes(control)) {
      return Math.abs(raw - src.active) < 0.12 ? 1 : 0;
    }
    return Math.max(0, Math.min(1, (raw - src.neutral) / (src.active - src.neutral)));
  }
  return {
    pressed: new Set(buttons.filter((name) => value(name) > 0.5)),
    left: [value('leftX+') - value('leftX-'), value('leftY+') - value('leftY-')],
    right: [value('rightX+') - value('rightX-'), value('rightY+') - value('rightY-')],
  };
}

export function loadProfile(pad: RawPad): Profile | null {
  try {
    const saved = JSON.parse(localStorage.getItem('jamera.pad.' + pad.id) ?? 'null');
    if (saved && controls.every((name) => {
      const src = saved[name];
      if (src === null) return /^right[XY]/.test(name);
      return src && (Number.isInteger(src.button) && src.button >= 0 && src.button < pad.buttons.length
        || Number.isInteger(src.axis) && src.axis >= 0 && src.axis < pad.axes.length
        && Number.isFinite(src.active) && Number.isFinite(src.neutral) && src.active !== src.neutral);
    })) return saved as Profile;
  } catch { /* Storage can be disabled. */ }
  return pad.mapping === 'standard' ? standardProfile() : null;
}
export function saveProfile(id: string, profile: Profile): void {
  try { localStorage.setItem('jamera.pad.' + id, JSON.stringify(profile)); } catch { /* Session profile remains usable. */ }
}

export function createDevice(onFrame: (pad: Gamepad | null, time: number) => void,
  read: () => (Gamepad | null)[] = () => navigator.getGamepads?.() ?? [],
  request = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let activeIndex = -1;
  let activeId: string | null = null;
  let raf = 0;
  let running = true;
  const tick = (now: number) => {
    let pads: (Gamepad | null)[] = [];
    try { pads = Array.from(read()); } catch { /* API denied by the browser. */ }
    // Emit a disconnected frame before handing over to another device.
    const pad = activeIndex >= 0 ? pads[activeIndex] : pads.find((p) => p?.connected);
    const replacement = activeIndex >= 0 && pad?.id !== activeId;
    activeIndex = pad?.connected && !replacement ? pad.index : -1;
    activeId = activeIndex >= 0 ? pad!.id : null;
    onFrame(activeIndex >= 0 ? pad! : null, now);
    if (running) raf = request(tick);
  };
  raf = request(tick);
  return { destroy() { running = false; cancel(raf); } };
}

/** Capture the largest axis displacement, including hats resting outside [-1, 1]. */
export function captureSource(pad: RawPad, neutral: readonly number[]): Source | null {
  const button = pad.buttons.findIndex((b) => b.pressed || b.value > 0.6);
  if (button >= 0) return { button };
  let best = 0.12;
  let result: Source | null = null;
  pad.axes.forEach((active, axis) => {
    const delta = Math.abs(active - neutral[axis]);
    if (delta > best) {
      best = delta;
      result = { axis, neutral: neutral[axis], active };
    }
  });
  return result;
}
