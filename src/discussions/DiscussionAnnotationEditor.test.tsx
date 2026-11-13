// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as annotation from './discussion-annotation';
import { DiscussionAnnotationEditor, type AnnotationExit } from './DiscussionAnnotationEditor';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Editor({ image, onCancel = () => {}, onPrepare = async () => true }: {
  image: HTMLCanvasElement;
  onCancel?: () => void;
  onPrepare?: (file: File) => Promise<boolean>;
}) {
  const [exit, setExit] = useState<AnnotationExit>('editing');
  return <KonstaProvider theme="ios" dark><DiscussionAnnotationEditor image={image} exit={exit}
    onExitChange={setExit} onCancel={onCancel} onPrepare={onPrepare} /></KonstaProvider>;
}

it('drags after a hold, moves the loupe to the opposite corner and commits one undo step', () => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  const image = document.createElement('canvas');
  image.width = image.height = 200;
  const view = render(<Editor image={image} />);
  const canvas = screen.getByLabelText('Изображение с линиями');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200));

  fireEvent.pointerDown(canvas, { clientX: 124, clientY: 100 });
  act(() => vi.advanceTimersByTime(240));
  fireEvent.pointerMove(canvas, { clientX: 150, clientY: 160 });
  const loupe = view.container.querySelector('.discussion-annotation__loupe');
  expect(loupe?.getAttribute('data-horizontal')).toBe('left');
  fireEvent.pointerMove(canvas, { clientX: 60, clientY: 70 });
  expect(loupe?.getAttribute('data-horizontal')).toBe('right');
  fireEvent.pointerUp(canvas, { clientX: 60, clientY: 70 });
  expect(view.container.querySelector('.discussion-annotation__loupe')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить действие' }));
  expect(screen.getByRole('button', { name: 'Завершить линию' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить действие' }));
  expect(screen.getByRole('button', { name: 'Нарисовать линию' })).toBeTruthy();
});

it('exports the finished and current lines only after confirming exit', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const image = document.createElement('canvas');
  image.width = image.height = 200;
  const photo = new File(['jpeg'], 'annotation.jpg', { type: 'image/jpeg' });
  const exportPhoto = vi.spyOn(annotation, 'exportAnnotation').mockResolvedValue(photo);
  const onPrepare = vi.fn(async (_file: File) => true);
  render(<Editor image={image} onPrepare={onPrepare} />);
  const canvas = screen.getByLabelText('Изображение с линиями');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200));
  fireEvent.pointerDown(canvas, { clientX: 180, clientY: 180 });
  fireEvent.pointerUp(canvas, { clientX: 180, clientY: 180 });

  fireEvent.click(screen.getByRole('button', { name: 'Завершить линию' }));
  fireEvent.click(screen.getByRole('button', { name: 'Нарисовать линию' }));
  fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(canvas, { clientX: 20, clientY: 20 });
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть редактор' }));
  expect(screen.getByRole('dialog', { name: 'Сохранить и отправить результат?' })).toBeTruthy();
  expect(exportPhoto).not.toHaveBeenCalled();
  expect(onPrepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Да' }));
  await waitFor(() => expect(onPrepare).toHaveBeenCalledWith(photo));
  expect(exportPhoto).toHaveBeenCalledWith(image, [
    [{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }],
    [{ x: 0.5, y: 0.5 }, { x: 0.1, y: 0.1 }],
  ]);
});
