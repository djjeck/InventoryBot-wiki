/**
 * The pipeline in memory: phases 1 to 5, from the pages of the exports to the wiki, the
 * player state and the report lines. Each export is read once into a record
 * (processExport), which can be kept; the records of a run give the results (buildWiki).
 * runPipeline is the two in a row; converse, then finishPipeline, run from phase 2 on
 * given messages.
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
import { compareCodePoints } from './lib/text.ts';
import { anonymise } from './telegram/anonymise/anonymise.ts';
import {
  type Conversation,
  matchReportLines,
  readConversation,
} from './telegram/conversation/conversation.ts';
import { hasDm, ownerFromDm } from './telegram/conversation/owner.ts';
import {
  type ExportRecord,
  mergeExports,
  readExport,
  splitExports,
  summaryLine,
} from './telegram/export/record.ts';
import { type Message, type Page } from './telegram/messages.ts';

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
export function buildFromEvents(
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

/** A step of the pipeline, as the page's progress shows it. */
export type Phase = 'parse' | 'conversation' | 'interpret' | 'build';

/** What phases 4 and 5 give after the conversation: every result, and the report lines. */
export interface Finished {
  events: EventRecord[];
  wiki: Wiki;
  player: PlayerState;
  report: string[];
}

/** Phases 4 and 5 after the conversation of phases 2 and 3. */
export function finishPipeline(c: Conversed, onPhase: (p: Phase) => void = () => {}): Finished {
  onPhase('interpret');
  const interpreted = interpret(c);
  onPhase('build');
  const built = buildFromEvents(interpreted.events, c.owner);
  return {
    events: interpreted.events,
    wiki: built.wiki,
    player: built.player,
    report: [...interpreted.report, ...built.report],
  };
}

export interface PipelineOptions extends ConverseOptions {
  /** The IANA time zone for the dates of macOS exports (ParseOptions.timeZone). */
  timeZone: string;
}

/** A run of the whole pipeline: its results, or why it stopped, with the report lines so far. */
export type PipelineOutcome =
  | ({ status: 'done'; messages: readonly Message[]; conversed: Conversed } & Finished)
  /** No DM with the bot and no username given: the owner is unknown. */
  | { status: 'no-owner'; report: string[] };

/**
 * Phase 1 for one export (the pages of one folder, in order: splitExports): its record,
 * plain JSON data that buildWiki reads, so that an export is parsed only once. The
 * sender keys are salted with the pseudonyms' salt, so they agree across records.
 * Asynchronous: the hashes are Web Crypto's.
 */
export function processExport(
  pages: Iterable<Page>,
  options: Pick<ConverseOptions, 'salt'>
): Promise<ExportRecord> {
  return readExport(pages, { bot: INVENTORY_BOT, salt: options.salt });
}

/**
 * Phases 1 to 5 on the records of the exports, in the order they were read (the end of
 * phase 1, mergeExports, then phases 2 to 5). The report lines are the warnings of phase
 * 1, its summary (with the chat titles of phase 3, so printed only once there is an
 * owner), then the lines of each phase.
 */
export function buildWiki(
  records: readonly ExportRecord[],
  options: PipelineOptions,
  onPhase: (p: Phase) => void = () => {}
): PipelineOutcome {
  const parsed = mergeExports(records, { bot: INVENTORY_BOT, timeZone: options.timeZone });
  const report = [...parsed.warnings];
  onPhase('conversation');
  const c = converse(parsed.messages, options);
  if (c.ownerMissing) return { status: 'no-owner', report };
  const chats = [...new Set(parsed.chats.map((t) => (t === '?' ? t : c.chatTitle(t))))];
  const fromBot = parsed.messages.filter((m) => m.from_bot).length;
  report.push(
    summaryLine({ ...parsed, chats: chats.sort(compareCodePoints) }),
    `messaggi: ${parsed.messages.length} (dal bot: ${fromBot})`,
    ...conversationReport(c)
  );
  const finished = finishPipeline(c, onPhase);
  return {
    status: 'done',
    messages: parsed.messages,
    conversed: c,
    ...finished,
    report: [...report, ...finished.report],
  };
}

/** Phases 1 to 5 on the pages of each input folder: buildWiki on each export's processExport. */
export async function runPipeline(
  paths: Iterable<Iterable<Page>>,
  options: PipelineOptions,
  onPhase: (p: Phase) => void = () => {}
): Promise<PipelineOutcome> {
  onPhase('parse');
  const records: ExportRecord[] = [];
  for (const pages of paths)
    for (const p of splitExports(pages)) records.push(await processExport(p, options));
  return buildWiki(records, options, onPhase);
}
