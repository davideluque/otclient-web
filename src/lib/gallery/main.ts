/**
 * Gallery shell for /ui-components.html — renders the sidebar of
 * registered components, mounts one at a time, and gives each entry a
 * knob panel + event log. See registry.ts for the entry contract.
 */

import { ENTRIES, type GalleryEntry } from './registry';

const sidebar = document.getElementById('gallery-sidebar')!;
const titleEl = document.getElementById('gallery-title')!;
const descEl = document.getElementById('gallery-desc')!;
const knobsEl = document.getElementById('gallery-knobs')!;
const stageEl = document.getElementById('gallery-stage')!;
const logEl = document.getElementById('gallery-log')!;

let teardown: (() => void) | null = null;
let activeButton: HTMLButtonElement | null = null;

function log(msg: string): void {
  const line = document.createElement('div');
  line.className = 'log-line';
  const time = new Date().toLocaleTimeString([], { hour12: false });
  line.textContent = `${time}  ${msg}`;
  logEl.prepend(line);
  // Keep the log bounded; old lines have no value here.
  while (logEl.childElementCount > 200) logEl.lastElementChild!.remove();
}

function activate(entry: GalleryEntry, button: HTMLButtonElement): void {
  teardown?.();
  teardown = null;
  knobsEl.replaceChildren();
  stageEl.replaceChildren();
  logEl.replaceChildren();
  activeButton?.classList.remove('active');
  activeButton = button;
  button.classList.add('active');

  titleEl.textContent = entry.name;
  descEl.textContent = entry.description;

  teardown = entry.mount({
    stage: stageEl,
    log,
    knobs: {
      button(label, fn) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'knob-btn';
        b.textContent = label;
        b.addEventListener('click', fn);
        knobsEl.appendChild(b);
      },
      toggle(label, initial, fn) {
        const wrap = document.createElement('label');
        wrap.className = 'knob-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = initial;
        input.addEventListener('change', () => fn(input.checked));
        wrap.append(input, document.createTextNode(label));
        knobsEl.appendChild(wrap);
      },
    },
  });
  log(`mounted: ${entry.name}`);
}

for (const entry of ENTRIES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = entry.name;
  button.addEventListener('click', () => activate(entry, button));
  sidebar.appendChild(button);
}

// Auto-open the entry named in the hash (e.g. /ui-components.html#chat),
// else the first one — the page should never load empty.
const fromHash = decodeURIComponent(window.location.hash.slice(1)).toLowerCase();
const initial = ENTRIES.findIndex((e) => e.name.toLowerCase() === fromHash);
const index = initial >= 0 ? initial : 0;
activate(ENTRIES[index], sidebar.children[index] as HTMLButtonElement);
