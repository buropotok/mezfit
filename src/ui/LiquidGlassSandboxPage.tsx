import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { LiquidGlassContainer } from '@tinymomentum/liquid-glass-react';
import '@tinymomentum/liquid-glass-react/dist/components/LiquidGlassBase.css';
import { Text } from './index';
import type { UiIconPair } from './iconPair';
import { useLiquidGlassTabsController } from './LiquidGlassTabs';
import './liquid-glass-sandbox.css';

function svg(paths: ReactElement | ReactElement[], filled = false) {
  return (
    <svg
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? undefined : 'currentColor'}
      strokeLinecap={filled ? undefined : 'round'}
      strokeLinejoin={filled ? undefined : 'round'}
      strokeWidth={filled ? undefined : 2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

const homeIcon: UiIconPair = {
  outline: svg([
    <path key="roof" d="M5 12l-2 0l9 -9l9 9l-2 0" />,
    <path key="walls" d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />,
    <path key="door" d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />,
  ]),
  filled: svg(<path d="M12.707 2.293l9 9c.63 .63 .184 1.707 -.707 1.707h-1v6a3 3 0 0 1 -3 3h-1v-7a3 3 0 0 0 -2.824 -2.995l-.176 -.005h-2a3 3 0 0 0 -3 3v7h-1a3 3 0 0 1 -3 -3v-6h-1c-.89 0 -1.337 -1.077 -.707 -1.707l9 -9a1 1 0 0 1 1.414 0m.293 11.707a1 1 0 0 1 1 1v7h-4v-7a1 1 0 0 1 .883 -.993l.117 -.007z" />, true),
};

const workoutIcon: UiIconPair = {
  outline: svg([
    <path key="a" d="M2 12h1" />,
    <path key="b" d="M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2" />,
    <path key="c" d="M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1" />,
    <path key="d" d="M9 12h6" />,
    <path key="e" d="M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1" />,
    <path key="f" d="M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2" />,
  ]),
  filled: svg([
    <path key="a" d="M4 7a1 1 0 0 1 1 1v8a1 1 0 0 1 -2 0v-3h-1a1 1 0 0 1 0 -2h1v-3a1 1 0 0 1 1 -1" />,
    <path key="b" d="M20 7a1 1 0 0 1 1 1v3h1a1 1 0 0 1 0 2h-1v3a1 1 0 0 1 -2 0v-8a1 1 0 0 1 1 -1" />,
    <path key="c" d="M16 5a2 2 0 0 1 2 2v10a2 2 0 1 1 -4 0v-4h-4v4a2 2 0 1 1 -4 0v-10a2 2 0 1 1 4 0v4h4v-4a2 2 0 0 1 2 -2" />,
  ], true),
};

const calendarIcon: UiIconPair = {
  outline: svg([
    <rect key="r" height="16" rx="2" width="18" x="3" y="5" />,
    <path key="p" d="M16 3v4M8 3v4M3 11h18" />,
  ]),
  filled: svg(<path d="M16 2a1 1 0 0 1 .993 .883l.007 .117v1h1a3 3 0 0 1 2.995 2.824l.005 .176v12a3 3 0 0 1 -2.824 2.995l-.176 .005h-12a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-12a3 3 0 0 1 2.824 -2.995l.176 -.005h1v-1a1 1 0 0 1 1.993 -.117l.007 .117v1h6v-1a1 1 0 0 1 1 -1zm3 7h-14v9.625c0 .705 .386 1.286 .883 1.366l.117 .009h12c.513 0 .936 -.53 .993 -1.215l.007 -.16v-9.625z" />, true),
};

const settingsIcon: UiIconPair = {
  outline: svg([
    <path key="a" d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065" />,
    <path key="b" d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />,
  ]),
  filled: svg(<path d="M14.647 4.081a.724 .724 0 0 0 1.08 .448c2.439 -1.485 5.23 1.305 3.745 3.744a.724 .724 0 0 0 .447 1.08c2.775 .673 2.775 4.62 0 5.294a.724 .724 0 0 0 -.448 1.08c1.485 2.439 -1.305 5.23 -3.744 3.745a.724 .724 0 0 0 -1.08 .447c-.673 2.775 -4.62 2.775 -5.294 0a.724 .724 0 0 0 -1.08 -.448c-2.439 1.485 -5.23 -1.305 -3.745 -3.744a.724 .724 0 0 0 -.447 -1.08c-2.775 -.673 -2.775 -4.62 0 -5.294a.724 .724 0 0 0 .448 -1.08c-1.485 -2.439 1.305 -5.23 3.744 -3.745a.724 .724 0 0 0 1.08 -.447c.673 -2.775 4.62 -2.775 5.294 0M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0 -6" />, true),
};

type SandboxTab = {
  value: string;
  label: string;
  icon?: UiIconPair;
};

const iconTabs: SandboxTab[] = [
  { value: 'home', label: 'Главная', icon: homeIcon },
  { value: 'workout', label: 'Тренировки', icon: workoutIcon },
  { value: 'calendar', label: 'Календарь', icon: calendarIcon },
  { value: 'settings', label: 'Настройки', icon: settingsIcon },
];

const textTabs: SandboxTab[] = [
  { value: 'all', label: 'Все' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'history', label: 'История' },
];

function RealLiquidGlassMaterial() {
  return (
    <LiquidGlassContainer
      className="liquid-glass-sandbox__library-material"
      style={{ width: '100%', height: '100%', borderRadius: 'inherit' }}
      aria-hidden="true"
    />
  );
}

function SandboxTabs({
  mode,
  items,
  value,
  onValueChange,
}: {
  mode: 'default' | 'icon';
  items: SandboxTab[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const visualLayerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const indicatorSurfaceRef = useRef<HTMLDivElement>(null);

  const liquidGlass = useLiquidGlassTabsController({
    enabled: true,
    mode,
    activeValue: value,
    visualLayerRef,
    listRef,
    indicatorRef,
    indicatorSurfaceRef,
  });

  useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!list || !indicator) return;
    const active = Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > .ui-tabs__trigger'))
      .find((trigger) => trigger.dataset.uiTabValue === value);
    if (!active) return;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    indicator.style.width = `${active.offsetWidth}px`;
  }, [items, value]);

  return (
    <div className="ui-tabs liquid-glass-sandbox__experiment-tabs" data-ui-theme="liquidGlass" data-ui-mode={mode}>
      <div ref={visualLayerRef} className="ui-tabs__liquid-layer">
        <div className="liquid-glass-sandbox__container-material" aria-hidden="true">
          <RealLiquidGlassMaterial />
        </div>

        <div
          ref={listRef}
          className="ui-tabs__list ui-tabs__list--ready"
          role="tablist"
          onPointerDown={liquidGlass.handlers.onPointerDown}
          onPointerMove={liquidGlass.handlers.onPointerMove}
          onPointerUp={liquidGlass.handlers.onPointerUp}
          onPointerCancel={liquidGlass.handlers.onPointerCancel}
          onClickCapture={liquidGlass.handlers.onClickCapture}
        >
          {items.map((item) => {
            const active = item.value === value;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-state={active ? 'active' : 'inactive'}
                data-ui-tab-value={item.value}
                className="ui-tabs__trigger"
                onClick={() => onValueChange(item.value)}
              >
                {mode === 'icon' && item.icon ? (
                  <>
                    <span className="ui-tabs__icon" aria-hidden="true">
                      <span className="ui-tabs__icon-outline">{item.icon.outline}</span>
                      <span className="ui-tabs__icon-filled">{item.icon.filled}</span>
                    </span>
                    <span className="ui-tabs__label">{item.label}</span>
                  </>
                ) : item.label}
              </button>
            );
          })}

          <div ref={indicatorRef} className="ui-tabs__active-indicator ui-tabs__active-indicator--moving" aria-hidden="true">
            <div ref={indicatorSurfaceRef} className="ui-tabs__active-indicator-surface">
              <RealLiquidGlassMaterial />
            </div>
          </div>
        </div>

        <div ref={liquidGlass.lensRef} className="ui-tabs__press-lens" aria-hidden="true">
          <RealLiquidGlassMaterial />
        </div>
      </div>
    </div>
  );
}

