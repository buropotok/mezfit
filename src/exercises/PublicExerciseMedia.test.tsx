// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicExerciseMedia, publicExerciseMediaUrl } from './PublicExerciseMedia';

vi.mock('../ui', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid="fallback-icon">{name}</span>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const sha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const row = {
  id: '0001',
  name: 'Press',
  name_ru: 'Жим',
  sourceSha256: sha,
  gif_url: 'exercises/0001/press.gif',
};

afterEach(cleanup);

describe('public Dexie catalogue media / R2 boundary', () => {
  it('automatically resolves owner-supplied GIFs without a rollout flag', () => {
    expect(publicExerciseMediaUrl(row)).toBe('/api/exercise-media/gym_keeper_apk/0001');
    render(<PublicExerciseMedia row={row} variant="detail" />);
    expect(screen.getByRole('img', { name: 'Жим' }).getAttribute('src'))
      .toBe('/api/exercise-media/gym_keeper_apk/0001');
  });

  it('resolves a verified source to the existing same-origin R2 Worker path by default', () => {
    expect(publicExerciseMediaUrl(row)).toBe('/api/exercise-media/gym_keeper_apk/0001');
    render(<PublicExerciseMedia row={row} variant="detail" />);
    const picture = screen.getByRole('img', { name: 'Жим' });
    expect(picture.getAttribute('src')).toBe('/api/exercise-media/gym_keeper_apk/0001');
    expect(picture.getAttribute('loading')).toBe('eager');
    expect(picture.getAttribute('decoding')).toBe('async');
  });

  it('rejects external, malformed and cross-release identifiers even when enabled', () => {
    expect(publicExerciseMediaUrl({ ...row, id: '../clients' })).toBeNull();
    expect(publicExerciseMediaUrl({ ...row, id: '00001' })).toBeNull();
    expect(publicExerciseMediaUrl({ ...row, sourceSha256: 'a'.repeat(64) })).toBeNull();
    expect(publicExerciseMediaUrl({ ...row, gif_url: '' })).toBeNull();
  });

  it('renders lazy decorative thumbnail and falls back if Worker/R2 returns an error', () => {
    const { container } = render(<PublicExerciseMedia row={row} variant="thumbnail" />);
    const picture = container.querySelector('img');
    expect(picture?.getAttribute('alt')).toBe('');
    expect(picture?.getAttribute('loading')).toBe('lazy');
    if (!picture) throw new Error('Decorative GIF should render as an img element');
    fireEvent.error(picture);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('fallback-icon').textContent).toBe('barbell');
  });

  it('shows a non-sensitive detail fallback after missing R2 media', () => {
    render(<PublicExerciseMedia row={row} variant="detail" />);
    fireEvent.error(screen.getByRole('img', { name: 'Жим' }));
    expect(screen.getByText('Медиа недоступно')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('remounts an exercise image when navigating to a different item', () => {
    const view = ({ entry }: { entry: typeof row }) => (
      <PublicExerciseMedia key={entry.id} row={entry} variant="detail" />
    );
    const rendered = render(view({ entry: row }));
    fireEvent.error(screen.getByRole('img', { name: 'Жим' }));
    expect(screen.getByText('Медиа недоступно')).toBeTruthy();
    rendered.rerender(view({ entry: { ...row, id: '0002', name_ru: 'Приседание' } }));
    expect(screen.getByRole('img', { name: 'Приседание' }).getAttribute('src'))
      .toBe('/api/exercise-media/gym_keeper_apk/0002');
  });
});
