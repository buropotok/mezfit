import { DayPicker } from '@daypicker/react';
import { ru } from '@daypicker/react/locale';
import '@daypicker/react/style.css';
import './calendar.css';

export interface CalendarProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  className?: string;
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
    />
  );
}
