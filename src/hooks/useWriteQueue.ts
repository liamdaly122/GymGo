import { useCallback, useRef } from 'react';

/**
 * Runs writes one at a time, in the order they were asked for.
 *
 * Tapping a stepper while a field is focused fires blur — which commits the
 * typed value — and then click. Two writes to the same set racing each other
 * can land in either order, and the later one wins, so a stepper could be
 * overwritten by the very value it stepped from. Chaining them keeps the order
 * the user produced.
 */
export function useWriteQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work, work);
    // A failed write must not jam every write after it.
    queue.current = next.catch(() => undefined);
    return next;
  }, []);
}
