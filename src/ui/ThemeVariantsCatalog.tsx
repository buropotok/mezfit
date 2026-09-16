import type { CSSProperties, ReactNode } from 'react';
import { Divider, IconButton, Surface, Tabs, TabsContent, TabsList, TabsTrigger, Text } from './index';
import barbellFilledIconUrl from './icons/barbell-filled.svg';
import barbellIconUrl from './icons/barbell.svg';
import calendarFilledIconUrl from './icons/calendar-filled.svg';
import calendarIconUrl from './icons/calendar.svg';
import clipboardFilledIconUrl from './icons/clipboard-text-filled.svg';
import clipboardIconUrl from './icons/clipboard-text.svg';
import homeFilledIconUrl from './icons/home-filled.svg';
import homeIconUrl from './icons/home.svg';
import settingsIconUrl from './icons/settings.svg';

type MaskIconProps = { src: string };

function MaskIcon({ src }: MaskIconProps) {
  return <span className="ui-kit-mask-icon" style={{ '--ui-kit-mask-icon': `url("${src}")` } as CSSProperties} />;
}

const tabs = [
  { value: 'overview', label: 'Обзор', outline: homeIconUrl, filled: homeFilledIconUrl },
  { value: 'program', label: 'Программа', outline: clipboardIconUrl, filled: clipboardFilledIconUrl },
  { value: 'exercises', label: 'Упражнения', outline: barbellIconUrl, filled: barbellFilledIconUrl },
  { value: 'calendar', label: 'Календарь', outline: calendarIconUrl, filled: calendarFilledIconUrl },
] as const;

function IconTabs({ theme = 'default' }: { theme?: 'default' | 'glass' }) {
  return (
    <Tabs defaultValue="overview" mode="icon" theme={theme}>
      <TabsList aria-label={`Icon tabs ${theme}`}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            icon={{
              outline: <MaskIcon src={tab.outline} />,
              filled: <MaskIcon src={tab.filled} />,
            }}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function TextTabs({ theme = 'default' }: { theme?: 'default' | 'glass' }) {
  return (
    <Tabs defaultValue="overview" theme={theme}>
      <TabsList aria-label={`Text tabs ${theme}`}>
        <TabsTrigger value="overview">Обзор</TabsTrigger>
        <TabsTrigger value="program">Программа</TabsTrigger>
        <TabsTrigger value="exercises">Упражнения</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" />
      <TabsContent value="program" />
      <TabsContent value="exercises" />
    </Tabs>
  );
}

function GlassStage({ children }: { children: ReactNode }) {
  return (
    <div className="ui-kit-glass-stage">
      <div className="ui-kit-glass-stage__backdrop" aria-hidden="true">
        <Text variant="headline">Тренировка сегодня</Text>
        <Text tone="muted">Жим лёжа · тяга блока · приседания · 18 подходов</Text>
      </div>
      <div className="ui-kit-glass-stage__foreground">{children}</div>
    </div>
  );
}

export function ThemeVariantsCatalog() {
  return (
    <div className="ui-kit-page ui-kit-page--theme-variants">
      <Surface as="section" className="ui-kit-section">
        <Text variant="title">Surface themes</Text>
        <Text variant="caption" tone="muted">theme omitted = current default. Glass owns its border; the border prop belongs only to default Surface.</Text>
        <Divider />
        <div className="ui-kit-stack">
          <Surface style={{ padding: 'var(--ui-space-3)' }}><Text>Default Surface</Text></Surface>
          <GlassStage><Surface theme="glass" style={{ padding: 'var(--ui-space-3)' }}><Text>Glass Surface</Text></Surface></GlassStage>
        </div>
      </Surface>

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">IconButton themes</Text>
        <Divider />
        <div className="ui-kit-row">
          <IconButton label="Default settings"><MaskIcon src={settingsIconUrl} /></IconButton>
          <GlassStage><IconButton label="Glass settings" theme="glass"><MaskIcon src={settingsIconUrl} /></IconButton></GlassStage>
        </div>
      </Surface>

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">Tabs variants</Text>
        <Text variant="caption" tone="muted">Theme and mode are independent. Icon mode requires outline + filled icon pairs and springs the selected icon.</Text>
        <Divider />
        <div className="ui-kit-stack">
          <div><Text variant="footnote" tone="muted">Default · text</Text><TextTabs /></div>
          <div><Text variant="footnote" tone="muted">Glass · text</Text><GlassStage><TextTabs theme="glass" /></GlassStage></div>
          <div><Text variant="footnote" tone="muted">Default · icon</Text><IconTabs /></div>
          <div><Text variant="footnote" tone="muted">Glass · icon</Text><GlassStage><IconTabs theme="glass" /></GlassStage></div>
        </div>
      </Surface>
    </div>
  );
}
