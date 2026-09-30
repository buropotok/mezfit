import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button as KonstaButton, Glass, Link, Navbar } from 'konsta/react';
import { MezfitPopover, MezfitSidePanel } from '../konsta-mezfit';
import {
  buildMonthGrid,
  calculateCenteredScrollTop,
  clampYear,
  formatDayLabel,
  formatLocalDate,
  formatMonthName,
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

export interface DatePickerProps {
  opened: boolean;
  value: LocalDate;
  onChange: (value: LocalDate) => void;
  onClose: () => void;
  minYear?: number;
  maxYear?: number;
  locale?: string;
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
}: {
  visibleYear: number;
  selectedDate: LocalDateParts;
  locale: string;
  weekdayLabels: readonly string[];
  onChooseDate: (monthIndex: number, day: number) => void;
}) {
  return (
    <div className="ui-date-picker__months">
      {Array.from({ length: MONTH_COUNT }, (_, monthIndex) => (
        <section className="ui-date-picker__month" data-month-index={monthIndex} key={monthIndex}>
          <h2 className="ui-date-picker__month-title">
            {formatMonthName(visibleYear, monthIndex, locale)}
          </h2>
          <div className="ui-date-picker__weekdays" aria-hidden="true">
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

              const isSelected = selectedDate.year === visibleYear
                && selectedDate.month === monthIndex + 1
                && selectedDate.day === day;

              return (
                <button
                  type="button"
                  className={`ui-date-picker__day${isSelected ? ' ui-date-picker__day--selected' : ''}`}
                  aria-label={formatDayLabel(visibleYear, monthIndex, day, locale)}
                  aria-current={isSelected ? 'date' : undefined}
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

const YearGrid = memo(function YearGrid({
  years,
  visibleYear,
  onChooseYear,
}: {
  years: readonly number[];
  visibleYear: number;
  onChooseYear: (year: number) => void;
}) {
  return (
    <div className="ui-date-picker__year-grid">
      {years.map((year) => {
        const selected = year === visibleYear;
        return (
          <KonstaButton
            key={year}
            data-year={year}
            clear={!selected}
            tonal={selected}
            rounded
            colors={{
              textIos: 'text-white',
              clearBgIos: 'bg-transparent active:bg-white/10',
              tonalTextIos: 'text-white',
              tonalBgIos: 'bg-white/14 active:bg-white/20',
            }}
            aria-current={selected ? 'date' : undefined}
            onClick={() => onChooseYear(year)}
          >
            {year}
          </KonstaButton>
        );
      })}
    </div>
  );
});

export function DatePicker({
  opened,
  value,
  onChange,
  onClose,
  minYear = DEFAULT_MIN_YEAR,
  maxYear = DEFAULT_MAX_YEAR,
  locale = 'ru-RU',
}: DatePickerProps) {
  const rangeIsValid = Number.isInteger(minYear) && Number.isInteger(maxYear) && minYear <= maxYear;
  const safeMinYear = rangeIsValid ? minYear : DEFAULT_MIN_YEAR;
  const safeMaxYear = rangeIsValid ? maxYear : DEFAULT_MAX_YEAR;
  const selectedDate = useMemo(() => parseLocalDate(value), [value]);
  const safeSelectedDate = selectedDate ?? { year: safeMinYear, month: 1, day: 1 };

  const [visibleYear, setVisibleYear] = useState(() => clampYear(safeSelectedDate.year, safeMinYear, safeMaxYear));
  const [panelContentReady, setPanelContentReady] = useState(false);
  const [panelReadyToOpen, setPanelReadyToOpen] = useState(false);
  const [yearPopoverRequested, setYearPopoverRequested] = useState(false);
  const [yearPopoverContentReady, setYearPopoverContentReady] = useState(false);
  const [yearPopoverReadyToOpen, setYearPopoverReadyToOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  const onCloseRef = useRef(onClose);
  const yearTargetRef = useRef<HTMLButtonElement | null>(null);
  const monthScrollRef = useRef<HTMLDivElement | null>(null);
  const yearScrollRef = useRef<HTMLDivElement | null>(null);
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
  const effectivePanelOpened = opened && panelReadyToOpen;
  const effectiveYearPopoverOpened = effectivePanelOpened
    && yearPopoverRequested
    && yearPopoverReadyToOpen;

  useEffect(() => {
    if (!opened) {
      setYearPopoverRequested(false);
      wasOpenedRef.current = false;
      return;
    }

    if (panelReadyToOpen) return;

    if (!panelContentReady) {
      setPanelContentReady(true);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setPanelReadyToOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [opened, panelContentReady, panelReadyToOpen]);

  useEffect(() => {
    if (!effectivePanelOpened) return;

    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    if (!justOpened) return;

    setVisibleYear(clampYear(safeSelectedDate.year, safeMinYear, safeMaxYear));
    setYearPopoverRequested(false);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollElement = monthScrollRef.current;
        const monthElement = scrollElement?.querySelector<HTMLElement>(`[data-month-index="${safeSelectedDate.month - 1}"]`);
        if (!scrollElement || !monthElement) return;
        scrollElement.scrollTop = Math.max(0, monthElement.offsetTop - HEADER_SCROLL_OFFSET);
      });
    });
  }, [effectivePanelOpened, safeMaxYear, safeMinYear, safeSelectedDate.month, safeSelectedDate.year]);

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

  useEffect(() => {
    if (!effectiveYearPopoverOpened) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollElement = yearScrollRef.current;
        const yearElement = scrollElement?.querySelector<HTMLElement>(`[data-year="${visibleYear}"]`);
        if (!scrollElement || !yearElement) return;

        const scrollRect = scrollElement.getBoundingClientRect();
        const yearRect = yearElement.getBoundingClientRect();
        const targetOffset = scrollElement.scrollTop + yearRect.top - scrollRect.top;

        scrollElement.scrollTop = calculateCenteredScrollTop({
          targetOffset,
          targetHeight: yearRect.height || yearElement.offsetHeight,
          viewportHeight: scrollElement.clientHeight,
          scrollHeight: scrollElement.scrollHeight,
        });
      });
    });
  }, [effectiveYearPopoverOpened, visibleYear]);

  if (!rangeIsValid) throw new Error('DatePicker requires a valid minYear/maxYear range');
  if (!selectedDate) throw new Error('DatePicker value must be a valid YYYY-MM-DD local date');
  if (selectedDate.year < minYear || selectedDate.year > maxYear) {
    throw new Error('DatePicker value must be inside the configured year range');
  }

  const chooseDate = useCallback((monthIndex: number, day: number) => {
    onChangeRef.current(formatLocalDate(visibleYear, monthIndex + 1, day));
    setYearPopoverRequested(false);
    onCloseRef.current();
  }, [visibleYear]);

  const chooseYear = useCallback((year: number) => {
    setVisibleYear(year);
    setYearPopoverRequested(false);
  }, []);

  const yearTrigger = (
    <Glass
      component="button"
      ref={yearTargetRef}
      className="ui-date-picker__year-trigger"
      aria-label={`Выбрать год, сейчас ${visibleYear}`}
      aria-expanded={effectiveYearPopoverOpened}
      onClick={(event) => {
        event.preventDefault();
        setYearPopoverRequested((current) => !current);
      }}
    >
      {visibleYear}
    </Glass>
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

  return (
    <>
      <MezfitSidePanel
        side="right"
        opened={effectivePanelOpened}
        floating
        backdrop
        onBackdropClick={yearPopoverRequested ? undefined : onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Выбор даты"
      >
        <div className="ui-date-picker__scroll" ref={monthScrollRef}>
          <div className="ui-date-picker__header-blur" aria-hidden="true" />
          <Navbar
            className="ui-date-picker__navbar"
            centerTitle
            outline={false}
            title={yearTrigger}
            right={closeAction}
          />

          {panelContentReady ? (
            <CalendarMonths
              visibleYear={visibleYear}
              selectedDate={selectedDate}
              locale={locale}
              weekdayLabels={weekdayLabels}
              onChooseDate={chooseDate}
            />
          ) : null}
        </div>
      </MezfitSidePanel>

      <MezfitPopover
        opened={effectiveYearPopoverOpened}
        target={yearTargetRef.current ?? undefined}
        angle={false}
        backdrop
        onBackdropClick={() => setYearPopoverRequested(false)}
        style={{ width: '284px', maxWidth: 'calc(100vw - 24px)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Выберите год"
      >
        <div className="ui-date-picker__year-popover">
          <div className="ui-date-picker__year-scroll" ref={yearScrollRef}>
            {yearPopoverContentReady ? (
              <YearGrid
                years={years}
                visibleYear={visibleYear}
                onChooseYear={chooseYear}
              />
            ) : null}
          </div>
        </div>
      </MezfitPopover>
    </>
  );
}

export type { LocalDate };
