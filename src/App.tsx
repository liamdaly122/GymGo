import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAppInit } from './hooks/useAppInit';
import HomeScreen from './features/home/HomeScreen';
import ActiveWorkoutScreen from './features/workout/ActiveWorkoutScreen';
import ExerciseLibraryScreen from './features/exercises/ExerciseLibraryScreen';
import ExerciseDetailScreen from './features/exercises/ExerciseDetailScreen';
import HistoryScreen from './features/history/HistoryScreen';
import WorkoutDetailScreen from './features/history/WorkoutDetailScreen';
import RoutinesScreen from './features/routines/RoutinesScreen';
import RoutineEditorScreen from './features/routines/RoutineEditorScreen';
import SettingsScreen from './features/settings/SettingsScreen';
import PlansScreen from './features/plans/PlansScreen';
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
          <p className="text-sm text-white">Could not open the local database.</p>
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
          <Route path="/routines" element={<RoutinesScreen />} />
          <Route path="/routines/:routineId" element={<RoutineEditorScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/history/:workoutId" element={<WorkoutDetailScreen />} />
          <Route path="/plans" element={<PlansScreen />} />
          <Route path="/plans/:goalId" element={<SplitPickerScreen />} />
          <Route path="/plans/:goalId/:splitId" element={<PlanPreviewScreen />} />
          {/* The A-Z browse still exists, just not as a tab of its own. */}
          <Route path="/exercises" element={<ExerciseLibraryScreen />} />
          <Route path="/exercises/:exerciseId" element={<ExerciseDetailScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
        </Route>
        {/* The active workout is full screen: no tab bar competing with set entry. */}
        <Route path="/workout/:workoutId" element={<ActiveWorkoutScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
