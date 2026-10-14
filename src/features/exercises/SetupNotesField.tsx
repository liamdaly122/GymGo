import { useState } from 'react';
import type { Exercise } from '@/db/schema';
import { updateExercise } from '@/db/mutations';

/**
 * The small feature that saves the most time in practice: seat height, pin
 * position, which bar. Saved when the field loses focus, trimmed, and an
 * empty note is stored as none.
 *
 * On a lift's own screen, and on the companion screen beside the exercise
 * the watch is on, which is the first place a workout ever showed them.
 */
export default function SetupNotesField({ exercise, label }: { exercise: Exercise; label: string }) {
  // Null until typed into: the stored note shows, and a change elsewhere reaches it.
  const [draft, setDraft] = useState<string | null>(null);
  const notes = draft ?? exercise.setup_notes ?? '';

  return (
    <textarea
      value={notes}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const trimmed = draft.trim();
        void updateExercise(exercise.id, { setup_notes: trimmed === '' ? null : trimmed });
        setDraft(null);
      }}
      rows={2}
      placeholder="Seat height, pin position, grip width, which bar…"
      aria-label={label}
      className="field h-auto resize-none py-3"
    />
  );
}
