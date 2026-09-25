import { useEffect, useMemo, useRef, useState } from 'react';
import { Button as KonstaButton, Glass, Link, Navbar, Panel, Popover } from 'konsta/react';
import {
  buildMonthGrid,
  calculateCenteredScrollTop,
  clampYear,
  formatDayLabel,
  formatLocalDate,
  formatMonthName,
  getWeekdayLabels,
  parseLocalDate,
  type LocalDate,
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
  const [yearPopoverOpened, setYearPopoverOpened] = useState(false);
  const yearTargetRef = useRef<HTMLButtonElement | null>(null);
  const monthScrollRef = useRef<HTMLDivElement | null>(null);
  const yearScrollRef = useRef<HTMLDivElement | null>(null);
  const wasOpenedRef = useRef(false);

  const weekdayLabels = useMemo(() => getWeekdayLabels(locale), [locale]);
  const years = useMemo(
    () => Array.from({ length: safeMaxYear - safeMinYear + 1 }, (_, index) => safeMinYear + index),
    [safeMaxYear, safeMinYear],
  );

  useEffect(() => {
    if (!opened) {
      setYearPopoverOpened(false);
      wasOpenedRef.current = false;
      return;
    }

    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    if (!justOpened) return;

    setVisibleYear(clampYear(safeSelectedDate.year, safeMinYear, safeMaxYear));
    setYearPopoverOpened(false);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollElement = monthScrollRef.current;
        const monthElement = scrollElement?.querySelector<HTMLElement>(`[data-month-index="${safeSelectedDate.month - 1}"]`);
        if (!scrollElement || !monthElement) return;
        scrollElement.scrollTop = Math.max(0, monthElement.offsetTop - HEADER_SCROLL_OFFSET);
      });
    });
  }, [opened, safeMaxYear, safeMinYear, safeSelectedDate.month, safeSelectedDate.year]);

  useEffect(() => {
    if (!yearPopoverOpened) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollElement = yearScrollRef.current;
        const yearElement = scrollElement?.querySelector<HTMLElement>(`[data-year="${visibleYear}"]`);
        if (!scrollElement || !yearElement) return;

        scrollElement.scrollTop = calculateCenteredScrollTop({
          targetOffset: yearElement.offsetTop,
          targetHeight: yearElement.offsetHeight,
          viewportHeight: scrollElement.clientHeight,
          scrollHeight: scrollElement.scrollHeight,
        });
      });
    });
  }, [visibleYear, yearPopoverOpened]);

  if (!rangeIsValid) throw new Error('DatePicker requires a valid minYear/maxYear range');
  if (!selectedDate) throw new Error('DatePicker value must be a valid YYYY-MM-DD local date');
  if (selectedDate.year < minYear || selectedDate.year > maxYear) {
    throw new Error('DatePicker value must be inside the configured year range');
  }

  const chooseDate = (monthIndex: number, day: number) => {
    onChange(formatLocalDate(visibleYear, monthIndex + 1, day));
    setYearPopoverOpened(false);
    onClose();
  };

  const yearTrigger = (
    <Glass
      component="button"
      type="button"
      ref={yearTargetRef}
      className="ui-date-picker__year-trigger"
      aria-label={`Выбрать год, сейчас ${visibleYear}`}
      aria-expanded={yearPopoverOpened}
      onClick={() => setYearPopoverOpened((current) => !current)}
    >
      {visibleYear}
    </Glass>
  );

  const closeAction = (
    <Link
      component="button"
      type="button"
      iconOnly
      disabled={yearPopoverOpened}
      aria-label="Закрыть календарь"
      onClick={onClose}
    >
      <CloseIcon />
    </Link>
  );

  return (
    <>
      <Panel
        side="right"
        opened={opened}
        floating
        backdrop
        onBackdropClick={yearPopoverOpened ? undefined : onClose}
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
                    if (cell.day === null) {
                      return <span className="ui-date-picker__empty-day" aria-hidden="true" key={`empty-${cellIndex}`} />;
                    }

                    const isSelected = selectedDate.year === visibleYear
                      && selectedDate.month === monthIndex + 1
                      && selectedDate.day === cell.day;

                    return (
                      <button
                        type="button"
                        className={`ui-date-picker__day${isSelected ? ' ui-date-picker__day--selected' : ''}`}
                        aria-label={formatDayLabel(visibleYear, monthIndex, cell.day, locale)}
                        aria-current={isSelected ? 'date' : undefined}
                        onClick={() => chooseDate(monthIndex, cell.day as number)}
                        key={cell.day}
                      >
                        <span className="ui-date-picker__day-label">{cell.day}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Panel>

      <Popover
        opened={opened && yearPopoverOpened}
        target={yearTargetRef.current ?? undefined}
        angle={false}
        backdrop
        onBackdropClick={() => setYearPopoverOpened(false)}
        style={{ width: '284px', maxWidth: 'calc(100vw - 24px)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Выберите год"
      >
        <div className="ui-date-picker__year-popover">
          <div className="ui-date-picker__year-scroll" ref={yearScrollRef}>
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
                    onClick={() => {
                      setVisibleYear(year);
                      setYearPopoverOpened(false);
                    }}
                  >
                    {year}
                  </KonstaButton>
                );
              })}
            </div>
          </div>
        </div>
      </Popover>
    </>
  );
}

export type { LocalDate };
