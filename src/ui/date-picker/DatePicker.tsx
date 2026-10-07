import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { Link, Navbar } from 'konsta/react';
import { GlassSurface } from '../GlassSurface';
import { LiquidPopover, type LiquidPopoverItem } from '../LiquidPopover';
import type { GlassMaterialOverrides, GlassPresetName } from '../glassMaterial';
import { MEZFIT_NAVBAR_GLASS_PRESET } from '../mezfitNavbarConfig';
import { MezfitTopPanel } from '../konsta-mezfit/TopPanel';
import { Text } from '../primitives';
import { MezfitSidePanel } from '../konsta-mezfit';
import {
  buildMonthGrid,
  clampYear,
  formatDayLabel,
  formatLocalDate,
  formatMonthName,
  getTodayLocalDate,
  getWeekdayLabels,
  parseLocalDate,
  prewarmDateFormatters,
  type LocalDate,
  type LocalDateParts,
} from './datePickerDate';
import './date-picker.css';

const DEFAULT_MIN_YEAR = 1950;
const DEFAULT_MAX_YEAR = 2049;
const MONTH_COUNT = 12;
const HEADER_SCROLL_OFFSET = 78;

export type DatePickerSurface = 'bare' | 'panel' | 'top-panel';
export type DatePickerDayStatus = 'scheduled' | 'completed' | 'missed';

export interface DatePickerDayStatusEntry {
  date: LocalDate;
  status: DatePickerDayStatus;
}

const DAY_STATUS_ACCESSIBLE_LABELS: Record<DatePickerDayStatus, string> = {
  scheduled: 'назначена тренировка',
  completed: 'тренировочная сессия завершена',
  missed: 'плановая тренировка пропущена',
};

const EMPTY_DAY_STATUSES: readonly DatePickerDayStatusEntry[] = [];

function isDatePickerDayStatus(value: unknown): value is DatePickerDayStatus {
  return value === 'scheduled' || value === 'completed' || value === 'missed';
}

