import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import type { Application } from 'pixi.js';
import {
  buildIlluminationOverlay, computeAmbient, createLightMaskTexture,
  creatureLightSource, loadBrightness, tibiaColorToHex, LightSpritePool, type LightSource,
} from '../lighting';
import {
  renderTileRegion, renderPlayer, spriteIndex, readPixelDisplacement,
  type TintedTextureCache,
} from '../tileRenderer';
import { buildOcclusionSets } from '../render/floorOcclusion';
import { firstVisibleFloorForGlide } from '../render/floorVisibility';
import {
  drawnFloorsBelow, drawnFloorsAbove, dirtyFloors, dirtyFloorsWithBelowOcclusion,
  floorLayerOffset, glideEndpoints, coveringRevisionKey, partitionByFloor,
} from '../render/floorStack';
import { createNameplate, type NameplateHandle } from './nameplate';
import { CombatTextRenderer } from './combatText';
import { SpeechBubbleRenderer } from '../chat/SpeechBubbleRenderer';
import type { ChatManager } from '../chat/ChatManager';
import { DISTANCE_SHOT_TTL_MS, type GameWorld, type WorldCreature } from '../GameWorld';
import { DatAttr } from '../dat';
import type { Direction } from '../player';
import type { SpriteAtlas } from '../spriteAtlas';
import { TILE_SIZE } from '../../constants';
import { HALF_W_LEFT, HALF_W_RIGHT, HALF_H_TOP, HALF_H_BOTTOM } from './region';
import { VIEWPORT_EVENT } from './viewport';
import { reportMetric } from './metrics';

/** Walk frame duration — two alternating walk poses at ~8 fps. */
const WALK_FRAME_MS = 125;

/**
 * Glide duration bounds. The right duration is the creature's ACTUAL
 * step cadence (Tibia paces ~400ms/tile at base speed, faster with
 * hastes/levels, plus network jitter) — a fixed value either finishes
 * early (visible stop-start between steps) or rubber-bands. The SELF
 * creature's cadence is measured from its confirmation intervals
 * (EMA), so continuous walking renders as one unbroken scroll; every
 * other creature glides forward over its true step duration instead
 * (see forwardStateAt).
 */
export const STEP_GLIDE_DEFAULT_MS = 380;
export const STEP_GLIDE_MIN_MS = 150;
export const STEP_GLIDE_MAX_MS = 650;

/**
 * Bounds for a computed (speed-based) step duration. The ceiling covers
 * the slowest real case — an NPC (base speed 110) crossing swamp — while
 * keeping a glitched speed/ground value from freezing a creature
 * mid-tile; the floor keeps an extreme haste from reading as a teleport.
 */
export const FORWARD_STEP_MIN_MS = 100;
export const FORWARD_STEP_MAX_MS = 2500;

/**
 * The server's step duration (otserv Creature::getStepDuration):
 * 1000 × groundSpeed / creatureSpeed, doubled on diagonals. This is the
 * time a creature really spends per tile, so it is the glide duration
 * that renders NPCs ambling and hasted players sprinting — the arrival
 * cadence can't say that (an NPC's think-pauses swamp it).
 */
export function expectedStepMs(creatureSpeed: number, groundSpeed: number, diagonal: boolean): number {
  if (creatureSpeed <= 0) return STEP_GLIDE_DEFAULT_MS;
  const ground = groundSpeed > 0 ? groundSpeed : 150;
  const dur = ((1000 * ground) / creatureSpeed) * (diagonal ? 2 : 1);
  return Math.max(FORWARD_STEP_MIN_MS, Math.min(FORWARD_STEP_MAX_MS, Math.round(dur)));
}
/**
 * Extra painted tiles beyond the server window on every side: the
 * pursuing camera trails the confirmed position by up to a tile, and
 * the trailing edge must show the (already-known, lingering) tiles
 * there instead of black.
 */
const GLIDE_PAD = 3;

/**
 * Tile-layer rebuild policy. Rebuilding tile layers is the expensive
 * operation (hundreds to thousands of sprites in dense town areas), so
 * it no longer runs per walk-pose frame: all drawn floors rebuild only
 * when the player has moved HYSTERESIS tiles from the painted center
 * (the pad keeps the screen covered in between) or on a floor change;
 * in-place tile changes (doors, dropped items) rebuild — throttled —
 * only the floors whose per-z revision moved.
 */
const TILE_REBUILD_HYSTERESIS = 2;
const TILE_REVISION_THROTTLE_MS = 300;

/**
 * Settings fires this when the brightness slider moves so the light
 * overlay rebuilds immediately (a preference change fires no
 * world.onChange).
 */
export const LIGHT_PREF_EVENT = 'jamera:light-pref';

/**
 * Exponential moving average of a creature's step cadence. Exported for
 * tests. Per the Codex review, only samples in the plausible
 * SERVER-step-duration band feed the estimate — anything longer is
 * network arrival jitter or a standing pause, anything shorter is a
 * delivery burst; neither says how fast the creature walks.
 */
export function nextStepEma(prevEma: number, sampleMs: number): number {
  if (sampleMs < STEP_GLIDE_MIN_MS || sampleMs > 500) return prevEma;
  return Math.max(STEP_GLIDE_MIN_MS, Math.min(STEP_GLIDE_MAX_MS, prevEma * 0.75 + sampleMs * 0.25));
}

/** Magic-effect animation cadence: 100 ms per .dat phase (OTClient's 7.6 timing). */
export const EFFECT_PHASE_MS = 100;

/**
 * Which .dat animation phase a magic effect shows at `now`, or -1 once
 * it has played through — effects run once, they don't loop.
 */
export function effectPhaseAt(now: number, startedAt: number, animationPhases: number): number {
  const phase = Math.floor((now - startedAt) / EFFECT_PHASE_MS);
  return phase < animationPhases ? phase : -1;
}

/**
 * Sprite pick from a missile's 3×3 directional pattern grid — the
 * OTClient thingtype convention: patX is the flight's horizontal
 * component (west 0, none 1, east 2), patY the vertical (north 0,
 * none 1, south 2). The delta is snapped to 8 directions by angle
 * first (OTClient's getDirectionFromPosition), not by raw sign — a
 * (7, 1) shot flies east, not southeast.
 */
