import { useState, type CSSProperties } from 'react';
import { Button, Text } from './index';
import { LiquidGlassIconOnly, type LiquidGlassIconOnlyTab } from './LiquidGlassIconOnly';
import calendarFilledUrl from './icons/liquid-glass-calendar-event-filled.svg';
import calendarOutlineUrl from './icons/liquid-glass-calendar-event-outline.svg';
import usersFilledUrl from './icons/liquid-glass-users-filled.svg';
import usersOutlineUrl from './icons/liquid-glass-users-outline.svg';
import programsFilledUrl from './icons/liquid-glass-clipboard-list-filled.svg';
import programsOutlineUrl from './icons/liquid-glass-clipboard-list-outline.svg';
import analyticsFilledUrl from './icons/liquid-glass-chart-dots-2-filled.svg';
import analyticsOutlineUrl from './icons/liquid-glass-chart-dots-2-outline.svg';
import settingsFilledUrl from './icons/liquid-glass-settings-filled.svg';
import settingsOutlineUrl from './icons/liquid-glass-settings-outline.svg';
import './LiquidGlassIconOnlyCatalog.css';

type PrototypeIconProps = { src: string };

function PrototypeIcon({ src }: PrototypeIconProps) {
  return (
    <span
      className="ui-kit-liquid-glass-icon-only__icon"
      style={{ '--ui-kit-liquid-glass-icon-only-icon': `url("${src}")` } as CSSProperties}
    />
  );
}

const prototypeTabs: readonly LiquidGlassIconOnlyTab[] = [
  { value: 'today', label: 'Сегодня', icon: { outline: <PrototypeIcon src={calendarOutlineUrl} />, filled: <PrototypeIcon src={calendarFilledUrl} /> } },
  { value: 'clients', label: 'Клиенты', icon: { outline: <PrototypeIcon src={usersOutlineUrl} />, filled: <PrototypeIcon src={usersFilledUrl} /> } },
  { value: 'programs', label: 'Программы', icon: { outline: <PrototypeIcon src={programsOutlineUrl} />, filled: <PrototypeIcon src={programsFilledUrl} /> } },
  { value: 'analytics', label: 'Аналитика', icon: { outline: <PrototypeIcon src={analyticsOutlineUrl} />, filled: <PrototypeIcon src={analyticsFilledUrl} /> } },
  { value: 'settings', label: 'Настройки', icon: { outline: <PrototypeIcon src={settingsOutlineUrl} />, filled: <PrototypeIcon src={settingsFilledUrl} /> } },
];

export function LiquidGlassIconOnlyCatalog() {
  const [hidden, setHidden] = useState(true);
  const [value, setValue] = useState('today');

  return (
    <section className="ui-kit-liquid-glass-icon-only" aria-labelledby="ui-kit-liquid-glass-icon-only-title">
      <div className="ui-kit-liquid-glass-icon-only__header">
        <Text id="ui-kit-liquid-glass-icon-only-title" variant="title">Liquid Glass Icon Only</Text>
        <Text variant="caption" tone="muted">Independent primitive · prototype icons · hidden={String(hidden)}</Text>
        <Button variant="secondary" onClick={() => setHidden((current) => !current)}>
          {hidden ? 'Показать' : 'Скрыть'}
        </Button>
      </div>
      <div className="ui-kit-liquid-glass-icon-only__stage">
        <LiquidGlassIconOnly
          tabs={prototypeTabs}
          value={value}
          onValueChange={setValue}
          hidden={hidden}
        />
      </div>
    </section>
  );
}