import { Direction } from '../player';

const dialogs = [
  '[data-pad-dialog]', '[role="dialog"]',
  '.settings-pane', '.changelog-pane', '.vip-list', '.spell-customizer', '.death-dialog',
  '.action-sheet-backdrop', '.full-chat',
  '.text-window', '.shop-pane', '.trade-pane',
].join(',');
const selectable = 'button:enabled,input:enabled,textarea:enabled,select:enabled,[tabindex="0"]';
function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}
// A closed menu is translated off screen and still has a layout rectangle.
const surfaces = dialogs + ',.jamera-login,.game-menu-pane';
const openSurfaces = dialogs + ',.jamera-login:not([hidden]),.game-menu-pane.open';
export function observeSurfaces(changed: () => void) {
  const roots = new Set<Element>(document.querySelectorAll(surfaces));
  function discover(node: Node) {
    if (!(node instanceof Element)) return;
    if (node.matches(surfaces)) { roots.add(node); changed(); }
    if (node.childElementCount) {
      for (const surface of node.querySelectorAll(surfaces)) { roots.add(surface); changed(); }
    }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target as Element;
        if (roots.has(target)) {
          if (!target.matches(surfaces)) roots.delete(target);
          changed(); continue;
        }
        if (target.matches(surfaces)) { roots.add(target); changed(); continue; }
        // A wrapper can hide or reveal a mounted dialog.
        if (target.childElementCount && [...roots].some(root => target.contains(root))) changed();
      } else {
        for (const node of record.addedNodes) discover(node);
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          for (const root of roots) if (node.contains(root) && !root.isConnected) { roots.delete(root); changed(); }
        }
      }
    }
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','role','data-pad-dialog']});
  return observer;
}

export function topSurface(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let height = -Infinity;
  for (const el of document.querySelectorAll<HTMLElement>(openSurfaces)) {
    if (!visible(el)) continue;
    let node: HTMLElement | null = el;
    let z = 0;
    while (node && !z) { z = Number.parseInt(getComputedStyle(node).zIndex) || 0; node = node.parentElement; }
    if (z >= height) { height = z; best = el; }
  }
  return best;
}

/** Directional search in CSS pixels. Prefer the same row/column where possible. */
export function neighbour(rects: readonly DOMRect[], index: number, dir: Direction): number {
  if (index < 0) return 0;
  const vertical = dir === Direction.North || dir === Direction.South;
  const sign = dir === Direction.North || dir === Direction.West ? -1 : 1;
  const origin = rects[index];
  let winner = index, best = Infinity;
  rects.forEach((rect, i) => {
    const dx = rect.left + rect.width/2 - origin.left - origin.width/2;
    const dy = rect.top + rect.height/2 - origin.top - origin.height/2;
    const forward = (vertical ? dy : dx) * sign;
    if (forward < 1) return;
    const cross = Math.abs(vertical ? dx : dy);
    const cost = forward + cross * 3;
    if (cost < best) { best = cost; winner = i; }
  });
  return winner;
}

export function dialog(title: string) {
  const el = document.createElement('section');
  el.dataset.padDialog = '';
  el.setAttribute('role','dialog');
  el.setAttribute('aria-label', title);
  const heading = document.createElement('h2');
  heading.textContent = title;
  el.appendChild(heading);
  document.body.appendChild(el);
  const button = (label: string, click: () => void, parent: HTMLElement = el) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', click);
    parent.appendChild(b);
    return b;
  };
  return { el, button, close: () => el.remove() };
}

// A webOS keyboard may require a trusted activation event. Provide text
// entry from real gamepad edges even on browsers that ignore scripted click.
const gridOrigin = new WeakMap<HTMLElement, HTMLElement>();
function textEntry(scope: HTMLElement, field: HTMLInputElement | HTMLTextAreaElement): void {
  gridOrigin.set(scope,field);
  const panel = dialog(field.getAttribute('aria-label') || 'Enter text');
  const secret = field instanceof HTMLInputElement && field.type === 'password';
  const output = document.createElement('output');
  let value = field.value;
  const show = () => { output.textContent = secret ? '•'.repeat(value.length) : value; };
  show();
  panel.el.appendChild(output);
  const grid = document.createElement('div');
  grid.className = 'pad-keys';
  panel.el.appendChild(grid);
  const numeric = field instanceof HTMLInputElement && field.type === 'number';
  let shifted = false;
  const draw = () => {
    grid.replaceChildren();
    const letters = shifted ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz';
    for (const char of numeric ? '1234567890' : '1234567890' + letters + ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~') {
      panel.button(char === ' ' ? 'Space' : char, () => { value += char; show(); }, grid);
    }
  };
  draw();
  if (!numeric) panel.button('Shift', () => { shifted = !shifted; draw(); });
  panel.button('Delete', () => { value = value.slice(0,-1); show(); });
  panel.button('Done', () => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    panel.close();
  });
  panel.button('Cancel', panel.close).dataset.padBack = '';
  grid.querySelector('button')?.focus();
}

function isTextField(item: HTMLElement): item is HTMLInputElement | HTMLTextAreaElement {
  return item instanceof HTMLTextAreaElement || item instanceof HTMLInputElement
    && ['text','number','password'].includes(item.type);
}

function focusFromPad(item: HTMLElement) {
  if (isTextField(item) && document.activeElement !== item) {
    const original = item.getAttribute('inputmode');
    item.setAttribute('inputmode','none');
    const restore = () => {
      if (original === null) item.removeAttribute('inputmode');
      else item.setAttribute('inputmode',original);
      item.removeEventListener('blur',restore);
      item.removeEventListener('pointerdown',restore);
      item.removeEventListener('keydown',restore);
    };
    item.addEventListener('blur',restore);
    item.addEventListener('pointerdown',restore);
    item.addEventListener('keydown',restore);
  }
  item.focus();
}

export function focusAction(scope: HTMLElement, action: 'activate' | Direction, fromPad = true): void {
  const items = Array.from(scope.querySelectorAll<HTMLElement>(selectable)).filter(visible);
  if (!items.length) return;
  const origin = document.activeElement === document.body ? gridOrigin.get(scope) : document.activeElement;
  const index = items.indexOf(origin as HTMLElement);
  const item = items[Math.max(0,index)];
  if (action === 'activate') {
    if (isTextField(item)) textEntry(scope,item);
    else { item.focus(); item.click(); }
  } else if (item instanceof HTMLInputElement && item.type === 'range' && [1,3].includes(action)) {
    if (action === Direction.East) item.stepUp(); else item.stepDown();
    item.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const next = neighbour(items.map((el) => el.getBoundingClientRect()), index, action);
    if (fromPad) focusFromPad(items[next]); else items[next].focus();
    items[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

export function back(scope: HTMLElement | null): void {
  if (!scope) { document.querySelector<HTMLButtonElement>('.game-menu-btn')?.click(); return; }
  const close = scope.querySelector<HTMLButtonElement>('[data-pad-back],button[aria-label^="Close" i],.action-sheet .cancel,.death-dialog .continue,.trade-actions button:not(.accept)');
  if (close) { close.click(); return; }
  if (scope.matches('.game-menu-pane')) { document.querySelector<HTMLElement>('.game-menu-backdrop')?.click(); return; }
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true }));
}
