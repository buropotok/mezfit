import { useMemo } from 'react';
import { useNavigationSurfaceFloatingAction } from '../NavigationShell';

/** Reuse the same root/nested FAB slot as the rest of the coach workspace. */
export function CoachExerciseCatalogFab({ onCreate }: { onCreate: () => void }) {
  const action = useMemo(() => ({
    label: 'Добавить упражнение',
    icon: 'plus' as const,
    onClick: onCreate,
  }), [onCreate]);
  useNavigationSurfaceFloatingAction(action);
  return null;
}
