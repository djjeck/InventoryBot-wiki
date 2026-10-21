/**
 * A call put off until `ms` have passed without another (the page builds again only once
 * the player stops typing a username). Pure, tested in Node with fake timers.
 */
export interface Debounced {
  /** Calls the function `ms` after the last call; an earlier pending one is dropped. */
  call(): void;
  /** Calls it now if a call is pending. */
  flush(): void;
  /** Drops the pending call. */
  cancel(): void;
}

export function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const fire = (): void => {
    timer = null;
    fn();
  };
  return {
    call() {
      cancel();
      timer = setTimeout(fire, ms);
    },
    flush() {
      if (timer === null) return;
      cancel();
      fn();
    },
    cancel,
  };
}
