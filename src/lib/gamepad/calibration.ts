import { captureSource, hasNavigation, controls, type Profile, type Source, type Control, type RawPad } from './device';
import { glyphs } from './bindings';
import { dialog } from './focus';

const labels: Record<Control, string> = {
  cross:glyphs[0], circle:glyphs[1], square:glyphs[2], triangle:glyphs[3], r1:'R1', r2:'R2',
  l1:'L1', l2:'L2', l3:'L3', r3:'R3', options:'Options', create:'Create',
  up:'D-pad up', down:'D-pad down', left:'D-pad left', right:'D-pad right',
  'leftX+':'left stick right', 'leftX-':'left stick left', 'leftY+':'left stick down', 'leftY-':'left stick up',
  'rightX+':'right stick right', 'rightX-':'right stick left', 'rightY+':'right stick down', 'rightY-':'right stick up',
};
const first: Control[] = ['cross','circle','up','down','left','right','options'];
const leftStick: Control[] = ['leftX+','leftX-','leftY+','leftY-'];

export function calibrate(complete: (p: Profile) => void, cancel: () => void) {
  const panel = dialog('Calibrate controller');
  const help = panel.el.appendChild(document.createElement('p'));
  const live = panel.el.appendChild(document.createElement('output'));
  const offer = panel.el.appendChild(document.createElement('p'));
  const profile = Object.fromEntries(controls.map(key => [key,null])) as Profile;
  const order = [...first,...controls.filter(key => !first.includes(key))];
  let index = 0;
  let since = 0;
  let now = 0;
  let stableSince = 0;
  let lastAxes: number[] = [];
  let lastButtons = '';
  let neutral: number[] | null = null;
  let candidate: Source | null = null;
  let timeoutShown = false;
  const skip = panel.button('Skip', () => advance(null));
  const finish = panel.button('Finish', () => { if (hasNavigation(profile)) complete(profile); });
  panel.button('Cancel', cancel).dataset.padBack = '';
  skip.focus();

  function prompt() {
    timeoutShown = false;
    since = now;
    offer.textContent = '';
    finish.disabled = !hasNavigation(profile);
    if (!finish.disabled) offer.textContent = 'Press the assigned ✕ again to finish now.';
    help.textContent = (index+1) + ' of ' + order.length + ' · ' + (neutral
      ? 'Press or fully move ' + labels[order[index]] + ', then release.'
      : 'Release every control and leave both sticks centered.');
  }
  function advance(source: Source | null) {
    profile[order[index++]] = source;
    candidate = null;
    if (index === first.length && !hasNavigation(profile)) {
      // Offer alternative navigation immediately when D-pad directions were skipped.
      order.splice(index,order.length-index,...leftStick,...order.slice(index).filter(key => !leftStick.includes(key)));
    }
    if (index === order.length) {
      if (hasNavigation(profile)) { complete(profile); return; }
      index = 0;
      prompt();
      offer.textContent = 'For navigation, assign ✕, ○, Options and four D-pad or left-stick directions. Cancel to use the remote.';
    } else prompt();
  }
  prompt();
  return { close: panel.close, sample(pad: RawPad, timestamp: number) {
    now = timestamp;
    const pressed = pad.buttons.flatMap((b,i) => b.pressed || b.value > .6 ? [i] : []).join(',');
    if (lastAxes.length !== pad.axes.length || pressed !== lastButtons
      || pad.axes.some((v,i) => Math.abs(v-lastAxes[i]) > .04)) {
      stableSince = now;
      lastAxes = Array.from(pad.axes);
      lastButtons = pressed;
    }
    const source = neutral ? captureSource(pad,neutral) : null;
    const raw = source && ('button' in source ? 'Button ' + source.button : 'Axis ' + source.axis + ' = ' + source.active.toFixed(2));
    if (live.textContent !== (raw || 'At rest')) live.textContent = raw || 'At rest';
    if (!timeoutShown && now-since > 15000) {
      offer.textContent = 'Taking longer? Select Skip to continue.';
      timeoutShown = true;
    }
    if (!neutral) {
      if (!pressed && now-stableSince >= 350) { neutral = Array.from(pad.axes); prompt(); }
      return;
    }
    if (!candidate) { candidate = source; return; }
    if (source && 'button' in source && 'axis' in candidate) candidate = source;
    if ('axis' in candidate) {
      const delta = pad.axes[candidate.axis] - candidate.neutral;
      const peak = candidate.active - candidate.neutral;
      // Some unsigned-at-boot triggers first report a negative value on light pressure.
      if (['r2','l2'].includes(order[index]) && candidate.neutral === 0 && peak < 0 && delta > .65) {
        candidate.active = pad.axes[candidate.axis];
        return;
      }
      if (delta / peak >= 1) candidate.active = pad.axes[candidate.axis];
      if (delta / peak > .65) return; // Wait for retreat from the peak before learning the resting value.
    }
    if (pressed || now-stableSince < 160) return;
    neutral = Array.from(pad.axes);
    const learned = candidate;
    candidate = null;
    if ('axis' in learned) learned.neutral = neutral[learned.axis];
    const duplicate = order.find(key => {
      if (key === order[index]) return false;
      const other = profile[key];
      if (!other) return false;
      if ('button' in learned) return 'button' in other && other.button === learned.button;
      return 'axis' in other && other.axis === learned.axis && Math.abs(other.active-learned.active) < .12;
    });
    if (duplicate === 'cross' && hasNavigation(profile)) { complete(profile); return; }
    if (duplicate) offer.textContent = 'Already assigned. Try ' + labels[order[index]] + ' again.';
    else advance(learned);
  } };
}
