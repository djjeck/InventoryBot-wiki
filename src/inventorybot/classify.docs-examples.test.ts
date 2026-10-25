/**
 * docs/bot-protocol.md: every `bot-reply` example is classified as the document says (the
 * convention is section 8 of the document).
 *
 * Each fenced block whose info string starts with `bot-reply` holds one bot message;
 * its attributes give the expected event type, the command passed as `query`, optional
 * preprocessing (`chat`, `titles`), the expected addressee and expected event fields.
 *
 * The document is a source file of the repository, so the examples are synthetic data
 * like any other test's (and its names are in the invented universe).
 */
import { describe, expect, it } from 'vitest';
import {
  CHATS,
  CONTROL,
  DOC,
  examples,
  field,
  FieldError,
  parseAttrs,
  preprocess,
  readDoc,
  same,
} from '#test/doc-examples.ts';
import { classify } from './classify.ts';
import { playerOf } from './dialect.ts';

const text = readDoc();
const blocks = examples(text);

describe('docs examples', () => {
  it('document_has_examples', () => {
    expect(blocks.length, `no bot-reply blocks in ${DOC}`).toBeGreaterThan(0);
  });

  it('every_block_is_parsed', () => {
    // A malformed fence (e.g. a typo in "bot-reply") would silently skip an example.
    const opened = text.match(/(?:^|(?<=\n))```bot-reply/gu)?.length ?? 0;
    expect(opened).toBe(blocks.length);
  });

  it('every_event_type_has_an_example', () => {
    const types = new Set(blocks.map((b) => b.attrs.get('type')));
    const expected = [
      'drop',
      'cooldown',
      'recipe_list',
      'recipe_detail',
      'craft',
      'item_info',
      'inventory',
      'travel',
      'location',
      'travel_blocked',
      'stats',
      'gift',
      'give',
      'show',
      'use',
      'miss',
      'title',
      'item_cooldown',
      'travel_requirement',
      'old_format',
      'unknown',
    ];
    expect(expected.filter((t) => !types.has(t))).toStrictEqual([]);
  });

  // One test per block: every failing example is reported.
  it.each(blocks.map((b) => [b.line, b] as const))(
    'examples (line %i)',
    (line, { attrs, body }) => {
      const where = `line ${line}: ${body.slice(0, 60)}`;
      expect(attrs.has('type'), `${where}: every example needs type=`).toBe(true);
      expect(CHATS.has(attrs.get('chat') ?? 'dm'), where).toBe(true);
      const t = preprocess(body, attrs);
      const event = classify(t, attrs.get('query') ?? null);
      expect(event.type, `${where}: ${JSON.stringify(event)}`).toBe(attrs.get('type'));
      if (attrs.has('addressee')) {
        const expected = attrs.get('addressee') === 'null' ? null : attrs.get('addressee');
        expect(playerOf(t), where).toBe(expected);
      }
      for (const [key, value] of attrs) {
        if (CONTROL.has(key)) continue;
        let actual: unknown;
        try {
          actual = field(event, key);
        } catch (e) {
          if (!(e instanceof FieldError)) throw e;
          expect.fail(
            `${where}: event has no field ${JSON.stringify(key)}: ${JSON.stringify(event)}`
          );
        }
        expect(
          same(actual, value),
          `${where}: ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
        ).toBe(true);
      }
    }
  );
});

describe('docs examples harness', () => {
  it('attrs', () => {
    expect(
      Object.fromEntries(
        parseAttrs(' type=drop query="/avventura x" raw="a \\"b\\" c" items.0.qty=2 e=\'["a b"]\'')
      )
    ).toStrictEqual({
      type: 'drop',
      query: '/avventura x',
      raw: 'a "b" c',
      'items.0.qty': '2',
      e: '["a b"]',
    });
  });

  it('blocks', () => {
    const doc = 'x\n```bot-reply type=miss\nriga 1\nriga 2\n```\n```text\nno\n```\n';
    expect(examples(doc).map((b) => [b.line, Object.fromEntries(b.attrs), b.body])).toStrictEqual([
      [2, { type: 'miss' }, 'riga 1\nriga 2'],
    ]);
  });

  it('field_and_compare', () => {
    const ev = { a: [{ b: 3, c: null, d: 'x' }], e: [] };
    expect(same(field(ev, 'a.0.b'), '3')).toBe(true);
    expect(same(field(ev, 'a.0.c'), 'null')).toBe(true);
    expect(same(field(ev, 'a.0.d'), 'x')).toBe(true);
    expect(same(field(ev, 'e'), '[]')).toBe(true);
    expect(() => field(ev, 'z')).toThrow(FieldError);
  });
});
