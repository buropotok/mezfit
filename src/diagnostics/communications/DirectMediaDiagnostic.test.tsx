// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectMediaDiagnostic } from './DirectMediaDiagnostic';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uploads only after a user action and exposes the returned permanent link', async () => {
  const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
  vi.stubGlobal('fetch', put);
  const view = render(<DirectMediaDiagnostic />);
  const input = view.container.querySelector('input[type="file"]');
  if (!input) throw new Error('Missing file input');
  fireEvent.change(input, { target: { files: [new File(['sample'], 'test.mp4', { type: 'video/mp4' })] } });
  expect(put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
  const link = await screen.findByRole('link', { name: 'Открыть загруженный файл' });
  expect(link.getAttribute('href')).toBe(put.mock.calls[0][0]);
});

it('shows the safe S3 error details when direct upload returns HTTP 403', async () => {
  const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    '<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>',
    { status: 403, headers: { 'Content-Type': 'application/xml' } },
  ));
  vi.stubGlobal('fetch', put);
  const view = render(<DirectMediaDiagnostic />);
  const input = view.container.querySelector('input[type="file"]');
  if (!input) throw new Error('Missing file input');
  fireEvent.change(input, { target: { files: [new File(['sample'], 'test.jpg', { type: 'image/jpeg' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
  expect(await screen.findByText('Хранилище отклонило загрузку (HTTP 403; S3 AccessDenied: Access Denied.).')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeTruthy();
});

it('performs an unconditioned PUT only on the explicit diagnostic action', async () => {
  const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    '<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>',
    { status: 403, headers: { 'Content-Type': 'application/xml' } },
  ));
  vi.stubGlobal('fetch', put);
  const view = render(<DirectMediaDiagnostic />);
  const input = view.container.querySelector('input[type="file"]');
  if (!input) throw new Error('Missing file input');
  fireEvent.change(input, { target: { files: [new File(['test'], 'photo.jpg', { type: 'image/jpeg' })] } });
  expect(put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Проверить PUT без If-None-Match' }));
  expect(await screen.findByText(
    'Тест без If-None-Match: Хранилище отклонило загрузку (HTTP 403; S3 AccessDenied: Access Denied.).',
  )).toBeTruthy();
  expect(put).toHaveBeenCalledOnce();
  expect(put.mock.calls[0][1]).toEqual(expect.objectContaining({
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
  }));
  expect(put.mock.calls[0][0]).toMatch(/^https:\/\/storage\.yandexcloud\.net\/mezfit-comm-poc-20261106\/mvp-media\/[a-f0-9]{64}$/);
});