// Octants: 0 = E, 1 = NE, 2 = N, 3 = NW, ±4 = W, -3 = SW, -2 = S, -1 = SE.
// Module-level so the per-shot per-frame lookup allocates nothing.
const MISSILE_PATTERN_BY_OCTANT: Record<number, { patX: number; patY: number }> = {
  0: { patX: 2, patY: 1 },
  1: { patX: 2, patY: 0 },
  2: { patX: 1, patY: 0 },
  3: { patX: 0, patY: 0 },
  4: { patX: 0, patY: 1 },
  [-4]: { patX: 0, patY: 1 },
  [-3]: { patX: 0, patY: 2 },
  [-2]: { patX: 1, patY: 2 },
  [-1]: { patX: 2, patY: 2 },
};

export function missilePattern(dx: number, dy: number): { patX: number; patY: number } {
  if (dx === 0 && dy === 0) return { patX: 1, patY: 1 };
  // Screen y grows southward; flip it so atan2 works in math space.
  const octant = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4));
  return MISSILE_PATTERN_BY_OCTANT[octant];
}

/** Flight progress 0→1 of a distance shot at `now`, clamped at landing. */
export function shotProgressAt(now: number, startedAt: number): number {
  return Math.min(1, Math.max(0, (now - startedAt) / DISTANCE_SHOT_TTL_MS));
}

export interface RenderPos { x: number; y: number }

/**
 * Playout buffer (fixed render delay), the FPS-netcode entity-
 * interpolation pattern Codex recommended over latest-target pursuit:
 * confirmed tiles are buffered as timestamped samples and rendered
 * RENDER_DELAY_MS in the past. For SELF each glide is timed to FINISH
 * exactly at its sample's (delayed) arrival time; other creatures
 * glide forward from it instead (see forwardStateAt). Wi-Fi delivery
 * jitter smaller than the delay reorders nothing on screen — motion
 * plays back as one continuous stream instead of stalling and
 * sprinting.
 */
export const RENDER_DELAY_MS = 180;
/** Buffered samples per creature — enough to ride out a delivery burst. */
const MAX_SAMPLES = 8;

export interface PlaybackSample {
  x: number;
  y: number;
  z: number;
  at: number;
  /** Expected duration of the step INTO this tile (absent on seeds). */
  stepMs?: number;
}
export interface PlaybackState extends RenderPos { moving: boolean }

/**
 * State on the buffered timeline at delayed time `t`. A segment cannot
 * exceed RENDER_DELAY_MS: anything longer would begin before the endpoint
 * sample had arrived and make the next render jump retroactively into the
 * step. Discontinuities hold and snap at the sample timestamp.
 */
export function playbackStateAt(
  samples: ReadonlyArray<PlaybackSample>,
  cadenceMs: number,
  t: number,
): PlaybackState {
  if (samples.length === 0) return { x: 0, y: 0, moving: false };
  if (t >= samples[samples.length - 1].at) {
    const last = samples[samples.length - 1];
    return { x: last.x, y: last.y, moving: false };
  }
  // Find the segment [a, b] with a.at <= t < b.at.
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].at > t) i--;
  const b = samples[i];
  const a = i > 0 ? samples[i - 1] : b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const discontinuity = b.z !== a.z || Math.abs(dx) > 1 || Math.abs(dy) > 1;
  if (discontinuity) return { x: a.x, y: a.y, moving: false };
  const duration = Math.min(cadenceMs, RENDER_DELAY_MS, Math.max(1, b.at - a.at));
  const startAt = b.at - duration;
  const u = Math.min(1, Math.max(0, (t - startAt) / duration));
  return {
    x: a.x + dx * u,
    y: a.y + dy * u,
    moving: (dx !== 0 || dy !== 0) && t >= startAt && t < b.at,
  };
}

export function playbackPosAt(
  samples: ReadonlyArray<PlaybackSample>,
  cadenceMs: number,
  t: number,
): RenderPos {
  const { x, y } = playbackStateAt(samples, cadenceMs, t);
  return { x, y };
}

/**
 * OTClient-style forward glide, used for every creature but self: the
 * step into sample `b` animates over [b.at, b.at + b.stepMs), i.e. the
 * creature leaves its old tile when the move packet plays and takes its
 * TRUE step duration to cross — an ambling NPC ambles instead of
 * standing then dashing the tile in RENDER_DELAY_MS. Only already-known
 * samples feed the glide, so nothing ever jumps retroactively; a
 * follow-up sample arriving early cuts the glide short at its own
 * timestamp. Discontinuities snap.
 */
