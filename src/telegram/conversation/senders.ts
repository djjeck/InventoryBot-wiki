/**
 * Who sent each message, and which @username each group sender is. Generic: the bot's
 * wording comes from its BotDialect. Pure functions, no Node APIs.
 */
import { increment, mostCommon } from '#src/lib/counts.ts';
import { windowsDateSeconds } from '#src/lib/dates.ts';
import { type Message } from '#src/telegram/messages.ts';
import { type ChatMessage, firstWord, isBotCommand } from './commands.ts';
import { type BotDialect } from './dialect.ts';

/** Telegram's display name for every deleted account: shared by many people, never mapped. */
export const DELETED_ACCOUNT = 'Deleted Account';

/** Display names never mapped to a username: Telegram's own and the dialect's. */
export function unmappableNames(dialect: Pick<BotDialect, 'unmappableNames'>): Set<string> {
  return new Set([DELETED_ACCOUNT, ...dialect.unmappableNames]);
}

/** Keeps opaque sender keys apart from display names in the maps keyed by sender. */
const KEYED = '\u0000';

/**
 * Who sent a message, for the display name -> @username map and the pairing: its opaque
 * `sender_key` when the export identifies the sender (macOS export), else its display
 * name. A key tells apart two people with the same name and follows a renamed account.
 */
export function senderIdentity(m: Pick<Message, 'sender' | 'sender_key'>): string | null {
  return m.sender_key !== undefined ? KEYED + m.sender_key : m.sender;
}

/**
 * Messages without a sender key take the key of their display name, so one person is not
 * split into a name and a key (e.g. a Windows export next to a macOS export of the same
 * chat, or the owner's key from a macOS DM in a group exported on Windows): the only key
 * the name has in the same chat; if it has none there, the only key it has in the whole
 * input. Names with several keys, and `unmappable` names, stay display names.
 */
export function shareSenderKeys<T extends Message>(
  msgs: readonly T[],
  unmappable: ReadonlySet<string> = new Set([DELETED_ACCOUNT])
): T[] {
  const inChat = new Map<string, Set<string>>();
  const anywhere = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, k: string, key: string): void => {
    let s = map.get(k);
    if (s === undefined) map.set(k, (s = new Set()));
    s.add(key);
  };
  const chatName = (m: T): string => JSON.stringify([m.chat, m.sender]);
  for (const m of msgs) {
    if (m.sender_key === undefined || m.sender === null) continue;
    add(inChat, chatName(m), m.sender_key);
    add(anywhere, m.sender, m.sender_key);
  }
  return msgs.map((m) => {
    if (m.sender_key !== undefined || m.sender === null || unmappable.has(m.sender)) return m;
    const k = inChat.get(chatName(m)) ?? anywhere.get(m.sender);
    return k !== undefined && k.size === 1 ? { ...m, sender_key: [...k][0] as string } : m;
  });
}

/**
 * Maps group display names to @usernames by voting over the whole chat.
 *
 * Each bot reply addressed to @u (dialect.addressee) votes for the sender of the nearest
 * preceding compatible command (dialect.compatibleCommands) within dialect.groupWindow. A
 * display name takes the @username it voted for in at least minVotes cases and minShare
 * of its votes; each @username keeps only the display name with most votes (an export
 * shows every user under a single name). Order-independent, so an early mistake does not
 * propagate. Senders are senderIdentity()s: the opaque sender key when the export gives
 * one. Unmappable names (unmappableNames) never vote.
 */
export function learnDisplayNames(
  msgs: readonly ChatMessage[],
  seed: ReadonlyMap<string | null, string>,
  dialect: Pick<BotDialect, 'compatibleCommands' | 'addressee' | 'unmappableNames' | 'groupWindow'>,
  minVotes = 3,
  minShare = 0.6
): Map<string | null, string> {
  const unmappable = unmappableNames(dialect);
  const window = dialect.groupWindow;
  const votes = new Map<string | null, Map<string, number>>();
  // chat -> commands in the window: [ts, sender, command]
  const recent = new Map<string | null, [number, string | null, string][]>();
  for (const m of msgs) {
    if (m.dm || m.forwarded_from) continue;
    const ts = windowsDateSeconds(m.date);
    if (ts === null) continue;
    const chat = m.chat;
    if (!m.from_bot) {
      if (isBotCommand(m) && !unmappable.has(m.sender as string)) {
        const r = recent.get(chat) ?? [];
        r.push([ts, senderIdentity(m), firstWord(m.text)]);
        recent.set(chat, r);
      }
      continue;
    }
    const player = dialect.addressee(m.text);
    if (!player) continue;
    const allowed = dialect.compatibleCommands(m.text);
    const r = recent.get(chat) ?? [];
    const live = r.filter(
      (c) => 0 <= ts - c[0] && ts - c[0] <= window && (allowed === null || allowed.has(c[2]))
    );
    recent.set(
      chat,
      r.filter((c) => ts - c[0] <= window)
    );
    const nearest = live[live.length - 1];
    if (nearest) {
      let v = votes.get(nearest[1]);
      if (v === undefined) votes.set(nearest[1], (v = new Map()));
      increment(v, player);
    }
  }
  const best: [string | null, string, number][] = [];
  for (const [sender, c] of votes) {
    const [player, n] = mostCommon(c)[0] as [string, number];
    let total = 0;
    for (const x of c.values()) total += x;
    if (n >= minVotes && n / total >= minShare) best.push([sender, player, n]);
  }
  const out = new Map(seed);
  const taken = new Set(seed.values());
  for (const [sender, player] of best.sort((a, b) => b[2] - a[2])) {
    if (!out.has(sender) && !taken.has(player)) {
      out.set(sender, player);
      taken.add(player);
    }
  }
  return out;
}
