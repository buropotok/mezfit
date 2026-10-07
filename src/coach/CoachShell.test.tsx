// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

vi.mock('../schedule/TodayPage', () => ({
  TodayPage: ({ onCreateEvent }: { onCreateEvent?: () => void }) => (
    <button type="button" onClick={onCreateEvent}>Создать событие</button>
  ),
}));

afterEach(cleanup);

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


describe('coach schedule event navigation', () => {
  it('opens the Event placeholder as a level-two screen', async () => {
    const onNavigationContextChange = vi.fn();
    render(
      <CoachShell
        initData="test-init-data"
        destination="today"
        onNavigationContextChange={onNavigationContextChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Создать событие' }));

    expect(screen.getByText('Событие')).toBeTruthy();
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(expect.objectContaining({
      level: 2,
      title: 'Событие',
      scrollKey: 'event:new',
    })));
  });
});
