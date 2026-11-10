// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mockSignedMediaTransport } from '../../media/mediaUploadTestFixtures';
import { DirectMediaDiagnostic } from './DirectMediaDiagnostic';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('uploads only after a user action and exposes the returned permanent link', async () => {
  const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
  const transport = mockSignedMediaTransport(put);
  const view = render(<DirectMediaDiagnostic />);
  const input = view.container.querySelector('input[type="file"]');
  if (!input) throw new Error('Missing file input');
  fireEvent.change(input, { target: { files: [new File(['sample'], 'test.mp4', { type: 'video/mp4' })] } });
  expect(transport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
  const link = await screen.findByRole('link', { name: 'Открыть загруженный файл' });
  expect(link.getAttribute('href')).toBe(String(put.mock.calls[0][0]).split('?')[0]);
  expect(screen.queryByRole('button', { name: /без If-None-Match/ })).toBeNull();
});

it('shows the safe S3 error details when direct upload returns HTTP 403', async () => {
  const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    '<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>',
    { status: 403, headers: { 'Content-Type': 'application/xml' } },
  ));
  mockSignedMediaTransport(put);
  const view = render(<DirectMediaDiagnostic />);
  const input = view.container.querySelector('input[type="file"]');
  if (!input) throw new Error('Missing file input');
  fireEvent.change(input, { target: { files: [new File(['sample'], 'test.jpg', { type: 'image/jpeg' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
  expect(await screen.findByText('Хранилище отклонило загрузку (HTTP 403; S3 AccessDenied: Access Denied.).')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeTruthy();
});
