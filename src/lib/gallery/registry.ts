/**
 * The component registry for the /ui-components.html gallery.
 *
 * Every entry mounts one UI component in isolation and returns a
 * teardown. The contract this page enforces is the same one the
 * components live by in the game: a factory that takes params, a handle
 * with update methods + destroy, no hidden dependencies on page CSS.
 * If a component can't render here, it isn't standalone — fix the
 * component, not the gallery.
 */

import { createJoystick } from '../joystick';
import { createDevControls } from '../devControls';
import { createHud } from '../hud';
import { createSpellBar } from '../spellBar';
import { createSkillPane, SKILL_NAMES } from '../skillPane';
import { createGameMenu } from '../gameMenu';
import { showStorageNotice } from '../storageNotice';
import { createInventoryPane, INVENTORY_SLOTS } from '../inventoryPane';
import { createSettingsPane } from '../settingsPane';
import { createMinimap, minimapIndexToRgb } from '../minimap';
import { createBattleList } from '../battleList';
import { createVipList } from '../vipList';
import { createSpellCustomizer } from '../spellCustomizer';
import { DEFAULT_SLOTS } from '../spells';
import { createCombatModes } from '../combatModes';
import { createStatusBar, StatusIcon } from '../statusBar';
import { createMetricsOverlay } from '../jamera/metricsOverlay';
import { reportMetric } from '../jamera/metrics';
import { createChangelogPane } from '../changelogPane';
import { CHANGELOG } from '../changelog';
import { ChatManager } from '../chat/ChatManager';
import { createChatUI } from '../chat/ChatUI';
import { createFullChatView } from '../chat/FullChatView';
import { GameProtocol } from '../net/7.6/GameProtocol';
import { MessageType, ChannelId } from '../net/common/types';

export interface GalleryCtx {
  /** Inline area inside the gallery card (fixed-position components ignore it). */
  stage: HTMLElement;
  knobs: {
    button(label: string, fn: () => void): void;
    toggle(label: string, initial: boolean, fn: (on: boolean) => void): void;
  };
  log(msg: string): void;
}

export interface GalleryEntry {
  name: string;
  description: string;
  /** Mount the component; return a teardown that fully removes it. */
  mount(ctx: GalleryCtx): () => void;
}

