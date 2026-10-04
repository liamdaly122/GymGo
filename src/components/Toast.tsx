import { useCallback, useEffect, useState } from 'react';

/**
 * A line said back after an action whose effect is out of sight — a swap that
 * reached two other sessions, say. Gone after a few seconds, never in the way.
 */
export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (message === null) return;
    const id = window.setTimeout(() => setMessage(null), 2600);
    return () => window.clearTimeout(id);
  }, [message]);
  return [message, useCallback((next: string) => setMessage(next), [])];
}

export function Toast({ message }: { message: string | null }) {
  return message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null;
}
