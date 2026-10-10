import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { useSettings } from '@/db/queries';
import { updateSettings } from '@/db/mutations';
import { exportAsCsv, exportAsJson, importFromJson } from '@/db/backup';
import { saveFile } from '@/platform/files';
import { isNativeApp } from '@/platform/native';
import { exportFilename } from '@/lib/export';
import { wipeAndReseed } from '@/db/seed';
import { SCHEMA_VERSION } from '@/db/schema';
import { BackLink, Button, NumberField, Screen, ScreenHeader, SectionLabel, Segmented, Toggle } from '@/components/ui';
import type { Mode } from '@/domain/types';
import SyncSection from './SyncSection';

type Status = { tone: 'ok' | 'error'; message: string } | null;

export default function SettingsScreen() {
  const settings = useSettings();
  const navigate = useNavigate();
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
      const outcome = await saveFile(JSON.stringify(data, null, 2), exportFilename('json'), 'application/json');
      if (outcome === 'saved') setStatus({ tone: 'ok', message: 'Exported. Keep that file somewhere safe.' });
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = async () => {
    setBusy(true);
    try {
      const outcome = await saveFile(await exportAsCsv(), exportFilename('csv'), 'text/csv');
      if (outcome === 'saved') setStatus({ tone: 'ok', message: 'Exported one row per set, ready for a spreadsheet.' });
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
      <BackLink to="/">Today</BackLink>
      <ScreenHeader title="Settings" />

      <div className="stack">
        {status ? (
          <p
            className={`rounded-md px-4 py-3 text-sm ${
              status.tone === 'ok' ? 'bg-surface text-chalk' : 'bg-surface text-danger'
            }`}
            role="status"
          >
            {status.message}
          </p>
        ) : null}

        <section aria-labelledby="interface" className="stack-sm">
          <SectionLabel id="interface">Interface</SectionLabel>
          <p className="field-label">Mode</p>
          <Segmented<Mode>
            label="Mode"
            options={[
              { value: 'beginner', label: 'Beginner' },
              { value: 'pro', label: 'Pro' },
            ]}
            value={settings?.mode ?? 'beginner'}
            onChange={(mode) => void updateSettings({ mode })}
          />
          <p className="t-meta">
            Pro adds reps in reserve and AMRAP on the set in hand, techniques like drop sets,
            estimated 1-rep max, sets per muscle and supersets. One data model either way —
            switching never loses anything.
          </p>

          <Toggle
            label="Sound"
            hint="A beep when rest is up."
            checked={settings?.sound_on ?? true}
            onChange={(sound_on) => void updateSettings({ sound_on })}
          />
          <Toggle
            label="Vibrate"
            hint={isNativeApp() ? 'A buzz at the end of a rest, and a longer one for a record.' : 'Ignored on iOS Safari, which has no vibration API.'}
            checked={settings?.vibrate_on ?? true}
            onChange={(vibrate_on) => void updateSettings({ vibrate_on })}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">Default rest</p>
              <p className="t-meta">Used when an exercise has no rest of its own.</p>
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
        </section>

        <SyncSection />

        <section aria-labelledby="your-data" className="stack-sm">
          <SectionLabel id="your-data">Your data</SectionLabel>
          <p className="t-meta">
            Everything lives on this device first. Export is your way out, so this is never a
            one-way door — and it stays useful even with sync switched on.
          </p>
          <Button block onClick={() => void navigate('/gyms')}>
            Gyms and equipment
          </Button>
          <Button block onClick={() => void navigate('/exercises')}>
            Browse all exercises
          </Button>
          <Button block disabled={busy} onClick={() => void handleExportJson()}>
            Export everything as JSON
          </Button>
          <Button block disabled={busy} onClick={() => void handleExportCsv()}>
            Export sets as CSV
          </Button>
          <Button block disabled={busy} onClick={() => fileInput.current?.click()}>
            Import a JSON backup
          </Button>
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
          <p className="t-meta">
            Importing replaces everything currently on this device. It is validated before
            anything is written, and applied in one go, so a bad file cannot leave you half
            restored.
          </p>
        </section>

        <section aria-labelledby="device">
          <SectionLabel id="device">On this device</SectionLabel>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row label="Exercises" value={counts?.exercises} />
            <Row label="Workouts" value={counts?.workouts} />
            <Row label="Sets" value={counts?.sets} />
            <Row label="Queued for sync" value={counts?.queued} />
            <Row label="Schema version" value={SCHEMA_VERSION} />
          </dl>
          <p className="t-meta mt-3">Queued changes are held locally and flush whenever there is a connection.</p>
        </section>

        <section aria-labelledby="danger" className="stack-sm">
          <SectionLabel id="danger">Danger</SectionLabel>
          {confirmingReseed ? (
            <>
              <p className="text-sm">
                This deletes every workout, routine and setting on this device and rebuilds the
                exercise library from scratch. Export first if you want any of it back.
              </p>
              <div className="row2">
                <Button variant="danger" disabled={busy} onClick={() => void handleReseed()}>
                  Wipe and reseed
                </Button>
                <Button onClick={() => setConfirmingReseed(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingReseed(true)} className="btn-text text-left text-danger">
              Wipe and reseed local database
            </button>
          )}
        </section>
      </div>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}
