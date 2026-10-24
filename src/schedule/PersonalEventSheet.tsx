import { useEffect, useRef, useState } from 'react';
import { Button, List, ListInput } from 'konsta/react';
import { DatePicker, MezfitBottomSheet, MezfitDialog, MezfitDialogButton, Text,
  TimePicker, type LocalDate, type LocalTime } from '../ui';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import type { PersonalEventRepository, PersonalEventInput } from '../data/cloud/personal-events';
import { calendarDate, calendarTime, localScheduleEnd, localScheduleInstant } from './calendar-time';
import './personal-event-sheet.css';

type Picker = 'start' | 'end' | null;

// In Konsta 5.4.0, ListInput's bgIos slot applies only without outline.
// The outlined input is transparent, so its List owns the black surface instead.
const EVENT_LIST_COLORS = { strongBgIos: 'bg-black' };
const EVENT_FIELD_COLORS = {
  bgIos: 'bg-black',
  outlineLabelBgIos: 'bg-black',
};

export function PersonalEventSheet({ opened, event, date, repository, onClose, onSaved }: {
  opened: boolean;
  event: CloudWorkoutOccurrenceRow | null;
  date: LocalDate;
  repository: PersonalEventRepository | null;
  onClose: () => void;
  onSaved: (startsAtUtc: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedDate, setSelectedDate] = useState<LocalDate>(date);
  const [startTime, setStartTime] = useState<LocalTime>('09:00' as LocalTime);
  const [endTime, setEndTime] = useState<LocalTime>('10:00' as LocalTime);
  const [dateOpened, setDateOpened] = useState(false);
  const [timeOpened, setTimeOpened] = useState<Picker>(null);
  const [deleteOpened, setDeleteOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const generation = useRef(0);
  const startRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const token = ++generation.current;
    if (!opened) return;
    setTitle(event?.plan.name ?? '');
    setNotes(event?.plan.comment ?? '');
    const start = event ? new Date(event.startsAtUtc) : null;
    const end = event ? new Date(Date.parse(event.startsAtUtc) + event.durationMinutes * 60_000) : null;
    setSelectedDate(start ? calendarDate(start) as LocalDate : date);
    setStartTime(start ? calendarTime(start) as LocalTime : '09:00' as LocalTime);
    setEndTime(end ? calendarTime(end) as LocalTime : '10:00' as LocalTime);
    setDateOpened(false); setTimeOpened(null); setDeleteOpened(false);
    setError(''); setBusy(false); running.current = false;
    return () => { if (generation.current === token) generation.current++; };
  }, [opened, event?.id, date]);

  const timing = (): PersonalEventInput => {
    const startsAtUtc = localScheduleInstant(selectedDate, startTime);
    const endUtc = localScheduleEnd(new Date(startsAtUtc), endTime);
    const durationMinutes = (Date.parse(endUtc) - Date.parse(startsAtUtc)) / 60_000;
    return { title, notes: notes.trim() || null, startsAtUtc, durationMinutes };
  };

  const save = async () => {
    if (!repository || running.current) return;
    running.current = true; setBusy(true); setError('');
    const token = generation.current;
    try {
      const input = timing();
      if (event) await repository.update(event.id, input);
      else await repository.create(input);
      if (generation.current === token) onSaved(input.startsAtUtc);
    } catch (reason) {
      if (generation.current === token)
        setError(reason instanceof Error ? reason.message : 'Не удалось сохранить событие');
    } finally {
      if (generation.current === token) { running.current = false; setBusy(false); }
    }
  };

  const remove = async () => {
    if (!repository || !event || running.current) return;
    running.current = true; setBusy(true); setError('');
    const token = generation.current;
    try {
      await repository.cancel(event.id);
      if (generation.current === token) { setDeleteOpened(false); onClose(); }
    } catch (reason) {
      if (generation.current === token) {
        setDeleteOpened(false);
        setError(reason instanceof Error ? reason.message : 'Не удалось удалить событие');
      }
    } finally {
      if (generation.current === token) { running.current = false; setBusy(false); }
    }
  };

  return <>
    <MezfitBottomSheet opened={opened} label={event ? 'Редактировать событие' : 'Новое событие'} lazyMount>
      <section className="personal-event-sheet">
        <header className="personal-event-sheet__header">
          <Text variant="headline">{event ? 'Редактировать событие' : 'Новое событие'}</Text>
          <Button clear inline disabled={busy} onClick={onClose}><Text variant="body">Назад</Text></Button>
        </header>
        <div className="personal-event-sheet__body">
          <Text variant="footnote" tone="muted">Личное событие. Видно только вам и занимает время в расписании.</Text>
          <List nested strong dividers={false} colors={EVENT_LIST_COLORS}>
            <ListInput type="text" label="Название" floatingLabel outline
              colors={EVENT_FIELD_COLORS} disabled={busy} maxLength={120}
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Например, личные дела" />
          </List>
          <div className="personal-event-sheet__timing">
            <Text variant="footnote" tone="muted">Дата</Text>
            <Button tonal disabled={busy} onClick={() => setDateOpened(true)}><Text variant="body">{selectedDate}</Text></Button>
          </div>
          <div className="personal-event-sheet__time-row">
            <div className="personal-event-sheet__timing">
              <Text variant="footnote" tone="muted">Начало</Text>
              <span ref={startRef}><Button tonal disabled={busy} onClick={() => setTimeOpened('start')}><Text variant="body">{startTime}</Text></Button></span>
            </div>
            <div className="personal-event-sheet__timing">
              <Text variant="footnote" tone="muted">Окончание</Text>
              <span ref={endRef}><Button tonal disabled={busy} onClick={() => setTimeOpened('end')}><Text variant="body">{endTime}</Text></Button></span>
            </div>
          </div>
          <Text variant="caption" tone="muted">Если окончание не позже начала, событие заканчивается на следующий день.</Text>
          <List nested strong dividers={false} colors={EVENT_LIST_COLORS}>
            <ListInput type="textarea" label="Описание (необязательно)" floatingLabel outline
              colors={EVENT_FIELD_COLORS} disabled={busy} maxLength={4000}
              value={notes} onChange={e => setNotes(e.target.value)} />
          </List>
          {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
        </div>
        <footer className="personal-event-sheet__footer">
          {event ? <Button tonal disabled={busy} onClick={() => setDeleteOpened(true)}><Text variant="body">Удалить</Text></Button> : <span />}
          <Button disabled={busy || !repository || !title.trim()} onClick={() => void save()}>
            <Text variant="body">{busy ? 'Сохраняем…' : event ? 'Сохранить' : 'Создать событие'}</Text>
          </Button>
        </footer>
      </section>
    </MezfitBottomSheet>
    <DatePicker opened={opened && dateOpened} value={selectedDate} onChange={value => {
      setSelectedDate(value); setDateOpened(false);
    }} onClose={() => setDateOpened(false)} />
    <TimePicker opened={opened && timeOpened === 'start'} value={startTime} target={startRef.current}
      onChange={setStartTime} onClose={() => setTimeOpened(null)} />
    <TimePicker opened={opened && timeOpened === 'end'} value={endTime} target={endRef.current}
      onChange={setEndTime} onClose={() => setTimeOpened(null)} />
    <MezfitDialog opened={opened && deleteOpened} title="Удалить личное событие?"
      content="Событие исчезнет из расписания и освободит время."
      buttons={<>
        <MezfitDialogButton onClick={() => setDeleteOpened(false)}><Text variant="body">Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton tone="danger" strong onClick={() => void remove()}><Text variant="body">Удалить</Text></MezfitDialogButton>
      </>} />
  </>;
}
