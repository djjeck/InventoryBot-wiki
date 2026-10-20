/**
 * The end of phase 4: the game checks the group pairs phase 2 proposed. Phase 2 pairs a
 * reply with a command by generic evidence (sender, window, the commands the reply's text
 * can come from); only the fully classified reply, read with its command, shows whether
 * the two fit. A pair made in a group by sender (`user`) or as the only candidate
 * (`single`) is confirmed, or dissolved when the event the reply gives with the command is
 * not one that command produces (commandFamily).
 *
 * A dissolved reply is classified again without a command; it gets `query: null`,
 * `match: "dissolved"`, and no player unless it names one. Pairs in the DM and pairs by
 * quote are not checked: they are certain. Pure logic only (no Node APIs).
 *
 * A second check, that a group /usa reply fits the item its query names, needs the items
 * of phase 5 and comes with it.
 */
import { sliceCodePoints } from '#src/lib/text.ts';
import { firstWord } from '#src/telegram/conversation/commands.ts';
import { type BotReply } from '#src/telegram/conversation/conversation.ts';
import { classify } from './classify.ts';
import { commandFamily, playerOf } from './dialect.ts';
import { stripAddr } from './patterns.ts';
import { type ReportEntry } from './report.ts';
import { type EventRecord } from './types.ts';

type Dissolved = Extract<ReportEntry, { kind: 'dissolved_pair' }>;

export interface Verification {
  /** The events, with the dissolved pairs' replies classified again without their command. */
  events: EventRecord[];
  /** Group pairs checked (`user` and `single`). */
  checked: number;
  /** The dissolved pairs, in message order. */
  dissolved: Dissolved[];
}

const isGroupPair = (r: BotReply): boolean =>
  r.context.query !== null && (r.context.match === 'user' || r.context.match === 'single');

/** The reply read without its command: classified again, no query, no player unless it names one. */
function dissolve({ text, context }: BotReply): EventRecord {
  const ev = {
    ...classify(text, null),
    ...context,
    player: playerOf(text) === null ? null : context.player,
    query: null,
    match: 'dissolved',
  } as EventRecord;
  if (ev.type === 'unknown') (ev as { text: string }).text = text;
  return ev;
}

/**
 * Checks the group pairs of `replies`, whose events (same index) are classified with
 * their command; returns the events with the dissolved pairs read again.
 */
export function verifyPairs(
  replies: readonly BotReply[],
  classified: readonly EventRecord[]
): Verification {
  const events = [...classified];
  const dissolved: Dissolved[] = [];
  let checked = 0;
  for (const [i, r] of replies.entries()) {
    if (!isGroupPair(r)) continue;
    checked++;
    const family = commandFamily(events[i] as EventRecord);
    if (family === null || family.has(firstWord(r.context.query as string))) continue;
    events[i] = dissolve(r);
    dissolved.push({
      kind: 'dissolved_pair',
      reason: 'command',
      match: r.context.match as Dissolved['match'],
      query: r.context.query as string,
      type: (classified[i] as EventRecord).type,
      text: sliceCodePoints(stripAddr(r.text), 0, 80),
    });
  }
  return { events, checked, dissolved };
}
