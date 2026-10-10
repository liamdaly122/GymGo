import { describe, expect, it } from 'vitest';
import { isDurableKey, nativeSessionStore, remember, restoreDurableKeys } from './durable';

describe('the durable keys', () => {
  it('are the once flags, the builder choices and the backup ledger, not the running rest', () => {
    expect(isDurableKey('gymgo.once.rests-follow-the-lift')).toBe(true);
    expect(isDurableKey('gymgo.builder')).toBe(true);
    expect(isDurableKey('gymgo.backup.9f1c')).toBe(true);
    expect(isDurableKey('gymgo.rest')).toBe(false);
    expect(isDurableKey('gymgo.snapshot.at')).toBe(false);
  });

  it('are left to localStorage outside the app', async () => {
    expect(() => remember('gymgo.builder', '{}')).not.toThrow();
    expect(await restoreDurableKeys()).toBe(0);
    expect(nativeSessionStore()).toBeUndefined();
  });
});
