import { SPELLS } from '../spells';
import { glyphs, layers } from './bindings';
import { dialog } from './focus';

/** All controls are ordinary focusable buttons so the same editor works with a mouse. */
export function openBindings(words: string[], change: () => void, readOnly = false) {
  const panel = dialog(readOnly ? 'Controller layout' : 'Controller spells');
  let selected = 0;
  function grid() {
    panel.el.querySelectorAll('div,button').forEach((el) => el.remove());
    const rows = document.createElement('div');
    rows.style.cssText = 'display:grid;grid-template-columns:5em repeat(6,1fr);align-items:center';
    panel.el.appendChild(rows);
    layers.forEach((layer, l) => {
      rows.appendChild(document.createElement('strong')).textContent = layer;
      glyphs.forEach((glyph, i) => {
        const index = l*6+i;
        const b = panel.button(glyph + ' ' + (words[index] || '—'), () => { selected = index; picker(); }, rows);
        b.setAttribute('aria-label', layer + ' ' + glyph + ': ' + (words[index] || 'Empty'));
        b.disabled = readOnly;
        if (selected === index && !readOnly) b.focus();
      });
    });
    const close = panel.button('Close', panel.close);
    close.dataset.padBack = '';
    if (readOnly) close.focus();
  }
  function picker() {
    panel.el.querySelectorAll('div,button').forEach((el) => el.remove());
    panel.button('Back to slots', grid).dataset.padBack = '';
    const list = document.createElement('div');
    list.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr)';
    panel.el.appendChild(list);
    const assign = (word: string) => { words[selected] = word; change(); grid(); };
    panel.button('Clear slot', () => assign(''), list).focus();
    for (const spell of SPELLS) {
      const reason = spell.parameter ? ' · requires ' + spell.parameter : '';
      const choice = panel.button(spell.name + ' · ' + spell.words + reason, () => assign(spell.words), list);
      choice.disabled = !!spell.parameter;
    }
  }
  grid();
  return panel;
}
