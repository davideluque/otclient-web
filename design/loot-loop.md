# Loot loop — containers, item move, use-with

The client can walk, fight, and chat, but can't open a corpse, pick anything
up, or use a rope. This plan adds the full loot loop as three stacked-PR
tracks. Wire layouts are verified against the Jamera server source
(`protocol76.cpp`, `game.cpp`, `player.cpp` — file:line refs below are into
that tree).

## Wire reference (7.6)

### Server → client

| packet | layout |
|---|---|
| ContainerOpen 0x6E | u8 cid, u16 containerClientId (no count byte), string name, u8 capacity, u8 hasParent, u8 itemCount (≤255), items |
| ContainerClose 0x6F | u8 cid |
| ContainerAddItem 0x70 | u8 cid, item — **no slot byte: prepend at slot 0** |
| ContainerUpdateItem 0x71 | u8 cid, u8 slot, item |
| ContainerRemoveItem 0x72 | u8 cid, u8 slot |

Item serialization everywhere: u16 clientId, then u8 count **only if** the
.dat type is stackable/splash/fluid (`NetworkMessage::AddItem`,
networkmessage.cpp:125). The client mirror is `MapProtocol.parseItem`.

### Client → server

| packet | layout |
|---|---|
| ThrowItem 0x78 | pos from, u16 spriteId, u8 fromStackpos, pos to, u8 count (parseThrow :1231; server drops the packet when to == from) |
| UseItemEx 0x83 | pos from, u16 fromSpriteId, u8 fromStackpos, pos to, u16 toSpriteId, u8 toStackpos (:1182) |
| CloseContainer 0x87 | u8 cid (server echoes 0x6F) |
| UpArrowContainer 0x88 | u8 cid (server rebinds the SAME cid to the parent and re-sends 0x6E) |
| UseItem 0x82 (existing) | its trailing `index` byte is the **client-chosen container id** the opened container should occupy (actions.cpp:346) |

### Virtual positions (game.cpp:430-580)

Container and inventory things are addressed through fake positions:

- Container slot: `x = 0xFFFF, y = 0x40 | cid, z = slot` (cid is 4 bits → 0-15,
  max 16 open containers; `addContainer` rejects cid > 0xF, player.cpp:800)
- Inventory slot: `x = 0xFFFF, y = slot (1=head … 10=ammo), z = 0`
- `y = 0, z = 0` is the hotkey/find-by-type form — not used by us

## UX (mobile-first, casual)

- **Open**: double-tap a corpse/backpack (existing use path) → container pane
  appears. The pane mirrors the inventory pane pattern (fixed overlay, item
  thumbnails, DOM above the canvas so taps never leak to walk).
- **Pane chrome**: name, ⬆ up-arrow when `hasParent`, ✕ close. Multiple panes
  stack vertically; each is one server cid.
- **Loot**: tap an item in a container → action sheet: **Loot** (move to the
  equipped backpack: to = inventory slot 3), **Look**, **Drop** (to the tile
  under the player). Stackables move with their full count — no split UI in
  v1 (documented gap).
- **Use with**: action sheets grow a **Use with…** entry (rope, shovel,
  runes): arms a crosshair mode; the next canvas tap sends 0x83 with the
  armed item as `from` and the tapped tile's top thing as `to`.
- **Window ids**: the client picks the next free cid on 0x82 (`index` byte);
  opening a container from *inside* an open container reuses that pane's cid
  (classic-client behaviour, keeps the pane count bounded).

## PR map

Track A — containers (this stack):
1. `feat/loot-plan` — this document.
2. `feat/containers-protocol` — ClientOp additions (0x78/0x83/0x87/0x88),
   `containersProtocol.ts` parsers + builders, `ContainersProtocol` section on
   `GameProtocol`, round-trip tests.
3. `feat/containers-manager` — `ContainerManager` (cid → open container
   state, slot-0 prepend, update/remove, subscribe) + `containerBinding`
   registering the five server opcodes over their wireSkips.
4. `feat/containers-pane` — `containerPane` UI + thumbnails + binding wiring
   in jamera main, gallery entry, changelog.
5. `feat/containers-open-id` — next-free-cid selection for 0x82's index byte
   (threaded into interactions), reuse-parent-cid rule.

Track B — item move (stacked after A merges):
`buildMoveThing` + virtual-position encoders + tests, then the action-sheet
UI (loot/drop from containers; unequip via inventory pane; ground pick-up on
the long-press sheet).

Track C — use-with (stacked after B):
`buildUseItemWith` + crosshair arm/cancel mode in interactions, action-sheet
entries, changelog.

## Non-goals (v1)

- Stack-count splitting (always full count), drag-and-drop (tap flows only),
  trade windows, text/house windows. Depot works for free (it's a container).
