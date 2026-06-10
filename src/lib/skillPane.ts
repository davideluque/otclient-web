/**
 * Skill pane — the seven 7.6 skills with level + progress-to-next bars.
 * Self-contained component (joystick.ts pattern). The skill list and
 * (level, percent) pairs mirror the AddPlayerSkills wire layout (0xA1):
 * fist, club, sword, axe, distance, shielding, fishing — so wiring the
 * live packet later is a positional map.
 */

export const SKILL_NAMES = [
  'Fist', 'Club', 'Sword', 'Axe', 'Distance', 'Shielding', 'Fishing',
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export interface SkillPaneHandle {
  readonly el: HTMLElement;
  setSkill(name: SkillName, level: number, percent: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'skill-pane-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .skill-pane {
      position: fixed; top: 50%; right: 12px; transform: translateY(-50%);
      width: 190px; padding: 10px 12px;
      background: rgba(22,22,22,0.95); color: #e0e0e0;
      border: 1px solid #9a9a9a; border-radius: 10px;
      font-family: system-ui, sans-serif; font-size: 0.78rem;
      z-index: 30; user-select: none;
    }
    .skill-pane h3 {
      margin: 0 0 8px; font-size: 0.85rem; color: #9a9a9a;
    }
    .skill-pane .skill { margin: 6px 0; }
    .skill-pane .skill .row {
      display: flex; justify-content: space-between; margin-bottom: 2px;
    }
    .skill-pane .skill .lvl { color: #fff; font-weight: bold; }
    .skill-pane .skill .bar {
      height: 5px; border-radius: 3px; background: rgba(0,0,0,0.5);
      overflow: hidden;
    }
    .skill-pane .skill .bar .fill {
      height: 100%; background: #9a9a9a; transition: width 0.25s ease;
    }
  `;
  document.head.appendChild(style);
}

export function createSkillPane(parent: HTMLElement = document.body): SkillPaneHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'skill-pane';
  el.innerHTML = '<h3>Skills</h3>';

  const rows = new Map<SkillName, { lvl: HTMLElement; fill: HTMLElement }>();
  for (const name of SKILL_NAMES) {
    const div = document.createElement('div');
    div.className = 'skill';
    div.innerHTML = `
      <div class="row"><span>${name}</span><span class="lvl">10</span></div>
      <div class="bar"><div class="fill" style="width:0%"></div></div>
    `;
    el.appendChild(div);
    rows.set(name, {
      lvl: div.querySelector('.lvl') as HTMLElement,
      fill: div.querySelector('.fill') as HTMLElement,
    });
  }
  parent.appendChild(el);

  return {
    el,
    setSkill: (name, level, percent) => {
      const row = rows.get(name);
      if (!row) return;
      row.lvl.textContent = String(level);
      row.fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    },
    setVisible: (visible) => { el.style.display = visible ? 'block' : 'none'; },
    destroy: () => el.remove(),
  };
}
