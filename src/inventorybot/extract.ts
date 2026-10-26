/**
 * Phase 4: the bot's replies, paired with their commands by phase 2 (and anonymised by
 * phase 3) -> typed game events, and the report lines of the phase. Phase 4 ends by
 * verifying the group pairs (verify.ts). The reply formats are docs/bot-protocol.md; the
 * classifiers are classify.ts. Pure logic only (no Node APIs).
 */
import { increment, mostCommon } from '#src/lib/counts.ts';
import { compareCodePoints, sliceCodePoints } from '#src/lib/text.ts';
import { type BotReply } from '#src/telegram/conversation/conversation.ts';
import { classify } from './classify.ts';
import { type ReportEntry, reportSections } from './report.ts';
import { type EventRecord } from './types.ts';
import { verifyPairs } from './verify.ts';

/** What interpretReplies returns. */
export interface Interpretation {
  /** One event per reply, in message order. */
  events: EventRecord[];
  /** The summary lines of the report (Italian). */
  summary: string[];
  /** The report entries (the dissolved pairs), in message order. */
  entries: ReportEntry[];
}

/**
 * Classifies every reply of the conversation, in message order: each event is the
 * reply's own fields, then its context; an unknown reply also keeps its text. Then the
 * group pairs are verified (verifyPairs): a dissolved pair's reply is read again without
 * its command. The summary is the event counts by type, the verification and the
 * unrecognised replies by year; the entries are the dissolved pairs.
 */
export function interpretReplies(replies: readonly BotReply[]): Interpretation {
  const classified: EventRecord[] = [];
  for (const { text, file_text, context } of replies) {
    // Spread keeps a classified key that the context repeats in its first position.
    const ev = { ...classify(text, context.query, file_text ?? null), ...context } as EventRecord;
    if (ev.type === 'unknown') (ev as { text: string }).text = text;
    classified.push(ev);
  }
  const { events, checked, dissolved } = verifyPairs(replies, classified);

  const types = new Map<string, number>();
  const unknownByYear = new Map<string, number>();
  for (const ev of events) {
    increment(types, ev.type);
    if (ev.type === 'unknown') increment(unknownByYear, sliceCodePoints(ev.date ?? '', 6, 10));
  }
  const summary = [
    'eventi: ' +
      mostCommon(types)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
  ];
  if (checked > 0) {
    summary.push(
      `  coppie nei gruppi verificate dalla risposta: confermate=${checked - dissolved.length}, ` +
        `sciolte=${dissolved.length}`
    );
  }
  if (unknownByYear.size > 0) {
    const years = [...unknownByYear].sort((a, b) => compareCodePoints(a[0], b[0]));
    summary.push(
      '  risposte del bot non riconosciute, per anno: ' +
        years.map(([y, n]) => `${y}=${n}`).join(', ')
    );
  }
  return { events, summary, entries: dissolved };
}

/** The report lines of phase 4: the summary, then the entries by kind (reportSections). */
export function interpretationReport({ summary, entries }: Interpretation): string[] {
  return [...summary, ...reportSections(entries)];
}
