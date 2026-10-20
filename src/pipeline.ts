/**
 * The pipeline in memory: phases 2 to 5 on the messages of phase 1.
 * It joins the generic Telegram-bot layer and the InventoryBot layer, and uses no Node or
 * browser API: the web app's worker (src/web/run.ts) runs it, and the tests run it in Node.
 *
 * An ending condition that needs the user (no owner) is returned, not reported: the front
 * end words it for its own way of asking.
 */
import { INVENTORY_BOT } from './inventorybot/bot.ts';
import { build, reportLines, toJson } from './inventorybot/build.ts';
import { inventoryBotDialect, learnTitles } from './inventorybot/dialect.ts';
import { interpretationReport, interpretReplies } from './inventorybot/extract.ts';
import { playerState } from './inventorybot/player.ts';
import {
  type BuildEvent,
  type EventRecord,
  type PlayerState,
  type Wiki,
} from './inventorybot/types.ts';
import { anonymise } from './telegram/anonymise/anonymise.ts';
import {
  type Conversation,
  matchReportLines,
  readConversation,
} from './telegram/conversation/conversation.ts';
import { hasDm, ownerFromDm } from './telegram/conversation/owner.ts';
import { type Message } from './telegram/messages.ts';

/** What phases 2 and 3 return, with the player titles the dialect was built with. */
export interface Conversed {
  /** Anonymised (phase 3). */
  conversation: Conversation;
  titles: string[];
  /** The export owner, decided before phase 3; null when unknown. */
  owner: string | null;
  /** No DM with the bot and no username given: the run must stop and ask for it. */
  ownerMissing: boolean;
  /** A chat title as phase 3 writes it (Anonymised.chatTitle). */
  chatTitle(title: string): string;
}

export interface ConverseOptions {
  /** The owner's @username (without `@`), as the player gives it; else the DM decides. */
  player: string | null;
  /** The secret salt of the pseudonyms (AnonymiseOptions.salt). */
  salt: string;
}

/**
 * Phases 2 and 3 on the messages of phase 1. The dialect is built with the player titles
 * learned from every bot message of the run; the owner is decided between the two.
 */
export function converse(messages: readonly Message[], options: ConverseOptions): Conversed {
  const titles = learnTitles(messages.filter((m) => m.from_bot).map((m) => m.text));
  const dialect = inventoryBotDialect(titles);
  const paired = readConversation(messages, INVENTORY_BOT.name, dialect);
  const contexts = paired.replies.map((r) => r.context);
  const owner = options.player || ownerFromDm(contexts);
  const groupChats = messages.filter((m) => !m.dm).map((m) => m.chat);
  const { conversation, chatTitle } = anonymise(paired, {
    owner,
    botName: INVENTORY_BOT.name,
    dialect,
    salt: options.salt,
    groupChats,
  });
  return {
    conversation,
    titles,
    owner,
    ownerMissing: !options.player && !hasDm(contexts),
    chatTitle,
  };
}

/** The report lines of phases 2 and 3, in Italian: the owner, the replies and their pairing. */
export function conversationReport(c: Conversed): string[] {
  return [
    `giocatore: ${c.owner === null ? 'sconosciuto' : `@${c.owner}`}`,
    `risposte del bot: ${c.conversation.replies.length}`,
    ...matchReportLines(c.conversation.replies),
    `nomi visualizzati abbinati a un giocatore: ${c.conversation.senders.size}; ` +
      `titoli dei giocatori riconosciuti: ${c.titles.length}`,
  ];
}

/** Phase 4 on the conversation of phases 2 and 3: the events and the report lines. */
export function interpret(c: Conversed): { events: EventRecord[]; report: string[] } {
  const interpretation = interpretReplies(c.conversation.replies);
  return { events: interpretation.events, report: interpretationReport(interpretation) };
}

/**
 * Phase 5 on the events of phase 4: the wiki and the owner's player state, and the report
 * lines. The events are read as plain JSON copies: build() annotates its input in place,
 * and a copy keeps phase 4's events as they were.
 */
export function buildWiki(
  events: readonly EventRecord[],
  owner: string | null
): { wiki: Wiki; player: PlayerState; report: string[] } {
  const copies = JSON.parse(JSON.stringify(events)) as BuildEvent[];
  const kb = build(copies, owner);
  // toJson and playerState add to the report: the lines are read after both.
  const wiki = toJson(kb);
  const player = playerState(copies, kb);
  return { wiki, player, report: reportLines(kb) };
}
