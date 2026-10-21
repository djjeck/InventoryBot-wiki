/** The debounced call of the username field (debounce.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounce', () => {
  it('calls_once_after_the_last_call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d.call();
    vi.advanceTimersByTime(400);
    d.call();
    vi.advanceTimersByTime(599);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush_calls_at_once_only_when_pending', () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
    d.call();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel_drops_the_pending_call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(600);
    expect(fn).not.toHaveBeenCalled();
  });
});
