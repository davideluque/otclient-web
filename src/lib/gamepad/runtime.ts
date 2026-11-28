import { createDevice, normalize, loadProfile, saveProfile, type Profile } from './device';
import { idle, mapFrame } from './mapping';
import { back, dialog, focusAction, topSurface } from './focus';
import { loadBindings, saveBindings } from './bindings';
import { createControllerHUD } from './hud';
import { calibrate } from './calibration';
import { openBindings } from './editor';
import type { CombatBindingHandle } from '../jamera/combatBinding';
import './controller.css';

export function mountController(tv: boolean, cancelCharacterSelect: () => void) {
  document.documentElement.classList.add('pad-active');
  const hint = document.createElement('p');
  hint.textContent = typeof navigator.getGamepads === 'function'
    ? 'Press and release a controller button to connect.'
    : 'Gamepad API unavailable. Open device diagnostics to check controller inputs.';
  document.querySelector('.jamera-login')?.appendChild(hint);
  const words = loadBindings();
  let state = idle();
  let combat: CombatBindingHandle | null = null;
  let hud: ReturnType<typeof createControllerHUD> | null = null;
  let sheet: ReturnType<typeof openBindings> | null = null;
  let editor: ReturnType<typeof openBindings> | null = null;
  let recovery: ReturnType<typeof dialog> | null = null;
  let wizard: ReturnType<typeof calibrate> | null = null;
  let id: string | null = null;
  let profile: Profile | null = null;
  let scope: HTMLElement | null = null;
  let dirty = true;
  let lastCircle = -Infinity;
  let backTimer: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;
  const blur = () => { suspended = true; reset(); };
  const focus = () => { suspended = false; reset(); };
  let retryCalibration = false;

  // Most frames have no UI changes. Ignore HUD text/cooldowns and canvas
  // repaints when deciding whether to measure visible panels again.
  const observer = new MutationObserver(records => {
    if (records.some(({target}) => target instanceof Element && !target.closest('.controller-hud,canvas'))) dirty = true;
  });
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style','hidden','disabled'] });
  function currentScope() {
    if (dirty) { scope = topSurface(); dirty = false; }
    return scope;
  }
  function goBack(surface: HTMLElement | null) {
    if (surface?.matches('.jamera-login')) cancelCharacterSelect();
    else back(surface);
  }
  function reset() { state = idle(); dirty = true; }
  function stopWizard() { wizard?.close(); wizard = null; reset(); }
  function startCalibration() {
    stopWizard();
    wizard = calibrate((learned) => {
      if (id !== null) saveProfile(id, learned);
      profile = learned;
      stopWizard();
    }, stopWizard);
  }
  function recover(message: string) {
    recovery?.close();
    recovery = dialog(message);
    const reconnect = recovery.button('Retry', () => {
      if (id === null) return;
      recovery?.close();
      recovery = null;
      reset();
    });
    reconnect.focus();
  }
  function showEditor() {
    editor?.close();
    editor = openBindings(words, () => saveBindings(words));
  }
  function showSheet() {
    if (sheet?.el.isConnected) { sheet.close(); sheet = null; }
    else if (!currentScope()) sheet = openBindings(words, () => {}, true);
  }
  const device = createDevice((pad, now) => {
    if (document.hidden || suspended) { if (state.connected) reset(); return; }
    if ((pad?.id ?? null) !== id) {
      const hadPad = id !== null;
      id = pad?.id ?? null;
      hint.hidden = id !== null;
      stopWizard();
      profile = pad ? loadProfile(pad) : null;
      if (hadPad && !pad) recover('Controller disconnected. Reconnect and press a button.');
      if (pad && !profile) startCalibration();
    }
    if (wizard && pad) { wizard.sample(pad, now); return; }
    if (pad && !profile) {
      const down = pad.buttons.some(b => b.pressed);
      if (down && !retryCalibration) startCalibration();
      retryCalibration = down;
      return;
    }
    const ui = currentScope();
    const snapshot = pad && profile ? normalize(pad, profile) : null;
    const next = mapFrame(state, snapshot, ui || !combat ? 'ui' : 'game', words, now);
    if (next.pressed.has('circle') && !state.pressed.has('circle')) {
      lastCircle = performance.now();
      clearTimeout(backTimer);
    }
    state = next;
    for (const action of next.actions) {
      if (typeof action === 'object') {
        if ('cast' in action) combat?.cast(action.cast);
        else if (ui) focusAction(ui, action.focus);
      } else if (action === 'activate' && ui) focusAction(ui, action);
      else if (action === 'back') goBack(ui);
      else if (action === 'menu') document.querySelector<HTMLButtonElement>('.game-menu-btn')?.click();
      else if (action === 'next') combat?.attackNextMonster();
      else if (action === 'stop') combat?.setAttacking(false);
      else if (action === 'sheet') showSheet();
    }
    if (combat && hud) hud.update(next.layer, words, combat.cooldownUntil, now);
  });
  function keydown(e: KeyboardEvent) {
    if (tv && e.keyCode === 461) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat && performance.now()-lastCircle > 200) {
        clearTimeout(backTimer);
        backTimer = setTimeout(() => goBack(currentScope()), id !== null ? 100 : 0);
      }
    } else if (tv && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(e.key) && id !== null) {
      // A paired pad can synthesize keydown before its next polled snapshot.
      // Use the Gamepad API as the sole owner of these keys while attached.
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  document.addEventListener('visibilitychange', reset);
  function leave(disconnected: boolean) {
    hud?.destroy(); hud = null; combat = null;
    sheet?.close(); sheet = null;
    editor?.close(); editor = null;
    document.querySelectorAll('[data-pad-dialog]').forEach(el => el.remove());
    stopWizard(); recovery = null;
    reset();
    if (disconnected) recover('Game connection closed. Retry to return to login.');
  }
  return { get heldDirection() { return state.held; }, get blocksMovement() { return !!currentScope() || document.hidden; },
    enter(binding: CombatBindingHandle) { combat = binding; hud?.destroy(); hud = createControllerHUD(); reset(); },
    leave, showEditor, startCalibration,
    destroy() {
      leave(false); device.destroy(); observer.disconnect(); hint.remove();
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      clearTimeout(backTimer);
      document.removeEventListener('visibilitychange', reset);
      document.documentElement.classList.remove('pad-active');
    },
  };
}

export type Controller = ReturnType<typeof mountController>;
