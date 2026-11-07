import type { ReactNode } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { GlassSurface } from '../ui/GlassSurface';
import { LiquidGlassTextOnly } from '../ui/LiquidGlassTextOnly';
import { Text } from '../ui';
import './profile-workspace.css';

export type ProfileTab = 'basics' | 'program' | 'exercises' | 'calendar' | 'progress' | 'history' | 'discussions';
export type ProfileViewContext = { kind: 'self'; name: string } | { kind: 'contact'; contact: CloudContact };
const tabs: ReadonlyArray<{ value: ProfileTab; label: string }> = [
  { value: 'basics', label: 'Основные' },
  { value: 'program', label: 'Программа' },
  { value: 'exercises', label: 'Упражнения' },
  { value: 'calendar', label: 'Календарь' },
  { value: 'progress', label: 'Прогресс' },
  { value: 'history', label: 'История' },
];
const contactPlaceholders: Partial<Record<ProfileTab, string>> = {
  calendar: 'Плановые и завершённые тренировки клиента появятся после реализации WorkoutOccurrence.',
  progress: 'Замеры, фотографии и производные показатели будут добавлены после тренировочного ядра.',
  history: 'Хронологическая история WorkoutSession появится вместе с PLAN / FACT анализом.',
};

/** Shared screen composition; each viewer supplies only its authorized tab content. */
export function ProfileWorkspace({ view, tab, onTabChange, basicsContent, programContent, exercisesContent, discussionsContent, hideTabs = false }: {
  view: ProfileViewContext;
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  basicsContent?: ReactNode;
  programContent?: ReactNode;
  exercisesContent?: ReactNode;
  discussionsContent?: ReactNode;
  hideTabs?: boolean;
}) {
  const name = view.kind === 'self' ? view.name : view.contact.displayName;
  const visibleTabs = view.kind === 'contact' && discussionsContent !== undefined
    ? [...tabs, { value: 'discussions' as const, label: 'Обсуждения' }] : tabs;
  const label = visibleTabs.find(item => item.value === tab)?.label;
  const content = tab === 'basics' ? basicsContent : tab === 'program' ? programContent
    : tab === 'exercises' ? exercisesContent : tab === 'discussions' ? discussionsContent : undefined;
  return <div className="stack client-workspace">
    {!hideTabs ? <div className="client-workspace-tabs" role="group"
      aria-label={view.kind === 'contact' ? `Разделы клиента ${name}` : 'Разделы моего профиля'}>
      <LiquidGlassTextOnly tabs={visibleTabs} value={tab} hidden={false} fullWidth
        onValueChange={value => {
          const selected = visibleTabs.find(item => item.value === value);
          if (selected) onTabChange(selected.value);
        }} />
    </div> : null}
    {content !== undefined ? content : <GlassSurface component="section" preset="modalTuned" optics={false}
      shape="auto" contentClassName="stack client-workspace-surface">
      <Text variant="title">{label}</Text>
      <Text variant="body" tone="muted">{view.kind === 'contact'
        ? contactPlaceholders[tab] ?? 'Этот раздел профиля пока недоступен.'
        : 'Этот раздел собственного профиля пока недоступен.'}</Text>
    </GlassSurface>}
  </div>;
}
