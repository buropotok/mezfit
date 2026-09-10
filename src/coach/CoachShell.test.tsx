import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoachShell } from './CoachShell';

describe('coach exercise navigation', () => {
  it('renders the functional global catalogue for the exercises destination', () => {
    const html = renderToStaticMarkup(
      <CoachShell
        initData="test-init-data"
        destination="exercises"
        onNavigationContextChange={() => undefined}
      />,
    );

    expect(html).toContain('Поиск упражнения');
    expect(html).toContain('Все категории');
    expect(html).toContain('Загружаем упражнения');
    expect(html).not.toContain('Здесь будет глобальный каталог упражнений тренера');
  });
});