export const ENTRIES: GalleryEntry[] = [
  {
    name: 'Joystick',
    description:
      'Touch joystick (bottom-left). Drag the knob — the active cardinal '
      + 'direction lands in the event log. Dead zone and axis hysteresis '
      + 'prevent accidental flips near diagonals.',
    mount({ knobs, log }) {
      const joystick = createJoystick({
        onChange: (dir) => log(`direction: ${dir === null ? 'released' : dir}`),
      });
      // The factory starts hidden (the game shows it only on coarse-pointer
      // devices); the gallery always wants it on screen.
      joystick.setVisible(true);
      knobs.toggle('Visible', true, (on) => joystick.setVisible(on));
      return () => joystick.destroy();
    },
  },

  {
    name: 'HUD',
    description:
      'Health/mana bars + level badge (top-left). The stats shape mirrors '
      + 'the 7.6 AddPlayerStats packet (0xA0), so the live wire-up is a '
      + 'field-for-field map.',
    mount({ knobs, log }) {
      const stats = { health: 150, maxHealth: 185, mana: 35, maxMana: 90, level: 12 };
      const hud = createHud(stats);
      const apply = () => { hud.setStats({ ...stats }); };
      knobs.button('Take 25 damage', () => {
        stats.health = Math.max(0, stats.health - 25);
        apply(); log(`hp ${stats.health}/${stats.maxHealth}`);
      });
      knobs.button('Heal 40', () => {
        stats.health = Math.min(stats.maxHealth, stats.health + 40);
        apply(); log(`hp ${stats.health}/${stats.maxHealth}`);
      });
      knobs.button('Spend 20 mana', () => {
        stats.mana = Math.max(0, stats.mana - 20);
        apply(); log(`mana ${stats.mana}/${stats.maxMana}`);
      });
      knobs.button('Level up', () => {
        stats.level += 1;
        stats.maxHealth += 15; stats.health = stats.maxHealth;
        stats.maxMana += 10; stats.mana = stats.maxMana;
        apply(); log(`level ${stats.level}!`);
      });
      knobs.toggle('Visible', true, (on) => hud.setVisible(on));
      return () => hud.destroy();
    },
  },

  {
    name: 'Spell bar',
    description:
      'Cast buttons fanned along a quarter-circle hugging the '
      + 'bottom-right corner (MOBA-style): slot 1 sits left of the big '
      + 'corner anchor (the ⚔ auto-attack toggle in game), the last '
      + 'slot straight above it. Faces are the tibia.com spell library '
      + 'images (emoji fallback); cooldown presses are swallowed and '
      + 'buttons can be disabled (e.g. not enough mana). Configure '
      + 'slots via menu → Hotkeys.',
    mount({ knobs, log }) {
      const bar = createSpellBar({
        spells: [
          { id: 'exura', label: 'exura', iconUrl: '/assets/spells/lighthealing.png', cooldownMs: 1000 },
          { id: 'exori', label: 'exori', cooldownMs: 4000 },
          { id: 'utani-hur', label: 'haste', iconUrl: '/assets/spells/haste.png', cooldownMs: 2000 },
        ],
        onCast: (id) => log(`cast: ${id}`),
      });
      // The in-game ⚔ anchor, so the gallery shows the full corner shape.
      const anchor = document.createElement('button');
      anchor.type = 'button';
      anchor.className = 'anchor';
      anchor.textContent = '⚔';
      anchor.addEventListener('click', () => log('anchor (auto-attack) tapped'));
      bar.el.prepend(anchor);
      knobs.button('Trigger exori cooldown externally', () => bar.triggerCooldown('exori'));
      knobs.toggle('exura enabled', true, (on) => bar.setEnabled('exura', on));
      knobs.toggle('Visible', true, (on) => bar.setVisible(on));
      return () => bar.destroy();
    },
  },

  {
    name: 'Skill pane',
    description:
      'Character block (level with the RED progress bar, experience, '
      + 'magic, capacity, soul — from 0xA0) above the seven 7.6 skills '
      + 'with progress bars (0xA1, wire order).',
    mount({ knobs, log }) {
      const pane = createSkillPane();
      const stats = {
        level: 80, levelPercent: 35, experience: 85_316_000,
        magicLevel: 22, magicLevelPercent: 60, capacity: 2000, soul: 100,
      };
      pane.setStats(stats);
      knobs.button('Gain experience (level bar is RED)', () => {
        stats.levelPercent = (stats.levelPercent + 20) % 100;
        stats.experience += 120_000;
        pane.setStats(stats);
        log(`xp → ${stats.experience.toLocaleString()} (${stats.levelPercent}%)`);
      });
      const levels = new Map(SKILL_NAMES.map((n) => [n, { level: 10, percent: 0 }]));
      for (const name of SKILL_NAMES) pane.setSkill(name, 10, 0);
      knobs.button('Train a random skill', () => {
        const name = SKILL_NAMES[Math.floor(Math.random() * SKILL_NAMES.length)];
        const s = levels.get(name)!;
        s.percent += 15 + Math.floor(Math.random() * 30);
        if (s.percent >= 100) { s.level += 1; s.percent = 0; log(`${name} advanced to ${s.level}!`); }
        pane.setSkill(name, s.level, s.percent);
      });
      knobs.toggle('Visible', true, (on) => pane.setVisible(on));
      return () => pane.destroy();
    },
  },

  {
    name: 'Game menu',
    description:
      'Hamburger button (top-right) sliding in a contextual menu pane — '
      + 'the one mobile surface. In-game it hosts: Inventory, Chat, '
      + 'Battle, VIP, Spells, Settings, Changelog, Log out.',
    mount({ knobs, log }) {
      const menu = createGameMenu([
        { label: 'Inventory', onSelect: () => log('selected: Inventory') },
        { label: 'Chat', onSelect: () => log('selected: Chat') },
        { label: 'Battle', onSelect: () => log('selected: Battle') },
        { label: 'VIP', onSelect: () => log('selected: VIP') },
        { label: 'Spells', onSelect: () => log('selected: Spells') },
        { label: 'Settings', onSelect: () => log('selected: Settings') },
        { label: 'Changelog', onSelect: () => log('selected: Changelog') },
        { label: 'Log out', onSelect: () => log('selected: Log out') },
      ]);
      knobs.button('Open', () => menu.open());
      knobs.button('Close', () => menu.close());
      knobs.button('Swap to short item set', () => {
        menu.setItems([{ label: 'Only one item', onSelect: () => log('selected: Only one item') }]);
        log('items swapped');
      });
      return () => menu.destroy();
    },
  },

  {
    name: 'Inventory',
    description:
      'Classic 10-slot equipment cross (right edge), wire order per the '
      + 'server\'s creature.h. In-game, slots render real item sprites '
      + 'from the atlas; here (no atlas) they fall back to the textual '
      + '#id form — the same fallback pre-asset mounts use.',
    mount({ knobs, log }) {
      const pane = createInventoryPane();
      knobs.button('Equip a kit', () => {
        pane.setSlot('head', 2457); pane.setSlot('armor', 2463);
        pane.setSlot('legs', 2647); pane.setSlot('feet', 2643);
        pane.setSlot('left', 2376); pane.setSlot('right', 2530);
        pane.setSlot('backpack', 1988); pane.setSlot('ammo', 2544, 38);
        log('full kit equipped');
      });
      knobs.button('Clear armor slot', () => { pane.setSlot('armor', null); log('armor cleared'); });
      knobs.button('Stack arrows +25', () => { pane.setSlot('ammo', 2544, 63); log('ammo count 63'); });
      knobs.toggle('Visible', true, (on) => pane.setVisible(on));
      log(`slots: ${INVENTORY_SLOTS.join(', ')}`);
      return () => pane.destroy();
    },
  },

  {
    name: 'Minimap',
    description:
      'Automap (left edge, under the HUD): known tiles painted from '
      + 'their .dat MinimapColor in the original 216-color palette, '
      + 'player dot centered, unknown tiles black.',
    mount({ knobs, log }) {
      let cx = 100, cy = 100;
      const minimap = createMinimap({
        getCenter: () => ({ x: cx, y: cy, z: 7 }),
        tileColor: (x, y) => {
          // Synthetic terrain: grass with a river and a road.
          if (Math.abs(x - 100) > 24 || Math.abs(y - 100) > 24) return null;
          if (Math.abs(x - y) < 2) return minimapIndexToRgb(51);  // water-ish
          if (y === 96) return minimapIndexToRgb(129);            // road-ish
          return minimapIndexToRgb(24);                           // grass-ish
        },
      });
      knobs.button('Walk east', () => { cx += 1; minimap.refresh(); log(`center ${cx},${cy}`); });
      knobs.button('Walk south', () => { cy += 1; minimap.refresh(); log(`center ${cx},${cy}`); });
      knobs.toggle('Visible', true, (on) => minimap.setVisible(on));
      return () => minimap.destroy();
    },
  },

  {
    name: 'Combat modes',
    description:
      'The classic trio (right edge, above the spell bar): fight stance '
      + 'cycles offensive/balanced/defensive, chase follows the target, '
      + 'secure mode blocks attacking players. Wire: one 0xA0 per change.',
    mount({ knobs, log }) {
      const modes = createCombatModes({
        onChange: (s) => log(`0xA0 fight=${s.fightMode} chase=${s.chase} secure=${s.secure}`),
      });
      knobs.button('Force defensive externally', () => modes.setState({ fightMode: 3 }));
      knobs.toggle('Visible', true, (on) => modes.setVisible(on));
      return () => modes.destroy();
    },
  },

  {
    name: 'Status bar',
    description:
      'Player condition chips (top-left, under the HUD) from the 0xA2 '
      + 'icon bitmask: poison, burn, energy, drunk, mana shield, '
      + 'paralyze, haste, in-fight. Hidden entirely when no condition.',
    mount({ knobs, log }) {
      const bar = createStatusBar();
      let mask = 0;
      const apply = () => { bar.setIcons(mask); log(`mask = ${mask}`); };
      knobs.button('Toggle poison', () => { mask ^= StatusIcon.Poison; apply(); });
      knobs.button('Toggle haste', () => { mask ^= StatusIcon.Haste; apply(); });
      knobs.button('Toggle in-fight ⚔', () => { mask ^= StatusIcon.InFight; apply(); });
      knobs.button('Everything at once', () => { mask = 255; apply(); });
      knobs.button('Clear', () => { mask = 0; apply(); });
      return () => bar.destroy();
    },
  },

  {
    name: 'Battle list',
    description:
      'Visible creatures with name + health bar (left edge), tap to '
      + 'target — routes through the combat binding so the ⚔ circle and '
      + 'sticky targeting stay in sync. Toggled from the menu (Battle).',
    mount({ knobs, log }) {
      let targeted = 0;
      const entries = [
        { id: 1, name: 'Rat', healthPercent: 100 },
        { id: 2, name: 'Cave Rat', healthPercent: 62 },
        { id: 3, name: 'Rotworm', healthPercent: 18 },
      ];
      const render = () => list.setEntries(entries.map((e) => ({ ...e, targeted: e.id === targeted })));
      const list = createBattleList({
        onSelect: (id) => {
          targeted = targeted === id ? 0 : id;
          render();
          log(`target → ${targeted || 'none'}`);
        },
      });
      render();
      knobs.button('Damage the rat', () => {
        entries[0].healthPercent = Math.max(0, entries[0].healthPercent - 25);
        render();
      });
      knobs.toggle('Visible', true, (on) => list.setVisible(on));
      return () => list.destroy();
    },
  },

  {
    name: 'Spell customizer',
    description:
      'Hotkeys menu (menu → Hotkeys): tap a slot to open the full spell '
      + 'picker — every castable spell on the server, with tibia.com '
      + 'library icons. Picking a spell already on another slot swaps '
      + 'the two. Changes apply to the live spell bar immediately.',
    mount({ knobs, log }) {
      const customizer = createSpellCustomizer({
        initial: [...DEFAULT_SLOTS],
        onChange: (slots) => log(`slots → ${slots.join(' | ')}`),
      });
      knobs.button('Open', () => customizer.open());
      knobs.button('Close', () => customizer.close());
      return () => customizer.destroy();
    },
  },

  {
    name: 'VIP list',
    description:
      'Friends with online status (menu → VIP): 0xD2 entries, 0xD3/0xD4 '
      + 'online flips, add by name (0xDC), remove by guid (0xDD). Online '
      + 'first, then alphabetical.',
    mount({ knobs, log }) {
      const entries = [
        { guid: 1, name: 'GOD Bruno', online: true },
        { guid: 2, name: 'Squirrel', online: false },
        { guid: 3, name: 'Gurz', online: true },
      ];
      const vip = createVipList({
        onAdd: (name) => { log(`0xDC add "${name}"`); },
        onRemove: (guid) => { log(`0xDD remove #${guid}`); },
      });
      vip.setEntries(entries);
      knobs.button('Open', () => vip.open());
      knobs.button('Squirrel logs in', () => {
        entries[1].online = true;
        vip.setEntries(entries);
        log('0xD3 → Squirrel online');
      });
      return () => vip.destroy();
    },
  },

  {
    name: 'Settings',
    description:
      'Settings overlay (menu → Settings): toggle rows that adapt live '
      + 'game state via get/set — the pane re-reads state every open, so '
      + 'it stays in sync with other control surfaces like the ⚔ circle.',
    mount({ knobs, log }) {
      let attacking = false;
      let sound = true;
      const pane = createSettingsPane([
        {
          label: 'Auto-attack',
          hint: 'Same switch as the ⚔ circle on the combat bar.',
          get: () => attacking,
          set: (on) => { attacking = on; log(`auto-attack: ${on}`); },
        },
        {
          label: 'Sound (demo row)',
          get: () => sound,
          set: (on) => { sound = on; log(`sound: ${on}`); },
        },
      ]);
      knobs.button('Open', () => pane.open());
      knobs.button('Close', () => pane.close());
      knobs.button('Flip auto-attack externally (⚔)', () => {
        attacking = !attacking;
        log(`external flip → ${attacking}; reopen to see the switch sync`);
      });
      return () => pane.destroy();
    },
  },

  {
    name: 'Changelog',
    description:
      'In-game changelog (menu → Changelog): one line per user-visible '
      + 'change merged to main, newest first, grouped by date — what to '
      + 'test and what changed. Every merge appends its line.',
    mount({ knobs, log }) {
      const pane = createChangelogPane();
      knobs.button('Open', () => pane.open());
      knobs.button('Close', () => pane.close());
      knobs.button('Toggle', () => pane.toggle());
      log(`${CHANGELOG.length} entries, latest: ${CHANGELOG[0]?.text}`);
      return () => pane.destroy();
    },
  },

  {
    name: 'Metrics overlay',
    description:
      'Dev metrics (top-center): FPS, walk-step latency (network + '
      + 'server), repaint cost (device CPU) — the walk-lag decomposition. '
      + 'In-game: Settings → Show metrics, or ?metrics=1.',
    mount({ knobs, log }) {
      const overlay = createMetricsOverlay();
      knobs.button('Report step 180ms', () => { reportMetric('step', 180); log('step 180ms'); });
      knobs.button('Report step 520ms', () => { reportMetric('step', 520); log('step 520ms'); });
      knobs.button('Report repaint 6ms', () => { reportMetric('repaint', 6); log('repaint 6ms'); });
      knobs.button('Report repaint 48ms (slow device)', () => { reportMetric('repaint', 48); log('repaint 48ms'); });
      return () => overlay.destroy();
    },
  },

  {
    name: 'Storage notice',
    description:
      'Dismissable toast (bottom-center) for storage events: quota '
      + 'pressure, browser eviction, no IndexedDB. One at a time, latest '
      + 'wins, click to dismiss, 15s auto-hide.',
    mount({ knobs }) {
      knobs.button('Quota warning', () => showStorageNotice(
        'Your device is low on storage (~100 MB needed, about 30 MB available). '
        + 'The game still runs, but it can\'t save assets for instant offline play.',
      ));
      knobs.button('Evicted notice', () => showStorageNotice(
        'Your saved game assets were cleared by the browser to free up space. '
        + 'They will be saved again after this load.',
      ));
      knobs.button('No-IndexedDB notice', () => showStorageNotice(
        'This browser can\'t store game assets, so offline play and instant boots are unavailable here.',
      ));
      return () => document.querySelector('.storage-notice')?.remove();
    },
  },

  {
    name: 'Dev controls',
    description:
      'Collapsible developer toggle panel (top-right). Interim surface — '
      + 'its entries are planned to fold into the Game menu.',
    mount({ knobs, log }) {
      const controls = createDevControls([
        { label: 'Night mode', defaultOn: false, onChange: (on) => log(`Night mode: ${on}`) },
        { label: 'Show light sources', defaultOn: true, onChange: (on) => log(`Show light sources: ${on}`) },
        { label: 'Free zoom', defaultOn: false, onChange: (on) => log(`Free zoom: ${on}`) },
      ]);
      knobs.button('Force "Night mode" on (external)', () => controls.setToggle('Night mode', true));
      knobs.toggle('Visible', true, (on) => controls.setVisible(on));
      return () => controls.destroy();
    },
  },

  {
    name: 'Chat',
    description:
      'Chat overlay (bottom): tabs, message list, input with /w, /whisper '
      + 'and /yell commands. Outgoing packets land in the event log as '
      + 'opcode bytes. The XSS knob proves hostile sender names render '
      + 'as text.',
    mount({ knobs, log }) {
      const manager = new ChatManager();
      const protocol = new GameProtocol();
      const ui = createChatUI(manager, protocol, (packet) => {
        const bytes = packet.toUint8Array();
        log(`sent packet: 0x${bytes[0].toString(16).padStart(2, '0')} (${bytes.length} bytes)`);
      }, {
        onClose: () => { ui.el.style.display = 'none'; log('chat closed (✕)'); },
      });
      document.body.appendChild(ui.el);
      knobs.button('Reopen chat', () => { ui.el.style.display = 'flex'; });
      let n = 0;
      knobs.button('Incoming say', () => manager.handleMessage({
        senderName: 'Trinity', messageType: MessageType.Say,
        text: `hello from the gallery #${++n}`, timestamp: Date.now(),
      }));
      knobs.button('Incoming Game Chat msg', () => manager.handleMessage({
        senderName: 'Loot Goblin', messageType: MessageType.Channel,
        channelId: ChannelId.GameChat, text: 'channel message', timestamp: Date.now(),
      }));
      knobs.button('Hostile sender name (XSS check)', () => manager.handleMessage({
        senderName: '<img src=x onerror=alert(1)>', messageType: MessageType.Say,
        text: '<b>not bold</b>', timestamp: Date.now(),
      }));
      knobs.button('Spam 50 messages', () => {
        for (let i = 0; i < 50; i++) {
          manager.handleMessage({
            senderName: 'Spammer', messageType: MessageType.Say,
            text: `spam ${i}`, timestamp: Date.now(),
          });
        }
      });
      return () => ui.destroy();
    },
  },

  {
    name: 'Full chat',
    description:
      'Full-screen chat interface (menu → Chat) — a second consumer of '
      + 'the ChatManager API. Shares history and channels with the '
      + 'compact overlay; both re-render via ChatManager.subscribe.',
    mount({ knobs, log }) {
      const manager = new ChatManager();
      const protocol = new GameProtocol();
      const view = createFullChatView(manager, protocol, (packet) => {
        const bytes = packet.toUint8Array();
        log(`sent packet: 0x${bytes[0].toString(16).padStart(2, '0')} (${bytes.length} bytes)`);
      });
      let n = 0;
      knobs.button('Open', () => view.open());
      knobs.button('Close', () => view.close());
      knobs.button('Incoming say', () => manager.handleMessage({
        senderName: 'Trinity', messageType: MessageType.Say,
        text: `full view message #${++n}`, timestamp: Date.now(),
      }));
      return () => view.destroy();
    },
  },
];
