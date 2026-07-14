import type { Application } from 'pixi.js';
import type { GameClient } from '../net/common/GameClient';
import type { WirePosition } from '../net/common/types';
import type { GameWorld } from '../GameWorld';
import { DatAttr, type ThingType } from '../dat';
import { findWalkRoute } from './autowalk';
import { spriteIndex } from '../tileRenderer';
import { TILE_SIZE } from '../../constants';
import { font, radius, space, surface, zIndex } from '../ui/tokens';
import { loadTapToWalk } from './interactionPreferences';

/**
 * World-interaction input on the game canvas:
 *
 *  - LOOK (0x8C): right-click on desktop, long-press (~500ms without
 *    moving) on touch. The server's "You see ..." answer arrives as a
 *    0xB4 text message, which the chat binding already routes into the
 *    default channel — signs read themselves.
 *  - USE (0x82): double-click / double-tap. Ladders, ropes spots, sewer
 *    grates, doors, levers. (Stairs and holes don't need this — walking
 *    onto them floor-changes server-side already.)
 *
 * Targeting: look resolves the top thing of the tapped tile, while use
 * resolves the top item. The server resolves the thing by position+stackpos,
 * and that stackpos indexes the full wire-ordered tile.things array
 * (including creatures).
 *
 * USE WITH (0x83): armed from an action sheet (armUseWith). While armed
 * the next tap/click resolves the tapped tile's top thing as the target
 * and sends UseItemEx instead of walking/looking/using; a long-press,
 * the hint's ✕, or cancelUseWith disarms without sending.
 */
export interface InteractionsHandle {
  /** Arm crosshair mode: the next canvas tap uses `from` on the tapped thing. */
  armUseWith(from: ThingRef): void;
  /** Disarm crosshair mode without sending anything. */
  cancelUseWith(): void;
  destroy(): void;
}

/** A thing addressed the way the wire wants: position + sprite id + stackpos. */
export interface ThingRef {
  readonly position: WirePosition;
  readonly thingId: number;
  readonly stackPos: number;
}

export interface InteractionsOptions {
  /**
   * Window id to put in 0x82's trailing index byte — the server opens a
   * used container under exactly this id (actions.cpp), so without it a
   * second container replaces the first window. Wired to
   * ContainerManager.nextFreeId for .dat Container items; absent (tests,
   * pre-container mounts, non-container uses) the packet uses window 0.
   */
  nextContainerId?: (target: ThingRef) => number;
  /**
   * Client ids of floor-changing items (from the OTB) — stairs/holes
   * flag NotWalkable in the .dat, so without this set tap-to-walk can't
   * target them and going up/down by tap silently does nothing.
   */
  floorChangeIds?: Set<number>;
  /** OTB Useable ids: containers/corpses, doors, ladders and levers. */
  useableIds?: Set<number>;
  /** Live preference adapter. Defaults to the persisted mobile setting. */
  tapToWalk?: () => boolean;
  /** Select/attack a tapped non-player creature through the combat binding. */
  onCreatureTap?: (creatureId: number) => void;
}

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 12;
/** How long after a touch tap a (legacy, pointerType-less) synthesized
 *  click is still attributed to that tap and dropped. */
const SYNTHESIZED_CLICK_MS = 500;

const HINT_STYLE_ID = 'use-with-hint-style';
const TAP_FEEDBACK_STYLE_ID = 'tap-feedback-style';

