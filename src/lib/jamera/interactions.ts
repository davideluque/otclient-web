import type { Application } from 'pixi.js';
import type { GameClient } from '../net/common/GameClient';
import type { WirePosition } from '../net/common/types';
import type { GameWorld } from '../GameWorld';
import type { ThingType } from '../dat';
import { findWalkRoute } from './autowalk';
import { TILE_SIZE } from '../../constants';

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
 */
export interface InteractionsHandle {
  destroy(): void;
}

export interface InteractionsOptions {
  /**
   * Window id to put in 0x82's trailing index byte — the server opens a
   * used container under exactly this id (actions.cpp), so without it a
   * second container replaces the first window. Wired to
   * ContainerManager.nextFreeId; absent (tests, pre-container mounts)
   * every use falls back to window 0.
   */
  nextContainerId?: () => number;
}

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 12;

interface TileStackTarget {
  readonly position: WirePosition;
  readonly thingId: number;
  readonly stackPos: number;
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

  function topStackThingAtTile(position: WirePosition): TileStackTarget | null {
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

  function topStackItemAtTile(position: WirePosition): TileStackTarget | null {
    const tile = world.getTile(position.x, position.y, position.z);
    if (!tile || tile.items.length === 0) return null;

    for (let stackPos = tile.things.length - 1; stackPos >= 0; stackPos--) {
      const thing = tile.things[stackPos];
      if (thing.kind === 'item') {
        return { position, thingId: thing.item.id, stackPos };
      }
    }
    return null;
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

  function use(clientX: number, clientY: number): void {
    const target = topStackItemAtTile(worldTileAtPointer(clientX, clientY));
    if (!target) return;
    // Always sent — the server only reads the index byte when the used
    // item turns out to be a container, so no .dat check is needed here.
    send(protocol.actions.buildUseItem(
      target.position, target.thingId, target.stackPos,
      opts.nextContainerId?.() ?? 0,
    ));
  }

  // Tap/click-to-walk: A* over the known window, sent as one 0x64
  // autowalk — the server walks the route and confirms each step like
  // manual moves. A tap that starts a double-tap still walks first
  // (one step toward a ladder before using it is what the original
  // client does too); a new tap simply replaces the route server-side.
  function walkTo(clientX: number, clientY: number): void {
    if (!datIndex) return;
    const pos = worldTileAtPointer(clientX, clientY);
    const route = findWalkRoute(world, datIndex, pos.x, pos.y);
    if (!route || route.length === 0) return;
    send(protocol.movement.buildAutoWalk(route));
  }

  // Desktop: left-click walks, right-click looks, double-click uses.
  // Touch taps walk via pointerup below; browsers also synthesize a
  // click after a tap, so non-mouse clicks are ignored here (browsers
  // old enough to omit pointerType on clicks just send a benign
  // duplicate route).
  const onClick = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const pointerType = (e as PointerEvent).pointerType;
    if (pointerType && pointerType !== 'mouse') return;
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
    if (wasTap) walkTo(e.clientX, e.clientY);
  };

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', cancelPress);

  return {
    destroy: () => {
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
