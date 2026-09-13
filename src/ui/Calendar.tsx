import { DayPicker } from '@daypicker/react';
import { ru } from '@daypicker/react/locale';
import { startPressScale } from './PressScale';
import '@daypicker/react/style.css';
import './calendar.css';

export interface CalendarProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  className?: string;
}

export function Calendar({ value, onChange, className = '' }: CalendarProps) {
  return (
    <div onPointerDownCapture={(event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (target instanceof HTMLButtonElement && !target.disabled) startPressScale(target);
    }}>
      <DayPicker
        className={`ui-calendar ${className}`.trim()}
        locale={ru}
        mode="single"
        selected={value}
        onSelect={onChange}
        showOutsideDays
      />
    </div>
  );
}