function ensureHintStyles(): void {
  if (document.getElementById(HINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HINT_STYLE_ID;
  style.textContent = `
    .use-with-hint {
      position: fixed; top: calc(${space.lg}px + env(safe-area-inset-top, 0px));
      left: 50%; transform: translateX(-50%); z-index: ${zIndex.hud};
      display: flex; align-items: center; gap: ${space.lg}px;
      padding: ${space.lg}px ${space.xl}px;
      background: ${surface.panelBg}; border: 1px solid ${surface.panelBorder};
      border-radius: ${radius.lg}px; color: ${surface.textPrimary};
      font-family: ${font.ui}; font-size: ${font.sizeMd}rem; user-select: none;
    }
    .use-with-hint button {
      background: none; border: none; color: ${surface.textMuted};
      font-size: ${font.sizeLg}rem; cursor: pointer; padding: 0 ${space.sm}px;
    }
  `;
  document.head.appendChild(style);
}

type TapFeedbackKind = 'walk' | 'use' | 'attack';

function showTapFeedback(clientX: number, clientY: number, kind: TapFeedbackKind): void {
  if (!document.getElementById(TAP_FEEDBACK_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = TAP_FEEDBACK_STYLE_ID;
    style.textContent = `
      .world-tap-feedback {
        position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px;
        z-index: ${zIndex.hud}; border: 2px solid #eee; border-radius: 50%;
        pointer-events: none; animation: world-tap-pop 360ms ease-out forwards;
      }
      .world-tap-feedback.use { border-color: #ffd45a; }
      .world-tap-feedback.attack { border-color: #ff5f57; }
      @keyframes world-tap-pop {
        from { opacity: 0.95; transform: scale(0.45); }
        to { opacity: 0; transform: scale(1.45); }
      }
    `;
    document.head.appendChild(style);
  }
  const marker = document.createElement('div');
  marker.className = `world-tap-feedback ${kind}`;
  marker.style.left = `${clientX}px`;
  marker.style.top = `${clientY}px`;
  document.body.appendChild(marker);
  marker.addEventListener('animationend', () => marker.remove(), { once: true });
  setTimeout(() => marker.remove(), 500);
}

/**
 * Canvas-space pixel → world tile, inverting the renderer's centering
 * math. Callers must convert viewport (client) coordinates to canvas
 * space first — see toCanvasSpace.
 */
export function screenToWorldTile(
  app: Application,
  world: GameWorld,
  clientX: number,
  clientY: number,
): { x: number; y: number; z: number } {
  // The stage carries the viewport cover-zoom; one on-screen tile is
  // TILE_SIZE × zoom canvas pixels. (Tests stub `app` without a stage.)
  const zoom = app.stage?.scale?.x || 1;
  const dxTiles = (clientX - app.screen.width / 2) / (TILE_SIZE * zoom);
  const dyTiles = (clientY - app.screen.height / 2) / (TILE_SIZE * zoom);
  return {
    x: Math.floor(world.playerX + 0.5 + dxTiles),
    y: Math.floor(world.playerY + 0.5 + dyTiles),
    z: world.playerZ,
  };
}

/**
 * Viewport (clientX/Y) → canvas-space coordinates, robust to the canvas
 * being offset, letterboxed, or CSS-scaled relative to its logical
 * app.screen size.
 */
export function toCanvasSpace(
  canvas: HTMLCanvasElement,
  screen: { width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (screen.width / rect.width),
    y: (clientY - rect.top) * (screen.height / rect.height),
  };
}

/**
 * Resolve a tap on visible floor-change artwork to the item's anchor tile.
 *
 * DAT sprites are anchored at their bottom-right tile and may extend up and
 * left over neighbouring tiles.  A 2x2 stair therefore has only one logical
 * floor-change tile but four visible tile-sized pieces.  Grid-only hit testing
 * makes three of those pieces walk to ordinary ground instead of the stair.
 */
export function floorChangeTileAtPointer(
  world: GameWorld,
  datIndex: Map<number, ThingType>,
  pointedTile: WirePosition,
  floorChangeIds?: Set<number>,
): WirePosition {
  if (!floorChangeIds || floorChangeIds.size === 0) return pointedTile;

  let maxWidth = 1;
  let maxHeight = 1;
  for (const id of floorChangeIds) {
    const frame = datIndex.get(id)?.frameGroup;
    if (!frame) continue;
    maxWidth = Math.max(maxWidth, frame.width);
    maxHeight = Math.max(maxHeight, frame.height);
  }

  // Anchors whose sprites cover the pointed tile can only lie down/right of
  // it. Iterate in reverse render order so overlapping artwork selects the
  // visually topmost (most south-eastern) stair.
  for (let anchorY = pointedTile.y + maxHeight - 1; anchorY >= pointedTile.y; anchorY--) {
    for (let anchorX = pointedTile.x + maxWidth - 1; anchorX >= pointedTile.x; anchorX--) {
      const tile = world.getTile(anchorX, anchorY, pointedTile.z);
      if (!tile) continue;

      for (let itemIndex = tile.items.length - 1; itemIndex >= 0; itemIndex--) {
        const item = tile.items[itemIndex];
        if (!floorChangeIds.has(item.id)) continue;
        const frame = datIndex.get(item.id)?.frameGroup;
        if (!frame) continue;

        const pieceX = anchorX - pointedTile.x;
        const pieceY = anchorY - pointedTile.y;
        if (pieceX >= frame.width || pieceY >= frame.height) continue;

        const patX = ((anchorX % frame.numPatternX) + frame.numPatternX) % frame.numPatternX;
        const patY = ((anchorY % frame.numPatternY) + frame.numPatternY) % frame.numPatternY;
        let hasVisiblePiece = false;
        for (let layer = 0; layer < frame.layers; layer++) {
          if (frame.spriteIds[spriteIndex(frame, 0, patX, patY, layer, pieceY, pieceX)]) {
            hasVisiblePiece = true;
            break;
          }
        }
        if (hasVisiblePiece) return { x: anchorX, y: anchorY, z: pointedTile.z };
      }
    }
  }

  return pointedTile;
}

export function bindInteractions(
  client: GameClient,
  world: GameWorld,
  app: Application,
  // Tap-to-walk needs the .dat walkability flags; without them taps
  // only look/use (tests and pre-asset mounts pass undefined).
  datIndex?: Map<number, ThingType>,
  opts: InteractionsOptions = {},
): InteractionsHandle {
  const canvas = app.canvas as HTMLCanvasElement;
  const protocol = client.getProtocol();

  function worldTileAtPointer(clientX: number, clientY: number): WirePosition {
    const canvasPoint = toCanvasSpace(canvas, app.screen, clientX, clientY);
    return screenToWorldTile(app, world, canvasPoint.x, canvasPoint.y);
  }

  function topStackThingAtTile(position: WirePosition): ThingRef | null {
    const tile = world.getTile(position.x, position.y, position.z);
    if (!tile || tile.things.length === 0) return null;

    const stackPos = tile.things.length - 1;
    const thing = tile.things[stackPos];
    // stackPos is the resolver the server actually uses for look; the
    // thingId is an advisory sprite/clientId that 7.6 LookAt ignores
    // (the server returns getTopThing()). For a creature there is no
    // sprite id, so the runtime id is sent purely as a placeholder — it
    // is never validated, and is masked to U16 since a 32-bit creature id
    // would not round-trip the field.
    return {
      position,
      thingId: thing.kind === 'item' ? thing.item.id : (thing.creature.id & 0xffff),
      stackPos,
    };
  }

  function topStackItemAtTile(position: WirePosition, ids?: Set<number>): ThingRef | null {
    const tile = world.getTile(position.x, position.y, position.z);
    if (!tile || tile.items.length === 0) return null;

    for (let stackPos = tile.things.length - 1; stackPos >= 0; stackPos--) {
      const thing = tile.things[stackPos];
      if (thing.kind === 'item' && (!ids || ids.has(thing.item.id))) {
        return { position, thingId: thing.item.id, stackPos };
      }
    }
    return null;
  }

  function isContainerTarget(target: ThingRef): boolean {
    return datIndex?.get(target.thingId)?.attrs.has(DatAttr.Container) ?? false;
  }

  function send(packet: { toUint8Array(): Uint8Array }): void {
    try {
      client.send(packet as Parameters<GameClient['send']>[0]);
    } catch (e) {
      console.warn('[jamera] interaction send failed:', e instanceof Error ? e.message : e);
    }
  }

  function look(clientX: number, clientY: number): void {
    const target = topStackThingAtTile(worldTileAtPointer(clientX, clientY));
    if (!target) return;
    send(protocol.actions.buildLookAt(target.position, target.thingId, target.stackPos));
  }

  function use(clientX: number, clientY: number, ids?: Set<number>): void {
    const target = topStackItemAtTile(worldTileAtPointer(clientX, clientY), ids);
    if (!target) return;
    // The byte is always sent, but only real containers should reserve an
    // id; doors/ladders/ropes may also use 0x82 and never answer with 0x6E.
    const containerId = isContainerTarget(target) ? opts.nextContainerId?.(target) ?? 0 : 0;
    send(protocol.actions.buildUseItem(
      target.position, target.thingId, target.stackPos,
      containerId,
    ));
  }

  function tileHasUseableItem(position: WirePosition): boolean {
    if (!opts.useableIds?.size) return false;
    const tile = world.getTile(position.x, position.y, position.z);
    return tile?.items.some((item) => opts.useableIds!.has(item.id)) ?? false;
  }

  function topCreatureAtTile(position: WirePosition): number | null {
    const tile = world.getTile(position.x, position.y, position.z);
    if (!tile) return null;
    for (let i = tile.things.length - 1; i >= 0; i--) {
      const thing = tile.things[i];
      if (thing.kind === 'creature' && thing.creature.id !== world.playerCreatureId) {
        return thing.creature.id;
      }
    }
    return null;
  }

  // Tap/click-to-walk: A* over the known window, sent as one 0x64
  // autowalk — the server walks the route and confirms each step like
  // manual moves. A tap that starts a double-tap still walks first
  // (one step toward a ladder before using it is what the original
  // client does too); a new tap simply replaces the route server-side.
  function walkTo(clientX: number, clientY: number): void {
    if (!datIndex) return;
    const pos = floorChangeTileAtPointer(
      world,
      datIndex,
      worldTileAtPointer(clientX, clientY),
      opts.floorChangeIds,
    );
    const route = findWalkRoute(world, datIndex, pos.x, pos.y, opts.floorChangeIds);
    if (!route || route.length === 0) return;
    send(protocol.movement.buildAutoWalk(route));
  }

  /**
   * Mobile's primary gesture. Floor-change artwork is always a walk target;
   * an OTB-useable item is used in place; ordinary ground walks only while
   * Tap to walk is enabled. This avoids depending on iOS WebKit to synthesize
   * dblclick after a double-tap (it frequently does not).
   */
  function smartTouchTap(clientX: number, clientY: number): void {
    const pointed = worldTileAtPointer(clientX, clientY);
    const creatureId = topCreatureAtTile(pointed);
    if (creatureId !== null && opts.onCreatureTap) {
      showTapFeedback(clientX, clientY, 'attack');
      opts.onCreatureTap(creatureId);
      return;
    }
    const floorTarget = datIndex
      ? floorChangeTileAtPointer(world, datIndex, pointed, opts.floorChangeIds)
      : pointed;
    const isFloorChange = floorTarget.x !== pointed.x || floorTarget.y !== pointed.y
      || (world.getTile(pointed.x, pointed.y, pointed.z)?.items
        .some((item) => opts.floorChangeIds?.has(item.id)) ?? false);
    if (isFloorChange) {
      showTapFeedback(clientX, clientY, 'walk');
      walkTo(clientX, clientY);
      return;
    }
    if (tileHasUseableItem(pointed)) {
      showTapFeedback(clientX, clientY, 'use');
      use(clientX, clientY, opts.useableIds);
      return;
    }
    if ((opts.tapToWalk ?? loadTapToWalk)()) {
      showTapFeedback(clientX, clientY, 'walk');
      walkTo(clientX, clientY);
    }
  }

  // Crosshair (use-with) mode: armed from an action sheet, consumed by
  // the next tap/click. A miss (empty tile) still disarms — the tap was
  // the player's one answer to "on what?".
  let armedUseWith: ThingRef | null = null;
  let lastTouchTapAt = 0;
  let hint: HTMLElement | null = null;

  function cancelUseWith(): void {
    armedUseWith = null;
    canvas.style.cursor = '';
    hint?.remove();
    hint = null;
  }

  function armUseWith(from: ThingRef): void {
    cancelUseWith();
    armedUseWith = from;
    canvas.style.cursor = 'crosshair';
    ensureHintStyles();
    hint = document.createElement('div');
    hint.className = 'use-with-hint';
    const label = document.createElement('span');
    label.textContent = 'Tap a target…';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.setAttribute('aria-label', 'Cancel use with');
    cancel.textContent = '✕';
    cancel.addEventListener('click', cancelUseWith);
    hint.append(label, cancel);
    document.body.appendChild(hint);
  }

  function fireUseWith(clientX: number, clientY: number): void {
    const from = armedUseWith;
    cancelUseWith();
    if (!from) return;
    const target = topStackThingAtTile(worldTileAtPointer(clientX, clientY));
    if (!target) return;
    send(protocol.actions.buildUseItemWith(
      from.position, from.thingId, from.stackPos,
      target.position, target.thingId, target.stackPos,
    ));
  }

  // Desktop: left-click walks, right-click looks, double-click uses.
  // Touch taps walk via pointerup below; browsers also synthesize a
  // click after a tap, so non-mouse clicks are ignored here (browsers
  // old enough to omit pointerType on clicks just send a benign
  // duplicate route).
  const onClick = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    // Legacy browsers synthesize a click after a touch tap WITHOUT a
    // pointerType for the guard below to catch. For plain walking that
    // duplicate was benign (same route); with use-with it would walk the
    // player toward the tile they just targeted — so any click landing
    // right after a processed tap is dropped by timestamp too.
    if (Date.now() - lastTouchTapAt < SYNTHESIZED_CLICK_MS) return;
    const pointerType = (e as PointerEvent).pointerType;
    if (pointerType && pointerType !== 'mouse') return;
    if (armedUseWith) {
      fireUseWith(e.clientX, e.clientY);
      return;
    }
    walkTo(e.clientX, e.clientY);
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    look(e.clientX, e.clientY);
  };
  const onDblClick = (e: MouseEvent): void => {
    use(e.clientX, e.clientY);
  };

  // Touch: a press held LONG_PRESS_MS without wandering looks. The press
  // is bound to one pointerId — a second finger (e.g. on the joystick)
  // must neither cancel the timer nor hijack the press position.
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressX = 0;
  let pressY = 0;
  let activePointerId: number | null = null;
  const cancelPress = (e?: PointerEvent): void => {
    if (e && e.pointerId !== activePointerId) return;
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    activePointerId = null;
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    if (activePointerId !== null) return; // a press is already in flight
    activePointerId = e.pointerId;
    pressX = e.clientX;
    pressY = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      activePointerId = null;
      // While armed, holding is the touch "never mind" — no look.
      if (armedUseWith) {
        cancelUseWith();
        return;
      }
      look(pressX, pressY);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (pressTimer === null || e.pointerId !== activePointerId) return;
    if (Math.abs(e.clientX - pressX) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - pressY) > MOVE_TOLERANCE_PX) {
      cancelPress(e);
    }
  };
  // A release while the long-press timer is still pending and the
  // finger hasn't wandered is a TAP → walk there. (Touch only — mouse
  // walks via the click handler, which ignores synthesized post-touch
  // clicks by pointerType.)
  const onPointerUp = (e: PointerEvent): void => {
    const wasTap =
      e.pointerId === activePointerId &&
      pressTimer !== null &&
      Math.abs(e.clientX - pressX) <= MOVE_TOLERANCE_PX &&
      Math.abs(e.clientY - pressY) <= MOVE_TOLERANCE_PX;
    cancelPress(e);
    if (!wasTap) return;
    lastTouchTapAt = Date.now();
    if (armedUseWith) fireUseWith(e.clientX, e.clientY);
    else smartTouchTap(e.clientX, e.clientY);
  };

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', cancelPress);

  return {
    armUseWith,
    cancelUseWith,
    destroy: () => {
      cancelUseWith();
      cancelPress();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', cancelPress);
    },
  };
}
