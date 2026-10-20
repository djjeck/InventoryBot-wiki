import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  compareCodePoints,
  escapeRegex,
  parseDecimalInt,
  splitWords,
  stripWs,
} from './text.ts';

describe('text', () => {
  it('compareCodePoints sorts astral characters after U+FFFF', () => {
    expect(['\u{1F600}', '￿', 'a'].sort(compareCodePoints)).toStrictEqual(['a', '￿', '\u{1F600}']);
  });

  it('stripWs and parseDecimalInt', () => {
    expect(stripWs(' \x1c x﻿\x85 ')).toBe('x﻿');
    expect(parseDecimalInt(' -١٢_3 ')).toBe(-123);
    expect(() => parseDecimalInt(':3')).toThrow();
  });

  it('splitWords splits on runs of whitespace', () => {
    expect(splitWords(' /dai\u00a01  x\n')).toStrictEqual(['/dai', '1', 'x']);
    expect(splitWords(' \x1c ')).toStrictEqual([]);
  });

  it('codePointLength_counts_astral_characters_once', () => {
    expect(codePointLength('a\u{1F600}b')).toBe(3);
  });

  it('escapeRegex_makes_a_literal_pattern', () => {
    const literal = 'a.b*(c)[d]{e}|f/g\\h^$+?';
    expect(new RegExp(`^${escapeRegex(literal)}$`, 'u').test(literal)).toBe(true);
    expect(new RegExp(escapeRegex('a.b'), 'u').test('axb')).toBe(false);
  });
});
