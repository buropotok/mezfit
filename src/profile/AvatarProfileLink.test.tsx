// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvatarProfileLink } from './AvatarProfileLink';

const state = vi.hoisted(() => ({ enabled: true, navigate: vi.fn() }));
vi.mock('../navigation/AvatarProfileNavigation', () => ({
  useAvatarProfileNavigation: () => state.enabled ? state.navigate : null,
}));

afterEach(() => {
  cleanup();
  state.enabled = true;
  state.navigate.mockClear();
});

describe('avatar profile action', () => {
  it('passes the portrayed identity into navigation without activating its parent card', () => {
    const openCard = vi.fn();
    render(<div onClick={openCard}>
      <AvatarProfileLink userId="tg:202" name="Клиент">
        <span role="img" aria-label="Клиент">К</span>
      </AvatarProfileLink>
    </div>);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть профиль: Клиент' }));
    expect(state.navigate).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith('tg:202');
    expect(openCard).not.toHaveBeenCalled();
  });

  it('keeps a presentational avatar when identity or navigation is unavailable', () => {
    const { rerender } = render(<AvatarProfileLink userId={null} name="Неизвестный">
      <span role="img" aria-label="Неизвестный" />
    </AvatarProfileLink>);
    expect(screen.queryByRole('button', { name: /Открыть профиль/ })).toBeNull();
    state.enabled = false;
    rerender(<AvatarProfileLink userId="tg:101" name="Тренер">
      <span role="img" aria-label="Тренер" />
    </AvatarProfileLink>);
    expect(screen.queryByRole('button', { name: /Открыть профиль/ })).toBeNull();
  });
});
