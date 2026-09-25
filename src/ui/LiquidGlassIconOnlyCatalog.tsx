import { useState } from 'react';
import { Button, Text } from './primitives';
import { LiquidGlassIconOnly, type LiquidGlassIconOnlyTab } from './LiquidGlassIconOnly';
import './LiquidGlassIconOnlyCatalog.css';


const prototypeTabs: readonly LiquidGlassIconOnlyTab[] = [
  { value: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { value: 'clients', label: 'Клиенты', icon: 'users' },
  { value: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { value: 'analytics', label: 'Аналитика', icon: 'chart-dots-2' },
  { value: 'settings', label: 'Настройки', icon: 'settings' },
];

const clientTabs: readonly LiquidGlassIconOnlyTab[] = prototypeTabs.map(tab => tab.value === 'clients'
  ? { value: 'training', label: 'Тренировка', icon: 'barbell' }
  : tab);

export function LiquidGlassIconOnlyCatalog() {
  const [mode, setMode] = useState<'coach' | 'client'>('coach');
  const tabs = mode === 'coach' ? prototypeTabs : clientTabs;
  const [hidden, setHidden] = useState(true);
  const [value, setValue] = useState('today');

  return (
    <section className="ui-kit-liquid-glass-icon-only" aria-labelledby="ui-kit-liquid-glass-icon-only-title">
      <div className="ui-kit-liquid-glass-icon-only__header">
        <Text id="ui-kit-liquid-glass-icon-only-title" variant="title">Liquid Glass Icon Only</Text>
        <Text variant="caption" tone="muted">{mode === 'coach' ? 'Тренер' : 'Клиент'} · hidden={String(hidden)}</Text>
        <Button variant="secondary" onClick={() => setHidden((current) => !current)}>
          {hidden ? 'Показать' : 'Скрыть'}
        </Button>
        <Button variant="secondary" onClick={() => {
          setMode(current => current === 'coach' ? 'client' : 'coach');
          setValue(current => current === 'clients' ? 'training' : current === 'training' ? 'clients' : current);
        }}>Сменить режим</Button>
      </div>
      <div className="ui-kit-liquid-glass-icon-only__stage">
        <LiquidGlassIconOnly
          tabs={tabs}
          value={value}
          onValueChange={setValue}
          hidden={hidden}
        />
      </div>
      <Text>{tabs.find(tab => tab.value === value)?.label}</Text>
    </section>
  );
}