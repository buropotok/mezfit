import { useState } from 'react';
import { Button, Text } from './primitives';
import { LiquidGlassTabsNoFab, type LiquidGlassTabsNoFabTab } from './LiquidGlassTabsNoFab';
import './LiquidGlassTabsNoFabCatalog.css';

const tabs: readonly LiquidGlassTabsNoFabTab[] = [
  { value: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { value: 'clients', label: 'Клиенты', icon: 'users' },
  { value: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { value: 'analytics', label: 'Аналитика', icon: 'chart-dots-2' },
  { value: 'settings', label: 'Настройки', icon: 'settings' },
];

const backdropLines = [
  'Сегодня · Клиенты · Программы',
  'Тренировки · Прогресс · Аналитика',
  'Подходы · Повторы · Нагрузка',
] as const;

export function LiquidGlassTabsNoFabCatalog() {
  const [hidden, setHidden] = useState(true);
  const [value, setValue] = useState('today');

  return (
    <section className="ui-kit-liquid-glass-tabs-no-fab" aria-labelledby="ui-kit-liquid-glass-tabs-no-fab-title">
      <div className="ui-kit-liquid-glass-tabs-no-fab__header">
        <Text id="ui-kit-liquid-glass-tabs-no-fab-title" variant="title">Liquid Glass Tabs No Fab</Text>
        <Text variant="caption" tone="muted">
          Центрированная liquid-анимация без FAB. Скрытие и повторный показ заново запускают entrance.
        </Text>
        <Button variant="secondary" onClick={() => setHidden(current => !current)}>
          {hidden ? 'Показать' : 'Скрыть'}
        </Button>
      </div>

      <div className="ui-kit-liquid-glass-tabs-no-fab__stage">
        <div className="ui-kit-liquid-glass-tabs-no-fab__backdrop" aria-hidden="true">
          {backdropLines.map((line, index) => (
            <Text
              key={line}
              variant="large-title"
              className="ui-kit-liquid-glass-tabs-no-fab__backdrop-line"
              data-offset={index === 1 ? 'shifted' : undefined}
            >
              {line}
            </Text>
          ))}
        </div>
        <div className="ui-kit-liquid-glass-tabs-no-fab__control">
          <LiquidGlassTabsNoFab
            tabs={tabs}
            value={value}
            onValueChange={setValue}
            hidden={hidden}
          />
        </div>
      </div>

      <Text variant="footnote" tone="muted" className="ui-kit-liquid-glass-tabs-no-fab__status">
        Активная вкладка: {tabs.find(tab => tab.value === value)?.label}
      </Text>
    </section>
  );
}
