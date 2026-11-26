import type { ChatMessage } from '../net/common/types';
import { MessageType } from '../net/common/types';

/** Build a message row with textContent only — sender/text are untrusted. */
export function buildMessageRow(msg: ChatMessage, className = 'msg'): HTMLElement {
  const div = document.createElement('div');
  div.className = className;
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.append(
    makeSpan('timestamp', time),
    makeSpan('sender', `${msg.senderName}: `),
    makeSpan('text', msg.text),
  );
  return div;
}

export function makeSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** Private messages and NPC/monster replies stay prominent in glance mode. */
export function isPersistentGlanceMessage(msg: ChatMessage): boolean {
  return (
    msg.messageType === MessageType.PrivateFrom
    || msg.messageType === MessageType.PrivateRed
    || msg.messageType === MessageType.MonsterSay
    || msg.messageType === MessageType.MonsterYell
  );
}
