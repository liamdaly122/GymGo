import { useEffect, useState, type FormEvent } from 'react';
import { Button, SectionLabel } from '@/components/ui';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { describeSyncStatus } from '@/sync/status';
import { currentAccount, signInWithPassword, signOut, type SyncAccount } from '@/sync/auth';
import { isSyncConfigured } from '@/sync/config';
import { syncNow } from '@/sync/engine';
import { formatSince } from '@/lib/dates';

/**
 * Backup, in Settings and nowhere else.
 *
 * Signing in is the one place the interface deliberately waits on the network,
 * because the user asked it to. Nothing on the logging path ever does.
 *
 * Email and password, typed into the app itself — see `src/sync/auth.ts` for
 * why not a magic link. A real form, so Return signs in and the phone offers to
 * keep the password; the password lives in this component only until it is
 * sent.
 */
export default function SyncSection() {
  const status = useSyncStatus();
  const [account, setAccount] = useState<SyncAccount | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void currentAccount().then(setAccount);
  }, [status.state]);

  if (!isSyncConfigured()) {
    return (
      <section aria-labelledby="sync" className="stack-sm">
        <SectionLabel id="sync">Backup</SectionLabel>
        <p className="font-semibold">Not connected yet.</p>
        <p className="t-meta">
          Everything works without it. Connected to a free Supabase project, every workout is copied
          off this phone as you log it, so a lost phone or a reinstall is a restore rather than a loss.
          Until then, Export below is your backup.
        </p>
        <p className="t-meta">
          To connect: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY where the app is built. The
          steps are in supabase/README.md.
        </p>
      </section>
    );
  }

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      setPassword('');
      setAccount(await currentAccount());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const backedUp = status.state === 'idle' && status.pending === 0 && status.lastSyncedAt !== null;

  return (
    <section aria-labelledby="sync" className="stack-sm">
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel id="sync">Backup</SectionLabel>
        {account ? (
          <span
            role="status"
            className={`text-sm font-semibold ${
              status.state === 'error' ? 'text-warn' : backedUp ? 'text-hot' : 'text-muted'
            }`}
          >
            {describeSyncStatus(status)}
          </span>
        ) : null}
      </div>

      {account ? (
        <>
          {status.restoredWorkouts ? (
            <p className="font-semibold text-hot">
              Restored {status.restoredWorkouts} workout{status.restoredWorkouts === 1 ? '' : 's'} from
              your backup.
            </p>
          ) : null}
          <p className="text-sm">
            {status.lastSyncedAt ? `Last backed up ${formatSince(status.lastSyncedAt)}` : 'Not backed up yet'}
            {status.pending > 0 ? ` · ${status.pending} waiting` : ''}
          </p>
          <p className="t-meta">
            Signed in as {account.email ?? 'you'}. It backs up by itself whenever there is signal,
            within a couple of minutes of a change, and checks everything over once a day. On a new
            phone, sign in here and everything comes back.
          </p>
          <Button block onClick={() => void syncNow()} disabled={status.state === 'syncing'}>
            {status.state === 'syncing' ? describeSyncStatus(status) : 'Back up now'}
          </Button>
          <button
            type="button"
            className="btn-text self-start"
            onClick={() => void signOut().then(() => setAccount(null))}
          >
            Sign out
          </button>
        </>
      ) : account === null ? (
        <form className="stack-sm" onSubmit={(event) => void handleSignIn(event)}>
          <p className="font-semibold">Sign in to back up this phone.</p>
          <p className="t-meta">
            Once, and it stays signed in. Your phone can keep the password for you.
          </p>
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            className="field"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            aria-label="Password"
            className="field"
          />
          <Button
            type="submit"
            variant="primary"
            block
            disabled={busy || email.trim() === '' || password === ''}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="t-meta">
            No account yet? Make it once in Supabase: Authentication → Users → Add user, with Auto
            Confirm User ticked.
          </p>
        </form>
      ) : null}

      {error ? (
        <p className="text-sm text-warn" role="status">
          {error}
        </p>
      ) : null}

      {account && status.state === 'error' && status.message ? (
        <p className="t-meta">Last attempt failed: {status.message}. It will try again by itself.</p>
      ) : null}
    </section>
  );
}
