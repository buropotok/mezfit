import { useState } from 'react';
import { Button, Surface, Text } from './primitives';
import { LiquidGlassTabsNoFab, type LiquidGlassTabsNoFabTab } from './LiquidGlassTabsNoFab';

const tabs: readonly LiquidGlassTabsNoFabTab[] = [
  { value: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { value: 'clients', label: 'Клиенты', icon: 'users' },
  { value: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { value: 'analytics', label: 'Аналитика', icon: 'chart-dots-2' },
  { value: 'settings', label: 'Настройки', icon: 'settings' },
];

export function LiquidGlassTabsNoFabCatalog() {
  const [hidden, setHidden] = useState(true);
  const [value, setValue] = useState('today');

  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Liquid Glass Tabs No Fab</Text>
      <Text variant="caption" tone="muted">
        Центрированная liquid-анимация без FAB. Скрытие и повторный показ заново запускают entrance.
      </Text>
      <div className="ui-kit-row">
        <Button variant="secondary" onClick={() => setHidden(current => !current)}>
          {hidden ? 'Показать' : 'Скрыть'}
        </Button>
      </div>
      <div style={{ minHeight: 96, display: 'grid', alignItems: 'end' }}>
        <LiquidGlassTabsNoFab
          tabs={tabs}
          value={value}
          onValueChange={setValue}
          hidden={hidden}
        />
      </div>
      <Text variant="footnote" tone="muted">
        Активная вкладка: {tabs.find(tab => tab.value === value)?.label}
      </Text>
    </Surface>
  );
}
