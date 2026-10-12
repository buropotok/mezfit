import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientCoachSelectorModal } from './ClientCoachSelectorModal';

vi.mock('./ClientCoachContext', () => ({
  useClientCoach: () => ({
    coaches: [
      {
        relationshipId: 'rlm11',
        userId: 'tg:700',
        telegramUserId: '700',
        displayName: 'Анна Иванова',
      },
    ],
    selectedCoach: {
      relationshipId: 'rlm11',
      userId: 'tg:700',
        telegramUserId: '700',
        displayName: 'Анна Иванова',
    },
    status: 'ready',
    error: '',
    selectCoach: () => undefined,
    refreshCoaches: () => undefined,
  }),
}));

describe('ClientCoachSelectorModal', () => {
  it('uses the Mezfit dialog list composition and synced cloud coach labels', () => {
    const html = renderToStaticMarkup(
      <KonstaProvider theme="ios" dark>
        <ClientCoachSelectorModal isOpen onClose={() => undefined} />
      </KonstaProvider>,
    );

    expect(html).toContain('ui-glass-surface');
    expect(html).toContain('Анна Иванова');
    expect(html).not.toContain('@coach_anna');
    expect(html).not.toContain('https://example.com/coach-anna.jpg');
    expect(html).toContain('type="radio"');
    expect(html).toContain('checked=""');
  });
});
