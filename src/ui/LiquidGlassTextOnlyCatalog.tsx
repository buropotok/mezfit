import { useState } from 'react';
import { Button, Text } from './primitives';
import { LiquidGlassTextOnly, type LiquidGlassTextOnlyTab } from './LiquidGlassTextOnly';
import './LiquidGlassTextOnlyCatalog.css';

const prototypeTabs: readonly LiquidGlassTextOnlyTab[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'clients', label: 'Клиенты' },
  { value: 'programs', label: 'Программы' },
  { value: 'analytics', label: 'Аналитика' },
  { value: 'workouts', label: 'Тренировки' },
  { value: 'measurements', label: 'Измерения' },
  { value: 'settings', label: 'Настройки' },
];

export function LiquidGlassTextOnlyCatalog() {
  const [hidden, setHidden] = useState(false);
  const [value, setValue] = useState('today');

  return (
    <section className="ui-kit-liquid-glass-text-only" aria-labelledby="ui-kit-liquid-glass-text-only-title">
      <div className="ui-kit-liquid-glass-text-only__header">
        <Text id="ui-kit-liquid-glass-text-only-title" variant="title">Liquid Glass Text Only</Text>
        <Text variant="caption" tone="muted">44 px · Caption · horizontal swipe</Text>
        <Button variant="secondary" onClick={() => setHidden(current => !current)}>
          {hidden ? 'Показать' : 'Скрыть'}
        </Button>
      </div>
      <div className="ui-kit-liquid-glass-text-only__stage">
        <LiquidGlassTextOnly
          tabs={prototypeTabs}
          value={value}
          onValueChange={setValue}
          hidden={hidden}
        />
      </div>
      <div className="ui-kit-liquid-glass-text-only__value">
        <Text variant="caption" tone="muted">Выбрано: {prototypeTabs.find(tab => tab.value === value)?.label}</Text>
      </div>
    </section>
  );
}
