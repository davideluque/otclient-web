import type { GameClient } from '../net/common/GameClient';
import type { InputPacket } from '../net/common/InputPacket';
import type { MapTileItem } from '../net/common/types';
import { makeDraggable } from '../draggable';

export interface TradeBindingOptions {
  renderThumb?: (itemId: number) => HTMLCanvasElement | null;
}

export interface TradeBindingHandle {
  destroy(): void;
}

interface TradeOffer {
  name: string;
  items: MapTileItem[];
}

const STYLE_ID = 'trade-pane-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .trade-pane {
      position: fixed; top: 18%; left: 50%; transform: translateX(-50%);
      z-index: 40; width: min(360px, calc(100vw - 24px)); padding: 10px;
      border: 1px solid #9a9a9a; border-radius: 10px;
      background: rgba(22,22,22,.96); color: #eee;
      font: .75rem system-ui, sans-serif; user-select: none;
    }
    .trade-pane .trade-head { cursor: grab; font-weight: 700; padding: 2px 2px 9px; }
    .trade-pane .trade-offers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .trade-pane .trade-offer { min-width: 0; }
    .trade-pane .trade-name { color: #d7c786; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .trade-pane .trade-grid {
      display: grid; grid-template-columns: repeat(3, 42px); gap: 4px;
      margin-top: 5px; max-height: 142px; overflow: auto;
    }
    .trade-pane .trade-item {
      position: relative; width: 42px; height: 42px; padding: 0;
      border: 1px solid #777; border-radius: 5px; background: rgba(0,0,0,.45);
      color: #ddd; font-size: .55rem; cursor: pointer;
    }
    .trade-pane .trade-item canvas { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
    .trade-pane .trade-count { position: absolute; right: 2px; bottom: 1px; color: white; text-shadow: 0 1px #000; }
    .trade-pane .trade-empty { color: #888; padding: 12px 0; }
    .trade-pane .trade-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .trade-pane .trade-actions button {
      min-height: 34px; padding: 0 14px; border: 1px solid #777; border-radius: 7px;
      background: #333; color: #eee; font: inherit; cursor: pointer;
    }
    .trade-pane .trade-actions .accept { border-color: #6d965c; background: #294326; }
    .trade-pane .trade-actions .accept:disabled { opacity: .45; cursor: default; }
  `;
  document.head.appendChild(style);
}

/** Bind Tibia 7.6's two trade-offer packets to a movable confirmation pane. */
export function bindTrade(
  client: GameClient,
  parent: HTMLElement = document.body,
  opts: TradeBindingOptions = {},
): TradeBindingHandle {
  ensureStyles();
  const protocol = client.getProtocol();
  const dispatcher = client.getDispatcher();
  const op = protocol.serverOpcodes;
  let own: TradeOffer | null = null;
  let counter: TradeOffer | null = null;
  let pane: HTMLElement | null = null;
  let stopDrag: (() => void) | null = null;

  const send = (packet: Parameters<GameClient['send']>[0]): void => {
    try {
      client.send(packet);
    } catch (e) {
      console.warn('[jamera] trade send failed:', e instanceof Error ? e.message : e);
    }
  };

  const parseOffer = (packet: InputPacket): TradeOffer => {
    const name = packet.getString();
    const count = packet.getU8();
    const items: MapTileItem[] = [];
    for (let i = 0; i < count; i++) items.push(protocol.map.parseItem(packet));
    return { name, items };
  };

  const closePane = (): void => {
    stopDrag?.();
    stopDrag = null;
    pane?.remove();
    pane = null;
  };

  const renderOffer = (offer: TradeOffer | null, isCounter: boolean): HTMLElement => {
    const section = document.createElement('section');
    section.className = 'trade-offer';
    const name = document.createElement('div');
    name.className = 'trade-name';
    name.textContent = offer ? (isCounter ? offer.name : `${offer.name} (you)`) : 'Waiting for offer…';
    section.appendChild(name);
    if (!offer) {
      const empty = document.createElement('div');
      empty.className = 'trade-empty';
      empty.textContent = 'No item yet';
      section.appendChild(empty);
      return section;
    }
    const grid = document.createElement('div');
    grid.className = 'trade-grid';
    offer.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'trade-item';
      button.setAttribute('aria-label', `Look at trade item ${index + 1}`);
      button.addEventListener('click', () => send(protocol.actions.buildLookInTrade(isCounter, index)));
      const thumb = opts.renderThumb?.(item.id) ?? null;
      if (thumb) button.appendChild(thumb);
      else button.textContent = `#${item.id}`;
      if (item.count !== undefined) {
        const count = document.createElement('span');
        count.className = 'trade-count';
        count.textContent = String(item.count);
        button.appendChild(count);
      }
      grid.appendChild(button);
    });
    section.appendChild(grid);
    return section;
  };

  const render = (): void => {
    const isNew = pane === null;
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'trade-pane';
      pane.setAttribute('role', 'dialog');
      pane.setAttribute('aria-label', 'Trade');
    } else {
      stopDrag?.();
      stopDrag = null;
      pane.replaceChildren();
    }
    const head = document.createElement('div');
    head.className = 'trade-head';
    head.textContent = 'Trade';
    const offers = document.createElement('div');
    offers.className = 'trade-offers';
    offers.append(renderOffer(own, false), renderOffer(counter, true));
    const actions = document.createElement('div');
    actions.className = 'trade-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => send(protocol.actions.buildCloseTrade()));
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'accept';
    accept.textContent = 'Accept';
    accept.disabled = !own || !counter;
    accept.addEventListener('click', () => {
      accept.disabled = true;
      send(protocol.actions.buildAcceptTrade());
    });
    actions.append(cancel, accept);
    pane.append(head, offers, actions);
    if (isNew) parent.appendChild(pane);
    stopDrag = makeDraggable(pane, head);
  };

  dispatcher.on(op.TradeRequest, (packet) => {
    own = parseOffer(packet);
    render();
  });
  dispatcher.on(op.TradeRequestAck, (packet) => {
    counter = parseOffer(packet);
    render();
  });
  dispatcher.on(op.TradeClose, () => {
    own = null;
    counter = null;
    closePane();
  });

  return {
    destroy: () => {
      dispatcher.off(op.TradeRequest);
      dispatcher.off(op.TradeRequestAck);
      dispatcher.off(op.TradeClose);
      closePane();
    },
  };
}
