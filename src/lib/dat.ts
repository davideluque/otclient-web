import { ParseError } from './parseError';
import { BinaryReader } from './BinaryReader';

// --- Enums & constants ---

export const ThingCategory = {
  Item: 0,
  Creature: 1,
  Effect: 2,
  Missile: 3,
} as const;

export type ThingCategory = (typeof ThingCategory)[keyof typeof ThingCategory];

export const ITEM_ID_OFFSET = 100;

export const DatAttr = {
  Ground: 0,
  GroundBorder: 1,
  OnBottom: 2,
  OnTop: 3,
  Container: 4,
  Stackable: 5,
  ForceUse: 6,
  MultiUse: 7,
  Writable: 8,
  WritableOnce: 9,
  FluidContainer: 10,
  Splash: 11,
  NotWalkable: 12,
  NotMoveable: 13,
  BlockProjectile: 14,
  NotPathable: 15,
  Pickupable: 16,
  Hangable: 17,
  HookSouth: 18,
  HookEast: 19,
  Rotatable: 20,
  Light: 21,
  DontHide: 22,
  Translucent: 23,
  Displacement: 24,
  Elevation: 25,
  LyingCorpse: 26,
  AnimateAlways: 27,
  MinimapColor: 28,
  LensHelp: 29,
  FullGround: 30,
  Look: 31,
  Cloth: 32,
  Market: 33,
  /** Attribute terminator byte */
  Last: 0xff,
} as const;

export type DatAttr = (typeof DatAttr)[keyof typeof DatAttr];

// --- Data types ---

export interface Light {
  intensity: number;
  color: number;
}

export interface MarketData {
  category: number;
  tradeAs: number;
  showAs: number;
  name: string;
  restrictVocation: number;
  requiredLevel: number;
}

export interface FrameGroup {
  width: number;
  height: number;
  exactSize: number;
  layers: number;
  numPatternX: number;
  numPatternY: number;
  numPatternZ: number;
  animationPhases: number;
  spriteIds: number[];
}

export interface ThingType {
  id: number;
  category: ThingCategory;
  attrs: Map<number, boolean | number | Light | MarketData | { x: number; y: number }>;
  frameGroup: FrameGroup;
}

export interface DatFile {
  signature: number;
  itemCount: number;
  creatureCount: number;
  effectCount: number;
  missileCount: number;
  items: ThingType[];
  creatures: ThingType[];
  effects: ThingType[];
  missiles: ThingType[];
}

// --- Parser ---

function parseAttrs(reader: BinaryReader): ThingType['attrs'] {
  const attrs = new Map<number, boolean | number | Light | MarketData | { x: number; y: number }>();

  while (true) {
    const attrId = reader.getU8();
    if (attrId === DatAttr.Last) break;

    switch (attrId) {
      case DatAttr.Ground:
        attrs.set(DatAttr.Ground, reader.getU16()); // ground speed
        break;
      case DatAttr.Writable:
      case DatAttr.WritableOnce:
        attrs.set(attrId, reader.getU16()); // max text length
        break;
      case DatAttr.Light:
        attrs.set(DatAttr.Light, {
          intensity: reader.getU16(),
          color: reader.getU16(),
        });
        break;
      case DatAttr.Displacement:
        attrs.set(DatAttr.Displacement, {
          x: reader.getU16(),
          y: reader.getU16(),
        });
        break;
      case DatAttr.Elevation:
        attrs.set(DatAttr.Elevation, reader.getU16());
        break;
      case DatAttr.MinimapColor:
        attrs.set(DatAttr.MinimapColor, reader.getU16());
        break;
      case DatAttr.LensHelp:
        attrs.set(DatAttr.LensHelp, reader.getU16());
        break;
      case DatAttr.Cloth:
        attrs.set(DatAttr.Cloth, reader.getU16());
        break;
      case DatAttr.Market: {
        const market: MarketData = {
          category: reader.getU16(),
          tradeAs: reader.getU16(),
          showAs: reader.getU16(),
          name: reader.getString(),
          restrictVocation: reader.getU16(),
          requiredLevel: reader.getU16(),
        };
        attrs.set(DatAttr.Market, market);
        break;
      }
      default:
        // Boolean flag — no extra data
        attrs.set(attrId, true);
        break;
    }
  }

  return attrs;
}

function parseFrameGroup(reader: BinaryReader): FrameGroup {
  const width = reader.getU8();
  const height = reader.getU8();

  let exactSize = 32;
  if (width > 1 || height > 1) {
    exactSize = Math.min(reader.getU8(), Math.max(width * 32, height * 32));
  }

  const layers = reader.getU8();
  const numPatternX = reader.getU8();
  const numPatternY = reader.getU8();
  const numPatternZ = reader.getU8(); // 7.6 is >= 755, so this exists
  const animationPhases = reader.getU8();

  // 7.6 has no enhanced animations (that's 1050+)

  const totalSprites = width * height * layers * numPatternX * numPatternY * numPatternZ * animationPhases;
  if (totalSprites === 0) {
    throw new ParseError('Invalid DAT frame group: dimensions and pattern counts must be positive');
  }
  if (totalSprites > (reader.length - reader.position) / 2) {
    throw new ParseError('Truncated DAT frame group: sprite count exceeds remaining data');
  }
  const spriteIds: number[] = new Array(totalSprites);

  // 7.6 uses U16 sprite IDs (U32 is 960+)
  for (let i = 0; i < totalSprites; i++) {
    spriteIds[i] = reader.getU16();
  }

  return { width, height, exactSize, layers, numPatternX, numPatternY, numPatternZ, animationPhases, spriteIds };
}

function parseThingTypes(
  reader: BinaryReader,
  count: number,
  category: ThingCategory,
  startId: number,
): ThingType[] {
  const things: ThingType[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const attrs = parseAttrs(reader);
    const frameGroup = parseFrameGroup(reader);
    things[i] = { id: startId + i, category, attrs, frameGroup };
  }
  return things;
}

export function parseDat(buffer: ArrayBuffer): DatFile {
  const reader = new BinaryReader(buffer);

  const signature = reader.getU32();
  const itemCount = reader.getU16();
  const creatureCount = reader.getU16();
  const effectCount = reader.getU16();
  const missileCount = reader.getU16();

  // Item IDs start at 100, others at 1
  const numItems = itemCount - ITEM_ID_OFFSET + 1;
  if (numItems < 0) throw new ParseError(`Invalid DAT maximum item ID: ${itemCount}`);
  const numCreatures = creatureCount;
  const numEffects = effectCount;
  const numMissiles = missileCount;

  const items = parseThingTypes(reader, numItems, ThingCategory.Item, ITEM_ID_OFFSET);
  const creatures = parseThingTypes(reader, numCreatures, ThingCategory.Creature, 1);
  const effects = parseThingTypes(reader, numEffects, ThingCategory.Effect, 1);
  const missiles = parseThingTypes(reader, numMissiles, ThingCategory.Missile, 1);

  return {
    signature,
    itemCount,
    creatureCount,
    effectCount,
    missileCount,
    items,
    creatures,
    effects,
    missiles,
  };
}
