import type { GameClient } from '../net/common/GameClient';
import type { ShopItem } from '../net/common/types';
import { ShopManager } from '../shop';
import { createShopPane, type ShopPaneHandle, type ShopPaneOptions, type ShopSide } from '../shopPane';
import { showActionSheet, type ActionSheetHandle, type ActionSheetAction } from '../actionSheet';

export interface ShopBindingHandle {
  readonly manager: ShopManager;
  destroy(): void;
}

export interface ShopBindingOptions {
  renderThumb?: ShopPaneOptions['renderThumb'];
}

/** Server-side bound (SHOPMODULE_MAX_WINDOW_AMOUNT); requests above it are rejected. */
const MAX_AMOUNT = 100;
const AMOUNT_STEPS = [1, 5, 10, 25, 50, 100];

/**
 * Routes the npc shop packets (0x7A-0x7C, docs/protocol/npc-shop.md) into
 * a ShopManager. Registered after registerWireSkips so these handlers
 * override the discard consumers per opcode. With a `parent`, a shop pane
 * renders the window: tapping an entry opens an amount sheet that sends a
 * buy/sell request (server id + subtype echoed from the catalog, never a
 * price), ✕ sends the close request and dismisses locally; without one the
 * binding stays wire → state only (node-env tests). Fully separate from
 * the player-to-player trade binding (0x7D-0x7F).
 */
export function bindShop(
  client: GameClient,
  parent?: HTMLElement,
  opts: ShopBindingOptions = {},
): ShopBindingHandle {
  const protocol = client.getProtocol();
  const dispatcher = client.getDispatcher();
  const op = protocol.serverOpcodes;
  const manager = new ShopManager();

  let pane: ShopPaneHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let sheet: ActionSheetHandle | null = null;
  const closeSheet = (): void => {
    sheet?.close();
    sheet = null;
  };

  if (parent) {
    const send = (packet: Parameters<GameClient['send']>[0]): void => {
      try {
        client.send(packet);
      } catch (e) {
        console.warn('[jamera] shop send failed:', e instanceof Error ? e.message : e);
      }
    };
    pane = createShopPane(parent, {
      renderThumb: opts.renderThumb,
      onClose: () => {
        send(protocol.shop.buildClose());
        // The server clears the session silently (no 0x7C echo) — drop
        // the window locally.
        manager.close();
      },
      onItemTap: (side: ShopSide, item: ShopItem, ownedCount: number) => {
        const unitPrice = side === 'buy' ? item.buyPrice : item.sellPrice;
        const cap = side === 'sell' ? Math.min(ownedCount, MAX_AMOUNT) : MAX_AMOUNT;
        const amounts = AMOUNT_STEPS.filter((n) => n <= cap);
        if (amounts.length === 0) return; // nothing to sell
        const actions: ActionSheetAction[] = amounts.map((amount) => ({
          label: `${side === 'buy' ? 'Buy' : 'Sell'} ${amount} — ${unitPrice * amount} gp`,
          onSelect: () => send(side === 'buy'
            ? protocol.shop.buildBuy(item.serverId, item.subType, amount)
            : protocol.shop.buildSell(item.serverId, item.subType, amount)),
        }));
        closeSheet();
        sheet = showActionSheet({ title: item.name, actions, parent });
      },
    });
    unsubscribe = manager.subscribe(() => {
      pane?.update(manager.current);
      // Goods/catalog updates can change owned counts and prices under
      // the sheet; force a fresh tap on the re-rendered row.
      closeSheet();
    });
  }

  dispatcher.on(op.ShopOpen, (p) => {
    manager.open(protocol.shop.parseOpen(p));
  });
  dispatcher.on(op.ShopGoods, (p) => {
    manager.setGoods(protocol.shop.parseGoods(p));
  });
  dispatcher.on(op.ShopClose, () => {
    manager.close();
  });

  return {
    manager,
    destroy: () => {
      dispatcher.off(op.ShopOpen);
      dispatcher.off(op.ShopGoods);
      dispatcher.off(op.ShopClose);
      unsubscribe?.();
      closeSheet();
      pane?.destroy();
      manager.clear();
    },
  };
}