export interface DatePickerProps {
  opened: boolean;
  value: LocalDate;
  onChange: (value: LocalDate) => void;
  onClose: () => void;
  minYear?: number;
  maxYear?: number;
  locale?: string;
  surface?: DatePickerSurface;
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
  topPanelBlur?: number;
  topPanelMaterialPreset?: GlassPresetName;
  topPanelMaterial?: GlassMaterialOverrides;
  topPanelMaterialOptics?: boolean;
  dayStatuses?: readonly DatePickerDayStatusEntry[];
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

const CalendarMonths = memo(function CalendarMonths({
  visibleYear,
  selectedDate,
  locale,
  weekdayLabels,
  onChooseDate,
  horizontal,
  todayDate,
  dayStatusByDate,
}: {
  visibleYear: number;
  selectedDate: LocalDateParts;
  locale: string;
  weekdayLabels: readonly string[];
  onChooseDate: (monthIndex: number, day: number) => void;
  horizontal: boolean;
  todayDate?: LocalDate;
  dayStatusByDate?: ReadonlyMap<LocalDate, DatePickerDayStatus>;
}) {
  return (
    <div className={`ui-date-picker__months${horizontal ? ' ui-date-picker__months--horizontal' : ''}`}>
      {Array.from({ length: MONTH_COUNT }, (_, monthIndex) => (
        <section className={`ui-date-picker__month${horizontal ? ' ui-date-picker__month--horizontal' : ''}`} data-month-index={monthIndex} key={monthIndex}>
          {horizontal ? null : (
            <h2 className="ui-date-picker__month-title ui-text--title">
              {formatMonthName(visibleYear, monthIndex, locale)}
            </h2>
          )}
          <div className="ui-date-picker__weekdays ui-text--footnote" aria-hidden="true">
            {weekdayLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          <div className="ui-date-picker__days">
            {buildMonthGrid(visibleYear, monthIndex).map((cell, cellIndex) => {
              const day = cell.day;
              if (day === null) {
                return <span className="ui-date-picker__empty-day" aria-hidden="true" key={`empty-${cellIndex}`} />;
              }

              const date = formatLocalDate(visibleYear, monthIndex + 1, day);
              const isSelected = selectedDate.year === visibleYear
                && selectedDate.month === monthIndex + 1
                && selectedDate.day === day;
              const isToday = horizontal && date === todayDate;
              const dayStatus = horizontal ? dayStatusByDate?.get(date) : undefined;
              const statusClassName = dayStatus ? ` ui-date-picker__day--status-${dayStatus}` : '';
              const accessibleQualifiers = [
                isToday ? 'сегодня' : null,
                dayStatus ? DAY_STATUS_ACCESSIBLE_LABELS[dayStatus] : null,
              ].filter((label): label is string => label !== null);
              const accessibleLabel = [
                formatDayLabel(visibleYear, monthIndex, day, locale),
                ...accessibleQualifiers,
              ].join(', ');

              return (
                <button
                  type="button"
                  className={`ui-date-picker__day ui-text--body${isSelected ? ' ui-date-picker__day--selected' : ''}${isToday ? ' ui-date-picker__day--today' : ''}${statusClassName}`}
                  aria-label={accessibleLabel}
                  aria-current={isSelected ? 'date' : undefined}
                  data-day-status={dayStatus}
                  data-today={isToday ? 'true' : undefined}
                  onClick={() => onChooseDate(monthIndex, day)}
                  key={day}
                >
                  <span className="ui-date-picker__day-label">{day}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
});

const YearTriggerButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => <button {...props} ref={ref} type="button" />);
YearTriggerButton.displayName = 'DatePickerYearTrigger';

export function DatePicker({
  opened,
  value,
  onChange,
  onClose,
  minYear = DEFAULT_MIN_YEAR,
  maxYear = DEFAULT_MAX_YEAR,
  locale = 'ru-RU',
  surface = 'bare',
  glassPreset = MEZFIT_NAVBAR_GLASS_PRESET,
  glassOptics = false,
  topPanelBlur,
  topPanelMaterialPreset,
  topPanelMaterial,
  topPanelMaterialOptics = false,
  dayStatuses = EMPTY_DAY_STATUSES,
}: DatePickerProps) {
  const rangeIsValid = Number.isInteger(minYear) && Number.isInteger(maxYear) && minYear <= maxYear;
  const safeMinYear = rangeIsValid ? minYear : DEFAULT_MIN_YEAR;
  const safeMaxYear = rangeIsValid ? maxYear : DEFAULT_MAX_YEAR;
  const selectedDate = useMemo(() => parseLocalDate(value), [value]);
  const safeSelectedDate = selectedDate ?? { year: safeMinYear, month: 1, day: 1 };
  const todayDate = getTodayLocalDate();
  const todayParts = parseLocalDate(todayDate) ?? safeSelectedDate;

  const [visibleYear, setVisibleYear] = useState(() => clampYear(safeSelectedDate.year, safeMinYear, safeMaxYear));
  const [visibleMonthIndex, setVisibleMonthIndex] = useState(() => safeSelectedDate.month - 1);
  const [surfaceContentReady, setSurfaceContentReady] = useState(false);
  const [surfaceReadyToOpen, setSurfaceReadyToOpen] = useState(false);
  const [yearPopoverRequested, setYearPopoverRequested] = useState(false);
  const [yearPopoverContentReady, setYearPopoverContentReady] = useState(false);
  const [yearPopoverReadyToOpen, setYearPopoverReadyToOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  const onCloseRef = useRef(onClose);
  const yearTargetRef = useRef<HTMLElement | null>(null);
  const monthScrollRef = useRef<HTMLDivElement | null>(null);
  const currentMonthIndexRef = useRef(safeSelectedDate.month - 1);
  const wasOpenedRef = useRef(false);

  onChangeRef.current = onChange;
  onCloseRef.current = onClose;

  const weekdayLabels = useMemo(() => {
    prewarmDateFormatters(locale);
    return getWeekdayLabels(locale);
  }, [locale]);
  const years = useMemo(
    () => Array.from({ length: safeMaxYear - safeMinYear + 1 }, (_, index) => safeMinYear + index),
    [safeMaxYear, safeMinYear],
  );
  const dayStatusByDate = useMemo(() => {
    const next = new Map<LocalDate, DatePickerDayStatus>();
    dayStatuses.forEach(({ date, status }) => {
      if (parseLocalDate(date) && isDatePickerDayStatus(status)) next.set(date, status);
    });
    return next;
  }, [dayStatuses]);
  const effectiveSurfaceOpened = opened && surfaceReadyToOpen;
  const effectiveYearPopoverOpened = effectiveSurfaceOpened
    && yearPopoverRequested
    && yearPopoverReadyToOpen;

  useEffect(() => {
    if (!opened) {
      setYearPopoverRequested(false);
      wasOpenedRef.current = false;
      return;
    }

    if (surfaceReadyToOpen) return;

    if (!surfaceContentReady) {
      setSurfaceContentReady(true);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setSurfaceReadyToOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [opened, surfaceContentReady, surfaceReadyToOpen]);

  useEffect(() => {
    if (!effectiveSurfaceOpened) return;

    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    if (!justOpened) return;

    const selectedMonthIndex = safeSelectedDate.month - 1;
    currentMonthIndexRef.current = selectedMonthIndex;
    setVisibleMonthIndex(selectedMonthIndex);
    setVisibleYear(clampYear(safeSelectedDate.year, safeMinYear, safeMaxYear));
    setYearPopoverRequested(false);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollElement = monthScrollRef.current;
        if (!scrollElement) return;

        if (surface === 'top-panel') {
          scrollElement.scrollLeft = selectedMonthIndex * scrollElement.clientWidth;
          return;
        }

        const monthElement = scrollElement.querySelector<HTMLElement>(`[data-month-index="${selectedMonthIndex}"]`);
        if (!monthElement) return;
        scrollElement.scrollTop = Math.max(0, monthElement.offsetTop - HEADER_SCROLL_OFFSET);
      });
    });
  }, [effectiveSurfaceOpened, safeMaxYear, safeMinYear, safeSelectedDate.month, safeSelectedDate.year, surface]);

  useEffect(() => {
    if (!opened || !yearPopoverRequested || yearPopoverReadyToOpen) return;

    if (!yearPopoverContentReady) {
      setYearPopoverContentReady(true);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setYearPopoverReadyToOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [opened, yearPopoverContentReady, yearPopoverReadyToOpen, yearPopoverRequested]);

  if (!rangeIsValid) throw new Error('DatePicker requires a valid minYear/maxYear range');
  if (!selectedDate) throw new Error('DatePicker value must be a valid YYYY-MM-DD local date');
  if (selectedDate.year < minYear || selectedDate.year > maxYear) {
    throw new Error('DatePicker value must be inside the configured year range');
  }

  const todayIsAvailable = todayParts.year >= safeMinYear && todayParts.year <= safeMaxYear;

  const scrollTopPanelToMonth = useCallback((monthIndex: number) => {
    currentMonthIndexRef.current = monthIndex;
    setVisibleMonthIndex(monthIndex);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollElement = monthScrollRef.current;
        if (!scrollElement) return;
        scrollElement.scrollLeft = monthIndex * scrollElement.clientWidth;
      });
    });
  }, []);

  const chooseDate = useCallback((monthIndex: number, day: number) => {
    onChangeRef.current(formatLocalDate(visibleYear, monthIndex + 1, day));
    setYearPopoverRequested(false);
    if (surface !== 'top-panel') onCloseRef.current();
  }, [surface, visibleYear]);

  const goToToday = useCallback(() => {
    if (!todayIsAvailable) return;
    setYearPopoverRequested(false);
    setVisibleYear(todayParts.year);
    onChangeRef.current(todayDate);
    scrollTopPanelToMonth(todayParts.month - 1);
  }, [scrollTopPanelToMonth, todayDate, todayIsAvailable, todayParts.month, todayParts.year]);

  const yearItems = useMemo<LiquidPopoverItem[]>(
    () => years.map((year) => ({
      id: String(year),
      label: String(year),
      active: year === visibleYear,
      'aria-current': year === visibleYear ? 'date' : undefined,
      onSelect: () => {
        setVisibleYear(year);
        if (surface === 'top-panel') scrollTopPanelToMonth(currentMonthIndexRef.current);
      },
    })),
    [scrollTopPanelToMonth, surface, visibleYear, years],
  );

  const yearTrigger = (
    <LiquidPopover
      isOpen={effectiveYearPopoverOpened}
      onOpenChange={setYearPopoverRequested}
      trigger={(
        <GlassSurface
          component={YearTriggerButton}
          ref={yearTargetRef}
          preset={glassPreset}
          optics={glassOptics}
          wrapContent={false}
          shape="capsule"
          className="ui-date-picker__year-trigger ui-text--body"
          aria-label={`Выбрать год, сейчас ${visibleYear}`}
        >
          {visibleYear}
        </GlassSurface>
      )}
      triggerRef={yearTargetRef}
      items={yearPopoverContentReady ? yearItems : []}
      label="Выберите год"
      preset={glassPreset}
      optics={false}
      layout="grid"
      columns={4}
      role="dialog"
      scrollActiveIntoView
    />
  );

  const closeAction = (
    <Link
      component="button"
      iconOnly
      linkProps={{ type: 'button', disabled: yearPopoverRequested }}
      aria-disabled={yearPopoverRequested}
      aria-label="Закрыть календарь"
      onClick={yearPopoverRequested ? undefined : onClose}
    >
      <CloseIcon />
    </Link>
  );

  const todayAction = (
    <GlassSurface
      component={YearTriggerButton}
      preset={glassPreset}
      optics={glassOptics}
      wrapContent={false}
      shape="capsule"
      className="ui-date-picker__today-trigger ui-text--body"
      aria-disabled={!todayIsAvailable}
      aria-label="Сегодня"
      onClick={todayIsAvailable ? goToToday : undefined}
    >
      Сегодня
    </GlassSurface>
  );

  const calendarContent = (
    <div className="ui-date-picker__scroll" ref={monthScrollRef}>
      <div className="ui-date-picker__header-blur" aria-hidden="true" />
      <Navbar
        className="ui-date-picker__navbar"
        centerTitle
        outline={false}
        title={yearTrigger}
        right={closeAction}
      />

      {surfaceContentReady ? (
        <CalendarMonths
          visibleYear={visibleYear}
          selectedDate={selectedDate}
          locale={locale}
          weekdayLabels={weekdayLabels}
          onChooseDate={chooseDate}
          horizontal={false}
        />
      ) : null}
    </div>
  );

  const topPanelContent = (
    <div className="ui-date-picker__top-content">
      <div className="ui-date-picker__top-toolbar">
        <div className="ui-date-picker__top-toolbar-start">
          {yearTrigger}
        </div>
        <Text variant="title" className="ui-date-picker__top-month">
          {formatMonthName(visibleYear, visibleMonthIndex, locale)}
        </Text>
        <div className="ui-date-picker__top-toolbar-end">
          {todayAction}
        </div>
      </div>

      <div
        className="ui-date-picker__scroll ui-date-picker__scroll--horizontal"
        ref={monthScrollRef}
        onScroll={(event) => {
          const width = event.currentTarget.clientWidth;
          if (width <= 0) return;
          const monthIndex = Math.max(
            0,
            Math.min(MONTH_COUNT - 1, Math.round(event.currentTarget.scrollLeft / width)),
          );
          currentMonthIndexRef.current = monthIndex;
          setVisibleMonthIndex(monthIndex);
        }}
      >
        {surfaceContentReady ? (
          <CalendarMonths
            visibleYear={visibleYear}
            selectedDate={selectedDate}
            locale={locale}
            weekdayLabels={weekdayLabels}
            onChooseDate={chooseDate}
            horizontal
            todayDate={todayDate}
            dayStatusByDate={dayStatusByDate}
          />
        ) : null}
      </div>
    </div>
  );

  if (surface === 'top-panel') {
    return (
      <MezfitTopPanel
        opened={effectiveSurfaceOpened}
        onClose={onClose}
        blur={topPanelBlur}
        materialPreset={topPanelMaterialPreset}
        material={topPanelMaterial}
        materialOptics={topPanelMaterialOptics}
        data-date-picker-surface="top-panel"
        role="dialog"
        aria-label="Выбор даты"
      >
        {topPanelContent}
      </MezfitTopPanel>
    );
  }

  return (
    <MezfitSidePanel
      side="right"
      opened={effectiveSurfaceOpened}
      floating
      backdrop
      surface={surface === 'bare' ? 'bare' : 'glass'}
      backdropClassName={surface === 'bare' ? 'ui-date-picker__bare-backdrop' : undefined}
      className={surface === 'bare' ? 'ui-date-picker__bare-surface' : undefined}
      data-date-picker-surface={surface}
      onBackdropClick={yearPopoverRequested ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Выбор даты"
    >
      {calendarContent}
    </MezfitSidePanel>
  );
}

export type { LocalDate };
