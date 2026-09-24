import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  useStandaloneLiquidGlassIconOnlyStartup,
  type StandaloneLiquidGlassIconOnlyStartupItem,
} from './LiquidGlassIconOnlyStartup';
import { useStandaloneLiquidGlassIconOnlyRuntime } from './LiquidGlassIconOnlyRuntime';
import './LiquidGlassIconOnly.css';

export type LiquidGlassIconOnlyTab = {
  value: string;
  label: string;
  icon: {
    outline: ReactNode;
    filled: ReactNode;
  };
};

export type LiquidGlassIconOnlyProps = {
  tabs: readonly LiquidGlassIconOnlyTab[];
  value: string;
  onValueChange: (value: string) => void;
  hidden: boolean;
};

export function LiquidGlassIconOnly({
  tabs,
  value,
  onValueChange,
  hidden,
}: LiquidGlassIconOnlyProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorSurfaceRef = useRef<HTMLSpanElement>(null);

  const startupItems = useMemo<readonly StandaloneLiquidGlassIconOnlyStartupItem[]>(
    () => tabs.map((tab) => ({ value: tab.value, icon: tab.icon })),
    [tabs],
  );

  const startup = useStandaloneLiquidGlassIconOnlyStartup({
    enabled: true,
    hidden,
    items: startupItems,
    activeValue: value,
    listRef,
  });

  const runtime = useStandaloneLiquidGlassIconOnlyRuntime({
    enabled: !hidden && startup.state === 'visible',
    activeValue: value,
    listRef,
    indicatorRef,
    indicatorSurfaceRef,
  });

  const activeIndex = tabs.length === 0
    ? -1
    : Math.max(0, tabs.findIndex((tab) => tab.value === value));
  const share = tabs.length > 0 ? `${100 / tabs.length}%` : '100%';

  return (
    <div
      className="ui-liquid-glass-icon-only__shell"
      data-startup-state={startup.state}
      aria-hidden={startup.state === 'visible' ? undefined : true}
    >
      {runtime.filter}
      <div className="ui-liquid-glass-icon-only__visual-layer">
        <div
          ref={listRef}
          className="ui-liquid-glass-icon-only__pane"
          role="tablist"
          aria-label="Навигация"
          onPointerDown={runtime.handlers.onPointerDown}
          onPointerMove={runtime.handlers.onPointerMove}
          onPointerUp={runtime.handlers.onPointerUp}
          onPointerCancel={runtime.handlers.onPointerCancel}
          onClickCapture={runtime.handlers.onClickCapture}
        >
          {tabs.map((tab, index) => {
            const active = index === activeIndex;
            const slotStyle = { width: share, flexBasis: share } as CSSProperties;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                className="ui-liquid-glass-icon-only__tab"
                data-ui-tab-value={tab.value}
                data-state={active ? 'active' : 'inactive'}
                aria-selected={active}
                aria-label={tab.label}
                title={tab.label}
                tabIndex={active ? 0 : -1}
                style={slotStyle}
                onClick={() => {
                  if (!hidden && tab.value !== value) onValueChange(tab.value);
                }}
              >
                <span className="ui-liquid-glass-icon-only__icon-wrap" aria-hidden="true">
                  <span className="ui-liquid-glass-icon-only__icon ui-liquid-glass-icon-only__icon--outline">
                    {tab.icon.outline}
                  </span>
                  <span className="ui-liquid-glass-icon-only__icon ui-liquid-glass-icon-only__icon--filled">
                    {tab.icon.filled}
                  </span>
                </span>
                <span className="ui-liquid-glass-icon-only__label">{tab.label}</span>
              </button>
            );
          })}
          <span
            ref={indicatorRef}
            className="ui-liquid-glass-icon-only__selector-track"
            aria-hidden="true"
          >
            <span
              ref={indicatorSurfaceRef}
              className="ui-liquid-glass-icon-only__selector"
            />
          </span>
        </div>

        <span
          ref={runtime.lensTrackRef}
          className="ui-liquid-glass-icon-only__lens-track"
          aria-hidden="true"
        >
          <span
            ref={runtime.lensRef}
            className="ui-liquid-glass-icon-only__lens"
            style={runtime.lensStyle}
          />
        </span>
      </div>
      {startup.overlay}
    </div>
  );
}
