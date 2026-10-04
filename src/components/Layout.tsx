import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useActiveWorkout, useWorkoutName } from '@/db/queries';
import { useElapsed } from '@/hooks/useElapsed';
import { formatClock } from '@/lib/dates';
import { Icon, type IconName } from './icons';

/**
 * Three tabs where there were five. Programme and Plans were both "what I'll
 * train", History and Progress both "what I did"; the owner tested the merge
 * in the drafts and chose it.
 *
 * A tab stays lit on the screens beneath it, so a session opened from
 * Progress still reads as Progress.
 */
const TABS: Array<{ to: string; label: string; icon: IconName; owns: (path: string) => boolean }> = [
  {
    to: '/',
    label: 'Today',
    icon: 'today',
    owns: (path) => path === '/' || path.startsWith('/settings') || path.startsWith('/gyms'),
  },
  {
    to: '/plan',
    label: 'Plan',
    icon: 'plan',
    owns: (path) => path.startsWith('/plan') || path.startsWith('/routines'),
  },
  {
    to: '/progress',
    label: 'Progress',
    icon: 'progress',
    owns: (path) =>
      path.startsWith('/progress') || path.startsWith('/history') || path.startsWith('/exercises'),
  },
];

export default function Layout() {
  const { pathname } = useLocation();
  return (
    <>
      <Outlet />
      <ResumeBar />
      <nav className="tabs" aria-label="Sections">
        <div className="tabs-inner">
          {TABS.map((tab) => {
            const on = tab.owns(pathname);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`tab ${on ? 'on' : ''}`}
                aria-current={on ? 'page' : undefined}
              >
                <Icon name={tab.icon} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/** On every tab while a workout is open, so leaving one never loses it. */
function ResumeBar() {
  const active = useActiveWorkout();
  const name = useWorkoutName(active?.id);
  const elapsed = useElapsed(active?.started_at);
  const navigate = useNavigate();
  if (!active) return null;
  return (
    <div className="resume">
      <p>
        {name ?? 'Workout'} in progress · <span className="num">{formatClock(elapsed)}</span>
      </p>
      <button type="button" className="btn btn-sm" onClick={() => void navigate(`/workout/${active.id}`)}>
        Resume
      </button>
    </div>
  );
}
