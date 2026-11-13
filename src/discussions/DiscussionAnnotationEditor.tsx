import { useLayoutEffect, useReducer, useRef, useState, type PointerEvent } from 'react';
import { IconButton, Text } from '../ui';
import { MezfitDialog, MezfitDialogButton } from '../ui/konsta-mezfit/Dialog';
import {
  containAnnotationImage, drawAnnotation, editAnnotation, exportAnnotation, initialAnnotationHistory, moveAnnotationPoint,
  type AnnotationPoint,
} from './discussion-annotation';
import './discussion-annotation.css';

interface Drag {
  index: number;
  point: AnnotationPoint;
}

interface Gesture {
  pointer: number;
  index: number;
  startX: number;
  startY: number;
  original?: AnnotationPoint;
  timer?: ReturnType<typeof setTimeout>;
  dragging: boolean;
  cancelled: boolean;
}

const holdMs = 230;
const tapSlop = 8;
const nodeHitRadius = 28;
const exitTitle = 'Сохранить и отправить результат?';

export type AnnotationExit = 'editing' | 'confirming' | 'preparing';

export function DiscussionAnnotationEditor({ image, exit, onExitChange, onCancel, onPrepare }: {
  image: HTMLCanvasElement;
  exit: AnnotationExit;
  onExitChange: (exit: AnnotationExit) => void;
  onCancel: () => void;
  onPrepare: (file: File) => Promise<boolean>;
}) {
  const [history, dispatch] = useReducer(editAnnotation, initialAnnotationHistory);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const exporting = useRef(false);
  const { completed, active } = history.current;
  const activeLine = active && drag ? moveAnnotationPoint(active, drag.index, drag.point) : active;
  const linesToExport = active && active.length > 1 ? [...completed, active] : completed;
  const canPrepare = linesToExport.length > 0;
  const confirming = exit === 'confirming';
  const preparing = exit === 'preparing';

  function clearGesture() {
    const current = gesture.current;
    if (current?.timer !== undefined) clearTimeout(current.timer);
    gesture.current = null;
    return current;
  }

  useLayoutEffect(() => () => { clearGesture(); }, []);
  useLayoutEffect(() => {
    if (exit !== 'editing') {
      clearGesture();
      setDrag(null);
    }
  }, [exit]);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useLayoutEffect(() => {
    const element = canvas.current;
    const { width, height } = viewport;
    if (!element || !width || !height) return;
    const lines = activeLine ? [...completed, activeLine] : completed;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    context.clearRect(0, 0, width, height);
    const rect = containAnnotationImage(width, height, image);
    drawAnnotation(context, image, rect, lines);
    for (const point of activeLine ?? []) {
      context.beginPath();
      context.arc(rect.x + point.x * rect.width, rect.y + point.y * rect.height, 5, 0, 2 * Math.PI);
      context.fillStyle = '#ffdc42';
      context.fill();
      context.strokeStyle = '#242424';
      context.lineWidth = 1.5;
      context.stroke();
    }

    const magnifier = loupe.current;
    if (!drag || !magnifier) return;
    const zoom = magnifier.getContext('2d');
    if (!zoom) return;
    const size = magnifier.width;
    const scale = (size / Math.max(1, magnifier.clientWidth)) * 2.5;
    zoom.clearRect(0, 0, size, size);
    drawAnnotation(zoom, image, {
      x: size / 2 - drag.point.x * rect.width * scale,
      y: size / 2 - drag.point.y * rect.height * scale,
      width: rect.width * scale, height: rect.height * scale,
    }, lines);
    zoom.beginPath();
    zoom.arc(size / 2, size / 2, 5 * scale, 0, 2 * Math.PI);
    zoom.strokeStyle = '#ffdc42';
    zoom.lineWidth = Math.max(2, scale);
    zoom.stroke();
  }, [image, completed, activeLine, drag, viewport]);

  function pointerPoint(event: PointerEvent<HTMLCanvasElement>, current?: Gesture): AnnotationPoint | null {
    const bounds = event.currentTarget.getBoundingClientRect();
    const rect = containAnnotationImage(bounds.width, bounds.height, image);
    if (!rect.width || !rect.height) return null;
    if (current?.original) return {
      x: Math.max(0, Math.min(1, current.original.x + (event.clientX - current.startX) / rect.width)),
      y: Math.max(0, Math.min(1, current.original.y + (event.clientY - current.startY) / rect.height)),
    };
    const x = (event.clientX - bounds.left - rect.x) / rect.width;
    const y = (event.clientY - bounds.top - rect.y) / rect.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }

  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (exit !== 'editing' || !active || gesture.current || event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rect = containAnnotationImage(bounds.width, bounds.height, image);
    const x = event.clientX - bounds.left - rect.x;
    const y = event.clientY - bounds.top - rect.y;
    let nearest = nodeHitRadius;
    let index = -1;
    active.forEach((point, position) => {
      const distance = Math.hypot(point.x * rect.width - x, point.y * rect.height - y);
      if (distance <= nearest) { index = position; nearest = distance; }
    });
    if (index < 0 && !pointerPoint(event)) return;
    const current: Gesture = {
      pointer: event.pointerId, index, startX: event.clientX, startY: event.clientY,
      original: active[index], dragging: false, cancelled: false,
    };
    gesture.current = current;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (current.original) {
      const point = current.original;
      current.timer = setTimeout(() => {
        if (gesture.current !== current || current.cancelled) return;
        current.dragging = true;
        setDrag({ index, point });
      }, holdMs);
    }
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.dragging) {
      const point = pointerPoint(event, current);
      if (point) setDrag({ index: current.index, point });
    } else if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > tapSlop) {
      current.cancelled = true;
    }
  }

  function end(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    if (gesture.current?.pointer !== event.pointerId) return;
    const current = clearGesture();
    setDrag(null);
    if (!current || cancelled || current.cancelled) return;
    if (current.dragging) {
      const point = pointerPoint(event, current);
      if (point) dispatch({ type: 'move', index: current.index, point });
    } else if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= tapSlop) {
      if (current.index >= 0) dispatch({ type: 'remove', index: current.index });
      else {
        const point = pointerPoint(event);
        if (point) dispatch({ type: 'add', point });
      }
    }
  }

  function changeLine(type: 'undo' | 'redo' | 'start' | 'finish') {
    clearGesture();
    setDrag(null);
    dispatch({ type });
  }

  async function prepare() {
    if (!confirming || !canPrepare || exporting.current) return;
    exporting.current = true;
    onExitChange('preparing');
    setFailed(false);
    try {
      if (await onPrepare(await exportAnnotation(image, linesToExport))) return;
    } catch {
      // An encoding failure follows the same recovery path as a rejected attachment.
    } finally {
      exporting.current = false;
    }
    setFailed(true);
    onExitChange('editing');
  }

  return <>
    <section className="discussion-annotation" aria-label="Разметка изображения" inert={exit !== 'editing'}>
      <div className="discussion-annotation__toolbar">
        <IconButton icon={active ? 'check' : 'chart-dots-3'} label={active ? 'Завершить линию' : 'Нарисовать линию'}
          disabled={preparing} onClick={() => changeLine(active ? 'finish' : 'start')} />
        <IconButton icon="arrow-back-up" label="Отменить действие" disabled={preparing || !history.past.length}
          onClick={() => changeLine('undo')} />
        <IconButton icon="arrow-forward-up" label="Повторить действие" disabled={preparing || !history.future.length}
          onClick={() => changeLine('redo')} />
        <IconButton icon="x" label="Закрыть редактор" onClick={() => onExitChange('confirming')} />
      </div>
      <div className="discussion-annotation__viewport">
        <canvas ref={canvas} className="discussion-annotation__canvas" aria-label="Изображение с линиями"
          onPointerDown={down} onPointerMove={move} onPointerUp={endPointer => end(endPointer)}
          onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}
          onContextMenu={event => event.preventDefault()} />
        {drag && <canvas ref={loupe} width={300} height={300} className="discussion-annotation__loupe" aria-hidden="true"
          data-horizontal={drag.point.x < 0.5 ? 'right' : 'left'} />}
      </div>
      {failed && <Text variant="footnote" role="alert">Не удалось подготовить фото. Повторите попытку.</Text>}
    </section>
    {(confirming || preparing) && <MezfitDialog opened role="dialog" aria-modal="true" aria-label={exitTitle}
      title={<Text variant="headline">{exitTitle}</Text>}
      content={preparing ? <Text variant="footnote" role="status">Готовим фото…</Text>
        : !canPrepare ? <Text variant="footnote">Добавьте хотя бы один отрезок, чтобы сохранить разметку.</Text> : undefined}
      onBackdropClick={() => { if (!preparing) onExitChange('editing'); }}
      buttons={<>
        <MezfitDialogButton disabled={preparing} onClick={onCancel}><Text>Нет</Text></MezfitDialogButton>
        <MezfitDialogButton strong disabled={preparing || !canPrepare} onClick={() => void prepare()}><Text>Да</Text></MezfitDialogButton>
      </>} />}
  </>;
}
