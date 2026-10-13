import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

vi.mock('../exercises/PublicExercises', () => ({
  PublicExercises: () => <section data-testid="public-exercise-catalogue">База упражнений</section>,
}));

describe('coach exercise navigation', () => {
  it('opens the shared public catalogue instead of the legacy D1 manager', () => {
    const html = renderToStaticMarkup(
      <CoachShell
        initData="test-init-data"
        destination="exercises"
        onNavigationContextChange={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="public-exercise-catalogue"');
    expect(html).toContain('База упражнений');
    expect(html).not.toContain('Загружаем категории');
  });
});
