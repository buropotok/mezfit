// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as annotation from './discussion-annotation';
import { DiscussionAnnotationEditor } from './DiscussionAnnotationEditor';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('drags after a hold, moves the loupe to the opposite corner and commits one undo step', () => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  const image = document.createElement('canvas');
  image.width = image.height = 200;
  const view = render(<DiscussionAnnotationEditor image={image} onCancel={() => {}} onPrepare={async () => true} />);
  const canvas = screen.getByLabelText('Изображение с линиями');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200));

  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
  act(() => vi.advanceTimersByTime(240));
  fireEvent.pointerMove(canvas, { clientX: 150, clientY: 160 });
  const loupe = view.container.querySelector('.discussion-annotation__loupe');
  expect(loupe?.getAttribute('data-horizontal')).toBe('left');
  expect(loupe?.getAttribute('data-vertical')).toBe('top');
  fireEvent.pointerMove(canvas, { clientX: 60, clientY: 70 });
  expect(loupe?.getAttribute('data-horizontal')).toBe('right');
  expect(loupe?.getAttribute('data-vertical')).toBe('bottom');
  fireEvent.pointerUp(canvas, { clientX: 60, clientY: 70 });
  expect(view.container.querySelector('.discussion-annotation__loupe')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить действие' }));
  expect(screen.getByRole('button', { name: 'Завершить линию' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить действие' }));
  expect(screen.getByRole('button', { name: 'Нарисовать линию' })).toBeTruthy();
});

it('prepares a JPEG only after the current line is completed', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const image = document.createElement('canvas');
  image.width = image.height = 200;
  const photo = new File(['jpeg'], 'annotation.jpg', { type: 'image/jpeg' });
  const exportPhoto = vi.spyOn(annotation, 'exportAnnotation').mockResolvedValue(photo);
  const onPrepare = vi.fn(async (_file: File) => true);
  render(<DiscussionAnnotationEditor image={image} onCancel={() => {}} onPrepare={onPrepare} />);
  const canvas = screen.getByLabelText('Изображение с линиями');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200));
  fireEvent.pointerDown(canvas, { clientX: 180, clientY: 180 });
  fireEvent.pointerUp(canvas, { clientX: 180, clientY: 180 });

  const prepare = screen.getByRole('button', { name: 'Подготовить фото' });
  expect(prepare).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Завершить линию' }));
  expect(exportPhoto).not.toHaveBeenCalled();
  expect(onPrepare).not.toHaveBeenCalled();
  fireEvent.click(prepare);
  await waitFor(() => expect(onPrepare).toHaveBeenCalledWith(photo));
  expect(exportPhoto).toHaveBeenCalledWith(image, [[{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }]]);
});
