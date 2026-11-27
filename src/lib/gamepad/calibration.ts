import { captureSource, controls, type Profile, type Source, type Control, type RawPad } from './device';
import { glyphs } from './bindings';
import { dialog } from './focus';

const labels: Record<Control, string> = {
  cross:glyphs[0], circle:glyphs[1], square:glyphs[2], triangle:glyphs[3], r1:'R1', r2:'R2',
  l1:'L1', l2:'L2', l3:'L3', r3:'R3', options:'Options', create:'Create',
  up:'D-pad up', down:'D-pad down', left:'D-pad left', right:'D-pad right',
  'leftX+':'left stick right', 'leftX-':'left stick left', 'leftY+':'left stick down', 'leftY-':'left stick up',
  'rightX+':'right stick right', 'rightX-':'right stick left', 'rightY+':'right stick down', 'rightY-':'right stick up',
};
export function calibrate(complete: (p: Profile) => void, cancel: () => void) {
  const panel = dialog('Calibrate controller');
  const help = panel.el.appendChild(document.createElement('p'));
  help.textContent = 'Release every control and leave both sticks centered for two seconds.';
  panel.button('Cancel', cancel).dataset.padBack = '';
  const profile = {} as Profile;
  let index = 0, settle = 0;
  let previous: number[] = [];
  let neutral: number[] | null = null;
  let candidate: Source | null = null;
  let strength = 0;
  const prompt = () => {
    const key = controls[index];
    help.textContent = 'Press or fully move ' + labels[key] + ', then release.'
      + (key === 'rightX+' ? ' Or press ✕ to finish without the unused right stick.' : '');
  };
  return { close: panel.close, sample(pad: RawPad, now: number) {
    if (!neutral) {
      if (!settle || pad.buttons.some(b => b.pressed) || pad.axes.some((v,i) => Math.abs(v - previous[i]) > .08)) settle = now;
      previous = Array.from(pad.axes);
      if (now - settle >= 1800) { neutral = previous; prompt(); }
      return;
    }
    const source = captureSource(pad, neutral);
    if (source) {
      const delta = 'button' in source ? Infinity : Math.abs(source.active - source.neutral);
      if (delta >= strength) { candidate = source; strength = delta; }
      return;
    }
    if (!candidate) return;
    const key = controls[index];
    const duplicate = controls.slice(0,index).find(k => {
      const other = profile[k];
      if (other && 'button' in other && 'button' in candidate!) return other.button === candidate.button;
      if (other && 'axis' in other && 'axis' in candidate!) return other.axis === candidate.axis && Math.abs(other.active-candidate.active) < .12;
      return false;
    });
    if (key === 'rightX+' && duplicate === 'cross') {
      for (const unused of controls.slice(index)) profile[unused] = null;
      complete(profile);
      return;
    }
    if (duplicate) {
      help.textContent = 'Already assigned. Try ' + labels[key] + ' again.';
    } else {
      profile[key] = candidate;
      index++;
      if (index === controls.length) { complete(profile); return; }
      prompt();
    }
    candidate = null;
    strength = 0;
  } };
}
