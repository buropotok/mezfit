import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { mountPrototype, type PrototypeController } from './prototypeRuntime';
import prototypeCss from './prototype.css?inline';
import type { LocalDate } from '../date-picker/datePickerDate';
import { addDays, toDate, WEEKDAY_LABELS } from './dateMath';

const weekOverrideCss = `
:host {
  height: 44px;
}
.text-only-stage {
  width: 100%;
}
.tab-strip {
  overflow: hidden;
}
.tab-link {
  flex: 1 1 0;
  width: 0;
  min-width: 0;
  padding: 0;
}
.tab-label {
  width: 100%;
}
.ui-day-schedule-week-label {
  display: grid;
  place-items: center;
  align-content: center;
  width: 100%;
  height: 100%;
  gap: 0;
}
.ui-day-schedule-week-label > span {
  font-family: var(--ui-font-family);
  font-size: var(--ui-font-size-caption);
  line-height: var(--ui-line-height-caption);
  font-weight: var(--ui-font-weight-medium);
  color: rgba(255,255,255,.55);
}
.ui-day-schedule-week-label > strong {
  font-family: var(--ui-font-family);
  font-size: var(--ui-font-size-body);
  line-height: var(--ui-line-height-body);
  font-weight: var(--ui-font-weight-medium);
  color: inherit;
}
:host([data-preview="true"]) .selector-track,
:host([data-preview="true"]) .lens-viewport,
:host([data-suppress-selector="true"]) .selector-track {
  display: none;
}
`;

export type WeekSceneHandle = {
  tapIndex: (index: number) => void;
  selectIndex: (index: number) => void;
};

type WeekSceneProps = {
  monday: LocalDate;
  selectedIndex: number;
  preview?: boolean;
  suppressSelector?: boolean;
  onSelect?: (index: number) => void;
};

export const WeekScene = forwardRef<WeekSceneHandle, WeekSceneProps>(function WeekScene({
  monday,
  selectedIndex,
  preview = false,
  suppressSelector = false,
  onSelect,
}, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PrototypeController | null>(null);
  const latestSelect = useRef(onSelect);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(monday, index)),
    [monday],
  );

  useLayoutEffect(() => {
    latestSelect.current = onSelect;
  }, [onSelect]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setShadow(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
  }, []);

  useLayoutEffect(() => {
    if (!shadow || preview) return;
    controllerRef.current = mountPrototype(shadow, selectedIndex, index => latestSelect.current?.(index));
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [preview, shadow, monday]);

  useLayoutEffect(() => {
    if (preview) return;
    controllerRef.current?.setValue(selectedIndex);
  }, [preview, selectedIndex]);

  useImperativeHandle(ref, () => ({
    tapIndex(index: number) {
      shadow?.querySelectorAll<HTMLButtonElement>('.tab-link')[index]?.click();
    },
    selectIndex(index: number) {
      controllerRef.current?.setValue(index);
    },
  }), [shadow]);

  return (
    <div
      ref={hostRef}
      data-preview={preview || undefined}
      data-suppress-selector={suppressSelector || undefined}
      className="ui-day-schedule__week-scene"
    >
      {shadow && createPortal(
        <>
          <style>{prototypeCss}</style>
          <style>{weekOverrideCss}</style>
          <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
            <filter id="standalone-lens-filter" colorInterpolationFilters="sRGB" />
          </svg>
          <div className="text-only-stage">
            <div className="optical-tabs-playground">
              <div className="toolbar-pane" id="toolbar-pane">
                <div className="selector-mask">
                  <div className="tab-strip" id="tab-strip" role="tablist" aria-label="Дни недели">
                    {dates.map((day, index) => (
                      <button
                        className={`tab-link${index === selectedIndex ? ' active' : ''}`}
                        type="button"
                        key={day}
                        data-index={index}
                        role="tab"
                        aria-selected={index === selectedIndex}
                        aria-label={`${WEEKDAY_LABELS[index]} ${toDate(day).day}`}
                      >
                        <span className="tab-label">
                          <span className="ui-day-schedule-week-label">
                            <span>{WEEKDAY_LABELS[index]}</span>
                            <strong>{toDate(day).day}</strong>
                          </span>
                        </span>
                      </button>
                    ))}
                    <span className="selector-track" id="selector-track" aria-hidden="true">
                      <span className="selector" id="selector" />
                    </span>
                  </div>
                </div>
              </div>
              <div className="lens-viewport" id="lens-viewport" aria-hidden="true">
                <span className="lens-track" id="lens-track">
                  <span className="lens" id="lens" />
                </span>
              </div>
            </div>
          </div>
        </>,
        shadow,
      )}
    </div>
  );
});
