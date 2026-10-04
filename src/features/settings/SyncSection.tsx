import { useEffect, useState } from 'react';
import { Button, SectionLabel } from '@/components/ui';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { describeSyncStatus } from '@/sync/status';
import { currentAccount, sendSignInCode, signOut, verifySignInCode, type SyncAccount } from '@/sync/auth';
import { isSyncConfigured } from '@/sync/config';
import { syncNow } from '@/sync/engine';
import { formatSince } from '@/lib/dates';

/**
 * Backup, in Settings and nowhere else.
 *
 * Signing in is the one place the interface deliberately waits on the network,
 * because the user asked it to. Nothing on the logging path ever does.
 *
 * Sign-in is by a code typed into the app, because that is what works in a
 * home-screen app on an iPhone: the link in the same email opens Safari, which
 * keeps its own storage, so it would sign Safari in and leave the app signed
 * out. The link still works in a browser.
 */
export default function SyncSection() {
  const status = useSyncStatus();
  const [account, setAccount] = useState<SyncAccount | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

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

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (cause) {
      setNote({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  };

  const handleSend = () =>
    run(async () => {
      const address = email.trim();
      await sendSignInCode(address);
      setSentTo(address);
      setCode('');
      setNote({ tone: 'ok', text: `Code sent to ${address}.` });
    });

  const handleVerify = () =>
    run(async () => {
      if (!sentTo) return;
      await verifySignInCode(sentTo, code);
      setAccount(await currentAccount());
      setSentTo(null);
      setCode('');
      setNote(null);
    });

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
        sentTo === null ? (
          <>
            <p className="font-semibold">Sign in to back up this phone.</p>
            <p className="t-meta">
              No password. You get a six-digit code by email, type it in here, and stay signed in.
            </p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              className="field"
            />
            <Button
              variant="primary"
              block
              disabled={busy || email.trim() === ''}
              onClick={() => void handleSend()}
            >
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </>
        ) : (
          <>
            <p className="font-semibold">Enter the code from the email.</p>
            <p className="t-meta">
              Type it here rather than tapping the link: on an iPhone the link opens Safari, which
              keeps its own storage, and this app would stay signed out.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
              placeholder="123456"
              aria-label="Sign-in code"
              className="field text-center text-2xl tracking-[0.3em]"
            />
            <Button
              variant="primary"
              block
              disabled={busy || code.length < 6}
              onClick={() => void handleVerify()}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="flex justify-between gap-3">
              <button type="button" className="btn-text" disabled={busy} onClick={() => void handleSend()}>
                Send a new code
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setSentTo(null);
                  setNote(null);
                }}
              >
                Use another email
              </button>
            </div>
          </>
        )
      ) : null}

      {note ? (
        <p className={`text-sm ${note.tone === 'ok' ? 'text-hot' : 'text-warn'}`} role="status">
          {note.text}
        </p>
      ) : null}

      {account && status.state === 'error' && status.message ? (
        <p className="t-meta">Last attempt failed: {status.message}. It will try again by itself.</p>
      ) : null}
    </section>
  );
}
