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
