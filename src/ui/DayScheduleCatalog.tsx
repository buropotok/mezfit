import { useMemo, useState } from 'react';
import { Avatar } from './primitives';
import { DaySchedule, type DayScheduleEvent } from './DaySchedule';
import type { LocalDate } from './date-picker/DatePicker';
import './DayScheduleCatalog.css';

type DemoEvent = DayScheduleEvent & {
  title: string;
  meta: string;
  avatar: string;
};

const demoEvents: Readonly<Record<LocalDate, readonly DemoEvent[]>> = {
  '2026-09-27': [
    { id: 'sun-1', startMinutes: 660, durationMinutes: 60, title: 'Мария Орлова', meta: 'Персональная', avatar: 'МО' },
  ],
  '2026-09-28': [
    { id: 'mon-1', startMinutes: 570, durationMinutes: 60, title: 'Иван Петров', meta: 'Персональная', avatar: 'ИП' },
    { id: 'mon-2', startMinutes: 720, durationMinutes: 90, title: 'Иван + Анна', meta: 'Мини-группа · 2 участника', avatar: '2' },
    { id: 'mon-3', startMinutes: 975, durationMinutes: 45, title: 'Анна Смирнова', meta: 'Функциональная', avatar: 'АС' },
  ],
  '2026-09-29': [
    { id: 'tue-1', startMinutes: 630, durationMinutes: 60, title: 'Елена Волкова', meta: 'Персональная', avatar: 'ЕВ' },
  ],
  '2026-09-30': [],
  '2026-10-01': [
    { id: 'thu-1', startMinutes: 540, durationMinutes: 45, title: 'Олег Морозов', meta: 'Кардио', avatar: 'ОМ' },
    { id: 'thu-2', startMinutes: 780, durationMinutes: 60, title: 'Наталья + Ирина', meta: 'Мини-группа · 2 участника', avatar: '2' },
  ],
  '2026-10-02': [
    { id: 'fri-1', startMinutes: 600, durationMinutes: 90, title: 'Алексей Романов', meta: 'Силовая', avatar: 'АР' },
    { id: 'fri-2', startMinutes: 870, durationMinutes: 60, title: 'Мария Орлова', meta: 'Персональная', avatar: 'МО' },
  ],
  '2026-10-03': [
    { id: 'sat-1', startMinutes: 720, durationMinutes: 60, title: 'Иван + Анна + Олег', meta: 'Мини-группа · 3 участника', avatar: '3' },
  ],
  '2026-10-04': [
    { id: 'sun-next-1', startMinutes: 780, durationMinutes: 60, title: 'Анна Смирнова', meta: 'Мобилити', avatar: 'АС' },
  ],
  '2026-10-05': [
    { id: 'mon-next-1', startMinutes: 600, durationMinutes: 60, title: 'Дмитрий Соколов', meta: 'Персональная', avatar: 'ДС' },
  ],
};

export function DayScheduleCatalog() {
  const [date, setDate] = useState<LocalDate>('2026-09-28');
  const [message, setMessage] = useState('');
  const eventsByDate = useMemo(() => demoEvents, []);

  return (
    <section className="ui-kit-day-schedule" aria-label="Day Schedule prototype">
      <DaySchedule
        date={date}
        today="2026-09-28"
        eventsByDate={eventsByDate}
        onDateChange={setDate}
        onBack={() => setMessage('Назад')}
        onOpenDatePicker={() => setMessage('Открыть DatePicker')}
        onAddEvent={() => setMessage('Добавить тренировку')}
        renderEvent={(event, state) => (
          <div className={`ui-kit-day-schedule__event${state.compact ? ' ui-kit-day-schedule__event--compact' : ''}`}>
            <Avatar name={event.title} />
            <div className="ui-kit-day-schedule__event-copy">
              <strong>{event.title}</strong>
              {!state.compact && <span>{event.meta}</span>}
            </div>
            <span className="ui-kit-day-schedule__event-time">
              {String(Math.floor(event.startMinutes / 60)).padStart(2, '0')}:{String(event.startMinutes % 60).padStart(2, '0')}
            </span>
          </div>
        )}
      />
      {message && <div className="ui-kit-day-schedule__message">{message}</div>}
    </section>
  );
}
