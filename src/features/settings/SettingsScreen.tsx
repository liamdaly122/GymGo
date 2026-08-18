import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { useSettings } from '@/db/queries';
import { updateSettings } from '@/db/mutations';
import { downloadFile, exportAsCsv, exportAsJson, importFromJson } from '@/db/backup';
import { exportFilename } from '@/lib/export';
import { wipeAndReseed } from '@/db/seed';
import { SCHEMA_VERSION } from '@/db/schema';
import { Button, Card, NumberField, Screen, ScreenTitle } from '@/components/ui';
import type { Mode } from '@/domain/types';

type Status = { tone: 'ok' | 'error'; message: string } | null;

export default function SettingsScreen() {
  const settings = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingReseed, setConfirmingReseed] = useState(false);

  const counts = useLiveQuery(async () => ({
    exercises: await db.exercises.count(),
    workouts: await db.workouts.count(),
    sets: await db.sets.count(),
    queued: await db.outbox.count(),
  }), []);

  const handleExportJson = async () => {
    setBusy(true);
    try {
      const data = await exportAsJson();
      downloadFile(JSON.stringify(data, null, 2), exportFilename('json'), 'application/json');
      setStatus({ tone: 'ok', message: 'Exported. Keep that file somewhere safe.' });
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = async () => {
    setBusy(true);
    try {
      downloadFile(await exportAsCsv(), exportFilename('csv'), 'text/csv');
      setStatus({ tone: 'ok', message: 'Exported one row per set, ready for a spreadsheet.' });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (file: File) => {
    setBusy(true);
    try {
      const result = await importFromJson(await file.text());
      setStatus({
        tone: 'ok',
        message: `Restored ${result.live_counts.workouts} workouts and ${result.live_counts.sets} sets.`,
      });
    } catch (cause) {
      setStatus({ tone: 'error', message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleReseed = async () => {
    setBusy(true);
    try {
      await wipeAndReseed();
      setStatus({ tone: 'ok', message: 'Local database wiped and reseeded.' });
    } finally {
      setBusy(false);
      setConfirmingReseed(false);
    }
  };

  return (
    <Screen>
      <Link to="/" className="mb-3 inline-block text-xs text-muted">
        ← Train
      </Link>
      <ScreenTitle>Settings</ScreenTitle>

      {status ? (
        <p
          className={`mb-4 rounded-xl px-4 py-3 text-sm ${
            status.tone === 'ok'
              ? 'bg-accent/10 text-accent'
              : 'bg-red-500/10 text-red-400'
          }`}
          role="status"
        >
          {status.message}
        </p>
      ) : null}

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Interface</h2>

        <div className="mb-4">
          <p className="mb-2 text-sm text-white">Mode</p>
          <div className="flex gap-2">
            {(['beginner', 'pro'] as Mode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => void updateSettings({ mode })}
                aria-pressed={settings?.mode === mode}
                className={`h-11 flex-1 rounded-xl text-sm capitalize transition-colors ${
                  settings?.mode === mode
                    ? 'bg-accent font-semibold text-ink'
                    : 'border border-line bg-raised text-muted'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            One data model, two levels of density. Switching never loses anything — Pro fields are
            simply stored empty while you are in Beginner.
          </p>
        </div>

        <Toggle
          label="Sound"
          hint="A beep when rest is up."
          checked={settings?.sound_on ?? true}
          onChange={(sound_on) => void updateSettings({ sound_on })}
        />
        <Toggle
          label="Vibrate"
          hint="Ignored on iOS Safari, which has no vibration API."
          checked={settings?.vibrate_on ?? true}
          onChange={(vibrate_on) => void updateSettings({ vibrate_on })}
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white">Default rest</p>
            <p className="text-[11px] text-muted">Used when an exercise has no rest of its own.</p>
          </div>
          <div className="w-24 shrink-0">
            <NumberField
              value={settings?.default_rest_seconds ?? 120}
              onCommit={(value) =>
                void updateSettings({ default_rest_seconds: Math.max(5, Math.round(value)) })
              }
              suffix="s"
              aria-label="Default rest in seconds"
            />
          </div>
        </div>
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">Your data</h2>
        <p className="mb-3 text-[11px] text-muted">
          Everything lives on this device. Export is your backup until sync exists — and your way
          out, so this is never a one-way door.
        </p>

        <div className="grid gap-2">
          <Button disabled={busy} onClick={() => void handleExportJson()}>
            Export everything as JSON
          </Button>
          <Button disabled={busy} onClick={() => void handleExportCsv()}>
            Export sets as CSV
          </Button>
          <Button disabled={busy} onClick={() => fileInput.current?.click()}>
            Import a JSON backup
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />

        <p className="mt-3 text-[11px] text-muted">
          Importing replaces everything currently on this device. It is validated before anything
          is written, and applied in one go, so a bad file cannot leave you half restored.
        </p>
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">On this device</h2>
        <dl className="space-y-1.5 text-sm">
          <Row label="Exercises" value={counts?.exercises} />
          <Row label="Workouts" value={counts?.workouts} />
          <Row label="Sets" value={counts?.sets} />
          <Row label="Queued for sync" value={counts?.queued} />
          <Row label="Schema version" value={SCHEMA_VERSION} />
        </dl>
        <p className="mt-3 text-[11px] text-muted">
          Sync is not built yet. Queued changes are held locally and will flush once Supabase is
          connected.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">Danger</h2>
        {confirmingReseed ? (
          <>
            <p className="mb-3 text-sm text-white">
              This deletes every workout, routine and setting on this device and rebuilds the
              exercise library from scratch. Export first if you want any of it back.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void handleReseed()}>
                Wipe and reseed
              </Button>
              <Button className="flex-1" onClick={() => setConfirmingReseed(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <button onClick={() => setConfirmingReseed(true)} className="text-sm text-red-400">
            Wipe and reseed local database
          </button>
        )}
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums text-white">{value ?? '—'}</dd>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
