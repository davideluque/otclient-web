import type { GameClient } from '../net/common/GameClient';

/**
 * Register dispatcher handlers for opcodes the jamera page deliberately
 * doesn't render. These are *application* decisions (a different
 * consumer might want to surface GM permissions or paint spell effects),
 * not protocol requirements — so they live here under jamera/, not in
 * `common/GameClient`.
 *
 * Each handler is `p.skip(N)` because the dispatcher can't infer packet
 * length without a handler — leaving an opcode unhandled drops the rest
 * of the frame (including MapDescription / move updates that may follow).
 *
 * Byte counts are what jamera (Aztra 7.6 fork) actually sends. If a
 * stricter 7.6 reference server emerges with different counts, that's a
 * per-server config split, not a code change here.
 */
export function applyJameraQuirks(client: GameClient): void {
  const dispatcher = client.getDispatcher();
  const op = client.getProtocol().serverOpcodes;

  // GMActions: 32-byte GM permission block jamera sends right after
  // LoginInfo. We don't render a GM UI; if we ever do, replace this
  // with a real parser.
  dispatcher.on(op.GMActions, (p) => p.skip(32));

  // MagicEffect: `U16 x, U16 y, U8 z, U8 effectType` = 6 bytes. Will
  // become a real handler when the effects PR lands.
  dispatcher.on(op.MagicEffect, (p) => p.skip(6));

  // InventoryClear: 1-byte slot id. The inventory UI PR will replace
  // this with a real handler that updates a player-inventory store.
  dispatcher.on(op.InventoryClear, (p) => p.skip(1));
}
