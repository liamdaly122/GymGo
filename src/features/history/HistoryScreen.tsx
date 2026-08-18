import { Screen, ScreenTitle, EmptyState } from '@/components/ui';

export default function HistoryScreen() {
  return (
    <Screen>
      <ScreenTitle>History</ScreenTitle>
      <EmptyState title="Coming in the next slice." />
    </Screen>
  );
}
