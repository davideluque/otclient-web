import { createDevice, normalize, consumeProfileReset, forgetProfile, standardProfile, loadProfile, saveProfile, type Profile } from './device';
import { idle, mapFrame } from './mapping';
import { back, dialog, focusAction, observeSurfaces, topSurface } from './focus';
import { loadBindings, saveBindings } from './bindings';
import { createControllerHUD } from './hud';
import { calibrate } from './calibration';
import { openBindings } from './editor';
import type { CombatBindingHandle } from '../jamera/combatBinding';
import './controller.css';

export function mountController(tv: boolean, cancelCharacterSelect: () => void) {
  function relaunch(event: Event) {
    if (String((event as CustomEvent).detail?.resetPad) !== 'true') return;
    const url = new URL(location.href);
    url.searchParams.set('reset-pad','1');
    location.replace(url.href);
  }
  if (tv) {
    consumeProfileReset();
    document.addEventListener('webOSRelaunch', relaunch);
  }
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
  let disconnectedPad: ReturnType<typeof dialog> | null = null;
  let closedGame: ReturnType<typeof dialog> | null = null;
  let wizard: ReturnType<typeof calibrate> | null = null;
  let id: string | null = null;
  let profile: Profile | null = null;
  let scope: HTMLElement | null = null;
  let dirty = true;
  const arrowKeys = ['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'];
  const configuredWindow = new URLSearchParams(location.search).get('padKeyMs');
  const duplicateMs = configuredWindow !== null && Number.isFinite(Number(configuredWindow))
    ? Math.max(0, Math.min(250, Number(configuredWindow))) : 80;
  const padKeys = new Map<string, number>();
  const remoteKeys = new Map<string, number>();
  function recentRemote(key: string) {
    const at = remoteKeys.get(key);
    remoteKeys.delete(key);
    return duplicateMs > 0 && at !== undefined && performance.now()-at <= duplicateMs;
  }
  let lastCircle = -Infinity;
  let backTimer: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;
  const blur = () => { suspended = true; reset(); };
  const focus = () => { suspended = false; reset(); };
  let controllerPaused = false;
  let retryOnPress = false;
  let rescue: ReturnType<typeof dialog> | null = null;

  const observer = observeSurfaces(() => { dirty = true; });
  function currentScope() {
    if (dirty) { scope = topSurface(); dirty = false; }
    return scope;
  }
  function goBack(surface: HTMLElement | null) {
    if (surface?.matches('.jamera-login')) cancelCharacterSelect();
    else back(surface);
  }
  function reset() { padKeys.clear(); remoteKeys.clear(); state = idle(); dirty = true; }
  function stopWizard() { wizard?.close(); wizard = null; reset(); }
  function startCalibration() {
    if (!id) { showRescue(); return; }
    controllerPaused = false;
    stopWizard();
    wizard = calibrate((learned) => {
      if (id !== null) saveProfile(id, learned);
      profile = learned;
      stopWizard();
    }, () => { controllerPaused = !profile; retryOnPress = !tv && !profile; stopWizard(); });
  }
  function showRescue() {
    stopWizard();
    rescue?.close();
    closePadNotice();
    const panel = dialog('Controller recovery');
    rescue = panel;
    function close() { panel.close(); rescue = null; reset(); closedGame?.el.querySelector('button')?.focus(); }
    const calibrateButton = panel.button('Recalibrate', () => { close(); startCalibration(); });
    const standard = panel.button('Use standard mapping', () => {
      if (!id) return;
      saveProfile(id,'standard'); profile = standardProfile(); controllerPaused = false; close();
    });
    const forget = panel.button('Forget this controller', () => {
      if (id) forgetProfile(id);
      profile = null; controllerPaused = true; close();
    });
    for (const button of [calibrateButton,standard,forget]) button.disabled = id === null;
    const without = panel.button('Continue without controller', () => { controllerPaused = true; close(); });
    without.dataset.padBack = '';
    (id ? calibrateButton : without).focus();
  }
  function closePadNotice() {
    disconnectedPad?.close(); disconnectedPad = null; reset();
  }
  function padNotice() {
    closePadNotice();
    disconnectedPad = dialog('Controller disconnected. Reconnect and press a button.');
    const button = disconnectedPad.button('Continue without controller', closePadNotice);
    button.dataset.padBack = '';
    button.focus();
  }
  function networkNotice() {
    const panel = dialog('Game connection closed. Retry to return to login.');
    closedGame = panel;
    const retry = panel.button('Retry', () => {
      panel.close(); closedGame = null; reset();
      if (id && !profile && !controllerPaused) startCalibration();
    });
    retry.dataset.padBack = '';
    retry.focus();
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
      if (pad && disconnectedPad) closePadNotice();
      if (!rescue && !closedGame && !controllerPaused && hadPad && !pad) padNotice();
      if (!rescue && !closedGame && !controllerPaused && pad && !profile) startCalibration();
      if (rescue) showRescue();
    }
    if (retryOnPress && pad?.buttons.some(b => b.pressed)) { retryOnPress = false; startCalibration(); }
    if (wizard && pad) { wizard.sample(pad, now); return; }
    const ui = currentScope();
    const snapshot = !rescue && !controllerPaused && pad && profile ? normalize(pad, profile) : null;
    const next = mapFrame(state, snapshot, ui || !combat ? 'ui' : 'game', words, now);
    if (next.pressed.has('circle') && !state.pressed.has('circle')) {
      lastCircle = performance.now();
      clearTimeout(backTimer);
    }
    if (tv && next.connected && state.connected && next.mode === state.mode) {
      if (next.held !== null && next.held !== state.held) padKeys.set(arrowKeys[next.held], performance.now());
      if (next.pressed.has('cross') && !state.pressed.has('cross')) padKeys.set('Enter', performance.now());
      for (const action of next.actions) {
        if (typeof action === 'object' && 'focus' in action) padKeys.set(arrowKeys[action.focus], performance.now());
      }
    }
    state = next;
    for (const action of next.actions) {
      if (typeof action === 'object') {
        if ('cast' in action) combat?.cast(action.cast);
        else if (ui && !recentRemote(arrowKeys[action.focus])) focusAction(ui, action.focus);
      } else if (action === 'activate' && ui && !recentRemote('Enter')) focusAction(ui, action);
      else if (action === 'back') goBack(ui);
      else if (action === 'menu') document.querySelector<HTMLButtonElement>('.game-menu-btn')?.click();
      else if (action === 'next') combat?.attackNextMonster();
      else if (action === 'stop') combat?.setAttacking(false);
      else if (action === 'sheet') showSheet();
    }
    if (combat && hud) hud.update(next.layer, words, combat.cooldownUntil, now);
  });
  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && currentScope()?.matches('[data-pad-dialog]')) {
      e.preventDefault(); e.stopImmediatePropagation(); goBack(currentScope());
    } else if (tv && e.keyCode === 404) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) showRescue();
    } else if (tv && e.keyCode === 461) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat && performance.now()-lastCircle > 200) {
        clearTimeout(backTimer);
        backTimer = setTimeout(() => goBack(currentScope()), id !== null ? 100 : 0);
      }
    } else if (tv) {
      const recent = padKeys.get(e.key);
      if (duplicateMs > 0 && profile && !wizard && recent !== undefined && performance.now()-recent <= duplicateMs) {
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }
      const direction = arrowKeys.indexOf(e.key);
      if (profile && !wizard && (direction >= 0 || e.key === 'Enter' && e.target instanceof HTMLButtonElement)) {
        remoteKeys.set(e.key, performance.now());
      }
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement
        && ['text','password','search','number'].includes(e.target.type)) return;
      const surface = direction >= 0 ? currentScope() : null;
      if (surface) {
        e.preventDefault(); e.stopImmediatePropagation();
        focusAction(surface, direction as 0|1|2|3, false);
      }
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
    stopWizard(); disconnectedPad = null; closedGame = null; rescue = null;
    reset();
    if (disconnected) networkNotice();
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
      document.removeEventListener('webOSRelaunch', relaunch);
      document.removeEventListener('visibilitychange', reset);
      document.documentElement.classList.remove('pad-active');
    },
  };
}

export type Controller = ReturnType<typeof mountController>;