export function forwardStateAt(
  samples: ReadonlyArray<PlaybackSample>,
  t: number,
): PlaybackState {
  if (samples.length === 0) return { x: 0, y: 0, moving: false };
  // Latest sample at or before t — the step currently animating.
  let i = samples.length - 1;
  while (i > 0 && samples[i].at > t) i--;
  const b = samples[i];
  if (i === 0 || t < b.at) return { x: b.x, y: b.y, moving: false };
  const a = samples[i - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const step = (dx !== 0 || dy !== 0) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && b.z === a.z;
  if (!step) return { x: b.x, y: b.y, moving: false };
  let duration = b.stepMs ?? STEP_GLIDE_DEFAULT_MS;
  if (i + 1 < samples.length) {
    duration = Math.min(duration, Math.max(1, samples[i + 1].at - b.at));
  }
  const u = Math.min(1, (t - b.at) / duration);
  return {
    x: a.x + dx * u,
    y: a.y + dy * u,
    moving: u < 1,
  };
}

function walkPhase(moving: boolean, now: number): number {
  if (!moving) return 0;
  // Phases 1..n-1 are the walk cycle (renderPlayer clamps to the
  // outfit's actual phase count).
  return 1 + (Math.floor(now / WALK_FRAME_MS) % 2);
}

/**
 * Bridges `GameWorld` → PIXI: subscribes to `world.onChange` and repaints
 * the visible region around the player using the `SpriteAtlas` the cache
 * PR exposed. Returns a teardown for the caller to invoke on re-login or
 * page unload — without it, the previous session's container would leak
 * into the new session's stage.
 *
 * Tile floors rebuild whole-floor-at-a-time (per-z dirty tracking picks
 * which); no tile-by-tile diffing yet — that's a separate track (#85).
 *
 * Creatures (the player included — it's just a creature the server put
 * on a tile) draw after the tile pass, north-to-south so southern
 * creatures overlap correctly, idle pose for now (walk animation is a
 * follow-up).
 */
export function bindRenderer(
  world: GameWorld,
  atlas: SpriteAtlas,
  app: Application,
  chatManager?: ChatManager,
): () => void {
  // Persistent scene root (recentered by the camera) holding three
  // layers: tiles (expensive, rebuilt with hysteresis), creatures
  // (cheap, rebuilt per pose/state change), bubbles (persistent).
  let root: Container | null = null;
  // Tile floors live as one child container per drawn z, deepest floor
  // first so shallower floors paint over deeper ones — split across TWO
  // parents around the creature layer (root: playerAndBelowTiles(0) →
  // creatures(1) → aboveTiles(2)), the simplest structure where roofs
  // also draw over creatures while creatures still stand on the ground.
  //
  // Every floor container carries the classic perspective offset
  // (z − playerZ) tiles on both axes (floorStack.floorLayerOffset):
  // below floors lean south-east, above floors north-west, one tile per
  // level — the model the wire format, upstream OTClient, and the map's
  // 64×64 sprite art all assume (NDIT-204). Each floor renders the world
  // window shifted the OPPOSITE way so the screen stays exactly covered.
  let tilesRoot: Container | null = null;
  const tileFloorLayers = new Map<number, Container>();
  let aboveTilesRoot: Container | null = null;
  const aboveFloorLayers = new Map<number, Container>();
  let creatureLayer: Container | null = null;
  // Non-player-floor creatures (and their nameplates) live in per-floor
  // containers inserted as SIBLINGS right after their floor's tile layer
  // — creatures on z must draw between tiles(z) and tiles(z−1). Siblings
  // rather than children of the tile layers: tile layers are destroyed
  // with `{ children: true }` on the expensive rebuild path, which would
  // take the persistent nameplates down with them mid-frame. The player
  // floor keeps its dedicated root-level layer (between the two tile
  // parents) — same draw position, and the light/effects insertion
  // logic anchors on it.
  const creatureFloorLayers = new Map<number, Container>();
  // The SELF nameplate rides above everything map (both tile parents and
  // the light overlay): it hangs a tile above the player's head, which
  // right under a stairwell opening is exactly where the floor-above
  // ground paints — per-floor parenting hid the player's own name there.
  // Always safe on top: drawnAbove is non-empty only when the roof probe
  // found the player position UNcovered, so nothing legitimately hides
  // the player (and their name) while above-floors are drawn.
  let selfPlateLayer: Container | null = null;
  // Bumped whenever tile-layer containers are created or destroyed, so
  // the (cheap) creature pass re-inserts its per-floor siblings against
  // the new stack — a roof change while everyone stands still must not
  // leave creature containers ordered against destroyed layers.
  let tileLayoutRev = 0;
  // Combat effects (magic effects, target square). Persistent like the
  // bubble layer — tiles/creatures/light insert themselves below it —
  // but its children are transient: rebuilt every frame while any
  // effect is live, which is rare and brief.
  let effectsLayer: Container | null = null;
  // Light overlay (multiply-blended) above tiles + creatures. The
  // RenderTexture, bubble pool, and mask persist across rebuilds —
  // buildIlluminationOverlay resizes/recycles them.
  let lightLayer: Sprite | null = null;
  let lightKey = '';
  const illuminationTexture = RenderTexture.create({ width: 1, height: 1 });
  const lightSpritePool = new LightSpritePool();
  const lightMask = createLightMaskTexture();
  let paintedCenterX = NaN;
  let paintedCenterY = NaN;
  let paintedCenterZ = NaN;
  let paintedTileRevision = -1;
  // Per-floor paint bookkeeping mirroring world.tileRevisionByZ, so the
  // throttled revision path repaints only the floors that changed.
  const paintedRevisionByZ = new Map<number, number>();
  // Roof-probe result (shallowest floor still drawn) and its input
  // fingerprint — recomputed only when the inputs move, not per frame.
  let firstVisible = world.playerZ;
  let lastProbeKey = '';
  let paintedFirstVisible = NaN;
  let lastTileRebuildAt = 0;
  let creatureKey = '';
  // Outfit tint compositions are expensive; cache them for the lifetime
  // of this binding (i.e. per session).
  const tintedCache: TintedTextureCache = new Map();
  // Nameplates persist across rebuilds (PIXI Text layout is costly);
  // keyed by creature id, evicted when the creature leaves view.
  const nameplates = new Map<number, NameplateHandle>();
  // Speech bubbles live in their own persistent layer, reparented on top
  // of each rebuilt container and updated every frame — bubble motion and
  // expiry must not depend on tiles changing.
  const bubbles = chatManager ? new SpeechBubbleRenderer() : null;
  // Floating damage/heal numbers — pooled Texts updated every frame
  // while any are live, in their own persistent layer like bubbles.
  const combatTexts = new CombatTextRenderer();
  // A creature speaking while everything stands still fires no
  // world.onChange — subscribe to the manager so a fresh bubble
  // repaints immediately and arms the rAF loop; unsubscribed on
  // teardown.
  const unsubscribeChat = chatManager ? chatManager.subscribe(() => update()) : null;

  // Center the player tile on the canvas. The 0.5 offset puts the
  // *center* of the player's tile at the canvas center instead of
  // the tile's top-left corner. Use `app.screen` (CSS pixels — what
  // the scene graph uses) rather than `app.canvas` (device pixels,
  // off by `devicePixelRatio` with autoDensity). The stage carries the
  // cover zoom (see viewport.ts), so screen px → stage units divides
  // by the stage scale.
  const recenter = (container: Container, camX = world.playerX, camY = world.playerY): void => {
    const zoom = app.stage?.scale?.x || 1;
    container.x = app.screen.width / 2 / zoom - (camX + 0.5) * TILE_SIZE;
    container.y = app.screen.height / 2 / zoom - (camY + 0.5) * TILE_SIZE;
  };

  // Per-rebuild registry of creature display nodes at their build-time
  // base positions — the per-frame glide pass nudges these (and the
  // camera) by the interpolated fraction without rebuilding anything.
  let movables: Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> = [];

  // Per-creature playout buffers (see playbackPosAt).
  const playback = new Map<number, { samples: PlaybackSample[]; cadence: number }>();

  // The server's formula for the step the creature just took: ground
  // speed of the tile it LEFT over its current speed (0x8F updates keep
  // WorldCreature.speed fresh, so hastes shorten the glide immediately).
  const stepMsFor = (c: WorldCreature, from: PlaybackSample): number => {
    const groundId = world.getTile(from.x, from.y, from.z)?.items[0]?.id;
    const groundAttr = groundId !== undefined
      ? atlas.datIndex.get(groundId)?.attrs.get(DatAttr.Ground)
      : undefined;
    const groundSpeed = typeof groundAttr === 'number' ? groundAttr : 0;
    const diagonal = from.x !== c.x && from.y !== c.y;
    return expectedStepMs(c.speed, groundSpeed, diagonal);
  };

  const playbackFor = (c: WorldCreature): { samples: PlaybackSample[]; cadence: number } => {
    let p = playback.get(c.id);
    if (!p) {
      // Seed in the past so a creature with no pending motion renders
      // at its tile immediately.
      p = {
        samples: [{ x: c.x, y: c.y, z: c.z, at: (c.lastMoveAt ?? 0) - RENDER_DELAY_MS }],
        cadence: STEP_GLIDE_DEFAULT_MS,
      };
      playback.set(c.id, p);
    }
    const last = p.samples[p.samples.length - 1];
    if (last.x !== c.x || last.y !== c.y || last.z !== c.z) {
      const at = c.lastMoveAt ?? performance.now();
      p.cadence = nextStepEma(p.cadence, at - last.at);
      p.samples.push({ x: c.x, y: c.y, z: c.z, at, stepMs: stepMsFor(c, last) });
      if (p.samples.length > MAX_SAMPLES) p.samples.shift();
    }
    return p;
  };

  // Self keeps the finish-at-confirmation playout buffer (the walk
  // pipeline's cadence is tuned around it); everyone else glides
  // forward at their true speed.
  const stateAt = (c: WorldCreature, p: { samples: PlaybackSample[]; cadence: number }, t: number): PlaybackState =>
    c.id === world.playerCreatureId
      ? playbackStateAt(p.samples, p.cadence, t)
      : forwardStateAt(p.samples, t);

  /** When this creature's last queued glide fully lands (rAF keep-alive). */
  const settleAt = (c: WorldCreature, p: { samples: PlaybackSample[] }): number => {
    const last = p.samples[p.samples.length - 1];
    return c.id === world.playerCreatureId ? last.at : last.at + (last.stepMs ?? 0);
  };

  const playbackStateFor = (c: WorldCreature, now: number): PlaybackState => {
    const p = playbackFor(c);
    return stateAt(c, p, now - RENDER_DELAY_MS);
  };

  const renderPosFor = (c: WorldCreature, now: number): RenderPos => {
    const { x, y } = playbackStateFor(c, now);
    return { x, y };
  };

  const glide = (now: number): void => {
    if (!root) return;
    const self = world.getCreature(world.playerCreatureId);
    const cam = self ? renderPosFor(self, now) : { x: world.playerX, y: world.playerY };
    recenter(root, cam.x, cam.y);
    for (const m of movables) {
      const p = renderPosFor(m.c, now);
      m.node.x = m.baseX + (p.x - m.c.x) * TILE_SIZE;
      m.node.y = m.baseY + (p.y - m.c.y) * TILE_SIZE;
    }
  };

  /**
   * Repaint the effects layer for this frame: every live magic effect
   * at its current animation phase, plus the attack-target square.
   * Children are rebuilt wholesale — a handful of sprites for well
   * under a second at a time. Sprite textures come from the memoised
   * atlas.get, so destroy() here never touches shared GPU resources.
   */
  const drawEffects = (now: number): void => {
    if (!effectsLayer) return;
    for (const child of effectsLayer.removeChildren()) child.destroy();

    for (const e of world.magicEffects) {
      if (e.z !== world.playerZ) continue;
      const thing = atlas.effectIndex.get(e.effectId);
      if (!thing) continue;
      const fg = thing.frameGroup;
      const phase = effectPhaseAt(now, e.startedAt, fg.animationPhases);
      if (phase < 0) continue;
      // Position-derived pattern variation, same rule as ground items.
      const patX = ((e.x % fg.numPatternX) + fg.numPatternX) % fg.numPatternX;
      const patY = ((e.y % fg.numPatternY) + fg.numPatternY) % fg.numPatternY;
      const displacement = readPixelDisplacement(thing);
      for (let h = fg.height - 1; h >= 0; h--) {
        for (let w = fg.width - 1; w >= 0; w--) {
          const id = fg.spriteIds[spriteIndex(fg, phase, patX, patY, 0, h, w)];
          if (!id) continue;
          const texture = atlas.get(id);
          if (!texture) continue;
          const sprite = new Sprite(texture);
          sprite.x = (e.x - w) * TILE_SIZE - displacement.x;
          sprite.y = (e.y - h) * TILE_SIZE - displacement.y;
          effectsLayer.addChild(sprite);
        }
      }
    }

    for (const s of world.distanceShots) {
      if (s.fromZ !== world.playerZ) continue;
      const thing = atlas.missileIndex.get(s.missileId);
      if (!thing) continue;
      const fg = thing.frameGroup;
      const { patX, patY } = missilePattern(s.toX - s.fromX, s.toY - s.fromY);
      // 7.6 missiles declare the full 3×3 grid; clamp anyway so a
      // sparse custom .dat degrades to a wrong-facing sprite, not a hole.
      const id = fg.spriteIds[spriteIndex(
        fg, 0,
        Math.min(patX, fg.numPatternX - 1), Math.min(patY, fg.numPatternY - 1),
        0, 0, 0,
      )];
      if (!id) continue;
      const texture = atlas.get(id);
      if (!texture) continue;
      const u = shotProgressAt(now, s.startedAt);
      const displacement = readPixelDisplacement(thing);
      const sprite = new Sprite(texture);
      sprite.x = (s.fromX + (s.toX - s.fromX) * u) * TILE_SIZE - displacement.x;
      sprite.y = (s.fromY + (s.toY - s.fromY) * u) * TILE_SIZE - displacement.y;
      effectsLayer.addChild(sprite);
    }

    const square = world.targetSquare;
    if (square) {
      const target = world.getCreature(square.creatureId);
      if (target && target.z === world.playerZ) {
        // Follow the creature through its glide, not its logical tile —
        // renderPosFor is the same interpolation the creature sprite uses.
        const p = renderPosFor(target, now);
        const g = new Graphics();
        g.rect(p.x * TILE_SIZE + 1, p.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2)
          .stroke({ color: tibiaColorToHex(square.color), width: 2 });
        effectsLayer.addChild(g);
      }
    }
  };

  let rafId = 0;

  const update = (): void => {
    const now = performance.now();
    world.pruneEffects(now);

    // ── Roof probe: how far above the player the view reaches ──
    // Cheap (≤5 positions × ≤7 floors) but not per-frame: keyed on the
    // camera endpoint tiles, the player floor, and the revisions of
    // every floor that could provide cover (a door or map edit can
    // change coverage without anyone moving). During a glide BOTH
    // endpoint tiles are probed and the more-covered one wins, so a
    // roof doesn't blink back in for the half-step where only one
    // endpoint is indoors (design-doc anti-flicker rule, PoC fabe172).
    // Runs before the rAF-keep-alive check below: the drawn-floor set
    // it feeds decides which creatures' walks keep the loop armed.
    const selfC = world.getCreature(world.playerCreatureId);
    const cam = selfC ? renderPosFor(selfC, now) : { x: world.playerX, y: world.playerY };
    const ep = glideEndpoints(cam.x, cam.y);
    const probeKey = `${ep.fromX}:${ep.fromY}:${ep.toX}:${ep.toY}:${world.playerZ}:`
      + coveringRevisionKey(world.tileRevisionByZ, world.playerZ);
    if (probeKey !== lastProbeKey) {
      firstVisible = firstVisibleFloorForGlide(
        world, atlas.datIndex, ep.fromX, ep.fromY, ep.toX, ep.toY, world.playerZ,
      );
      lastProbeKey = probeKey;
    }
    // Deepest-first, matching container stacking order; playerZ is
    // always the last entry of drawnBelow.
    const drawnBelow = drawnFloorsBelow(world.playerZ);
    const drawnAbove = drawnFloorsAbove(firstVisible, world.playerZ);

    // Effects animate frame-by-frame, so the rAF loop must stay armed
    // while any is live — a spell landing while everyone stands still
    // reaches here through world.onChange, then this keeps it playing.
    const effectsActive = world.magicEffects.length > 0
      || world.animatedTexts.length > 0
      || world.distanceShots.length > 0
      || world.targetSquare !== null;
    // Synchronize samples before deciding whether the rAF loop stays armed.
    // The pose key includes the exact set of moving creatures so starting or
    // finishing a glide repaints the walk/idle frame immediately.
    const playbackT = now - RENDER_DELAY_MS;
    const motionStates = new Map<number, PlaybackState>();
    const movingIds: number[] = [];
    let anyWalking = false;
    for (const c of world.getAllCreatures()) {
      if (!drawnBelow.includes(c.z) && !drawnAbove.includes(c.z)) continue;
      const p = playbackFor(c);
      const state = stateAt(c, p, playbackT);
      motionStates.set(c.id, state);
      if (state.moving) movingIds.push(c.id);
      if (playbackT < settleAt(c, p)) anyWalking = true;
    }
    movingIds.sort((a, b) => a - b);
    // Bubble lifecycle: ChatManager expiry runs on wall-clock time
    // (expiresAt comes from Date.now()), and the layer updates every
    // call — including ones the tile short-circuit below skips.
    let bubblesActive = false;
    if (chatManager && bubbles) {
      bubbles.update(chatManager, 0, 0, 1, Date.now());
      bubblesActive = chatManager.speechBubbles.length > 0;
    }
    const poseKey = movingIds.length > 0
      ? `${Math.floor(now / WALK_FRAME_MS)}:${movingIds.join(',')}`
      : 'idle';
    if ((anyWalking || bubblesActive || effectsActive) && rafId === 0) {
      const tick = (): void => {
        rafId = 0;
        update();
      };
      rafId = requestAnimationFrame(tick);
    }
    if (!root) {
      root = new Container();
      app.stage.addChild(root);
      // Before effectsLayer: tile/creature/light layers all insert
      // themselves below these, so the final order is tiles → creatures
      // → aboveTiles → light → self plate → effects.
      selfPlateLayer = new Container();
      root.addChild(selfPlateLayer);
      effectsLayer = new Container();
      root.addChild(effectsLayer);
      root.addChild(combatTexts.getContainer());
      if (bubbles) root.addChild(bubbles.getContainer());
    }

    // ── Tile layers (expensive): hysteresis + throttle ──
    const movedFar =
      Number.isNaN(paintedCenterX) ||
      Math.abs(world.playerX - paintedCenterX) >= TILE_REBUILD_HYSTERESIS ||
      Math.abs(world.playerY - paintedCenterY) >= TILE_REBUILD_HYSTERESIS;
    const zChanged = world.playerZ !== paintedCenterZ;
    const revChanged = world.tileRevision !== paintedTileRevision;
    const fullRebuild = !tilesRoot || zChanged || movedFar;
    // Stepping through a door changes no tile and moves the player one
    // step — the roof-culling moment rides on the probe result alone,
    // immediate (a vanishing roof must not wait out the throttle).
    const roofStateChanged = firstVisible !== paintedFirstVisible;
    const revisionDue = revChanged && now - lastTileRebuildAt >= TILE_REVISION_THROTTLE_MS;
    if (fullRebuild || roofStateChanged || revisionDue) {
      const belowToRebuild = fullRebuild ? drawnBelow
        : revisionDue ? dirtyFloorsWithBelowOcclusion(drawnBelow, paintedRevisionByZ, world.tileRevisionByZ)
          : [];
      // The above set is a function of the probe, so a probe change
      // rebuilds that whole (small, sparse) stack; roof-culled means
      // drawnAbove is simply empty and the parent ends up childless.
      const rebuildAllAbove = fullRebuild || roofStateChanged;
      const aboveToRebuild = rebuildAllAbove ? drawnAbove
        : revisionDue ? dirtyFloors(drawnAbove, paintedRevisionByZ, world.tileRevisionByZ)
          : [];
      if (belowToRebuild.length > 0 || aboveToRebuild.length > 0 || rebuildAllAbove) {
        const repaintStart = performance.now();
        if (!tilesRoot || !aboveTilesRoot) {
          tilesRoot = new Container();
          root.addChildAt(tilesRoot, 0);
          // Takes index 1 now, while no creature layer exists yet;
          // creatures always insert at index 1, landing between the
          // two tile parents from then on.
          aboveTilesRoot = new Container();
          root.addChildAt(aboveTilesRoot, 1);
        }
        if (fullRebuild) {
          // The drawn set is a function of playerZ — floors of a
          // previous stack must not linger, so the full path starts
          // from an empty parent and re-centers the painted region.
          for (const layer of tileFloorLayers.values()) {
            tilesRoot.removeChild(layer);
            layer.destroy({ children: true });
          }
          tileFloorLayers.clear();
          paintedRevisionByZ.clear();
          paintedCenterX = world.playerX;
          paintedCenterY = world.playerY;
          paintedCenterZ = world.playerZ;
        }
        if (rebuildAllAbove) {
          for (const [z, layer] of aboveFloorLayers) {
            aboveTilesRoot.removeChild(layer);
            layer.destroy({ children: true });
            paintedRevisionByZ.delete(z);
          }
          aboveFloorLayers.clear();
        }
        // GLIDE_PAD: covers both the pursuing camera trailing behind
        // the confirmed position AND the hysteresis lag of the painted
        // center — the trailing/lagging edges show lingering known
        // tiles instead of black. Undescribed tiles stay black but sit
        // past the leading edge, never on screen. Partial (per-floor)
        // rebuilds reuse the painted center so every floor keeps
        // covering the exact same region.
        const x1 = paintedCenterX - HALF_W_LEFT - GLIDE_PAD;
        const y1 = paintedCenterY - HALF_H_TOP - GLIDE_PAD;
        const x2 = paintedCenterX + HALF_W_RIGHT + GLIDE_PAD;
        const y2 = paintedCenterY + HALF_H_BOTTOM + GLIDE_PAD;
        // Tiles fully covered by a shallower floor's FullGround never
        // paint — in town, the surface floor blanks out nearly every
        // slot beneath it (see floorOcclusion.ts for the cascade rules).
        const occlusion = buildOcclusionSets(
          world, atlas.datIndex, x1, y1, x2, y2, [...drawnBelow].reverse(), world.playerZ,
        );
        for (const z of belowToRebuild) {
          const offset = floorLayerOffset(z, world.playerZ);
          const { container: nextTiles } = renderTileRegion(
            world, atlas.datIndex, atlas.atlasTextures, atlas.layout,
            x1 - offset.x, y1 - offset.y, x2 - offset.x, y2 - offset.y, z, occlusion.get(z),
          );
          nextTiles.position.set(offset.x * TILE_SIZE, offset.y * TILE_SIZE);
          const old = tileFloorLayers.get(z);
          if (old) {
            tilesRoot.addChildAt(nextTiles, tilesRoot.getChildIndex(old));
            tilesRoot.removeChild(old);
            old.destroy({ children: true });
          } else {
            // Full path only — drawnBelow is deepest-first, so plain
            // appends produce the paint-over stacking.
            tilesRoot.addChild(nextTiles);
          }
          tileFloorLayers.set(z, nextTiles);
          paintedRevisionByZ.set(z, world.tileRevisionByZ.get(z) ?? 0);
        }
        for (const z of aboveToRebuild) {
          // No skipPositions here: above floors are sparse roof
          // outlines, so a skip set saves next to nothing.
          const offset = floorLayerOffset(z, world.playerZ);
          const { container: nextTiles } = renderTileRegion(
            world, atlas.datIndex, atlas.atlasTextures, atlas.layout,
            x1 - offset.x, y1 - offset.y, x2 - offset.x, y2 - offset.y, z,
          );
          // Iso offset, negative → up-left. Without it multi-story
          // buildings collapse into a flat silhouette (lesson 3691ea3).
          nextTiles.position.set(offset.x * TILE_SIZE, offset.y * TILE_SIZE);
          const old = aboveFloorLayers.get(z);
          if (old) {
            aboveTilesRoot.addChildAt(nextTiles, aboveTilesRoot.getChildIndex(old));
            aboveTilesRoot.removeChild(old);
            old.destroy({ children: true });
          } else {
            // Deepest (playerZ−1) first, shallowest last — nearest the
            // viewer paints on top.
            aboveTilesRoot.addChild(nextTiles);
          }
          aboveFloorLayers.set(z, nextTiles);
          paintedRevisionByZ.set(z, world.tileRevisionByZ.get(z) ?? 0);
        }
        paintedFirstVisible = firstVisible;
        lastTileRebuildAt = now;
        // Tile containers were created/replaced/destroyed — the creature
        // pass below must re-seat its per-floor siblings against them.
        tileLayoutRev++;
        // Tile rebuild cost — the phone-CPU half of the lag decomposition.
        reportMetric('repaint', performance.now() - repaintStart);
      }
      // Sync even when no drawn floor was dirty: the global counter also
      // moves for floors this renderer never draws, and chasing those
      // would re-diff (and rebuild the light overlay) every update.
      paintedTileRevision = world.tileRevision;
    }

    // ── Creature layers (cheap): poses + creature state ──
    // tileLayoutRev in the key: the per-floor containers are ordered
    // against the tile stack, so a stack rebuild (which alone covers a
    // firstVisible change too) forces a re-seat even when no creature
    // moved.
    const ck = `${world.creatureRevision}:${poseKey}:${world.playerZ}:${world.playerX}:${world.playerY}:${tileLayoutRev}`;
    if (!creatureLayer || ck !== creatureKey) {
      // One container per drawn floor, seated in draw-order position
      // BEFORE drawCreatures fills them. Floors whose tile layer isn't
      // painted yet (login transient) get no container this pass — the
      // tile rebuild that paints them bumps tileLayoutRev and re-runs
      // this block.
      const layers = new Map<number, Container>();
      for (const z of drawnBelow) {
        if (z === world.playerZ) continue;
        const tileLayer = tileFloorLayers.get(z);
        if (!tilesRoot || !tileLayer) continue;
        const layer = new Container();
        // Same iso offset as the floor's tiles — creatures stand on the
        // shifted ground.
        layer.position.copyFrom(tileLayer.position);
        tilesRoot.addChildAt(layer, tilesRoot.getChildIndex(tileLayer) + 1);
        layers.set(z, layer);
      }
      const nextCreatures = new Container();
      layers.set(world.playerZ, nextCreatures);
      for (const z of drawnAbove) {
        const tileLayer = aboveFloorLayers.get(z);
        if (!aboveTilesRoot || !tileLayer) continue;
        const layer = new Container();
        // Same iso offset as the floor's tiles — creatures stand on the
        // shifted ground, and shallower roofs paint over them.
        layer.position.copyFrom(tileLayer.position);
        aboveTilesRoot.addChildAt(layer, aboveTilesRoot.getChildIndex(tileLayer) + 1);
        layers.set(z, layer);
      }
      // Build first, destroy after: drawCreatures reparents persistent
      // nameplates into the new layers, keeping them out of the destroy.
      movables = drawCreatures(
        world, atlas, layers, tintedCache, nameplates,
        (c) => motionStates.get(c.id)?.moving ?? playbackStateFor(c, now).moving,
        now, selfPlateLayer,
      );
      root.addChildAt(nextCreatures, tilesRoot ? 1 : 0);
      for (const old of creatureFloorLayers.values()) {
        old.parent?.removeChild(old);
        old.destroy({ children: true });
      }
      creatureFloorLayers.clear();
      for (const [z, layer] of layers) {
        if (z !== world.playerZ) creatureFloorLayers.set(z, layer);
      }
      if (creatureLayer) {
        root.removeChild(creatureLayer);
        creatureLayer.destroy({ children: true });
      }
      creatureLayer = nextCreatures;
      creatureKey = ck;
    }

    // ── Light overlay: server world light × brightness preference ──
    const brightness = loadBrightness();
    const ambientColor = computeAmbient(world.worldLight.level, world.worldLight.color, brightness);
    // Multiplying by pure white is a no-op, and additive light bubbles
    // cannot brighten it further. Skip the render-texture pass in daylight.
    const lk = ambientColor === 0xffffff ? 'off'
      : `${paintedTileRevision}:${creatureKey}:${world.worldLight.level}:${world.worldLight.color}:${brightness}`;
    if (lk !== lightKey) {
      if (lightLayer) {
        root.removeChild(lightLayer);
        lightLayer.destroy();
        lightLayer = null;
      }
      if (lk !== 'off') {
        // Match the tile texture's stable hysteresis center. Centering this
        // texture on every confirmed step exposes the still-painted trailing
        // edge as a briefly full-bright strip.
        const x1 = paintedCenterX - HALF_W_LEFT - GLIDE_PAD;
        const x2 = paintedCenterX + HALF_W_RIGHT + GLIDE_PAD;
        const y1 = paintedCenterY - HALF_H_TOP - GLIDE_PAD;
        const y2 = paintedCenterY + HALF_H_BOTTOM + GLIDE_PAD;
        // Creature-carried lights (the player's glow, torches in hand)
        // — any DRAWN floor's carriers count, matching the tile-light
        // gather below; only ones whose bubble can reach the visible
        // region (light intensity caps at 7 tiles).
        const MAX_LIGHT_REACH = 7;
        // Floor/light filters run BEFORE the position lookup: renderPosFor
        // seeds a persistent playback entry per creature, which dark-only
        // carriers on undrawn floors must not accumulate.
        const extraLights: LightSource[] = world.getAllCreatures()
          .filter((c) => (drawnBelow.includes(c.z) || drawnAbove.includes(c.z)) && c.lightLevel > 0)
          .map((creature) => {
            // Carriers glow at their floor's screen cell — shifted like
            // its container (floorLayerOffset), so the bubble tracks the
            // sprite, not the raw world coordinate.
            const raw = renderPosFor(creature, now);
            const dz = creature.z - world.playerZ;
            return { creature, position: { x: raw.x + dz, y: raw.y + dz } };
          })
          .filter(({ position }) =>
            position.x >= x1 - MAX_LIGHT_REACH && position.x <= x2 + MAX_LIGHT_REACH
            && position.y >= y1 - MAX_LIGHT_REACH && position.y <= y2 + MAX_LIGHT_REACH)
          .map(({ creature, position }) => creatureLightSource(creature, position));
        // Every drawn floor feeds ONE merged overlay (design doc:
        // classic behavior, no per-floor light layers) — a torch on the
        // stairs above you lights your view; the sealed cellar's does
        // not, because a culled floor is never in the drawn set.
        lightLayer = buildIlluminationOverlay(
          app, world, atlas.datIndex, lightMask,
          illuminationTexture, lightSpritePool,
          x1, y1, x2, y2, [...drawnBelow, ...drawnAbove],
          {
            ambientColor,
            enabled: true,
            extraLights,
          },
          world.playerZ,
        );
        // Above both tile parents and the creatures — roofs darken
        // with the world too — below the bubble layer.
        root.addChildAt(lightLayer, aboveTilesRoot ? root.getChildIndex(aboveTilesRoot) + 1
          : creatureLayer ? root.getChildIndex(creatureLayer) + 1 : root.children.length);
      }
      lightKey = lk;
    }

    drawEffects(now);
    combatTexts.update(world, now);
    glide(now);
  };

  const onLightPref = (): void => update();
  window.addEventListener(LIGHT_PREF_EVENT, onLightPref);

  // A viewport change alters `app.screen` and the stage zoom but fires
  // no world change — recenter the existing container without
  // rebuilding it. VIEWPORT_EVENT arrives *after* the app-level
  // debounce actually resized the renderer (a plain `resize` listener
  // would read pre-resize dimensions); the raw `resize` listener stays
  // as a fallback for tests / non-cover hosts.
  const onResize = (): void => {
    if (root) recenter(root);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener(VIEWPORT_EVENT, onResize);

  world.onChange = update;
  // Render immediately in case MapDescription has already populated the
  // world before this binding ran (e.g., assets finished loading after
  // the first map frame arrived).
  update();

  return () => {
    unsubscribeChat?.();
    if (rafId !== 0) cancelAnimationFrame(rafId);
    window.removeEventListener(LIGHT_PREF_EVENT, onLightPref);
    lightSpritePool.destroy();
    illuminationTexture.destroy(true);
    lightMask.destroy(true);
    lightLayer = null; // destroyed with root below
    // Tinted outfit textures are dynamically created GPU resources; the
    // shared atlas textures live for the page, but these are per-binding.
    for (const tex of tintedCache.values()) tex.destroy(true);
    tintedCache.clear();
    for (const plate of nameplates.values()) plate.destroy();
    nameplates.clear();
    playback.clear();
    combatTexts.destroy();
    bubbles?.destroy();
    window.removeEventListener('resize', onResize);
    window.removeEventListener(VIEWPORT_EVENT, onResize);
    if (world.onChange === update) world.onChange = null;
    if (root) {
      app.stage.removeChild(root);
      root.destroy({ children: true });
      root = null;
      tilesRoot = null;
      tileFloorLayers.clear();
      aboveTilesRoot = null;
      aboveFloorLayers.clear();
      creatureLayer = null;
      creatureFloorLayers.clear();
      selfPlateLayer = null;
      effectsLayer = null;
    }
  };
}

/**
 * Draw every creature in the visible region (the player included) into
 * its floor's container — one per drawn z, pre-seated by the caller in
 * draw-order position, so a creature on z paints between tiles(z) and
 * tiles(z−1) and roofs occlude the people under them. North-to-south
 * within each floor so southern creatures overlap the ones behind them,
 * matching the tile painter order. Nameplates go into the SAME per-floor
 * container as their creature — a roof that hides a creature must hide
 * its nameplate too. The one exception is the PLAYER's own plate, which
 * goes into `selfPlateLayer` (above both tile parents): standing under a
 * stairwell opening, the floor-above ground paints exactly where the
 * plate hangs, and the player's own name must never vanish while the
 * player is visible. Exported for tests.
 */
export function drawCreatures(
  world: GameWorld,
  atlas: SpriteAtlas,
  layersByZ: ReadonlyMap<number, Container>,
  tintedCache: TintedTextureCache,
  nameplates: Map<number, NameplateHandle>,
  isMoving: (creature: WorldCreature) => boolean,
  now: number,
  selfPlateLayer: Container | null,
): Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> {
  const movables: Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> = [];
  const x1 = world.playerX - HALF_W_LEFT - GLIDE_PAD;
  const x2 = world.playerX + HALF_W_RIGHT + GLIDE_PAD;
  const y1 = world.playerY - HALF_H_TOP - GLIDE_PAD;
  const y2 = world.playerY + HALF_H_BOTTOM + GLIDE_PAD;

  const byFloor = partitionByFloor(world.getAllCreatures(), [...layersByZ.keys()]);

  const seen = new Set<number>();
  for (const [z, container] of layersByZ) {
    const visible = (byFloor.get(z) ?? []).filter((c) =>
      c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2,
    );
    visible.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    for (const c of visible) {
      const sprite = renderCreature(c, atlas, tintedCache, walkPhase(isMoving(c), now));
      if (sprite) {
        container.addChild(sprite);
        movables.push({ node: sprite, baseX: sprite.x, baseY: sprite.y, c });
      }

      // Nameplate (name + six-band health bar) above the creature's tile.
      // Reparented into the fresh container each rebuild; updated in place.
      seen.add(c.id);
      let plate = nameplates.get(c.id);
      if (!plate) {
        plate = createNameplate(c.name, c.health);
        nameplates.set(c.id, plate);
      } else {
        plate.update(c.name, c.health);
      }
      plate.container.x = (c.x + 0.5) * TILE_SIZE;
      plate.container.y = c.y * TILE_SIZE - 14;
      const plateParent = c.id === world.playerCreatureId && selfPlateLayer
        ? selfPlateLayer
        : container;
      plateParent.addChild(plate.container);
      movables.push({
        node: plate.container, baseX: plate.container.x, baseY: plate.container.y, c,
      });
    }
  }
  for (const [id, plate] of nameplates) {
    if (!seen.has(id)) {
      plate.destroy();
      nameplates.delete(id);
    }
  }
  return movables;
}

function renderCreature(
  c: WorldCreature,
  atlas: SpriteAtlas,
  tintedCache: TintedTextureCache,
  animationPhase: number,
): Container | null {
  if (!c.outfit || c.outfit.lookType === 0) return null; // invisible / item-look: not drawn yet
  return renderPlayer(
    {
      x: c.x,
      y: c.y,
      z: c.z,
      // The wire direction byte is value-compatible with Direction
      // (0 north, 1 east, 2 south, 3 west); renderPlayer additionally
      // clamps to the outfit's pattern count.
      direction: (c.direction & 3) as Direction,
      animationPhase,
      outfit: {
        lookType: c.outfit.lookType,
        headColor: c.outfit.head,
        bodyColor: c.outfit.body,
        legsColor: c.outfit.legs,
        feetColor: c.outfit.feet,
      },
    },
    atlas.creatureIndex,
    atlas.atlasTextures,
    atlas.atlasPages,
    atlas.layout,
    tintedCache,
  );
}
