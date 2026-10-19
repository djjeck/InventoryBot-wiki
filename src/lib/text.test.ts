import { describe, expect, it } from 'vitest';
import { compareCodePoints, parseDecimalInt, splitWords, stripWs } from './text.ts';

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
});
