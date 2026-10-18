import { describe, expect, it } from 'vitest';
import { greet } from './greet.ts';

describe('greet', () => {
  it('greets the given name', () => {
    expect(greet('Mario')).toBe('Hello, Mario!');
  });
});
