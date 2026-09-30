import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react';
import { PointerSensor, TouchSensor } from '@dnd-kit/core';

export const LONG_PRESS_DELAY_MS = 300;
export const DRAG_ACTIVATION_TOLERANCE = 8;
export const SCHEDULE_TOUCH_ACTIVATION_TOLERANCE = 24;

function blocksDrag(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-no-dnd],a,input,select,textarea')) return true;
  const button = target.closest('button,[role="button"]');
  return Boolean(
    button
    && !button.classList.contains('ui-list-item')
    && !button.hasAttribute('data-ui-dnd-handle')
  );
}

export class UiPointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent: event }: ReactPointerEvent) => event.pointerType !== 'touch' && !blocksDrag(event.target),
  }];
}

export class UiTouchSensor extends TouchSensor {
  static activators = [{
    eventName: 'onTouchStart' as const,
    handler: ({ nativeEvent: event }: ReactTouchEvent) => !blocksDrag(event.target),
  }];
}

