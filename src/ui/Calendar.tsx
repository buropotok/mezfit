import { DayPicker, type RootProps } from '@daypicker/react';
import { ru } from '@daypicker/react/locale';
import { startPressScale } from './PressScale';
import '@daypicker/react/style.css';
import './calendar.css';

export interface CalendarProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  className?: string;
}

function PressScaleCalendarRoot({ rootRef, onPointerDownCapture, ...props }: RootProps) {
  return <div {...props} ref={rootRef} onPointerDownCapture={(event) => {
    onPointerDownCapture?.(event);
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (target instanceof HTMLButtonElement && !target.disabled) startPressScale(target);
  }} />;
}

export function Calendar({ value, onChange, className = '' }: CalendarProps) {
  return (
    <DayPicker
      className={`ui-calendar ${className}`.trim()}
      locale={ru}
      mode="single"
      selected={value}
      onSelect={onChange}
      showOutsideDays
      components={{ Root: PressScaleCalendarRoot }}
    />
  );
}
