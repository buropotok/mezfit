import { useMemo, useState } from 'react';
import { Button } from 'konsta/react';
import { Avatar } from './primitives';
import { DaySchedule, getDayScheduleValue, type DayScheduleEvent } from './DaySchedule';
import { DayScheduleEventCard } from './DayScheduleEventCard';
import { DatePicker, type LocalDate } from './date-picker/DatePicker';
import { addDays, currentLocalDate, dayIndex } from './day-schedule/dateMath';
import './DayScheduleCatalog.css';

type DemoEvent = DayScheduleEvent & { title: string; purpose: string };
const names = ['Иван Петров', 'Анна Смирнова', 'Олег Морозов', 'Мария Орлова', 'Елена Волкова', 'Дмитрий Соколов', 'Ирина Белова'];

/** Fixtures for every browsed date, not a production data source. */
function demoDay(date: LocalDate): DemoEvent[] {
  const index = dayIndex(date);
  return [
    { id: `${date}-morning`, startMinutes: 480 + index * 15, durationMinutes: 60, title: names[index], purpose: 'Персональная' },
    { id: `${date}-midday`, startMinutes: 660 + index * 15, durationMinutes: 90, title: names[(index + 2) % 7], purpose: 'Силовая' },
  ];
}

export function DayScheduleCatalog() {
  const [date, setDate] = useState<LocalDate>(() => currentLocalDate());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [lastChange, setLastChange] = useState<LocalDate | null>(null);
  const [eventOverrides, setEventOverrides] = useState<Record<string, { startMinutes: number; durationMinutes: number }>>({});
  const value = getDayScheduleValue(date);
  const eventsByDate = useMemo(() => Object.fromEntries(
    Array.from({ length: 15 }, (_, index) => {
      const day = addDays(date, index - 7);
      return [day, empty ? [] : demoDay(day).map(event => ({ ...event, ...(eventOverrides[event.id] ?? {}) }))];
    }),
  ), [date, empty, eventOverrides]);

  return (
    <section className="ui-kit-day-schedule" aria-label="DaySchedule">
      <h2>DaySchedule</h2>
      <p>Только неделя и сетка дня. Navbar и его действия принадлежат экрану приложения.</p>
      <div className="ui-kit-day-schedule__controls">
        <Button onClick={() => setPickerOpen(true)}>Выбрать дату</Button>
        <Button onClick={() => setEmpty(previous => !previous)}>{empty ? 'Показать события' : 'Пустой день'}</Button>
      </div>
      <div className="ui-kit-day-schedule__value" aria-live="polite">
        <div>value.date: {value.date}</div>
        <div>value.title для Navbar: {value.title}</div>
        <div>value.weekdayIndex: {value.weekdayIndex} · value.isToday: {String(value.isToday)}</div>
        <div>Последний onDateChange: {lastChange ?? 'ещё не вызван'}</div>
      </div>
      <DaySchedule
        className="ui-kit-day-schedule__preview"
        date={date}
        eventsByDate={eventsByDate}
        onDateChange={next => { setLastChange(next); setDate(next); }}
        onEventMove={({ eventId, date: eventDate, startMinutes }) => setEventOverrides(current => ({
          ...current,
          [eventId]: {
            startMinutes,
            durationMinutes: current[eventId]?.durationMinutes
              ?? eventsByDate[eventDate]?.find(event => event.id === eventId)?.durationMinutes
              ?? 60,
          },
        }))}
        onEventResize={({ eventId, startMinutes, durationMinutes }) => setEventOverrides(current => ({
          ...current,
          [eventId]: { startMinutes, durationMinutes },
        }))}
        renderEvent={(event, state) => (
          <DayScheduleEventCard
            title={event.title}
            detail={event.purpose}
            media={<Avatar name={event.title} />}
            state={state}
          />
        )}
      />
      <DatePicker opened={pickerOpen} value={date} onChange={next => { setDate(next); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />
      <div className="ui-kit-day-schedule__contract">
        <h3>Входные параметры</h3>
        <dl>
          <dt>date: LocalDate</dt><dd>Выбранная дата YYYY-MM-DD. Ею управляет родитель.</dd>
          <dt>eventsByDate: Record&lt;LocalDate, Event[]&gt;</dt><dd>События по датам: id, startMinutes, durationMinutes и любые поля вашей карточки. Нужны соседние дни и дни соседних недель.</dd>
          <dt>renderEvent(event, state)</dt><dd>Рендер события внутри рассчитанной рамки. state содержит compact, lifted, editing, height, startMinutes и durationMinutes; поэтому normal, lifted и resize-состояния используют одинаковый контент и типографику.</dd>
          <dt>onEventMove(move)?</dt><dd>Включает long-press drag событий. Удержание активируется через 300 ms с допуском движения пальца 24 px; DnD привязывает новое startMinutes к сетке 15 минут. Горизонтальный drag снапит экран на соседний день и передаёт targetDate; если слот пересекается с другим событием, drop отклоняется.</dd>
          <dt>onEventResize(resize)?</dt><dd>После успешного DnD карточка входит в resize-режим. Верхняя правая точка меняет начало, нижняя левая — окончание. Resize работает по сетке 15 минут и не допускает пересечений с соседними событиями.</dd>
          <dt>today?: LocalDate</dt><dd>Дата для индикатора текущего времени; по умолчанию локальная дата устройства.</dd>
          <dt>className?: string</dt><dd>Класс контейнера, например для высоты под внешним Navbar. По умолчанию высота равна viewport.</dd>
        </dl>
        <h3>Выходные параметры</h3>
        <dl>
          <dt>onDateChange(nextDate)</dt><dd>Запрос смены даты после тапа или свайпа. Родитель синхронно принимает значение через setDate.</dd>
          <dt>getDayScheduleValue(date, today?)</dt><dd>Возвращает {'{ date, title, weekdayIndex, isToday }'} для внешнего Navbar, в том числе до первого жеста. Это производные данные, не второе состояние.</dd>
        </dl>
        <p>Демо создаёт события для любой выбранной даты. Диапазон: 06:00–24:00, 112 px/час. Фон календаря чёрный. Обычная карточка полупрозрачна через --ui-day-schedule-event-card-color; lifted-состояние сохраняет тот же ListItem-контент на GlassSurface; resize-состояние делает карточку непрозрачной. Тап вне выбранной карточки завершает resize-режим.</p>
        <pre>{`<DaySchedule\n  date={date}\n  onDateChange={setDate}\n  onEventMove={handleEventMove}\n  onEventResize={handleEventResize}\n  eventsByDate={events}\n  renderEvent={(event, state) => (\n    <DayScheduleEventCard title={event.title} detail={event.type} state={state} />\n  )}\n/>`}</pre>
      </div>
    </section>
  );
}
