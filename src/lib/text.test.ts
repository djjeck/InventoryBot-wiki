import { describe, expect, it } from 'vitest';
import { compareCodePoints, parseDecimalInt, stripWs } from './text.ts';

describe('text', () => {
  it('compareCodePoints sorts astral characters after U+FFFF', () => {
    expect(['\u{1F600}', '￿', 'a'].sort(compareCodePoints)).toStrictEqual(['a', '￿', '\u{1F600}']);
  });

  it('stripWs and parseDecimalInt', () => {
    expect(stripWs(' \x1c x﻿\x85 ')).toBe('x﻿');
    expect(parseDecimalInt(' -١٢_3 ')).toBe(-123);
    expect(() => parseDecimalInt(':3')).toThrow();
  });
});
