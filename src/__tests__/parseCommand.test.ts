import { describe, it, expect } from 'vitest';
import { parseCommand } from '../lib/chat/ChatUI';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { MessageType, ChannelId } from '../lib/net/common/types';

const protocol = new GameProtocol();

function firstMessageType(packet: ReturnType<typeof protocol.chat.buildSay>): number {
  // chat packets: opcode(U8) + messageType(U8) + ...
  return packet.toUint8Array()[1];
}

describe('parseCommand', () => {
  it('/w Name msg → private message to Name', () => {
    const packet = parseCommand('/w Alice hello', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('/w with no message → null (no-op)', () => {
    expect(parseCommand('/w Alice', ChannelId.Default, protocol)).toBeNull();
  });

  it('/whisper Name msg → private message to Name (not local whisper)', () => {
    // Regression guard: previously `/whisper Alice hi` was sent as local
    // whisper text "Alice hi", leaking the intended-private message.
    const packet = parseCommand('/whisper Alice hi', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('/whisper msg (single word) → local whisper speech', () => {
    const packet = parseCommand('/whisper psst', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Whisper);
  });

  it('/yell msg → yell speech', () => {
    const packet = parseCommand('/yell HELP', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Yell);
  });

  it('plain text in Default channel → Say', () => {
    const packet = parseCommand('hello there', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Say);
  });

  it('plain text in non-Default channel → channel message', () => {
    const packet = parseCommand('selling sword', ChannelId.Trade, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Channel);
  });

  it('/w with extra whitespace still routes to private message', () => {
    // Regression guard: parser must collapse variable whitespace between
    // the prefix and the recipient name, or PMs silently drop / misroute.
    const packet = parseCommand('/w    Alice   hello there', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('/whisper with extra whitespace still routes to private message', () => {
    const packet = parseCommand('/whisper   Bob   secret', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  // ─── Privacy guards: unknown slash commands must NOT leak to public ────

  it('/wAlice secret (missing space after /w) returns null instead of leaking', () => {
    // Real privacy regression candidate: this looks like a typo'd PM and
    // would otherwise be sent to public Say.
    expect(parseCommand('/wAlice secret', ChannelId.Default, protocol)).toBeNull();
  });

  it('/w (no trailing space) returns null', () => {
    expect(parseCommand('/w', ChannelId.Default, protocol)).toBeNull();
  });

  it('/whisper (no trailing space) returns null', () => {
    expect(parseCommand('/whisper', ChannelId.Default, protocol)).toBeNull();
  });

  it('/pm Bob secret (unknown command) returns null instead of leaking', () => {
    expect(parseCommand('/pm Bob secret', ChannelId.Default, protocol)).toBeNull();
  });

  it('/unknownCommand returns null', () => {
    expect(parseCommand('/zzz hello', ChannelId.Default, protocol)).toBeNull();
  });

  it('plain text containing / mid-string still sends to default', () => {
    // Regression guard: only LEADING `/` is treated as command syntax.
    const packet = parseCommand('hello/world', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Say);
  });

  // ─── Leading-whitespace bypass guards ─────────────────────────────────

  it('"  /w Alice hi" (leading spaces) still routes to private, never public', () => {
    // Codex Rescue regression: callers that don't pre-trim could otherwise
    // bypass the slash-command guards entirely, exposing intended-private
    // text via the default Say branch.
    const packet = parseCommand('  /w Alice secret', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('"\\n/w Alice hi" (leading newline) still routes to private', () => {
    const packet = parseCommand('\n/w Alice secret', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('"\\t/whisper Bob hi" (leading tab) still routes to private', () => {
    const packet = parseCommand('\t/whisper Bob secret', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('"\\u00A0/pm Bob secret" (NBSP-prefixed unknown command) returns null', () => {
    // NBSP (U+00A0) is Unicode whitespace; trimStart handles it per spec.
    // After trim the input becomes "/pm Bob secret" which is an unknown
    // slash command → null, not leaked to public.
    expect(parseCommand(' /pm Bob secret', ChannelId.Default, protocol)).toBeNull();
  });

  // ─── Documented quirk: single-word /whisper ────────────────────────────

  it('/whisper Bob (no body) sends "Bob" as local whisper (documented quirk)', () => {
    // This is a privacy-ambiguous corner — the intended-recipient name is
    // spoken locally instead of going nowhere. Behaviour matches the doc
    // comment above parseCommand; this test guards against silent change.
    // If we ever want to flip the default to "null", update both.
    const packet = parseCommand('/whisper Bob', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Whisper);
  });
});
