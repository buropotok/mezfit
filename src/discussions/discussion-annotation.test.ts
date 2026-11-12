import { expect, it } from 'vitest';
import { containAnnotationImage, editAnnotation, initialAnnotationHistory } from './discussion-annotation';

it('adds, removes and moves nodes with one undo step for each edit', () => {
  const last = { x: 0.9, y: 0.9 };
  const middle = { x: 0.2, y: 0.2 };
  const moved = { x: 0.3, y: 0.4 };
  const start = editAnnotation(initialAnnotationHistory, { type: 'add', point: middle });
  const line = editAnnotation(start, { type: 'add', point: last });
  const drag = editAnnotation(line, { type: 'move', index: 1, point: moved });
  expect(drag.current.active).toEqual([{ x: 0.5, y: 0.5 }, moved, last]);
  expect(editAnnotation(drag, { type: 'undo' }).current).toEqual(line.current);

  const removed = editAnnotation(drag, { type: 'remove', index: 1 });
  expect(removed.current.active).toEqual([{ x: 0.5, y: 0.5 }, last]);
  const undone = editAnnotation(removed, { type: 'undo' });
  expect(undone.current).toEqual(drag.current);
  expect(editAnnotation(undone, { type: 'redo' }).current).toEqual(removed.current);
  expect(editAnnotation(undone, { type: 'add', point: middle }).future).toEqual([]);
});

it('undoes the creation and completion of independent lines', () => {
  const line = editAnnotation(initialAnnotationHistory, { type: 'add', point: { x: 0.9, y: 0.9 } });
  const finished = editAnnotation(line, { type: 'finish' });
  expect(finished.current).toEqual({ completed: [line.current.active], active: null });
  expect(editAnnotation(finished, { type: 'undo' }).current).toEqual(line.current);

  const next = editAnnotation(finished, { type: 'start' });
  expect(next.current.completed).toEqual(finished.current.completed);
  expect(next.current.active).toEqual([{ x: 0.5, y: 0.5 }]);
  expect(editAnnotation(next, { type: 'undo' }).current).toEqual(finished.current);
  expect(editAnnotation(initialAnnotationHistory, { type: 'undo' }).current.active).toBeNull();
});

it('fits the same image into portrait and landscape viewports', () => {
  const image = { width: 400, height: 200 };
  expect(containAnnotationImage(200, 400, image)).toEqual({ x: 0, y: 150, width: 200, height: 100 });
  expect(containAnnotationImage(600, 200, image)).toEqual({ x: 100, y: 0, width: 400, height: 200 });
});
