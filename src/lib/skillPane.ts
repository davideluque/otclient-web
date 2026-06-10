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

/** Character stats shown above the skills (0xA0 AddPlayerStats fields). */
export interface CharacterStats {
  level: number;
  /** Progress to the next level, 0-100 — rendered as the RED bar. */
  levelPercent: number;
  experience: number;
  magicLevel: number;
  magicLevelPercent: number;
  capacity: number;
  soul: number;
}

export interface SkillPaneHandle {
  readonly el: HTMLElement;
  setSkill(name: SkillName, level: number, percent: number): void;
  /** Update the character block (level/xp/maglevel/cap/soul). */
  setStats(stats: CharacterStats): void;
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
    /* The character block above the skills. Level progress is THE red
       bar (Santiago's spec); magic level keeps the neutral fill. */
    .skill-pane .skill .bar .fill.level { background: #c0392b; }
    .skill-pane .statline {
      display: flex; justify-content: space-between; margin: 3px 0;
      color: #bdbdbd;
    }
    .skill-pane .statline .val { color: #fff; font-weight: bold; }
    .skill-pane hr {
      border: none; border-top: 1px solid #333; margin: 8px 0;
    }
  `;
  document.head.appendChild(style);
}

export function createSkillPane(parent: HTMLElement = document.body): SkillPaneHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'skill-pane';
  el.innerHTML = `
    <h3>Skills</h3>
    <div class="skill" data-role="level">
      <div class="row"><span>Level</span><span class="lvl">—</span></div>
      <div class="bar"><div class="fill level" style="width:0%"></div></div>
    </div>
    <div class="statline"><span>Experience</span><span class="val" data-role="exp">—</span></div>
    <div class="skill" data-role="magic">
      <div class="row"><span>Magic</span><span class="lvl">—</span></div>
      <div class="bar"><div class="fill" style="width:0%"></div></div>
    </div>
    <div class="statline"><span>Capacity</span><span class="val" data-role="cap">—</span></div>
    <div class="statline"><span>Soul</span><span class="val" data-role="soul">—</span></div>
    <hr />
  `;

  const levelRow = el.querySelector('[data-role="level"]') as HTMLElement;
  const magicRow = el.querySelector('[data-role="magic"]') as HTMLElement;
  const expEl = el.querySelector('[data-role="exp"]') as HTMLElement;
  const capEl = el.querySelector('[data-role="cap"]') as HTMLElement;
  const soulEl = el.querySelector('[data-role="soul"]') as HTMLElement;

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

  const clampPct = (p: number): string => `${Math.max(0, Math.min(100, p))}%`;

  return {
    el,
    setStats: (stats) => {
      (levelRow.querySelector('.lvl') as HTMLElement).textContent = String(stats.level);
      (levelRow.querySelector('.fill') as HTMLElement).style.width = clampPct(stats.levelPercent);
      (magicRow.querySelector('.lvl') as HTMLElement).textContent = String(stats.magicLevel);
      (magicRow.querySelector('.fill') as HTMLElement).style.width = clampPct(stats.magicLevelPercent);
      expEl.textContent = stats.experience.toLocaleString();
      capEl.textContent = String(stats.capacity);
      soulEl.textContent = String(stats.soul);
    },
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
