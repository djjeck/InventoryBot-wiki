/**
 * Phase 5 on synthetic events, for the tests of the wiki and the player state:
 *
 * - ev(): a bot reply turned into an event the way interpretReplies() does it;
 * - runBuild(): build, toJson and playerState on events.
 *
 * No vitest imports here.
 */
import { build, type KB, toJson } from '#src/inventorybot/build.ts';
import { classify } from '#src/inventorybot/classify.ts';
import { playerOf } from '#src/inventorybot/dialect.ts';
import { playerState } from '#src/inventorybot/player.ts';
import { type BuildEvent, type PlayerState, type Wiki } from '#src/inventorybot/types.ts';
import { type MatchKind } from '#src/telegram/conversation/matcher.ts';
import { ownerFromDm } from '#src/telegram/conversation/owner.ts';
import { BASE, BOT, type Instant, tgDate } from './helpers.ts';

export interface EvOptions {
  t?: number;
  chat?: string;
  dm?: boolean;
  msg?: number;
  date?: string;
  /** Default: the @username the reply names. */
  player?: string | null;
  /** Default: "dm" in the DM, null elsewhere. */
  match?: MatchKind | null;
  forwarded?: boolean;
  broadcast?: boolean;
  base?: Instant;
  /** The text file the reply has attached (BotReply.file_text). */
  file?: string;
}

let msgCounter = 50000;

/** A bot reply as an event, assembled like interpretReplies() does it. */
export function ev(text: string, query: string | null = null, o: EvOptions = {}): BuildEvent {
  const dm = o.dm ?? true;
  const e = {
    ...classify(text, query, o.file ?? null),
    chat: o.chat ?? (dm ? BOT : 'Gruppo'),
    dm,
    msg: o.msg ?? ++msgCounter,
    date: o.date ?? tgDate(o.t ?? 0, o.base ?? BASE),
    player: o.player === undefined ? playerOf(text) : o.player,
    query,
    match: o.match === undefined ? (dm ? 'dm' : null) : o.match,
    forwarded: o.forwarded ?? false,
    broadcast: o.broadcast ?? false,
  } as BuildEvent;
  if (e.type === 'unknown') (e as { text: string }).text = text;
  return e;
}

/** An event's fields, for reading the annotations build() adds. */
export const fieldsOf = (e: BuildEvent): Record<string, unknown> =>
  e as unknown as Record<string, unknown>;

/** build + toJson + playerState -> { kb, wiki, state } (events are annotated in place). */
export function runBuild(
  events: BuildEvent[],
  player: string | null = null
): { kb: KB; wiki: Wiki; state: PlayerState } {
  // The given owner, else the DM's, as the pipeline decides it.
  const kb = build(events, player || ownerFromDm(events));
  const wiki = toJson(kb);
  return { kb, wiki, state: playerState(events, kb) };
}