export function LiquidGlassSandboxPage() {
  const [iconValue, setIconValue] = useState('workout');
  const [textValue, setTextValue] = useState('today');

  return (
    <main className="liquid-glass-sandbox">
      <section className="liquid-glass-sandbox__intro">
        <Text variant="large-title">Liquid Glass sandbox</Text>
        <Text tone="muted">
          Постоянная React-песочница. Материал — настоящий @tinymomentum/liquid-glass-react, а физика — текущая Mezfit liquidGlass.
        </Text>
      </section>

      <section className="liquid-glass-sandbox__copy">
        <Text variant="headline">Что здесь можно менять</Text>
        <Text>
          Все дальнейшие эксперименты с формой, таймингами и поведением будем делать только здесь. Production UI Kit остаётся нетронутым до визуального утверждения.
        </Text>
        <Text>
          Нажимай вкладки коротко и с удержанием. При переходе на другую вкладку линза раскрывается к T/2 и закрывается на второй половине пути.
        </Text>
        <Text>
          Главная · Тренировки · Календарь · Настройки · 0123456789 · ABCDEFGHIJKLMNOPQRSTUVWXYZ.
        </Text>

        <div className="liquid-glass-sandbox__gradient-card">
          <Text variant="headline">Цветной фон</Text>
          <Text>Нужен только для оценки реального distortion материала библиотеки.</Text>
        </div>

        <div className="liquid-glass-sandbox__spacer" />
      </section>

      <section className="liquid-glass-sandbox__text-tabs">
        <Text variant="footnote" tone="muted">mode=&quot;default&quot;</Text>
        <SandboxTabs mode="default" items={textTabs} value={textValue} onValueChange={setTextValue} />
      </section>

      <section className="liquid-glass-sandbox__bottom-nav">
        <SandboxTabs mode="icon" items={iconTabs} value={iconValue} onValueChange={setIconValue} />
      </section>
    </main>
  );
}
