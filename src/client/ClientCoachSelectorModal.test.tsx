import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientCoachSelectorModal } from './ClientCoachSelectorModal';

vi.mock('./ClientCoachContext', () => ({
  useClientCoach: () => ({
    coaches: [
      {
        relationshipId: 11,
        user: {
          id: 7,
          telegramUserId: '700',
          username: 'coach_anna',
          firstName: 'Анна',
          lastName: 'Иванова',
          languageCode: 'ru',
          photoUrl: 'https://example.com/coach-anna.jpg',
          isPremium: false,
        },
      },
    ],
    selectedCoach: {
      relationshipId: 11,
      user: {
        id: 7,
        telegramUserId: '700',
        username: 'coach_anna',
        firstName: 'Анна',
        lastName: 'Иванова',
        languageCode: 'ru',
        photoUrl: 'https://example.com/coach-anna.jpg',
        isPremium: false,
      },
    },
    status: 'ready',
    error: '',
    selectCoach: () => undefined,
    refreshCoaches: () => undefined,
  }),
}));

describe('ClientCoachSelectorModal', () => {
  it('uses the Mezfit dialog list composition and keeps coach avatars', () => {
    const html = renderToStaticMarkup(
      <KonstaProvider theme="ios" dark>
        <ClientCoachSelectorModal isOpen onClose={() => undefined} />
      </KonstaProvider>,
    );

    expect(html).toContain('ui-glass-surface');
    expect(html).toContain('Анна Иванова');
    expect(html).toContain('@coach_anna');
    expect(html).toContain('https://example.com/coach-anna.jpg');
    expect(html).toContain('type="radio"');
    expect(html).toContain('checked=""');
  });
});
