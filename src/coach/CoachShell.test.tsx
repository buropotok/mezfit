import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoachShell } from './CoachShell';

describe('coach exercise navigation', () => {
  it('opens the Gym Keeper-style category catalogue before exercise rows', () => {
    const html = renderToStaticMarkup(
      <CoachShell
        initData="test-init-data"
        destination="exercises"
        onNavigationContextChange={() => undefined}
      />,
    );

    expect(html).toContain('Загружаем категории');
    expect(html).not.toContain('Все категории');
    expect(html).not.toContain('Здесь будет глобальный каталог упражнений тренера');
  });
});
