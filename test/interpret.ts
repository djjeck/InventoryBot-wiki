/**
 * Phases 2 and 4 on synthetic messages, for the tests of the InventoryBot layer: the
 * conversation with InventoryBot's dialect (player titles learned from the run), then the
 * interpretation. Phase 3 is skipped, so that the tests read the synthetic names. No vitest
 * imports here.
 */
import { inventoryBotDialect, learnTitles } from '#src/inventorybot/dialect.ts';
import { interpretationReport, interpretReplies } from '#src/inventorybot/extract.ts';
import { type EventRecord } from '#src/inventorybot/types.ts';
import { matchReportLines, readConversation } from '#src/telegram/conversation/conversation.ts';
import { type Message } from '#src/telegram/messages.ts';
import { BOT } from './helpers.ts';

/** Phases 2 and 4 on `messages` -> the events, and the report lines as one text. */
export function runExtract(messages: readonly Message[]): { events: EventRecord[]; err: string } {
  const titles = learnTitles(messages.filter((m) => m.from_bot).map((m) => m.text));
  const conversation = readConversation(messages, BOT, inventoryBotDialect(titles));
  const interpretation = interpretReplies(conversation.replies);
  const lines = [
    ...matchReportLines(conversation.replies),
    `titoli dei giocatori riconosciuti: ${titles.length}`,
    ...interpretationReport(interpretation),
  ];
  return { events: interpretation.events, err: lines.map((l) => l + '\n').join('') };
}

/** The events of one type. */
export function byType<T extends EventRecord['type']>(
  events: readonly EventRecord[],
  t: T
): Extract<EventRecord, { type: T }>[] {
  return events.filter((e): e is Extract<EventRecord, { type: T }> => e.type === t);
}
