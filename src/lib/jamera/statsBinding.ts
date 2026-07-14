import { createHud, type HudHandle } from '../hud';
import { createSkillPane, SKILL_NAMES, type SkillPaneHandle } from '../skillPane';
import { createGameMenu, type GameMenuHandle, type GameMenuItem } from '../gameMenu';
import type { GameClient } from '../net/common/GameClient';
import type { PlayerSkills } from '../net/common/types';

/**
 * Feeds the HUD and skill pane from live player-state packets: 0xA0
 * stats land in the HUD bars, 0xA1 skills in the pane. The pane starts
 * hidden behind a game-menu entry — exactly the surface the gallery
 * prototyped. Registered after registerWireSkips so these override the
 * discard consumers.
 */
export interface StatsBindingHandle {
  destroy(): void;
}

/** 0xA1 wire order → gallery skill-pane display names. */
const WIRE_TO_PANE: ReadonlyArray<{ key: keyof PlayerSkills; name: (typeof SKILL_NAMES)[number] }> = [
  { key: 'fist', name: 'Fist' },
  { key: 'club', name: 'Club' },
  { key: 'sword', name: 'Sword' },
  { key: 'axe', name: 'Axe' },
  { key: 'distance', name: 'Distance' },
  { key: 'shielding', name: 'Shielding' },
  { key: 'fishing', name: 'Fishing' },
];

export function bindStats(
  client: GameClient,
  parent: HTMLElement = document.body,
  extraMenuItems: GameMenuItem[] = [],
): StatsBindingHandle {
  const protocol = client.getProtocol();
  const op = protocol.serverOpcodes;

  let hud: HudHandle | null = null;
  let pane: SkillPaneHandle | null = null;
  let paneOpen = false;

  // The pane's own ✕ and the menu entry flip the SAME flag, so the next
  // menu tap re-opens instead of toggling into a hidden state.
  const makePane = (): SkillPaneHandle => {
    const created = createSkillPane(parent, {
      onClose: () => {
        paneOpen = false;
        created.setVisible(false);
      },
    });
    created.setVisible(paneOpen);
    return created;
  };

  const dispatcher = client.getDispatcher();
  dispatcher.on(op.PlayerStats, (p) => {
    const stats = protocol.player.parseStats(p);
    if (!hud) hud = createHud(stats, parent);
    else hud.setStats(stats);
    // The skills pane shows the character block from the same packet.
    if (!pane) pane = makePane();
    pane.setStats(stats);
  });
  dispatcher.on(op.PlayerSkills, (p) => {
    const skills = protocol.player.parseSkills(p);
    if (!pane) pane = makePane();
    for (const { key, name } of WIRE_TO_PANE) {
      pane.setSkill(name, skills[key].level, skills[key].percent);
    }
  });

  const menu: GameMenuHandle = createGameMenu([
    {
      label: 'Skills',
      onSelect: () => {
        paneOpen = !paneOpen;
        pane?.setVisible(paneOpen);
      },
    },
    ...extraMenuItems,
  ], parent);

  return {
    destroy: () => {
      dispatcher.off(op.PlayerStats);
      dispatcher.off(op.PlayerSkills);
      hud?.destroy();
      pane?.destroy();
      menu.destroy();
    },
  };
}
