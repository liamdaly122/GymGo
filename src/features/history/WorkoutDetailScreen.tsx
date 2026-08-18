import { Screen, ScreenTitle, EmptyState } from '@/components/ui';

export default function WorkoutDetailScreen() {
  return (
    <Screen>
      <ScreenTitle>Workout</ScreenTitle>
      <EmptyState title="Coming in the next slice." />
    </Screen>
  );
}
