import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { describeSyncStatus } from '@/sync/status';
import { currentAccount, sendMagicLink, signOut, type SyncAccount } from '@/sync/auth';
import { isSyncConfigured } from '@/sync/config';
import { syncNow } from '@/sync/engine';
import { formatDayLabel } from '@/lib/dates';

/**
 * Backup and sync, in Settings and nowhere else.
 *
 * Signing in is the one place the interface deliberately waits on the network,
 * because the user asked it to. Nothing on the logging path ever does.
 */
export default function SyncSection() {
  const status = useSyncStatus();
  const [account, setAccount] = useState<SyncAccount | null>(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void currentAccount().then(setAccount);
  }, [status.state]);

  if (!isSyncConfigured()) {
    return (
      <Card className="mb-4 p-4">
        <h2 className="eyebrow mb-1">Backup and sync</h2>
        <p className="text-sm text-white">Not set up yet.</p>
        <p className="mt-1 text-[11px] text-muted">
          Everything works without it — this is about keeping a second copy off this phone. Add a
          Supabase project and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Until then, Export
          is your backup.
        </p>
      </Card>
    );
  }

  const handleSend = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    setNote(null);
    try {
      await sendMagicLink(trimmed);
      setNote({ tone: 'ok', text: `Link sent to ${trimmed}. Open it on this phone.` });
    } catch (cause) {
      setNote({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Backup and sync</h2>
        <span
          className={`text-[11px] ${
            status.state === 'error' ? 'text-warn' : status.state === 'idle' ? 'text-accent' : 'text-muted'
          }`}
        >
          {describeSyncStatus(status)}
        </span>
      </div>

      {account ? (
        <>
          <p className="text-sm text-white">{account.email ?? 'Signed in'}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {status.lastSyncedAt
              ? `Last backed up ${formatDayLabel(status.lastSyncedAt).toLowerCase()}`
              : 'Not backed up yet'}
            {status.pending > 0 ? ` · ${status.pending} waiting` : ''}
          </p>

          <div className="mt-3 grid gap-2">
            <Button onClick={() => void syncNow()} disabled={status.state === 'syncing'}>
              {status.state === 'syncing' ? 'Backing up…' : 'Back up now'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void signOut().then(() => setAccount(null));
              }}
            >
              Sign out
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-white">Sign in to keep a copy off this phone.</p>
          <p className="mt-1 mb-3 text-[11px] text-muted">
            No password. You get a link by email, tap it once on this phone, and stay signed in.
          </p>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-label="Email address for the sign-in link"
            className="h-11 w-full rounded-xl border border-line bg-raised px-4 text-base text-white placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <Button
            variant="primary"
            className="mt-2 w-full"
            disabled={sending || email.trim() === ''}
            onClick={() => void handleSend()}
          >
            {sending ? 'Sending…' : 'Email me a link'}
          </Button>
        </>
      )}

      {note ? (
        <p
          className={`mt-3 text-[11px] ${note.tone === 'ok' ? 'text-accent' : 'text-warn'}`}
          role="status"
        >
          {note.text}
        </p>
      ) : null}

      {status.state === 'error' && status.message ? (
        <p className="mt-2 text-[11px] text-muted">
          Last attempt failed: {status.message}. It will retry on its own.
        </p>
      ) : null}
    </Card>
  );
}
