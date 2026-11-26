// Small, original 7.6 assets for the mock server's grass (102) and outfit (128).
// Only two single-frame sprites are needed for the entire scene.
function u16(value) {
  return [value & 0xff, value >>> 8];
}

function u32(value) {
  return [...u16(value & 0xffff), ...u16(value >>> 16)];
}

function thing(sprite, attrs = []) {
  // Attr terminator, 1x1 tile, one layer, one pattern per axis, one phase.
  return [...attrs, 0xff, 1, 1, 1, 1, 1, 1, 1, ...u16(sprite)];
}

function dat() {
  const bytes = [...u32(0), ...u16(102), ...u16(128), ...u16(0), ...u16(0)];
  for (let item = 100; item <= 102; item++) bytes.push(...thing(1, [0, ...u16(100)]));
  for (let outfit = 1; outfit <= 128; outfit++) bytes.push(...thing(2));
  return Buffer.from(bytes);
}

function sprite(red, green, blue) {
  const pixels = Buffer.alloc(32 * 32 * 3, Buffer.from([red, green, blue]));
  const runs = [...u16(0), ...u16(32 * 32), ...pixels];
  return Buffer.from([0xff, 0, 0xff, ...u16(runs.length), ...runs]);
}

function spr() {
  const ground = sprite(40, 95, 50);
  const creature = sprite(200, 125, 50);
  const headerLength = 4 + 2 + 2 * 4;
  const header = [...u32(0), ...u16(2), ...u32(headerLength), ...u32(headerLength + ground.length)];
  return Buffer.concat([Buffer.from(header), ground, creature]);
}

function otb() {
  const start = 0xfe;
  const end = 0xff;
  const version = [...u32(0), ...u32(3), ...u32(760), ...u32(0), ...Buffer.alloc(128)];
  const root = [0, ...u32(0), 1, ...u16(version.length), ...version];
  const ground = [1, ...u32(0), 0x10, ...u16(2), ...u16(102), 0x11, ...u16(2), ...u16(102)];
  return Buffer.from([...u32(0), start, ...root, start, ...ground, end, end]);
}

export const mockAssets = { 'Tibia.dat': dat(), 'Tibia.spr': spr(), 'items.otb': otb() };
