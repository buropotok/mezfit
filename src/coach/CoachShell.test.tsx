import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

vi.mock('../exercises/PublicExercises', () => ({
  PublicExercises: () => <section data-testid="public-exercise-catalogue">База упражнений</section>,
}));

vi.mock('../exercises/CoachExercises', () => ({
  CoachExercises: () => <section data-testid="coach-exercise-catalogue">База упражнений тренера</section>,
}));

describe('coach exercise navigation', () => {
  it('opens the private-aware coach catalogue instead of the public-only or legacy D1 manager', () => {
    const html = renderToStaticMarkup(
      <CoachShell
        initData="test-init-data"
        destination="exercises"
        onNavigationContextChange={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="coach-exercise-catalogue"');
    expect(html).not.toContain('data-testid="public-exercise-catalogue"');
    expect(html).toContain('База упражнений тренера');
    expect(html).not.toContain('Загружаем категории');
  });
});
