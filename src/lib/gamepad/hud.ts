import { spellByWords, spellIconUrl } from '../spells';
import { glyphs, layers } from './bindings';

function ensureStyles() {
  if (document.getElementById('controller-hud-style')) return;
  const style = document.createElement('style');
  style.id = 'controller-hud-style';
  style.textContent = `
  .controller-hud { position:fixed; z-index:32; right:calc(10px + var(--game-inset-right,0px)); bottom:calc(10px + var(--game-inset-bottom,0px));
    pointer-events:none; color:#f3edd8; background:rgba(24,26,30,.92); border:1px solid #807b70; border-radius:7px;
    padding:.4em .65em; font:.9rem/1.35 system-ui,sans-serif; }
  .pad-active:not(.tv-layout) .controller-hud { bottom:calc(170px + var(--game-inset-bottom,0px)) }
  .controller-hud ul { display:grid; grid-template-columns:repeat(3,1fr); gap:2px 12px; list-style:none; margin:0; padding:0 }
  .controller-hud img { width:1.4em; height:1.4em; vertical-align:middle; margin:0 .2em; image-rendering:pixelated }
  .controller-hud li[data-cooling="true"] { opacity:.55; text-decoration:line-through }
  `;
  document.head.appendChild(style);
}
export function createControllerHUD(parent: HTMLElement = document.body) {
  ensureStyles();
  const el = document.createElement('aside');
  el.className = 'controller-hud';
  const layerName = document.createElement('strong');
  const list = document.createElement('ul');
  el.append(layerName, list);
  const items = glyphs.map(() => list.appendChild(document.createElement('li')));
  parent.appendChild(el);
  return { el, update(layer: number, bindings: readonly string[], cooldown: (s: string) => number, now: number) {
    if (layerName.textContent !== layers[layer]) layerName.textContent = layers[layer];
    items.forEach((item, i) => {
      const words = bindings[layer * 6 + i] || '';
      if (item.dataset.words !== words) {
        const spell = spellByWords(words);
        const icon = spell && spellIconUrl(spell);
        item.replaceChildren(glyphs[i] + ' ');
        if (icon) {
          const image = document.createElement('img');
          image.src = icon;
          image.alt = spell.name;
          item.appendChild(image);
        }
        item.append(icon ? words : spell?.name ?? '—');
        item.title = spell ? spell.name + ' · ' + words : 'Empty slot';
        item.dataset.words = words;
      }
      const cooling = String(!!words && cooldown(words) > now);
      if (item.dataset.cooling !== cooling) item.dataset.cooling = cooling;
    });
  }, destroy: () => el.remove() };
}
