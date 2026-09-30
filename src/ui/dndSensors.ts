import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react';
import {
  PointerSensor,
  TouchSensor,
  type DistanceMeasurement,
  type PointerActivationConstraint,
  type SensorInstance,
  type SensorProps,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

export const LONG_PRESS_DELAY_MS = 300;
export const DRAG_ACTIVATION_TOLERANCE = 8;
export const SCHEDULE_TOUCH_ACTIVATION_TOLERANCE = 24;

function blocksDrag(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-no-dnd],[data-schedule-no-swipe],a,input,select,textarea')) return true;
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

type ScheduleTouchSensorOptions = {
  activationConstraint?: PointerActivationConstraint;
};

function exceedsDistance(deltaX: number, deltaY: number, measurement: DistanceMeasurement): boolean {
  const dx = Math.abs(deltaX);
  const dy = Math.abs(deltaY);

  if (typeof measurement === 'number') return Math.hypot(dx, dy) > measurement;
  if ('x' in measurement && 'y' in measurement) return dx > measurement.x && dy > measurement.y;
  if ('x' in measurement) return dx > measurement.x;
  return dy > measurement.y;
}

function isDelayConstraint(
  constraint: PointerActivationConstraint,
): constraint is PointerActivationConstraint & { delay: number; tolerance: DistanceMeasurement } {
  return 'delay' in constraint;
}

/**
 * Touch sensor for DaySchedule.
 *
 * dnd-kit AbstractPointerSensor cancels every active drag on window.resize.
 * Telegram/iOS/Android WebViews can emit resize while a finger is still down,
 * which made a successfully lifted event immediately snap back. This sensor
 * intentionally keeps resize out of the drag lifecycle while preserving
 * touchend, touchcancel and visibilitychange semantics.
 */
export class UiScheduleTouchSensor implements SensorInstance {
  public autoScrollEnabled = true;

  static activators = [{
    eventName: 'onTouchStart' as const,
    handler: ({ nativeEvent: event }: ReactTouchEvent) => (
      event.touches.length <= 1 && !blocksDrag(event.target)
    ),
  }];

  static setup() {
    const noop = () => {};
    window.addEventListener('touchmove', noop, { passive: false });
    return () => window.removeEventListener('touchmove', noop);
  }

  private readonly props: SensorProps<ScheduleTouchSensorOptions>;
  private readonly document: Document;
  private readonly view: Window;
  private readonly initialX: number;
  private readonly initialY: number;
  private activationTimer: number | null = null;
  private activated = false;
  private detached = false;

  constructor(props: SensorProps<ScheduleTouchSensorOptions>) {
    this.props = props;

    const target = props.event.target;
    this.document = target instanceof Node ? target.ownerDocument ?? document : document;
    this.view = this.document.defaultView ?? window;

    const coordinates = getEventCoordinates(props.event) ?? { x: 0, y: 0 };
    this.initialX = coordinates.x;
    this.initialY = coordinates.y;

    this.handleMove = this.handleMove.bind(this);
    this.handleEnd = this.handleEnd.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleDragStart = this.handleDragStart.bind(this);
    this.removeSelection = this.removeSelection.bind(this);
    this.stopClick = this.stopClick.bind(this);

    this.document.addEventListener('touchmove', this.handleMove, { passive: false });
    this.document.addEventListener('touchend', this.handleEnd);
    this.document.addEventListener('touchcancel', this.handleCancel);
    this.document.addEventListener('selectionchange', this.removeSelection);
    this.document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.view.addEventListener('contextmenu', this.handleContextMenu);
    this.view.addEventListener('dragstart', this.handleDragStart);

    const constraint = props.options.activationConstraint;
    if (!constraint) {
      this.activate();
      return;
    }

    if (isDelayConstraint(constraint)) {
      props.onPending(props.active, constraint, coordinates);
      this.activationTimer = this.view.setTimeout(() => this.activate(), constraint.delay);
      return;
    }

    props.onPending(props.active, constraint, coordinates);
  }

  private activate() {
    if (this.detached || this.activated) return;
    this.activated = true;
    this.clearActivationTimer();
    this.document.addEventListener('click', this.stopClick, true);
    this.removeSelection();
    this.props.onStart({ x: this.initialX, y: this.initialY });
  }

  private handleMove(event: TouchEvent) {
    if (this.detached) return;
    const coordinates = getEventCoordinates(event);
    if (!coordinates) return;

    const deltaX = coordinates.x - this.initialX;
    const deltaY = coordinates.y - this.initialY;
    const constraint = this.props.options.activationConstraint;

    if (!this.activated && constraint) {
      if (isDelayConstraint(constraint)) {
        if (exceedsDistance(deltaX, deltaY, constraint.tolerance)) {
          this.abortPendingDrag();
          return;
        }
      } else if ('distance' in constraint) {
        if (constraint.tolerance != null && exceedsDistance(deltaX, deltaY, constraint.tolerance)) {
          this.abortPendingDrag();
          return;
        }
        if (exceedsDistance(deltaX, deltaY, constraint.distance)) {
          this.activate();
          return;
        }
      }

      this.props.onPending(
        this.props.active,
        constraint,
        { x: this.initialX, y: this.initialY },
        { x: deltaX, y: deltaY },
      );
      return;
    }

    if (event.cancelable) event.preventDefault();
    this.props.onMove(coordinates);
  }

  private handleEnd() {
    if (this.detached) return;
    const activated = this.activated;
    this.detach();
    if (!activated) this.props.onAbort(this.props.active);
    this.props.onEnd();
  }

  private handleCancel() {
    if (this.detached) return;
    const activated = this.activated;
    this.detach();
    if (!activated) this.props.onAbort(this.props.active);
    this.props.onCancel();
  }

  private handleVisibilityChange() {
    if (this.document.visibilityState === 'hidden') this.handleCancel();
  }

  private handleContextMenu(event: Event) {
    event.preventDefault();
  }

  private handleDragStart(event: Event) {
    event.preventDefault();
  }

  private removeSelection() {
    this.document.getSelection()?.removeAllRanges();
  }

  private stopClick(event: Event) {
    event.stopPropagation();
  }

  private abortPendingDrag() {
    const activated = this.activated;
    this.detach();
    if (!activated) this.props.onAbort(this.props.active);
    this.props.onCancel();
  }

  private clearActivationTimer() {
    if (this.activationTimer === null) return;
    this.view.clearTimeout(this.activationTimer);
    this.activationTimer = null;
  }

  private detach() {
    if (this.detached) return;
    this.detached = true;
    this.clearActivationTimer();

    this.document.removeEventListener('touchmove', this.handleMove);
    this.document.removeEventListener('touchend', this.handleEnd);
    this.document.removeEventListener('touchcancel', this.handleCancel);
    this.document.removeEventListener('selectionchange', this.removeSelection);
    this.document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.view.removeEventListener('contextmenu', this.handleContextMenu);
    this.view.removeEventListener('dragstart', this.handleDragStart);

    this.view.setTimeout(() => this.document.removeEventListener('click', this.stopClick, true), 50);
  }
}
