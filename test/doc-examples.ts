/**
 * The `bot-reply` example blocks of docs/bot-protocol.md (convention in its section 8).
 * No vitest imports here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSuaMaesta, titleStripper } from '#src/inventorybot/dialect.ts';
import { parseDecimalInt, stripWs, WORD_BODY, WS_BODY } from '#src/lib/text.ts';

/** Repository root (the parent of test/). */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOC = path.join(REPO, 'docs', 'bot-protocol.md');

/** The document text, with `\r\n` and `\r` line ends turned into `\n`. */
export function readDoc(): string {
  return fs.readFileSync(DOC, 'utf-8').replace(/\r\n?/g, '\n');
}

// A fence from a line starting with ```bot-reply to the next line holding only ```.
// Lines break at "\n" only (the JS `m` flag would also break at "\r", U+2028, U+2029).
const FENCE =
  /(?:^|(?<=\n))```bot-reply(?<info>[^\n]*)\n(?<body>[\s\S]*?)\n```[ \t]*(?=\n|(?![\s\S]))/gu;
const ATTR = new RegExp(
  `(?<key>[${WORD_BODY}.-]+)=(?:"(?<quoted>(?:[^"\\\\]|\\\\[^\\n])*)"|'(?<single>[^']*)'|(?<bare>[^${WS_BODY}]+))`,
  'uy'
);
/** Attributes that steer the test; every other attribute is an expected event field. */
export const CONTROL = new Set(['type', 'query', 'chat', 'titles', 'addressee']);
export const CHATS = new Set(['dm', 'group']);

export type Attrs = Map<string, string>;

export interface Example {
  line: number;
  attrs: Attrs;
  body: string;
}

export function parseAttrs(info: string): Attrs {
  const attrs: Attrs = new Map();
  const s = stripWs(info);
  let pos = 0;
  while (pos < s.length) {
    ATTR.lastIndex = pos;
    const m = ATTR.exec(s);
    if (!m) throw new Error(`cannot parse attributes at: ${JSON.stringify(s.slice(pos))}`);
    const g = m.groups as Record<string, string | undefined>;
    const value =
      g['quoted'] !== undefined
        ? g['quoted'].replace(/\\([^\n])/gu, '$1')
        : (g['single'] ?? (g['bare'] as string));
    const key = g['key'] as string;
    if (attrs.has(key)) throw new Error(`duplicate attribute ${JSON.stringify(key)}`);
    attrs.set(key, value);
    pos = ATTR.lastIndex;
    while (pos < s.length && s[pos] === ' ') pos++;
  }
  return attrs;
}

/** Every bot-reply block in the document, with its 1-based line number. */
export function examples(text: string): Example[] {
  const out: Example[] = [];
  for (const m of text.matchAll(FENCE)) {
    const line = text.slice(0, m.index).split('\n').length;
    const g = m.groups as Record<string, string>;
    out.push({ line, attrs: parseAttrs(g['info'] as string), body: g['body'] as string });
  }
  return out;
}

/** The text normalisation extract applies before classify(). */
export function preprocess(text: string, attrs: Attrs): string {
  const titles = (attrs.get('titles') ?? '').split('|').filter((t) => t);
  let t = stripSuaMaesta(titleStripper(titles)(text));
  if (attrs.get('chat') === 'group') t = t.replace(/^\[W\] /u, '');
  return t;
}

export class FieldError extends Error {}

/** An event field by dotted path (`items.0.qty`); a negative list index counts from the end. */
export function field(event: unknown, dotted: string): unknown {
  let cur = event;
  for (const part of dotted.split('.')) {
    if (Array.isArray(cur)) {
      let i: number;
      try {
        i = parseDecimalInt(part);
      } catch {
        throw new FieldError(dotted);
      }
      if (i < 0) i += cur.length;
      if (i < 0 || i >= cur.length) throw new FieldError(dotted);
      cur = cur[i];
    } else if (typeof cur === 'object' && cur !== null) {
      if (!Object.hasOwn(cur, part)) throw new FieldError(dotted);
      cur = (cur as Record<string, unknown>)[part];
    } else {
      throw new FieldError(dotted);
    }
  }
  return cur;
}

/** Strings compare as text, anything else as compact JSON. */
export function same(actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') return actual === expected;
  return JSON.stringify(actual) === expected;
}
