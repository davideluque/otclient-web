/** A single quick-reply chip shown during an NPC conversation. */
export interface NpcQuickReply {
  /** Visible label on the chip, e.g. "trade". */
  label: string;
  /** Text sent through the normal chat protocol when tapped. */
  text: string;
}

/**
 * Host-controlled NPC conversation context. When active, quick-chat shows
 * reply chips; free-form typing remains available.
 */
export interface NpcChatContext {
  /** Optional NPC name shown above the chips. */
  npcName?: string;
  /** Chip definitions; defaults applied when omitted. */
  replies?: NpcQuickReply[];
  /**
   * Item-specific purchase choices — generic extension point for shop UIs.
   * Each entry sends `text` through the chat protocol.
   */
  purchaseChoices?: NpcQuickReply[];
}

export const DEFAULT_NPC_REPLIES: readonly NpcQuickReply[] = [
  { label: 'hi', text: 'hi' },
  { label: 'trade', text: 'trade' },
  { label: 'yes', text: 'yes' },
  { label: 'no', text: 'no' },
  { label: 'buy', text: 'buy' },
  { label: 'sell', text: 'sell' },
];

export function resolveNpcReplies(ctx: NpcChatContext): NpcQuickReply[] {
  const base = ctx.replies ?? [...DEFAULT_NPC_REPLIES];
  return ctx.purchaseChoices ? [...base, ...ctx.purchaseChoices] : base;
}
