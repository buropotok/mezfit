import type { NavigationContext } from '../NavigationShell';
import { PersonalExercises } from './PersonalExercises';

/** The coach and the standalone client now share personal-library mechanics. */
export function CoachExercises({ onNavigationContextChange }: {
  onNavigationContextChange: (context: NavigationContext | null) => void;
}) {
  return <PersonalExercises role="coach" onNavigationContextChange={onNavigationContextChange} />;
}
