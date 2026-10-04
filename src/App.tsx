import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import { useAppInit } from './hooks/useAppInit';
import HomeScreen from './features/home/HomeScreen';
import ActiveWorkoutScreen from './features/workout/ActiveWorkoutScreen';
import SwapExerciseScreen from './features/workout/SwapExerciseScreen';
import WorkoutShell from './features/workout/WorkoutShell';
import ExerciseLibraryScreen from './features/exercises/ExerciseLibraryScreen';
import ExerciseDetailScreen from './features/exercises/ExerciseDetailScreen';
import WorkoutDetailScreen from './features/history/WorkoutDetailScreen';
import PlanScreen from './features/plan/PlanScreen';
import RoutineEditorScreen from './features/routines/RoutineEditorScreen';
import SettingsScreen from './features/settings/SettingsScreen';
import GymsScreen from './features/gyms/GymsScreen';
import GymEditorScreen from './features/gyms/GymEditorScreen';
import PlansScreen from './features/plans/PlansScreen';
import ProgressScreen from './features/progress/ProgressScreen';
import BlockReportScreen from './features/progress/BlockReportScreen';
import SplitPickerScreen from './features/plans/SplitPickerScreen';
import PlanPreviewScreen from './features/plans/PlanPreviewScreen';

export default function App() {
  const { state, error } = useAppInit();

  if (state === 'seeding') {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <p className="text-sm text-muted">Preparing your exercise database…</p>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-chalk">Could not open the local database.</p>
          <p className="mt-2 text-xs text-muted">{error?.message}</p>
          <p className="mt-4 text-xs text-muted">
            If this device is in private browsing, storage is unavailable.
          </p>
        </div>
      </div>
    );
  }

  return (
    // HashRouter keeps deep links working from a static host and from an
    // installed PWA without needing server-side rewrites.
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/plan" element={<PlanScreen />} />
          <Route path="/plan/new" element={<PlansScreen />} />
          <Route path="/plan/new/:goalId" element={<SplitPickerScreen />} />
          <Route path="/plan/new/:goalId/:splitId" element={<PlanPreviewScreen />} />
          <Route path="/routines/:routineId" element={<RoutineEditorScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/progress/lifts" element={<ProgressScreen />} />
          <Route path="/progress/blocks/:planId" element={<BlockReportScreen />} />
          <Route path="/history/:workoutId" element={<WorkoutDetailScreen />} />
          {/* The A-Z browse still exists, reached from Progress → Lifts. */}
          <Route path="/exercises" element={<ExerciseLibraryScreen />} />
          <Route path="/exercises/:exerciseId" element={<ExerciseDetailScreen />} />
          <Route path="/gyms" element={<GymsScreen />} />
          <Route path="/gyms/:gymId" element={<GymEditorScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />

          {/* Where the five-tab app used to live. Kept so an installed app, a
              bookmark or a back-stack entry from before the merge still lands. */}
          <Route path="/routines" element={<Navigate to="/plan" replace />} />
          <Route path="/history" element={<Navigate to="/progress" replace />} />
          <Route path="/plans" element={<PlansRedirect />} />
          <Route path="/plans/:goalId" element={<PlansRedirect />} />
          <Route path="/plans/:goalId/:splitId" element={<PlansRedirect />} />
        </Route>
        {/* The active workout is full screen: no tab bar competing with set entry.
            Both screens sit under one shell so the rest timer and the wake lock
            survive a trip to the swap picker. */}
        <Route path="/workout/:workoutId" element={<WorkoutShell />}>
          <Route index element={<ActiveWorkoutScreen />} />
          <Route path="swap/:workoutExerciseId" element={<SwapExerciseScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

/** /plans/:goal/:split?days=4 → /plan/new/:goal/:split?days=4 */
function PlansRedirect() {
  const { goalId, splitId } = useParams();
  const { search } = useLocation();
  const to = ['/plan/new', goalId, splitId].filter(Boolean).join('/');
  return <Navigate to={`${to}${search}`} replace />;
}
