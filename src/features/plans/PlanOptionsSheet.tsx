import { Button, Segmented, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import type { BuilderPrefs } from '@/lib/builderPrefs';
import type { ExperienceLevel, Muscle } from '@/domain/types';
import { AVOIDABLE_LIFTS, MAX_PRIORITIES, PRIORITY_MUSCLES, TIME_LIMITS } from '@/domain/programmes/tailor';

const EXPERIENCE: Array<{ value: ExperienceLevel; label: string }> = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
];

/**
 * The rest of the brief's generator inputs: time per session, experience,
 * priority muscles, and lifts to avoid. Every change rebuilds the plan behind
 * the sheet at once, so you see what it does as you choose.
 */
export default function PlanOptionsSheet({
  prefs,
  onChange,
  onClose,
}: {
  prefs: BuilderPrefs;
  onChange: (prefs: BuilderPrefs) => void;
  onClose: () => void;
}) {
  const togglePriority = (muscle: Muscle) => {
    const on = prefs.priorities.includes(muscle);
    if (!on && prefs.priorities.length >= MAX_PRIORITIES) return;
    onChange({
      ...prefs,
      priorities: on ? prefs.priorities.filter((other) => other !== muscle) : [...prefs.priorities, muscle],
    });
  };
  const toggleAvoid = (family: string) => {
    const on = prefs.avoidFamilies.includes(family);
    onChange({
      ...prefs,
      avoidFamilies: on ? prefs.avoidFamilies.filter((other) => other !== family) : [...prefs.avoidFamilies, family],
    });
  };

  return (
    <Sheet label="Adjust plan" onClose={onClose}>
      <h2>Adjust plan</h2>

      <p className="t-label">Time per session</p>
      <Segmented<number>
        label="Time per session"
        options={[{ value: 0, label: 'Any' }, ...TIME_LIMITS.map((minutes) => ({ value: minutes, label: `${minutes}` }))]}
        value={prefs.minutes ?? 0}
        onChange={(minutes) => onChange({ ...prefs, minutes: minutes === 0 ? null : minutes })}
      />
      <p className="sheet-note">
        {prefs.minutes
          ? `Sized so the hardest week fits in ${prefs.minutes} minutes. Earlier weeks finish sooner.`
          : 'No limit: every session as the plan writes it.'}
      </p>

      <p className="t-label">Experience</p>
      <Segmented<ExperienceLevel>
        label="Experience"
        options={EXPERIENCE}
        value={prefs.experience}
        onChange={(experience) => onChange({ ...prefs, experience })}
      />
      <p className="sheet-note">Picks lifts at or below your level: a technical lift you have not learned is how people get hurt.</p>

      <p className="t-label">Priority muscles · up to {MAX_PRIORITIES}</p>
      <ul className="toggle-grid" role="group" aria-label="Priority muscles">
        {PRIORITY_MUSCLES.map(({ muscle, label }) => {
          const on = prefs.priorities.includes(muscle);
          return (
            <li key={muscle}>
              <button
                type="button"
                className="toggle"
                aria-pressed={on}
                disabled={!on && prefs.priorities.length >= MAX_PRIORITIES}
                onClick={() => togglePriority(muscle)}
              >
                {label}
                {on ? <Icon name="check" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sheet-note">One more set on every lift they lead, up to the weekly ceiling.</p>

      <p className="t-label">Lifts to avoid</p>
      <ul className="toggle-grid" role="group" aria-label="Lifts to avoid">
        {AVOIDABLE_LIFTS.map(({ family, label }) => {
          const on = prefs.avoidFamilies.includes(family);
          return (
            <li key={family}>
              <button type="button" className="toggle" aria-pressed={on} onClick={() => toggleAvoid(family)}>
                {label}
                {on ? <Icon name="check" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sheet-note">
        An injury, or you just won't do them. Every version stays out of this plan, its shuffles and the
        accessories a block rotates in.
      </p>

      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    </Sheet>
  );
}
