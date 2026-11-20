// @vitest-environment jsdom
import { KonstaProvider } from 'konsta/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResetLocalDataSettings } from './ResetLocalDataSettings';

import { estimateMediaCacheBytes, estimateLocalDataBytes } from '../data/local/resetLocalDataSizes';

vi.mock('../data/local/resetLocalDataSizes', () => ({
  estimateMediaCacheBytes: vi.fn(),
  estimateLocalDataBytes: vi.fn(),
}));

afterEach(() => cleanup());

it('offers two independent Konsta toggles and requires a selected scope before clearing', () => {
  const onClear = vi.fn();
  const view = render(<KonstaProvider theme="ios" dark>
    <ResetLocalDataSettings onClear={onClear} />
  </KonstaProvider>);

  expect(screen.getByText('Выберете данные для сброса.')).toBeTruthy();
  expect(screen.getByText(/Данные будут удалены только с данного устройства/)).toBeTruthy();
  const toggles = view.container.querySelectorAll('input[type="checkbox"]');
  expect(toggles).toHaveLength(2);
  const clearButtons = () => screen.getAllByRole('button', { name: 'Очистить' });
  expect(clearButtons()[0].hasAttribute('disabled')).toBe(true);

  fireEvent.click(toggles[0]);
  expect(clearButtons()[0].hasAttribute('disabled')).toBe(false);
  fireEvent.click(clearButtons()[0]);
  expect(screen.getByText('Очистить локальные данные?')).toBeTruthy();
  fireEvent.click(clearButtons()[1]);
  expect(onClear).toHaveBeenCalledWith({ media: true, workouts: false });
});

it('warns about rehydrating other account data when working data is selected', () => {
  const view = render(<KonstaProvider theme="ios" dark>
    <ResetLocalDataSettings onClear={vi.fn()} />
  </KonstaProvider>);
  fireEvent.click(view.container.querySelectorAll('input[type="checkbox"]')[1]);
  expect(screen.getByText(/локальная копия профилей, каталога и переписок/)).toBeTruthy();
});

it('shows both independently calculated approximate sizes for the signed-in account', async () => {
  vi.mocked(estimateMediaCacheBytes).mockResolvedValueOnce(2 * 1024 * 1024);
  vi.mocked(estimateLocalDataBytes).mockResolvedValueOnce(8 * 1024);
  render(<KonstaProvider theme="ios" dark>
    <ResetLocalDataSettings telegramUserId="9401" onClear={vi.fn()} />
  </KonstaProvider>);
  expect(await screen.findByText('≈ 2.0 МБ')).toBeTruthy();
  expect(await screen.findByText('≈ 8.0 КБ')).toBeTruthy();
  expect(estimateMediaCacheBytes).toHaveBeenCalledWith('9401');
  expect(estimateLocalDataBytes).toHaveBeenCalledWith('9401');
});

it('keeps the other size visible when one IndexedDB estimate fails', async () => {
  vi.mocked(estimateMediaCacheBytes).mockRejectedValueOnce(new Error('IDB blocked'));
  vi.mocked(estimateLocalDataBytes).mockResolvedValueOnce(0);
  render(<KonstaProvider theme="ios" dark>
    <ResetLocalDataSettings telegramUserId="9401" onClear={vi.fn()} />
  </KonstaProvider>);
  expect(await screen.findByText('Размер недоступен')).toBeTruthy();
  expect(await screen.findByText('0 Б')).toBeTruthy();
});
